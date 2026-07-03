# Strategy Report Download — Implementation Notes

This document describes the standardized export feature for **backtests** and **live sessions** (paper + testnet) in CryptoStrategy Lab: what it includes, how to use it, the JSON schema, and how metrics are computed.

---

## What was built

### User-facing

| Page | Button | Output file |
|------|--------|-------------|
| Backtest results (`/backtests/[id]`) | **Download report (JSON)** | `backtest-{id}-report.json` |
| Paper / testnet session (`/paper/[id]`) | **Download report (JSON)** | `session-{id}-report.json` |

- Backtest download: only for **completed** backtests
- Session download: works while **running** or **stopped** (snapshot at export time)

### Backend

| File | Role |
|------|------|
| `backend/src/services/backtestAnalytics.ts` | Pure functions: performance metrics, benchmark, market regime, round-trip trade log |
| `backend/src/services/reportShared.ts` | Shared schema types, equity-curve builder for live sessions |
| `backend/src/services/backtestReport.ts` | Assembles backtest export JSON |
| `backend/src/services/sessionReport.ts` | Assembles live session export JSON |
| `backend/src/routes/backtests.ts` | `GET /api/backtests/:id/export` |
| `backend/src/routes/paperSessions.ts` | `GET /api/paper-sessions/:id/export` |
| `backend/src/services/backtestService.ts` | New backtests persist extended analytics in `backtest_runs.results` |

### Frontend

| File | Role |
|------|------|
| `frontend/src/lib/api.ts` | `downloadBacktestReport(id)`, `downloadSessionReport(id)` |
| `frontend/src/app/backtests/[id]/page.tsx` | Backtest download button |
| `frontend/src/app/paper/[id]/page.tsx` | Session download button |

### Tests

| File | Coverage |
|------|----------|
| `backend/src/services/backtestAnalytics.test.ts` | Round trips, benchmark, regime, drawdown |
| `backend/src/services/reportShared.test.ts` | Live-session equity curve from klines |

---

## How to use

### Backtest

1. Run a backtest from any strategy config page.
2. Open the backtest dashboard (`/backtests/{id}`).
3. Click **Download report (JSON)**.

```bash
curl -o backtest-42-report.json http://localhost:4000/api/backtests/42/export
```

### Live session (paper or testnet)

1. Start a paper or testnet session from the strategy page.
2. Open the session dashboard (`/paper/{id}`) — while running or after stopping.
3. Click **Download report (JSON)**.

```bash
curl -o session-7-report.json http://localhost:4000/api/paper-sessions/7/export
```

Open either file in an editor or paste into an AI chat for analysis.

---

## Standardized JSON schema (`schemaVersion: "1.0"`)

Both backtests and live sessions use the **same top-level shape**. The `reportType` field distinguishes them:

| `reportType` | `runMetadata` id field | Period end |
|---|---|---|
| `"backtest"` | `backtestId` | Fixed backtest `endDate` |
| `"live_session"` | `sessionId` + `sessionKind` (`paper` \| `live_testnet`) | `stoppedAt` or **now** if still running |

### Top-level structure

```json
{
  "schemaVersion": "1.0",
  "reportType": "backtest | live_session",
  "generatedAt": "ISO-8601",
  "runMetadata": { ... },
  "strategyParameters": { ... },
  "performance": { ... },
  "benchmark": { ... },
  "marketRegime": { ... },
  "tradeLog": { ... },
  "equityCurve": [ ... ],
  "notes": [ ... ]
}
```

---

### 1. Run metadata (`runMetadata`)

| Field | Description |
|-------|-------------|
| `reportType` | `backtest` or `live_session` |
| `backtestId` | Present for backtests |
| `sessionId` | Present for live sessions |
| `sessionKind` | `paper` or `live_testnet` (live sessions only) |
| `createdAt` | When the run/session was created |
| `status` | `completed` (export only allowed when completed) |
| `strategy.name` | Display name, e.g. "Grid Trading" |
| `strategy.slug` | Stable key, e.g. `grid`, `dca`, `ma-crossover`, `rsi-reversion` |
| `strategy.version` | `"1.0"` (app-level; no per-strategy semver yet) |
| `strategy.riskLevel` | `low` \| `medium` \| `high` |
| `symbol` | Trading pair, e.g. `BTCUSDT` |
| `interval` | Candle timeframe, e.g. `1h` |
| `period.start` / `period.end` | ISO backtest window |
| `period.durationDays` | Length in days |
| `initialCapital` | Starting quote balance (USDT/USDC) |
| `assumptions.feeRate` | Decimal per fill, e.g. `0.001` = 0.10% |
| `assumptions.feeRatePct` | Same as percent, e.g. `0.1` |
| `assumptions.slippageBps` | Slippage in basis points |
| `assumptions.fillModel` | `candle_close` (backtest), `live_simulated` (paper), or `testnet_market` (testnet) |
| `assumptions.quoteCurrency` | `USDT` or `USDC` inferred from pair suffix |

