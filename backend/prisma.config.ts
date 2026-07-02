import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 configuration: connection URL and seed command live here,
// not in schema.prisma / package.json as in older Prisma versions.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
