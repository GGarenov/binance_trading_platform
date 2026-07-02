# Project Spec: CryptoStrategy Lab

## 1. What this is

A beginner-friendly web app where a user can pick a crypto trading strategy from a library, read a plain-language explanation of how it works, configure it with their own parameters (amount, time period, coin pair), and test it two ways before risking real money:

- **Backtesting** – simulate the strategy against historical price data
- **Paper trading** – run the strategy live against real-time market data using simulated (fake) funds

No real trades are executed in the MVP. This is a learning/testing tool first.

## 2. Target user

Someone with little or no trading experience who has heard terms like "DCA" or "grid trading" but doesn't know what they mean or how to configure them safely. The UI and copy should assume zero prior trading knowledge.

## 3. MVP scope

### In scope
- Strategy library with exactly 2 strategies at launch: **DCA** and **Grid Trading**
- Each strategy card shows: name, plain-language description, "how it works", risk level (Low/Medium/High), when it works well / when it doesn't, configurable parameters
- User-configurable parameters: amount, time interval/period, trading pair, strategy-specific settings (e.g. grid range for Grid Trading)
- Backtesting engine using historical Binance price data
- Paper trading engine using real-time Binance price data with simulated balance
- Results dashboard: P&L, win rate, chart of simulated performance
- Binance API integration for **market data only** (no order execution)

### Explicitly out of scope (do not build yet)
- Arbitrage strategies
- Live trading with real funds and real order execution
- Additional strategies beyond DCA and Grid
- Multi-exchange support
- User accounts / auth (can hardcode a single local user for MVP if needed — revisit if this becomes multi-user)

Keeping this list of exclusions in the spec is intentional — the goal is to stop scope creep, not to forget these features. They come after the MVP works end-to-end.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + React + Tailwind |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Exchange data | Binance public REST API (+ WebSocket for paper trading live prices) |
| Hosting (later) | TBD — not needed for local MVP |

## 5. High-level architecture

```
Frontend (Next.js)
├── Strategy Selector — cards with description, risk level, "learn more"
├── Configuration Panel — user sets amount, period, pair, parameters
├── Backtest Dashboard — charts, P&L, trade log
└── Paper Trading Dashboard — live simulated P&L, open positions

Backend (Node/Express)
├── Strategy Engine — shared interface all strategies implement (run(config, priceData))
├── Backtest Service — fetches historical data, feeds it to Strategy Engine, returns results
├── Paper Trading Service — subscribes to live price feed, feeds it to Strategy Engine, tracks simulated positions
├── Binance Client — wraps Binance REST + WebSocket calls
└── Postgres — stores: strategy configs, backtest results, paper trading sessions, simulated trade history
```

## 6. Strategy definitions (for MVP)

**DCA (Dollar-Cost Averaging)**
- Plain description: buy a fixed amount at fixed time intervals, regardless of price, to smooth out volatility
- Risk level: Low
- Configurable: amount per buy, interval (daily/weekly), trading pair, duration

**Grid Trading**
- Plain description: place a grid of buy/sell orders across a price range; profits from price moving up and down within that range
- Risk level: Medium
- Configurable: price range (upper/lower bound), number of grid levels, amount per level, trading pair

## 7. Data model (draft — refine once building starts)

- `strategies` — id, name, description, risk_level, default_params (jsonb)
- `strategy_configs` — id, strategy_id, user params (jsonb), created_at
- `backtest_runs` — id, config_id, start_date, end_date, results (jsonb), created_at
- `paper_sessions` — id, config_id, status (running/stopped), simulated_balance, started_at
- `simulated_trades` — id, session_id (backtest or paper), timestamp, side, price, amount

## 8. Security notes

- Binance API key: **market-data / trading permissions only, never withdrawal**
- `.env` for all secrets, gitignored from first commit
- No real order execution anywhere in this phase of the project

## 9. Open questions to resolve while building

- Exact historical data granularity for backtesting (1h candles? 1d?)
- How far back Binance's public API allows fetching historical data for free
- Whether paper trading sessions persist across page reloads (likely yes, via DB)

## 10. Definition of done for MVP

A user can: open the app, pick DCA or Grid, read what it does, configure it, run a backtest and see results, start a paper trading session and watch it run against live prices — all without touching real funds.