---

### 2. Strategy parameters (`strategyParameters`)

Exact config JSON used for the run. Shape depends on strategy:

| Strategy | Typical fields |
|----------|----------------|
| **DCA** (`dca`) | `pair`, `amountPerBuy`, `interval` (`daily`/`weekly`), `durationDays` |
| **Grid** (`grid`) | `pair`, `lowerBound`, `upperBound`, `gridLevels`, `amountPerLevel` |
| **MA Crossover** (`ma-crossover`) | `pair`, `shortPeriod`, `longPeriod`, `allocationPct` |
| **RSI** (`rsi-reversion`) | `pair`, `rsiPeriod`, `oversold`, `overbought`, `allocationPct` |

---

### 3. Performance metrics (`performance`)

All **percent** fields are plain numbers where `5.25` means **+5.25%**. Money fields are in **quote currency** (USDT/USDC).

| Field | Unit | Description |
|-------|------|-------------|
| `totalReturnPct` | % | `(finalEquity - initialCapital) / initialCapital × 100` |
| `totalPnl` | quote | Absolute profit/loss |
| `cagrPct` | % | Compound annual growth rate; `null` if period &lt; 1 day |
| `maxDrawdownPct` | % | Peak-to-trough on equity curve (positive number) |
| `maxDrawdownDurationDays` | days | Longest time from equity peak to recovery |
| `sharpeRatio` | ratio | Annualized Sharpe from equity period returns; risk-free = 0 |
| `sortinoRatio` | ratio | Annualized Sortino (downside deviation only) |
| `winRatePct` | % | Profitable round trips / total round trips; `null` if none |
| `profitFactor` | ratio | Gross winning P&L / gross losing P&L on round trips |
| `averageWin` | quote | Mean net P&L of winning round trips |
| `averageLoss` | quote | Mean net P&L of losing round trips (negative) |
| `winLossRatio` | ratio | \|averageWin / averageLoss\| |
| `fillCount` | count | Total buys + sells |
| `roundTripCount` | count | Completed buy→sell matches |
| `averageTradeDurationDays` | days | Mean holding time of round trips |
| `largestWin` | quote | Best single round trip |
| `largestLoss` | quote | Worst single round trip (negative) |

**Null metrics:** DCA-style runs that never sell have `roundTripCount = 0`, so win rate, profit factor, trade duration, etc. are `null`. Open buys appear under `tradeLog.openPositions` instead.

---

### 4. Benchmark comparison (`benchmark`)

Buy-and-hold over the **same period and symbol**:

| Field | Description |
|-------|-------------|
| `firstPrice` | First candle close in the backtest window |
| `lastPrice` | Last candle close |
| `buyAndHoldReturnPct` | % return from buying at `firstPrice` with one entry fee |
| `buyAndHoldPnl` | Absolute P&L in quote currency |
| `buyAndHoldFinalEquity` | Final value: `(initialCapital × (1 - feeRate)) / firstPrice × lastPrice` |
| `excessReturnPct` | `totalReturnPct - buyAndHoldReturnPct` (alpha vs hold) |
| `beatBuyAndHold` | `true` if strategy outperformed buy-and-hold |

---

### 5. Trade log (`tradeLog`)

Three layers for flexibility:

#### `roundTrips` — completed positions (primary for analysis)

| Field | Description |
|-------|-------------|
| `roundTripIndex` | 0-based index |
| `entryTimestamp` / `exitTimestamp` | ISO-8601 |
| `entryPrice` | FIFO-weighted average buy price |
| `exitPrice` | Sell fill price |
| `quantity` | Base asset size |
| `grossPnl` | Proceeds − cost basis (before fees) |
| `netPnl` | After all fees on entry and exit |
| `feesPaid` | Buy fees + sell fee for this trip |
| `durationMs` / `durationDays` | Holding period |
| `exitReason` | Always `"signal"` — strategies emit buy/sell signals only |

**Not implemented:** `stop`, `take_profit` — no stop-loss or take-profit orders exist in the engine.

#### `openPositions` — unsold inventory at period end

Relevant for DCA and any strategy still holding base asset:

| Field | Description |
|-------|-------------|
| `entryTimestamp` | Buy time |
| `entryPrice` | Buy price |
| `quantity` | Still held |
| `feesPaid` | Entry fee |
| `unrealizedPnl` | Mark-to-market at `lastPrice` minus cost |

