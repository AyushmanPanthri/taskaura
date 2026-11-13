import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  var __prisma: PrismaClient | undefined;
  var __pgPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const connectionString =
    process.env.DATABASE_URL_POOLED ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Database configuration missing. Set DATABASE_URL (pooled PostgreSQL URL) before starting TaskAura.",
    );
  }

  return connectionString;
}

const connectionString = getDatabaseUrl();

const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString,
    // Keep each serverless process from opening an excessive number of
    // connections. The provider-side pooler handles cross-instance traffic.
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

const adapter = new PrismaPg(pool);

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
