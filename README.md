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

🚧 Early planning / setup phase. See `PROJECT_SPEC.md` for full spec.

## Getting started

Setup instructions will be added once the initial project scaffold exists.

## Security note

This project will eventually handle exchange API keys. Any Binance API key used here should be created with **read-only / trading permissions only — never withdrawal permissions**. `.env` files are gitignored from the first commit; never commit real API keys.