#### `fills` — raw execution log

Every individual buy/sell: timestamp, side, price, quantity, quote amount, fee.

---

### 6. Equity curve (`equityCurve`)

Array of `{ "timestamp": <ms epoch>, "equity": <quote value> }`.

- One sample per candle during simulation (downsampled to max 500 points for storage; sufficient for drawdown/volatility charts)
- `equity = cash + baseBalance × price` at each candle close

---

### 7. Market regime context (`marketRegime`)

Heuristic classification from **underlying price candles** (not strategy equity):

| Field | Description |
|-------|-------------|
| `label` | `trending_up` \| `trending_down` \| `ranging` \| `volatile` |
| `summary` | Plain-language interpretation for AI/human readers |
| `priceReturnPct` | Buy-and-hold price change over the period |
| `annualizedVolatilityPct` | Std dev of log returns, annualized |
| `trendSlopePerYear` | Log-price slope per year |

**Classification rules (simplified):**

- `annualizedVolatilityPct ≥ 60` → `volatile`
- Else `priceReturnPct ≥ 8%` → `trending_up`
- Else `priceReturnPct ≤ -8%` → `trending_down`
- Else → `ranging`

---

### 8. Notes (`notes`)

Static disclaimers about fill model, FIFO matching, missing stop/TP, Sharpe assumptions, and buy-and-hold fee model. Extra note added when there are no round trips.

---

## Metric computation details

### Round-trip matching

Sells are matched to prior buys **FIFO** (same approach as win-rate accounting in `simulation.ts`). Net P&L includes buy fees and sell fees.

### Drawdown

Walk the equity curve: track running peak; max drawdown = largest `(peak - trough) / peak`. Duration = longest time from a peak until equity recovers to that peak (or to period end if still underwater).

### Sharpe / Sortino

- Period returns from consecutive equity samples: `(Eₜ - Eₜ₋₁) / Eₜ₋₁`
- Annualization factor from candle interval (e.g. 8760 periods/year for `1h`)
- Risk-free rate = **0** (standard simplification for crypto backtests)

### CAGR

`(finalEquity / initialCapital)^(1/years) - 1`, where `years = periodMs / (365.25 × 86400000)`.

### Buy-and-hold

One market buy at `firstPrice` with entry fee; hold to `lastPrice`; no exit fee (unrealized at end). Compared directly to strategy total return.

---

## Persistence vs export-time recomputation

**New backtests** store in `backtest_runs.results`:

- All original fields (`pnl`, `equityCurve`, `winRate`, etc.)
- `firstPrice`, `lastPrice`
- `performance`, `benchmark`, `marketRegime`

**Export endpoint** always **recomputes** analytics from stored trades + equity curve + fresh kline fetch for regime/price context. This ensures:

- Older runs without extended fields still export correctly
- Trade log in the file always matches DB trades
- Market regime uses full candle series

---

## Files changed (summary)

```
backend/src/services/backtestAnalytics.ts      (metrics)
backend/src/services/reportShared.ts           (shared schema + equity builder)
backend/src/services/backtestReport.ts         (backtest export)
backend/src/services/sessionReport.ts          (live session export)
backend/src/services/reportShared.test.ts
backend/src/routes/backtests.ts                (GET /:id/export)
backend/src/routes/paperSessions.ts            (GET /:id/export)
frontend/src/lib/api.ts
frontend/src/app/backtests/[id]/page.tsx
frontend/src/app/paper/[id]/page.tsx
download_report.md
```

---

## Live session specifics

- **Equity curve** is rebuilt from session fills + **1h candles** from session start to export time (not tick-by-tick).
- **Benchmark / regime** use the same 1h price series over the session window.
- **Running sessions**: `period.end` is the export timestamp; `notes` includes a running-session disclaimer.
- **Testnet**: fills use real exchange prices; `fillModel` is `testnet_market`.

---

## Possible follow-ups (not implemented)

- Copy-as-Markdown button for quick AI paste
- CSV export for `tradeLog.fills` or `equityCurve`
- Include raw OHLCV candles in the report
- Stop-loss / take-profit with real `exitReason` values
- Compare multiple backtests in one export bundle
- Paper/testnet session reports (same schema, different `runMetadata` source) — **done**

---

## Example: prompting an AI with the report

After download, you can paste the JSON and ask:

> "Analyze this backtest report. Did the strategy add value vs buy-and-hold? How does the market regime explain the result? What are the main risks given max drawdown and fee drag?"

The standardized schema is designed so the same questions work for DCA, Grid, MA Crossover, and RSI without reformatting.
