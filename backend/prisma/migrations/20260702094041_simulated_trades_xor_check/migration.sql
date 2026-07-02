-- Every simulated trade must belong to exactly one parent:
-- a backtest run OR a paper session, never both, never neither.
-- Prisma's schema language cannot express CHECK constraints, so it lives here.
ALTER TABLE "simulated_trades"
  ADD CONSTRAINT "simulated_trades_one_parent_check"
  CHECK (("backtest_run_id" IS NULL) <> ("paper_session_id" IS NULL));
