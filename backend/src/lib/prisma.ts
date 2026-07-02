import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// One shared client for the whole process. Each PrismaClient manages its own
// connection pool, so creating one per request would exhaust Postgres connections.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

export const prisma = new PrismaClient({ adapter });
