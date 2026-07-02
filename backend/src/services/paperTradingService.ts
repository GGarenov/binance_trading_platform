import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { getStrategyDefinition } from "../strategies";
import type { StrategyInstance } from "../strategies/types";
import { fetchKlines } from "./binance/rest";
import { priceStream } from "./binance/stream";
import {
  fetchSymbolFilters,
  fetchTestnetBalances,
  testnetKeysConfigured,
} from "./binance/testnet";
import { executeTestnetFill } from "./orderExecutor";
import {
  DEFAULT_FEE_RATE,
  executeFill,
  type Balances,
  type ExecutionOptions,
} from "./simulation";

export type SessionKind = "paper" | "live_testnet";

interface RunningSession {
  sessionId: number;
  kind: SessionKind;
  pair: string;
  strategy: StrategyInstance;
  // In-memory mirror of the DB balances; the DB is updated on every trade.
  balances: Balances;
  execution: ExecutionOptions;
  lastPrice: number | null;
  lastPriceAt: number | null;
  unsubscribe: (() => void) | null;
  /** Guards against overlapping async trade processing between price ticks. */
  processing: boolean;
}

/** Indicator warm-up for live sessions samples hourly, matching WARMUP_INTERVAL. */
const WARMUP_INTERVAL = "1h";
const WARMUP_INTERVAL_MS = 60 * 60_000;

/**
 * Owns all running paper sessions in this process. Each session subscribes to
 * the shared Binance price stream, feeds ticks to its strategy instance and
 * persists any resulting trades. Sessions are resumed from the DB on server
 * start, so they survive restarts (spec question 9.3).
 */
class PaperTradingManager {
  private sessions = new Map<number, RunningSession>();

  async startSession(
    configId: number,
    initialBalance: number,
    feeRate: number,
    kind: SessionKind = "paper"
  ) {
    const config = await prisma.strategyConfig.findUnique({
      where: { id: configId },
      include: { strategy: true },
    });
    if (!config) throw new HttpError(404, `Config ${configId} not found`);
    const definition = getStrategyDefinition(config.strategy.slug);
    if (!definition) {
      throw new HttpError(500, `No implementation registered for strategy '${config.strategy.slug}'`);
    }

    if (kind === "live_testnet") {
      if (!testnetKeysConfigured()) {
        throw new HttpError(
          400,
          "Binance testnet API keys are not configured. Set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET in backend/.env and restart the server."
        );
      }
      // Fail fast if the testnet wallet can't back the requested budget:
      // otherwise every buy order would be rejected one by one later.
      const params = definition.paramsSchema.parse(config.params);
      const pair = (params as { pair: string }).pair;
      const filters = await fetchSymbolFilters(pair); // also validates the pair exists on testnet
      const wallet = await fetchTestnetBalances();
      const available = wallet[filters.quoteAsset] ?? 0;
      if (available < initialBalance) {
        throw new HttpError(
          400,
          `Testnet wallet has ${available.toFixed(2)} ${filters.quoteAsset} free, less than the requested budget of ${initialBalance}`
        );
      }
    }

    const session = await prisma.paperSession.create({
      data: {
        configId,
        status: "running",
        kind,
        initialBalance,
        quoteBalance: initialBalance,
        baseBalance: 0,
        feeRate,
      },
    });

    await this.boot(session.id);
    return session;
  }

  /** Called once on server startup: revive every session marked running in the DB. */
  async resumeRunningSessions() {
    const running = await prisma.paperSession.findMany({ where: { status: "running" } });
    for (const session of running) {
      try {
        await this.boot(session.id);
        console.log(`Resumed paper session ${session.id}`);
      } catch (err) {
        console.error(`Failed to resume paper session ${session.id}:`, err);
      }
    }
  }

  async stopSession(sessionId: number) {
    const running = this.sessions.get(sessionId);
    if (running) {
      running.unsubscribe?.();
      this.sessions.delete(sessionId);
    }

    const session = await prisma.paperSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new HttpError(404, `Session ${sessionId} not found`);
    if (session.status === "stopped") return session;

    return prisma.paperSession.update({
      where: { id: sessionId },
      data: { status: "stopped", stoppedAt: new Date() },
    });
  }

  /** Live, in-memory view of a running session (current price, equity) — null if not running here. */
  getLiveState(sessionId: number) {
    const s = this.sessions.get(sessionId);
    if (!s || s.lastPrice === null) return null;
    const equity = s.balances.quoteBalance + s.balances.baseBalance * s.lastPrice;
    return {
      currentPrice: s.lastPrice,
      priceUpdatedAt: s.lastPriceAt,
      equity,
      quoteBalance: s.balances.quoteBalance,
      baseBalance: s.balances.baseBalance,
    };
  }

