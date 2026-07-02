-- AlterTable
ALTER TABLE "paper_sessions" ADD COLUMN     "fee_rate" DECIMAL(6,5) NOT NULL DEFAULT 0.001;

-- AlterTable
ALTER TABLE "simulated_trades" ADD COLUMN     "fee" DECIMAL(20,8) NOT NULL DEFAULT 0;
