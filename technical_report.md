# CryptoStrategy Lab — Technical Architecture Report

## 1. What this application is

**CryptoStrategy Lab** is a beginner-friendly web platform for learning and testing crypto trading strategies without risking real money (by default). Users browse a strategy library, read plain-language explanations, configure parameters (pair, amounts, intervals, etc.), and run strategies in two modes:

| Mode | What it does |
|---|---|
| **Backtesting** | Replays historical Binance price data and simulates trades over a chosen date range |
| **Paper / live sessions** | Runs a strategy against **live** market prices; fills are either simulated (`paper`) or sent to the Binance Spot **Testnet** (`live_testnet`) |

The MVP goal (Phases 1–8) is complete. Post-MVP work added realistic fees/slippage, USDC pairs, two indicator strategies (MA Crossover, RSI Mean Reversion), and Binance Testnet order execution (Phase 12). Real-money trading (Phase 13) is planned but not implemented.

---

## 2. Yes — both backend and frontend must run

This is a **two-process** application plus a database. All three are required for the app to work end-to-end:

| Component | Port | Role |
|---|---|---|
| **PostgreSQL** | 5432 | Persists strategies, configs, backtest results, sessions, and trade history |
| **Backend (Express)** | 4000 | REST API, strategy engine, backtests, live session manager, Binance integration |
| **Frontend (Next.js)** | 3000 | UI — strategy library, config forms, backtest and session dashboards |

The frontend **never** talks to Binance directly. Every market-data and business call goes through the backend (`http://localhost:4000` by default, configurable via `NEXT_PUBLIC_API_URL`).

Typical local startup:

```powershell
# 1. Database (portable PostgreSQL in .pgsql/, or your own install)
.pgsql\pgsql\bin\pg_ctl.exe -D .pgsql\data -l .pgsql\postgres.log start

# 2. Backend
cd backend
npm install
copy .env.example .env
npx prisma migrate dev
npx prisma db seed
npm run dev          # → http://localhost:4000

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev          # → http://localhost:3000
```

If only the frontend is running, pages load but API calls fail with *"Cannot reach the backend"*.

---

