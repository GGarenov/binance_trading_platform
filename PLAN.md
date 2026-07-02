# Implementation Plan: CryptoStrategy Lab

Status: **Approved** (2026-07-02). This is the working plan for the MVP described in `PROJECT_SPEC.md`.

## 0. Locked-in decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript (frontend + backend) | Prisma and `@binance/spot` are TS-first; the compiler catches mistakes early — valuable for a learning project |
| ORM | Prisma | Schema-first, auto-generated migrations and types, best docs in the ecosystem |
| Binance client | `@binance/spot` (official) | Actively maintained by Binance; covers REST market data + WebSocket streams. Requires Node ≥ 22.12 |
| Backtesting | Custom engine (no library) | JS backtesting libs are abandoned; the strategy engine *is* the product; DCA/Grid loops are simple |
| Live dashboard updates | Polling (~3s) in MVP | Far simpler than WebSockets/SSE; invisible UX difference at this cadence; easy to upgrade later |
| Backtest granularity | 1h candles by default | Good realism/data-volume balance; Binance public klines API serves years of history free, no API key needed |
| Auth | None — single hardcoded local user | Per spec section 3; adding `user_id` later is a cheap migration |

## 1. Folder structure

Two apps in one repo, each with its own `package.json`. Backend is a separate Express process (not Next.js API routes) because paper trading needs a long-running process holding WebSocket subscriptions to Binance.

```
binance_trading_platform/
├── README.md
├── PROJECT_SPEC.md
├── PLAN.md
├── .gitignore
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example              # documents required env vars, safe to commit
│   ├── prisma/
│   │   ├── schema.prisma         # single source of truth for the DB schema
│   │   ├── migrations/           # auto-generated SQL migrations
│   │   └── seed.ts               # inserts the 2 strategies (DCA, Grid)
│   └── src/
│       ├── index.ts              # entry point: starts the server
│       ├── app.ts                # Express wiring (separate from index for testability)
│       ├── routes/
│       │   ├── strategies.ts
│       │   ├── configs.ts
│       │   ├── backtests.ts
│       │   ├── paperSessions.ts
│       │   └── market.ts
│       ├── services/
│       │   ├── backtestService.ts       # fetch candles → run engine → save results
│       │   ├── paperTradingService.ts   # live sessions, positions, balances
│       │   └── binance/
│       │       ├── rest.ts              # historical klines, symbol info
│       │       └── stream.ts            # WebSocket live prices
│       ├── strategies/
│       │   ├── types.ts          # shared Strategy interface
│       │   ├── dca.ts
│       │   ├── grid.ts
│       │   └── index.ts          # registry: slug → implementation
│       └── lib/
│           ├── prisma.ts         # single shared Prisma client
│           └── errors.ts         # error helpers / Express error middleware
│
└── frontend/
    ├── package.json
    ├── next.config.ts
    └── src/
        ├── app/                              # Next.js App Router
        │   ├── layout.tsx
        │   ├── page.tsx                      # strategy library (cards)
        │   ├── strategies/[slug]/page.tsx    # "learn more" + config form
        │   ├── backtests/[id]/page.tsx       # backtest results dashboard
        │   └── paper/[id]/page.tsx           # live paper trading dashboard
        ├── components/
        │   ├── StrategyCard.tsx
        │   ├── ConfigForm.tsx
        │   ├── EquityChart.tsx
        │   ├── StatsPanel.tsx                # P&L, win rate, etc.
        │   └── TradeLog.tsx
        └── lib/
            ├── api.ts                        # one typed fetch wrapper for all backend calls
            └── format.ts                     # money/percent/date formatting
```

Layering rule on the backend: **routes → services → strategies**. Routes only parse/validate HTTP; services own business logic; strategies are pure functions (no HTTP, no DB) so the same DCA code serves both the backtester and the paper trader.

## 2. PostgreSQL schema

Authored in `prisma/schema.prisma`; equivalent SQL for reference:

