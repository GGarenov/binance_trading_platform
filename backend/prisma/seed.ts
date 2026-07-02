import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Upserts (keyed by slug) so the seed is safe to re-run without duplicating rows.
async function main() {
  await prisma.strategy.upsert({
    where: { slug: "dca" },
    update: {},
    create: {
      slug: "dca",
      name: "Dollar-Cost Averaging (DCA)",
      description:
        "Buy a fixed amount of a coin at regular intervals — for example, $50 of Bitcoin every week — no matter what the price is.",
      howItWorks:
        "Instead of trying to guess the perfect moment to buy, you split your money into many small purchases spread over time. When the price is high, your fixed amount buys a little less; when the price is low, it buys a little more. Over time this averages out your purchase price, which is where the name comes from. You never sell during the strategy — you simply accumulate.",
      whenItWorks:
        "Works well when you believe a coin will be worth more in the long run but its price swings a lot along the way. It removes the stress (and mistakes) of trying to time the market.",
      whenItDoesnt:
        "If the price steadily declines for the entire period and never recovers, you will have bought all the way down and your holdings will be worth less than you paid. DCA smooths volatility — it does not protect against a coin that keeps losing value.",
      riskLevel: "low",
      defaultParams: {
        pair: "BTCUSDT",
        amountPerBuy: 50,
        interval: "weekly",
        durationDays: 90,
      },
    },
  });

  await prisma.strategy.upsert({
    where: { slug: "grid" },
    update: {},
    create: {
      slug: "grid",
      name: "Grid Trading",
      description:
        "Place a ladder of buy and sell orders across a price range, and profit each time the price bounces between the rungs.",
      howItWorks:
        "You choose a price range you expect the coin to stay inside — say $60,000 to $70,000 for Bitcoin — and split it into evenly spaced levels (the 'grid'). The strategy buys a small amount whenever the price drops to a lower level, and sells that amount back whenever the price rises to the level above. Each completed buy-low/sell-high pair locks in a small profit. The more the price zig-zags inside your range, the more of these small profits you collect.",
      whenItWorks:
        "Works well in a sideways, choppy market where the price keeps oscillating inside a range without a strong trend in either direction.",
      whenItDoesnt:
        "If the price breaks out of your range, the grid stops working: above the range you have sold everything and miss further gains; below the range you are holding coins bought at higher prices with no buyers beneath you. Choosing the range is the hard (and risky) part.",
      riskLevel: "medium",
      defaultParams: {
        pair: "BTCUSDT",
        lowerBound: 60000,
        upperBound: 70000,
        gridLevels: 10,
        amountPerLevel: 100,
      },
    },
  });

  await prisma.strategy.upsert({
    where: { slug: "ma-crossover" },
    update: {},
    create: {
      slug: "ma-crossover",
      name: "Moving Average Crossover",
      description:
        "Follow the trend: buy when the market's short-term direction turns up, sell everything when it turns back down.",
      howItWorks:
        "The strategy watches two averages of the price: a fast one (the last 10 hours) and a slow one (the last 50 hours). When the fast average climbs above the slow one, it means recent prices are rising faster than the longer trend — the strategy buys. When the fast average falls back below the slow one, the upswing is fading — it sells everything and waits in cash. It holds at most one position at a time and checks the market once per hour.",
      whenItWorks:
        "Works well in markets with long, sustained trends: it catches a big move early-ish and rides it, while staying safely in cash during long declines.",
      whenItDoesnt:
        "In a sideways, choppy market the two averages cross back and forth constantly ('whipsaw'): the strategy keeps buying small rises and selling small dips, losing a little — plus fees — each time. Trend followers pay for their patience in boring markets.",
      riskLevel: "medium",
      defaultParams: {
        pair: "BTCUSDT",
        shortPeriod: 10,
        longPeriod: 50,
        amountPerEntry: 500,
      },
    },
  });

  await prisma.strategy.upsert({
    where: { slug: "rsi-reversion" },
    update: {},
    create: {
      slug: "rsi-reversion",
      name: "RSI Mean Reversion",
      description:
        "Buy when the market looks panic-sold, sell when it looks euphoric — betting that extremes snap back to normal.",
      howItWorks:
        "RSI (Relative Strength Index) is a 0–100 gauge comparing recent gains to recent losses, measured hourly here. Below 30 usually means the market has been sold hard and fast ('oversold'); above 70 means it has been bought hard and fast ('overbought'). This strategy buys when RSI drops under your oversold threshold and sells the position once RSI rises over your overbought threshold. One position at a time.",
      whenItWorks:
        "Works well in ranging markets that overreact and correct: sharp dips get bought, euphoric spikes get sold, and the price's habit of returning to the middle pays you.",
      whenItDoesnt:
        "In a strong crash, 'oversold' can stay oversold for a long time while the price keeps falling — buying the dip of a collapsing market is called catching a falling knife. Mean reversion loses exactly when trends are strongest.",
      riskLevel: "medium",
      defaultParams: {
        pair: "BTCUSDT",
        rsiPeriod: 14,
        oversold: 30,
        overbought: 70,
        amountPerEntry: 500,
      },
    },
  });

  const count = await prisma.strategy.count();
  console.log(`Seed complete. Strategies in database: ${count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