  private async boot(sessionId: number) {
    const session = await prisma.paperSession.findUnique({
      where: { id: sessionId },
      include: { config: { include: { strategy: true } } },
    });
    if (!session) throw new Error(`Session ${sessionId} disappeared`);

    const definition = getStrategyDefinition(session.config.strategy.slug)!;
    const params = definition.paramsSchema.parse(session.config.params);
    const pair = (params as { pair: string }).pair;

    // The strategy's clock starts when the session was created, not when the
    // process (re)started — otherwise a restart would reset DCA's schedule.
    const strategy = definition.create(params as never, session.startedAt.getTime());

    if (session.strategyState !== null) {
      strategy.setState(session.strategyState);
    } else {
      // Fresh indicator strategies (MA, RSI) would otherwise wait ~warmup
      // hours before their first decision: prime them from recent history.
      const warmupCandles =
        typeof definition.warmupCandles === "function"
          ? definition.warmupCandles(params as never)
          : definition.warmupCandles ?? 0;
      if (warmupCandles > 0) {
        const now = Date.now();
        const candles = await fetchKlines(
          pair,
          WARMUP_INTERVAL,
          now - warmupCandles * WARMUP_INTERVAL_MS,
          now
        );
        for (const c of candles) {
          strategy.onPrice(
            { price: c.close, timestamp: c.closeTime },
            { quoteBalance: 0, baseBalance: 0 }
          );
        }
        // Persist the primed state so a restart doesn't re-warm (and so the
        // strategy can't warm up twice on top of live state).
        await prisma.paperSession.update({
          where: { id: sessionId },
          data: { strategyState: JSON.parse(JSON.stringify(strategy.getState())) },
        });
      }
    }

    const kind = session.kind as SessionKind;
    let balances: Balances = {
      quoteBalance: Number(session.quoteBalance),
      baseBalance: Number(session.baseBalance),
    };

    // A testnet session's coins live in a real (testnet) wallet that we don't
    // exclusively own — the user may have traded manually, or a previous crash
    // may have left the DB stale. Never trust the local record blindly.
    if (kind === "live_testnet") {
      balances = await this.reconcileWithTestnet(sessionId, pair, balances);
    }

    const running: RunningSession = {
      sessionId,
      kind,
      pair,
      strategy,
      balances,
      execution: { feeRate: Number(session.feeRate ?? DEFAULT_FEE_RATE), slippageBps: 0 },
      lastPrice: null,
      lastPriceAt: null,
      unsubscribe: null,
      processing: false,
    };
    this.sessions.set(sessionId, running);

    running.unsubscribe = await priceStream.subscribe(pair, (price, eventTimeMs) => {
      void this.onPrice(running, price, eventTimeMs);
    });
  }

  /**
   * Clamps the session's recorded balances to what the testnet wallet
   * actually holds. The session can never spend or sell more than the wallet
   * has, so if the wallet shrank (manual trades, other sessions), shrink the
   * session's view too and persist the correction.
   */
  private async reconcileWithTestnet(
    sessionId: number,
    pair: string,
    recorded: Balances
  ): Promise<Balances> {
    const filters = await fetchSymbolFilters(pair);
    const wallet = await fetchTestnetBalances();
    const reconciled: Balances = {
      quoteBalance: Math.min(recorded.quoteBalance, wallet[filters.quoteAsset] ?? 0),
      baseBalance: Math.min(recorded.baseBalance, wallet[filters.baseAsset] ?? 0),
    };

    const drifted =
      Math.abs(reconciled.quoteBalance - recorded.quoteBalance) > 1e-8 ||
      Math.abs(reconciled.baseBalance - recorded.baseBalance) > 1e-8;
    if (drifted) {
      console.warn(
        `Testnet session ${sessionId}: reconciled balances against wallet ` +
          `(quote ${recorded.quoteBalance} -> ${reconciled.quoteBalance}, ` +
          `base ${recorded.baseBalance} -> ${reconciled.baseBalance})`
      );
      await prisma.paperSession.update({
        where: { id: sessionId },
        data: {
          quoteBalance: reconciled.quoteBalance,
          baseBalance: reconciled.baseBalance,
        },
      });
    }
    return reconciled;
  }

  private async onPrice(running: RunningSession, price: number, timestamp: number) {
    running.lastPrice = price;
    running.lastPriceAt = timestamp;

    // Ticks arrive every second; DB writes from a previous tick may still be
    // in flight. Skipping a tick is harmless — the next one is a second away.
    if (running.processing) return;
    running.processing = true;

    try {
      const point = { price, timestamp };
      const decisions = running.strategy.onPrice(point, { ...running.balances });

      for (const decision of decisions) {
        // Paper fills are computed locally; testnet fills come back from a
        // real exchange order with the actual executed price and commission.
        const fill =
          running.kind === "live_testnet"
            ? await executeTestnetFill(decision, running.pair, point, running.balances)
            : executeFill(decision, point, running.balances, running.execution);
        if (!fill) continue;

        await prisma.$transaction([
          prisma.simulatedTrade.create({
            data: {
              paperSessionId: running.sessionId,
              side: fill.side,
              price: fill.price,
              quantity: fill.quantity,
              quoteAmount: fill.quoteAmount,
              fee: fill.fee,
              intendedPrice: point.price,
              executedAt: new Date(fill.executedAt),
            },
          }),
          prisma.paperSession.update({
            where: { id: running.sessionId },
            data: {
              quoteBalance: running.balances.quoteBalance,
              baseBalance: running.balances.baseBalance,
              strategyState: JSON.parse(JSON.stringify(running.strategy.getState())),
            },
          }),
        ]);
      }
    } catch (err) {
      console.error(`Paper session ${running.sessionId}: failed to process tick`, err);
    } finally {
      running.processing = false;
    }
  }
}

export const paperTradingManager = new PaperTradingManager();