```sql
CREATE TYPE risk_level     AS ENUM ('low', 'medium', 'high');
CREATE TYPE run_status     AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE session_status AS ENUM ('running', 'stopped');
CREATE TYPE trade_side     AS ENUM ('buy', 'sell');

CREATE TABLE strategies (
    id             SERIAL PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,      -- 'dca', 'grid' (stable key for code + URLs)
    name           TEXT NOT NULL,
    description    TEXT NOT NULL,             -- plain-language one-liner
    how_it_works   TEXT NOT NULL,
    when_it_works  TEXT NOT NULL,
    when_it_doesnt TEXT NOT NULL,
    risk_level     risk_level NOT NULL,
    default_params JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE strategy_configs (
    id          SERIAL PRIMARY KEY,
    strategy_id INT NOT NULL REFERENCES strategies(id),
    params      JSONB NOT NULL,               -- validated with zod before insert
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE backtest_runs (
    id         SERIAL PRIMARY KEY,
    config_id  INT NOT NULL REFERENCES strategy_configs(id),
    start_date TIMESTAMPTZ NOT NULL,
    end_date   TIMESTAMPTZ NOT NULL,
    interval   TEXT NOT NULL,                 -- candle granularity, default '1h'
    status     run_status NOT NULL DEFAULT 'pending',
    results    JSONB,                         -- P&L, win rate, equity curve; NULL until completed
    error      TEXT,                          -- populated when status = 'failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paper_sessions (
    id              SERIAL PRIMARY KEY,
    config_id       INT NOT NULL REFERENCES strategy_configs(id),
    status          session_status NOT NULL DEFAULT 'running',
    initial_balance NUMERIC(20, 8) NOT NULL,  -- starting simulated quote funds (e.g. USDT)
    quote_balance   NUMERIC(20, 8) NOT NULL,  -- current simulated cash
    base_balance    NUMERIC(20, 8) NOT NULL DEFAULT 0,  -- current simulated coins held
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at      TIMESTAMPTZ
);

CREATE TABLE simulated_trades (
    id               SERIAL PRIMARY KEY,
    backtest_run_id  INT REFERENCES backtest_runs(id) ON DELETE CASCADE,
    paper_session_id INT REFERENCES paper_sessions(id) ON DELETE CASCADE,
    side             trade_side NOT NULL,
    price            NUMERIC(20, 8) NOT NULL,
    quantity         NUMERIC(20, 8) NOT NULL,  -- amount of the base coin
    quote_amount     NUMERIC(20, 8) NOT NULL,  -- price * quantity
    executed_at      TIMESTAMPTZ NOT NULL,     -- simulated time (historical for backtests)
    CONSTRAINT one_parent CHECK (
        (backtest_run_id IS NULL) <> (paper_session_id IS NULL)
    )
);

CREATE INDEX ON simulated_trades (backtest_run_id);
CREATE INDEX ON simulated_trades (paper_session_id);
```

Design rationale (the non-obvious parts):

- **Two nullable FKs instead of one generic `session_id`** on `simulated_trades`: a single polymorphic column can't have a real foreign key to two tables. Two FKs + an XOR `CHECK` keeps referential integrity.
- **`NUMERIC(20,8)` instead of `FLOAT`** for money/price: floats are approximate (`0.1 + 0.2 ≠ 0.3`) and errors compound over many trades. 8 decimals matches Binance quantities.
- **`TIMESTAMPTZ` everywhere**: absolute points in time; plain `TIMESTAMP` invites timezone bugs.
- **`slug` on strategies**: stable identifier mapping DB rows to code (`dca.ts`, `grid.ts`); display names may change, slugs don't.
- **`status`/`error` on backtest runs**: lets the frontend show progress/failures instead of hanging.
- **`params` as JSONB**: DCA and Grid have different parameter shapes; new strategies shouldn't require schema changes. Shape is enforced with zod at the API boundary.
- **Equity curve inside `results` JSONB** for MVP; move to its own table only if it ever gets too large.

## 3. Backend API endpoints

All prefixed with `/api`. The frontend never calls Binance directly — market data is proxied through `/api/market/*` (one place for rate limiting/caching, no CORS pain).

| Method | Path | Description |
|---|---|---|
| GET | `/api/strategies` | List all strategies (library cards) |
| GET | `/api/strategies/:slug` | One strategy's full details + default params |
| POST | `/api/configs` | Save a config (`strategy_id` + params); zod-validates params |
| GET | `/api/configs/:id` | Fetch one saved config |
| POST | `/api/backtests` | Run a backtest for a config (+ date range, interval); synchronous — responds when done |
| GET | `/api/backtests/:id` | Run status + results (P&L, win rate, equity curve) |
| GET | `/api/backtests/:id/trades` | Trade log for that run |
| POST | `/api/paper-sessions` | Start a paper session for a config (+ starting balance) |
| GET | `/api/paper-sessions` | List sessions (dashboard survives page reloads — spec Q9.3: yes, persisted) |
| GET | `/api/paper-sessions/:id` | Live state: balances, position, unrealized P&L, current price |
| POST | `/api/paper-sessions/:id/stop` | Stop a running session |
| GET | `/api/paper-sessions/:id/trades` | Trade log for that session |
| GET | `/api/market/symbols` | Supported trading pairs (for the config form) |
| GET | `/api/market/klines` | Historical candles for a pair/interval (price charts) |

Frontend polls `GET /api/paper-sessions/:id` every ~3s for the live dashboard.

## 4. Packages

**Backend**

| Package | Purpose |
|---|---|
| `express`, `cors`, `dotenv` | HTTP server, CORS for the Next.js origin, env loading |
| `@binance/spot` | Official Binance connector: REST klines + WebSocket streams (Node ≥ 22.12) |
| `prisma`, `@prisma/client` | Schema, migrations, typed DB client |
| `zod` | Request-body + strategy-params validation at the API boundary |
| `date-fns` | Interval math for DCA scheduling (modular, immutable) |
| `typescript`, `tsx`, `@types/*` | TS toolchain; `tsx` for dev-mode execution |

**Frontend**

| Package | Purpose |
|---|---|
| `next`, `react`, `react-dom` | App framework |
| `tailwindcss` | Styling |
| `recharts` | Equity/P&L charts (declarative React API, gentle learning curve) |

