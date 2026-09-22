// ============================================================
// Task Aura — Progress Service
// Aggregates authoritative progression data:
// total XP, level, level breakdown, streak state,
// daily metrics, achievements, and weekly standing.
// ============================================================

import { store } from "./store";
import { getUserProgress } from "./xp-service";
import { LEVEL_CONFIG, localDateString } from "../logic/economy";
import { getUserRank } from "./leaderboard-service";
import { ACHIEVEMENT_DEFINITIONS } from "../logic/achievement-engine";

export interface ProgressSummary {
  userId: string;
  totalXp: number;
  level: number;
  title: string;
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

export function getUserProgressSummary(userId: string): ProgressSummary {
  // Reconcile and calculate progress using authoritative economy
  const progress = getUserProgress(userId);
  const user = store.users.get(userId);
  const tz = user?.timezone ?? "UTC";
  const today = localDateString(new Date(), tz);

  // Level config & title
  const title = LEVEL_CONFIG[progress.level]?.title ?? "Novice";

  // Streak status
  const streakRecord = store.streakRecords.get(userId);
  const userCache = store.userProgressCache.get(userId);
  const currentStreak = streakRecord?.currentStreak ?? 0;
  const longestStreak = Math.max(streakRecord?.bestStreak ?? 0, userCache?.longestStreak ?? 0);
  const graceTokens = userCache?.graceTokens ?? (streakRecord?.graceUsedThisWeek ? 0 : 1);

  let streakStatus: "ACTIVE" | "GRACE" | "INACTIVE" = "INACTIVE";
  if (currentStreak > 0) {
    streakStatus = streakRecord?.graceUsedThisWeek ? "GRACE" : "ACTIVE";
  }

  // Today's metrics
  const todayFocus = store
    .getUserFocusSessions(userId)
    .filter((s) => s.status === "COMPLETED" && localDateString(s.completedAt ?? s.startedAt, tz) === today)
    .reduce((sum, s) => sum + s.actualMinutes, 0);

  const todayTasks = store
    .getUserTasks(userId)
    .filter((t) => t.status === "COMPLETED" && t.completedAt && localDateString(t.completedAt, tz) === today).length;

  const todayHabits = store
    .getUserHabitLogs(userId)
    .filter((l) => l.date === today && l.completed).length;

  // User achievements
  const unlockedMap = new Map<string, Date>();
  for (const ua of store.getUserAchievements(userId)) {
    unlockedMap.set(ua.achievementId, ua.unlockedAt);
  }

  const achievements = ACHIEVEMENT_DEFINITIONS.slice(0, 10).map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    unlocked: unlockedMap.has(def.id),
    unlockedAt: unlockedMap.get(def.id)?.toISOString() ?? null,
  }));

  // Weekly score
  const userRank = getUserRank(userId);
  let weeklyScore = null;
  if (userRank) {
    weeklyScore = {
      rank: userRank.rank,
      weeklyXp: userRank.totalXp,
      weekStart: userRank.weekStart,
      weekEnd: userRank.weekEnd,
    };
  }

  return {
    userId,
    totalXp: progress.totalXp,
    level: progress.level,
    title,
    xpRequiredForLevel: progress.xpToNext,
    xpEarnedInLevel: progress.xpIntoLevel,
    xpRemaining: Math.max(0, progress.xpToNext - progress.xpIntoLevel),
    levelProgressPercentage: Math.round(progress.fraction * 1000) / 10,
    fraction: progress.fraction,
    streak: {
      current: currentStreak,
      longest: longestStreak,
      status: streakStatus,
      graceTokens,
      graceUsedThisWeek: streakRecord?.graceUsedThisWeek ?? false,
    },
    dailyMetrics: {
      date: today,
      focusMinutes: todayFocus,
      tasksCompleted: todayTasks,
      habitsCompleted: todayHabits,
    },
    achievements,
    weeklyScore,
  };
}
