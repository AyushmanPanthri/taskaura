// ============================================================
// LifeXP — Leaderboard Service
// PostgreSQL-backed Leaderboard Service
// ============================================================

import { prisma } from "../prisma";
import { getWeekStart, getWeekEnd } from "../logic/leaderboard";
import type { WeeklyScore } from "../logic/types";

/**
 * Snapshot the leaderboard into PostgreSQL (scheduled job).
 */
export async function snapshotLeaderboard(
  weekStart?: Date,
  weekEnd?: Date
): Promise<void> {
  const now = new Date();
  const start = weekStart ?? getWeekStart(now);
  const end = weekEnd ?? getWeekEnd(now);
  const weekStartStr = start.toISOString().slice(0, 10);
  const weekEndStr = end.toISOString().slice(0, 10);

  const weekEndExclusive = new Date(end);
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 1);

  const weeklyXpRows = await prisma.xPTransaction.groupBy({
    by: ["userId"],
    where: {
      createdAt: {
        gte: start,
        lt: weekEndExclusive,
      },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  let rank = 1;
  for (const row of weeklyXpRows) {
    await prisma.weeklyScore.upsert({
      where: {
        userId_weekStart: {
          userId: row.userId,
          weekStart: weekStartStr,
        },
      },
      create: {
        userId: row.userId,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        totalXp: row._sum.amount ?? 0,
        rank,
      },
      update: {
        totalXp: row._sum.amount ?? 0,
        rank,
        snapshotAt: new Date(),
      },
    });
    rank++;
  }
}

export async function getWeeklyLeaderboard(targetDate: Date = new Date()) {
  const start = getWeekStart(targetDate);
  const end = getWeekEnd(targetDate);
  const weekEndExclusive = new Date(end);
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 1);

  const weeklyXpRows = await prisma.xPTransaction.groupBy({
    by: ["userId"],
    where: {
      createdAt: {
        gte: start,
        lt: weekEndExclusive,
      },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: 100,
  });

  return weeklyXpRows.map((r, i) => ({
    userId: r.userId,
    xp: r._sum.amount ?? 0,
    rank: i + 1,
  }));
}

