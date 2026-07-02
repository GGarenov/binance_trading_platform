-- CreateEnum
CREATE TYPE "session_kind" AS ENUM ('paper', 'live_testnet', 'live_real');

-- AlterTable
ALTER TABLE "paper_sessions" ADD COLUMN     "kind" "session_kind" NOT NULL DEFAULT 'paper';

-- AlterTable
ALTER TABLE "simulated_trades" ADD COLUMN     "intended_price" DECIMAL(20,8);
