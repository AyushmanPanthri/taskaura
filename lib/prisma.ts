import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  var __prisma: PrismaClient | undefined;
  var __pgPool: Pool | undefined;
}

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:AYUSHMAN@localhost:5432/taskaura?schema=public";

const pool = globalThis.__pgPool || new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

const adapter = new PrismaPg(pool);

export const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
