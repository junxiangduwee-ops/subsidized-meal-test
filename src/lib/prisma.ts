import { PrismaClient } from '@prisma/client';

// With no DATABASE_URL configured, fall back to a local SQLite file so the
// app runs with zero setup. The path is relative to prisma/, matching where
// scripts/db-config.mjs writes the generated SQLite schema.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db';
}

// Reuse the client across hot reloads in dev so we don't exhaust connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    // Prisma's default interactive-transaction timeout is 5s. On a
    // connection with real round-trip latency to the DB (cross-region, or
    // just a slow pooler hop), a handful of sequential queries inside one
    // transaction (see selectMeal/clearMeal in lib/orders.ts) can blow past
    // that even though nothing is actually stuck - it's queries that are
    // each individually slow, not deadlocked. 15s gives real headroom while
    // still failing fast if something is genuinely hung.
    transactionOptions: {
      maxWait: 10_000, // time allowed to acquire a connection before starting
      timeout: 15_000, // time allowed for the whole transaction body to run
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
