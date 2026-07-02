import "dotenv/config";
import { createApp } from "./app";
import { paperTradingManager } from "./services/paperTradingService";

const port = Number(process.env.PORT) || 4000;

const app = createApp();

app.listen(port, () => {
  console.log(`CryptoStrategy Lab API listening on http://localhost:${port}`);

  // Revive paper sessions that were running when the server last shut down.
  paperTradingManager.resumeRunningSessions().catch((err) => {
    console.error("Failed to resume paper sessions:", err);
  });
});
