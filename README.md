# CryptoStrategy Lab

Beginner-friendly crypto trading bot platform with backtesting and paper trading. Users pick a strategy (DCA, Grid Trading, and more to come), see a plain-language explanation of how it works, configure their own parameters, and test it risk-free before ever touching real funds.

## Why this exists

Most trading bot tools assume you already know what "grid trading" or "DCA" means. This one doesn't. Every strategy comes with a plain explanation, a risk level, and sane defaults, so someone new to trading can actually understand what they're about to run.

## Core features (MVP)

- **Strategy library** – curated strategies, each with a description, risk level, and configurable parameters
- **Backtesting** – run a strategy against historical price data to see how it would have performed
- **Paper trading** – run a strategy live against real market data using simulated funds
- **Binance integration** – real market data via the Binance API (read-only for now; no live trading in MVP)

## Explicitly out of scope for MVP

- Arbitrage strategies (multi-exchange, latency-sensitive)
- Live trading with real funds
- More than 2 strategies (DCA, Grid) at launch
- Multi-exchange support (Binance only)

## Tech stack

- **Frontend:** Next.js, React, Tailwind
- **Backend:** Node.js / Express
- **Database:** PostgreSQL
- **Exchange data:** Binance API (public market data endpoints)

## Status

✅ MVP complete: strategy library, backtesting, and paper trading all work end-to-end. See `PROJECT_SPEC.md` for the spec and `PLAN.md` for the implementation plan and decisions.

## Getting started

### Prerequisites

- **Node.js ≥ 22.12** (required by the official Binance connector; check with `node --version`)
- No Binance API key needed — the app only uses public market data
- No PostgreSQL install needed — a portable PostgreSQL lives in `.pgsql/` (see below)

### 1. Start the database

A portable PostgreSQL 17.5 is set up inside the repo (gitignored). Start it with:

```powershell
.pgsql\pgsql\bin\pg_ctl.exe -D .pgsql\data -l .pgsql\postgres.log start
```

(Stop it later with the same command and `stop`.) If you're setting up from a fresh clone, `.pgsql/` won't exist — install PostgreSQL any way you like, create a database, and point `backend/.env` at it instead.

### 2. Start the backend (port 4000)

```powershell
cd backend
npm install
copy .env.example .env      # defaults work with the portable database
npx prisma migrate dev      # creates the schema
npx prisma db seed          # inserts the two strategies
npm run dev
```

### 3. Start the frontend (port 3000)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — pick a strategy, read how it works, run a backtest, start a paper trading session.

### Running tests

```powershell
cd backend
npm test
```

## Security note

This project will eventually handle exchange API keys. Any Binance API key used here should be created with **read-only / trading permissions only — never withdrawal permissions**. `.env` files are gitignored from the first commit; never commit real API keys.
