// ============================================================
// TaskAura — PostgreSQL-Authoritative Progress Service
//
// WHY THIS EXISTS:
// The legacy progress-service.ts reads totalXp from the in-memory
// store singleton. Admin XP grants (and any other direct Prisma
// writes) bypass that store entirely — they write to PostgreSQL
// but never update the in-memory Map. This means admin-granted XP
// is silently swallowed: the DB row is there, the audit log is
// there, but getTotalXp() returns the stale in-memory total.
//
// This service fixes that by reading the XP ledger SUM directly
// from PostgreSQL (the source of truth), then overlaying the rest
// of the summary (level, streak, achievements) on top.
// ============================================================

import { prisma } from "../prisma";
import {
  levelFor,
  levelProgress as levelProgressDetail,
  localDateString,
  getRankTitleInfo,
  getLegacyLevelTitle,
} from "../logic/economy";
import { ACHIEVEMENT_DEFINITIONS } from "../logic/achievement-engine";

export interface PgProgressSummary {
  userId: string;
  totalXp: number;
  level: number;
  /** @deprecated RPG mastery proficiency tier (e.g. Novice, Apprentice, Zenith). Kept for backward compatibility. */
  title: string;
  rankTitle: string;
  rankTier: number;
  nextTitleAt: number | null;
  xpRequiredForLevel: number;
  xpEarnedInLevel: number;
  xpRemaining: number;
  levelProgressPercentage: number;
  fraction: number;
  streak: {
    current: number;
    longest: number;
    status: "ACTIVE" | "GRACE" | "INACTIVE";
    graceTokens: number;
    graceUsedThisWeek: boolean;
  };
  dailyMetrics: {
    date: string;
    focusMinutes: number;
    tasksCompleted: number;
    habitsCompleted: number;
  };
  achievements: {
    id: string;
    name: string;
    description: string;
    unlocked: boolean;
    unlockedAt: string | null;
  }[];
  weeklyScore: {
    rank: number | null;
    weeklyXp: number;
    weekStart: string;
    weekEnd: string;
  } | null;
}

/**
 * Returns a fully authoritative ProgressSummary by reading the
 * XP ledger SUM from PostgreSQL — never from the in-memory store.
 *
 * This ensures admin XP grants, which are written directly to the
 * DB via xpRepository, are immediately reflected in the player's
 * dashboard, leaderboard, and level display.
 */
export async function getPgProgressSummary(userId: string): Promise<PgProgressSummary> {
  const today = localDateString(new Date(), "UTC");
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(`${today}T23:59:59.999Z`);

  // ── 1. Authoritative XP total from PostgreSQL ledger ──────
  const xpAgg = await prisma.xPTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  // Floored at 0 to prevent negative XP display after excessive reversals
  const totalXp = Math.max(0, xpAgg._sum.amount ?? 0);

  // ── 2. Level & progress breakdown ─────────────────────────
  const levelDetail = levelProgressDetail(totalXp, 100);
  const level = levelFor(totalXp, 100);
  const title = getLegacyLevelTitle(level);
  const rankInfo = getRankTitleInfo(level);

  // ── 3. Streak from PostgreSQL ──────────────────────────────
  const streakRecord = await prisma.streakRecord.findUnique({
    where: { userId },
    select: {
      currentStreak: true,
      bestStreak: true,
      graceUsedThisWeek: true,
    },
  });
  const currentStreak = streakRecord?.currentStreak ?? 0;
  const longestStreak = streakRecord?.bestStreak ?? 0;
  const graceUsedThisWeek = streakRecord?.graceUsedThisWeek ?? false;
  const graceTokens = graceUsedThisWeek ? 0 : 1;

  let streakStatus: "ACTIVE" | "GRACE" | "INACTIVE" = "INACTIVE";
  if (currentStreak > 0) {
    streakStatus = graceUsedThisWeek ? "GRACE" : "ACTIVE";
  }

  // ── 4. Today's activity from PostgreSQL ───────────────────
  const [focusAgg, tasksCompletedCount, habitsCompletedCount] = await Promise.all([
    prisma.focusSession.aggregate({
      where: {
        userId,
        status: "COMPLETED",
        completedAt: { gte: todayStart, lte: todayEnd },
      },
      _sum: { actualMinutes: true },
    }),
    prisma.task.count({
      where: {
        userId,
        status: "COMPLETED",
        completedAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.habitLog.count({
      where: {
        habit: { userId },
        date: today,
        completed: true,
      },
    }),
  ]);

  // ── 5. Achievements from PostgreSQL ───────────────────────
  const unlockedRows = await prisma.userAchievement.findMany({
    where: { userId },
    select: { achievementId: true, unlockedAt: true },
  });
  const unlockedMap = new Map<string, Date>(
    unlockedRows.map((r) => [r.achievementId, r.unlockedAt])
  );

  const achievements = ACHIEVEMENT_DEFINITIONS.slice(0, 10).map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    unlocked: unlockedMap.has(def.id),
    unlockedAt: unlockedMap.get(def.id)?.toISOString() ?? null,
  }));

  // ── 6. Weekly score from PostgreSQL ───────────────────────
  const latestWeeklyScore = await prisma.weeklyScore.findFirst({
    where: { userId },
    orderBy: { snapshotAt: "desc" },
    select: { rank: true, totalXp: true, weekStart: true, weekEnd: true },
  });

  const weeklyScore = latestWeeklyScore
    ? {
        rank: latestWeeklyScore.rank ?? null,
        weeklyXp: latestWeeklyScore.totalXp,
        weekStart: latestWeeklyScore.weekStart,
        weekEnd: latestWeeklyScore.weekEnd,
      }
    : null;

  return {
    userId,
    totalXp,
    level,
    title,
    rankTitle: rankInfo.rankTitle,
    rankTier: rankInfo.rankTier,
    nextTitleAt: rankInfo.nextTitleAt,
    xpRequiredForLevel: level >= 100 ? 0 : levelDetail.xpToNext,
    xpEarnedInLevel: levelDetail.xpIntoLevel,
    xpRemaining: level >= 100 ? 0 : Math.max(0, levelDetail.xpToNext - levelDetail.xpIntoLevel),
    levelProgressPercentage: level >= 100 ? 100 : Math.round(levelDetail.fraction * 1000) / 10,
    fraction: level >= 100 ? 1.0 : levelDetail.fraction,
    streak: {
      current: currentStreak,
      longest: longestStreak,
      status: streakStatus,
      graceTokens,
      graceUsedThisWeek,
    },
    dailyMetrics: {
      date: today,
      focusMinutes: Math.round(focusAgg._sum.actualMinutes ?? 0),
      tasksCompleted: tasksCompletedCount,
      habitsCompleted: habitsCompletedCount,
    },
    achievements,
    weeklyScore,
  };
}