No backtesting library — the engine is custom (see decisions table).

## 5. Strategy Engine interface (shape agreed, code comes later)

Every strategy implements the same interface so backtesting and paper trading share one code path:

- Input: validated config params + a stream/array of candles (or ticks)
- Output: a list of trade decisions (`buy`/`sell`, quantity, at which candle/price)
- Strategies are pure: no DB, no HTTP, no clock — the caller supplies time and prices. This is what makes backtests deterministic and testable.

## 6. To-do list

### Phase 1 — Scaffolding
- [x] Root `.gitignore` (node_modules, `.env`, `.next`, `dist`)
- [x] `backend/`: init npm + TypeScript, Express app skeleton (`index.ts` / `app.ts` split), health-check route
- [x] `frontend/`: `create-next-app` with TypeScript + Tailwind + App Router
- [x] `backend/.env.example` (`DATABASE_URL`, `PORT`)
- [x] Verify Node ≥ 22.12 locally (required by `@binance/spot`) — v24.11.1 ✓

### Phase 2 — Database
- [x] Install Prisma, write `schema.prisma` mirroring section 2 above (Prisma 7: URL/seed config moved to `prisma.config.ts`, client requires the `@prisma/adapter-pg` driver adapter)
- [x] Local PostgreSQL database + first migration (portable PostgreSQL 17.5 in gitignored `.pgsql/` — see note below)
- [x] `seed.ts` with the two strategies (DCA, Grid) incl. plain-language copy and `default_params`
- [x] Shared Prisma client in `lib/prisma.ts`

> **Local database note:** no system-wide PostgreSQL was installed, so a portable PostgreSQL 17.5 lives in `.pgsql/` (gitignored). Start it with
> `.pgsql\pgsql\bin\pg_ctl.exe -D .pgsql\data -l .pgsql\postgres.log start` and stop it with `... stop`. It uses trust auth on localhost:5432 — fine for local dev only. The GET /api/strategies route was pulled forward from Phase 5 to make the seed verifiable end-to-end.

### Phase 3 — Binance client
- [x] `services/binance/rest.ts`: fetch klines (with pagination beyond 1000 candles), fetch exchange symbols
- [x] `services/binance/stream.ts`: subscribe/unsubscribe to live price streams per symbol (implemented + type-checked; live verification comes with Phase 6 paper trading)
- [x] `GET /api/market/symbols` and `GET /api/market/klines` routes
- [x] Manual check: fetch 1 month of 1h BTCUSDT candles end-to-end — 720 candles returned ✓ (verified 2026-07-02)

### Phase 4 — Strategy engine
- [x] `strategies/types.ts`: Strategy interface + zod param schemas (plus `getState()`/`setState()` snapshots for paper-session resume)
- [x] DCA implementation (buy fixed amount per interval over duration)
- [x] Grid implementation (levels across range; buy/sell as price crosses levels)
- [x] Unit tests for both strategies against small hand-crafted candle fixtures — 16 tests passing (vitest; also covers the simulation engine)

### Phase 5 — Backtesting
- [x] `backtestService.ts`: fetch candles → run strategy → compute P&L, win rate, equity curve → persist run + trades (shared executor lives in `services/simulation.ts`; fills at candle close, no fees/slippage — documented MVP simplification)
- [x] `POST /api/backtests`, `GET /api/backtests/:id`, `GET /api/backtests/:id/trades`
- [x] Config routes: `POST /api/configs`, `GET /api/configs/:id` (zod validation per strategy)
- [x] Sanity-check results by hand — DCA weekly $50 over June 2026: 5 buys, engine P&L −24.78105 vs hand-computed −24.78114 (difference = 8-decimal rounding in stored trade quantities) ✓ (verified 2026-07-02)

### Phase 6 — Paper trading
- [x] `paperTradingService.ts`: session lifecycle, in-memory registry of running sessions, live price → strategy decision → simulated fill → DB
- [x] Session routes: create / list / get state / stop / trades
- [x] Resume `running` sessions from DB on server restart (verified: killed and restarted the server with a live session — it resumed and kept receiving prices; strategy state persists in the new `strategy_state` JSONB column added by migration)
- [x] Unrealized P&L calculation from current price + base balance

### Phase 7 — Frontend
- [ ] `lib/api.ts` typed fetch wrapper
- [ ] Strategy library page (cards: name, description, risk badge)
- [ ] Strategy detail page: "how it works" copy + config form (dynamic per strategy, sane defaults)
- [ ] Backtest dashboard: stats panel, equity chart (recharts), trade log
- [ ] Paper trading dashboard: live balances, position, P&L, trade log — polling every ~3s
- [ ] Start/stop paper session controls

### Phase 8 — Polish & wrap-up
- [ ] Error states + loading states on all pages
- [ ] Beginner-friendly copy pass (spec: assume zero trading knowledge)
- [ ] README "Getting started": prerequisites, DB setup, seed, run both apps
- [ ] Walk the full Definition of Done (spec section 10) end-to-end

## 7. Out of scope (do not build)

Arbitrage, live trading with real funds, strategies beyond DCA/Grid, multi-exchange, user accounts/auth. See spec section 3.
