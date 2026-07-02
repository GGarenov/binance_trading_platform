import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";
import { getStrategyDefinition } from "../strategies";
import type { StrategyInstance } from "../strategies/types";
import { priceStream } from "./binance/stream";

interface RunningSession {
  sessionId: number;
  pair: string;
  strategy: StrategyInstance;
  // In-memory mirror of the DB balances; the DB is updated on every trade.
  quoteBalance: number;
  baseBalance: number;
  lastPrice: number | null;
  lastPriceAt: number | null;
  unsubscribe: (() => void) | null;
  /** Guards against overlapping async trade processing between price ticks. */
  processing: boolean;
}

/**
 * Owns all running paper sessions in this process. Each session subscribes to
 * the shared Binance price stream, feeds ticks to its strategy instance and
 * persists any resulting trades. Sessions are resumed from the DB on server
 * start, so they survive restarts (spec question 9.3).
 */
class PaperTradingManager {
  private sessions = new Map<number, RunningSession>();

  async startSession(configId: number, initialBalance: number) {
    const config = await prisma.strategyConfig.findUnique({
      where: { id: configId },
      include: { strategy: true },
    });
    if (!config) throw new HttpError(404, `Config ${configId} not found`);
    if (!getStrategyDefinition(config.strategy.slug)) {
      throw new HttpError(500, `No implementation registered for strategy '${config.strategy.slug}'`);
    }

    const session = await prisma.paperSession.create({
      data: {
        configId,
        status: "running",
        initialBalance,
        quoteBalance: initialBalance,
        baseBalance: 0,
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
    const equity = s.quoteBalance + s.baseBalance * s.lastPrice;
    return {
      currentPrice: s.lastPrice,
      priceUpdatedAt: s.lastPriceAt,
      equity,
      quoteBalance: s.quoteBalance,
      baseBalance: s.baseBalance,
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
    }

    const running: RunningSession = {
      sessionId,
      pair,
      strategy,
      quoteBalance: Number(session.quoteBalance),
      baseBalance: Number(session.baseBalance),
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

  private async onPrice(running: RunningSession, price: number, timestamp: number) {
    running.lastPrice = price;
    running.lastPriceAt = timestamp;

    // Ticks arrive every second; DB writes from a previous tick may still be
    // in flight. Skipping a tick is harmless — the next one is a second away.
    if (running.processing) return;
    running.processing = true;

    try {
      const decisions = running.strategy.onPrice(
        { price, timestamp },
        { quoteBalance: running.quoteBalance, baseBalance: running.baseBalance }
      );

      for (const decision of decisions) {
        let side: "buy" | "sell";
        let quantity: number;
        let quoteAmount: number;

        if (decision.side === "buy") {
          if (decision.quoteAmount > running.quoteBalance) continue;
          side = "buy";
          quoteAmount = decision.quoteAmount;
          quantity = quoteAmount / price;
          running.quoteBalance -= quoteAmount;
          running.baseBalance += quantity;
        } else {
          quantity = Math.min(decision.quantity, running.baseBalance);
          if (quantity <= 0) continue;
          side = "sell";
          quoteAmount = quantity * price;
          running.baseBalance -= quantity;
          running.quoteBalance += quoteAmount;
        }

        await prisma.$transaction([
          prisma.simulatedTrade.create({
            data: {
              paperSessionId: running.sessionId,
              side,
              price,
              quantity,
              quoteAmount,
              executedAt: new Date(timestamp),
            },
          }),
          prisma.paperSession.update({
            where: { id: running.sessionId },
            data: {
              quoteBalance: running.quoteBalance,
              baseBalance: running.baseBalance,
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