## 3. High-level system diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (user)                                  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ HTTP (fetch)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend — Next.js 16 + React 19 + Tailwind (port 3000)              │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │ Strategy     │  │ Config form +   │  │ Backtest / session       │   │
│  │ library      │  │ backtest launch │  │ dashboards (poll ~3s)    │   │
│  └──────────────┘  └─────────────────┘  └──────────────────────────┘   │
│  lib/api.ts — typed HTTP client → NEXT_PUBLIC_API_URL (default :4000)   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ REST /api/*
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Backend — Express 5 + TypeScript (port 4000)                           │
│                                                                         │
│  routes/          services/              strategies/                    │
│  ├ strategies     ├ backtestService      ├ dca                         │
│  ├ configs        ├ paperTradingService  ├ grid                         │
│  ├ backtests      ├ simulation           ├ maCrossover                  │
│  ├ paper-sessions ├ orderExecutor        └ rsiReversion                 │
│  └ market         └ binance/ (rest, stream, testnet)                    │
│                                                                         │
│  On boot: resumeRunningSessions() — revives live sessions after restart │
└───────────────┬─────────────────────────────┬───────────────────────────┘
                │ Prisma ORM                  │ @binance/spot
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────────────┐
│  PostgreSQL               │   │  Binance                                  │
│  strategies, configs,     │   │  • Public REST — historical klines,       │
│  backtest_runs,           │   │    exchange symbols (no API key)          │
│  paper_sessions,          │   │  • Public WebSocket — live prices         │
│  simulated_trades         │   │  • Spot Testnet REST — real orders        │
└───────────────────────────┘   │    (fake money; keys in backend/.env)     │
                                └─────────────────────────────────────────┘
```

---

## 4. Why the backend is a separate Express process

The repo uses **two apps in one monorepo**, each with its own `package.json`. The backend is **not** implemented as Next.js API routes because:

1. **Long-running work** — Paper and testnet sessions hold open WebSocket subscriptions to Binance price streams for as long as the session runs.
2. **Session survival** — The `PaperTradingManager` keeps in-memory state and re-subscribes on server restart; sessions are persisted in PostgreSQL and resumed on boot.
3. **Clear layering** — Routes handle HTTP only; services own business logic; strategies are pure and testable.

---

## 5. Backend architecture

### 5.1 Layering rule

```
HTTP request  →  routes/  →  services/  →  strategies/
                  │              │
                  │              └── binance/, simulation, orderExecutor
                  └── parse body, call service, return JSON
```

- **Routes** — Thin Express routers; no business logic.
- **Services** — Orchestration: fetch data, run engine, read/write DB.
- **Strategies** — Pure functions: given price points and portfolio state, emit buy/sell decisions. No DB, no HTTP, no system clock.

### 5.2 Strategy engine

Every strategy implements the same interface (`strategies/types.ts`):

- `create(params, startTimeMs)` → `StrategyInstance`
- `onPrice(point, portfolio)` → `TradeDecision[]`
- `getState()` / `setState()` — JSON snapshots so paper sessions survive restarts

Registered strategies (`strategies/index.ts`):

| Slug | Name | Risk |
|---|---|---|
| `dca` | Dollar-Cost Averaging | Low |
| `grid` | Grid Trading | Medium |
| `ma-crossover` | MA Crossover | Medium |
| `rsi-reversion` | RSI Mean Reversion | High |

The **same strategy code** powers both backtesting and live sessions. The caller supplies time and prices; that keeps backtests deterministic.

### 5.3 Shared simulation layer (`services/simulation.ts`)

`executeFill()` and `runSimulation()` are shared by backtests and paper trading so fill math (fees, slippage, balance updates) cannot drift apart.

- Default taker fee: **0.10%** per side (`feeRate = 0.001`)
- Optional slippage in basis points (backtests only; live sessions use real/testnet fills)
- `NUMERIC(20,8)` in PostgreSQL avoids floating-point money errors

### 5.4 Backtest flow

1. `POST /api/backtests` with `configId`, date range, optional `feeRate` / `slippageBps`
2. `backtestService` loads config → validates params with Zod → fetches 1h (or chosen) klines from Binance REST
3. Indicator strategies get a **warm-up window** of pre-start candles (decisions discarded)
4. `runSimulation()` walks candles chronologically; each close price triggers `onPrice()`
5. Results (P&L, win rate, equity curve, fees) + individual trades saved to PostgreSQL
6. Frontend navigates to `/backtests/[id]` for charts and trade log

Backtests are **synchronous** in the MVP (typically a few seconds at 1h granularity).

### 5.5 Live session flow (paper & testnet)

1. `POST /api/paper-sessions` with `configId`, `initialBalance`, and `kind` (`paper` | `live_testnet`)
2. `PaperTradingManager` creates a DB row, instantiates the strategy, subscribes to the symbol on the shared Binance WebSocket (`binance/stream.ts`)
3. On each price tick: strategy decides → fill executed:
   - **`paper`** — `executeFill()` updates simulated balances in memory + DB
   - **`live_testnet`** — `orderExecutor` sends a MARKET order to Binance Spot Testnet; actual fill price and commission recorded
4. Strategy decisions still use **production** WebSocket prices; only order placement hits testnet (testnet order books are thin)
5. `GET /api/paper-sessions/:id` returns balances, unrealized P&L, current price — frontend **polls every ~3s**
6. `POST /api/paper-sessions/:id/stop` unsubscribes and marks session stopped

On server restart, `index.ts` calls `resumeRunningSessions()` to reload `running` sessions from the DB and re-subscribe to price streams.

### 5.6 Binance integration

| Module | Purpose | Auth |
|---|---|---|
| `binance/rest.ts` | Paginated klines, exchange symbols | None (public) |
| `binance/stream.ts` | Live trade/price WebSocket per symbol | None (public) |
| `binance/testnet.ts` | Wallet balances, symbol filters | `BINANCE_TESTNET_API_KEY` / `SECRET` |
| `orderExecutor.ts` | MARKET buy/sell respecting LOT_SIZE, minNotional | Testnet keys |

Market data for decisions always comes from **production** Binance. Testnet is execution-only.

### 5.7 REST API surface

All routes are prefixed with `/api`:

| Area | Key endpoints |
|---|---|
| Health | `GET /api/health` |
| Strategies | `GET /api/strategies`, `GET /api/strategies/:slug` |
| Configs | `POST /api/configs`, `GET /api/configs/:id` |
| Backtests | `POST /api/backtests`, `GET /api/backtests/:id`, `GET .../trades` |
| Sessions | `POST /api/paper-sessions`, `GET /api/paper-sessions`, `GET .../:id`, `POST .../stop`, `GET .../trades` |
| Market | `GET /api/market/symbols?quote=USDT\|USDC`, `GET /api/market/klines` |

Request bodies and strategy params are validated with **Zod** at the API boundary.

---

## 6. Frontend architecture

### 6.1 Stack

- **Next.js 16** (App Router, Turbopack in dev)
- **React 19**, **Tailwind CSS 4**
- **Recharts** for equity curves

### 6.2 Pages

| Route | Purpose |
|---|---|
| `/` | Strategy library cards + list of existing sessions |
| `/strategies/[slug]` | Strategy explanation, config form, launch backtest or session |
| `/backtests/[id]` | Backtest results — stats, equity chart, trade log |
| `/paper/[id]` | Live session dashboard — balances, P&L, trade log (polling) |

### 6.3 API client

`frontend/src/lib/api.ts` is the **single integration point** with the backend: typed interfaces, centralized error handling, and the friendly *"Is the backend running?"* message when `fetch` fails.

There is **no Next.js rewrite/proxy** — the browser calls the backend origin directly (CORS enabled on Express).

### 6.4 Components

Reusable UI: `StrategyCard`, `ConfigForm`, `EquityChart`, `StatsPanel`, `TradeLog`, `RiskBadge`. Formatting helpers live in `lib/format.ts`.

---

## 7. Data model (PostgreSQL via Prisma)

```
strategies
    └── strategy_configs
            ├── backtest_runs ──► simulated_trades
            └── paper_sessions ──► simulated_trades
```

Notable design choices:

- **`slug`** on strategies — stable key linking DB rows to code (`dca.ts`, etc.)
- **`params` as JSONB** — different shapes per strategy; Zod enforces at runtime
- **`simulated_trades`** — two nullable FKs (`backtest_run_id` XOR `paper_session_id`) with a Postgres CHECK constraint for referential integrity
- **`paper_sessions.kind`** — `paper` | `live_testnet` | `live_real` (last is rejected by API until Phase 13)
- **`strategy_state` JSONB** — serialized strategy snapshot for session resume
- **`intended_price` on trades** — strategy decision price vs actual fill (slippage visibility on testnet)

---

## 8. Session kinds (execution modes)

| Kind | Money | Orders | Price feed |
|---|---|---|---|
| `paper` | Simulated balance in DB | None — `executeFill()` locally | Production WebSocket |
| `live_testnet` | Testnet wallet (fake USDT/USDC/BTC) | Real MARKET orders on Spot Testnet | Production WebSocket for decisions |
| `live_real` | *Not enabled* | Planned Phase 13 with safety rails | TBD |

---

## 9. Security model (current)

- No user authentication — single local user (by design for MVP)
- No Binance keys needed for market data, backtests, or paper trading
- Testnet keys live only in `backend/.env` (gitignored)
- Real-money API keys and withdrawal permissions are explicitly out of scope until Phase 13
- Frontend never sees exchange secrets

---

## 10. Testing

Backend unit tests (Vitest): strategy logic, simulation/fees, indicators, order executor. Run with `cd backend && npm test` (37 tests as of Phase 11).

---

## 11. Implementation status summary

| Phase | Topic | Status |
|---|---|---|
| 1–8 | MVP scaffolding through polish | ✅ Complete |
| 9 | Fees & slippage in simulation | ✅ Complete |
| 10 | USDC quote currency support | ✅ Complete |
| 11 | MA Crossover & RSI strategies | ✅ Complete |
| 12 | Binance Spot Testnet trading | ✅ Complete |
| 13 | Real-money trading + safety rails | ⏳ Not started |

---

## 12. Key architectural invariants

1. **Strategies are pure** — same code for backtest and live; callers own time, prices, and persistence.
2. **One simulation path** — `executeFill()` shared across modes prevents inconsistent P&L.
3. **Backend owns all external I/O** — Binance, database, WebSockets, and (optionally) testnet orders.
4. **Frontend is a thin client** — display, forms, polling; no trading logic.
5. **Sessions are durable** — PostgreSQL + strategy snapshots + resume on boot.
6. **Honest backtests** — fees applied before drawing conclusions about strategy profitability.

---

*Generated from `PROJECT_SPEC.md`, `PLAN.md`, and the current codebase (July 2026).*
