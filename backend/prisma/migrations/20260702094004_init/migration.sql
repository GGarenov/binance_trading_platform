-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('pending', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('running', 'stopped');

-- CreateEnum
CREATE TYPE "trade_side" AS ENUM ('buy', 'sell');

-- CreateTable
CREATE TABLE "strategies" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "how_it_works" TEXT NOT NULL,
    "when_it_works" TEXT NOT NULL,
    "when_it_doesnt" TEXT NOT NULL,
    "risk_level" "risk_level" NOT NULL,
    "default_params" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_configs" (
    "id" SERIAL NOT NULL,
    "strategy_id" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" SERIAL NOT NULL,
    "config_id" INTEGER NOT NULL,
    "start_date" TIMESTAMPTZ NOT NULL,
    "end_date" TIMESTAMPTZ NOT NULL,
    "interval" TEXT NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'pending',
    "results" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_sessions" (
    "id" SERIAL NOT NULL,
    "config_id" INTEGER NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'running',
    "initial_balance" DECIMAL(20,8) NOT NULL,
    "quote_balance" DECIMAL(20,8) NOT NULL,
    "base_balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ,

    CONSTRAINT "paper_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_trades" (
    "id" SERIAL NOT NULL,
    "backtest_run_id" INTEGER,
    "paper_session_id" INTEGER,
    "side" "trade_side" NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "quote_amount" DECIMAL(20,8) NOT NULL,
    "executed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "simulated_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategies_slug_key" ON "strategies"("slug");

-- CreateIndex
CREATE INDEX "simulated_trades_backtest_run_id_idx" ON "simulated_trades"("backtest_run_id");

-- CreateIndex
CREATE INDEX "simulated_trades_paper_session_id_idx" ON "simulated_trades"("paper_session_id");

-- AddForeignKey
ALTER TABLE "strategy_configs" ADD CONSTRAINT "strategy_configs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "strategy_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_sessions" ADD CONSTRAINT "paper_sessions_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "strategy_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_trades" ADD CONSTRAINT "simulated_trades_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_trades" ADD CONSTRAINT "simulated_trades_paper_session_id_fkey" FOREIGN KEY ("paper_session_id") REFERENCES "paper_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
