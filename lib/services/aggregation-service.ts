// ============================================================
// LifeXP — Aggregation Service
// Maps to Logic System File v2 §4, §6, §12, §13
// Combines aggregation/streak/achievement logic + persistence
// ============================================================

import { store } from "./store";
import { getTotalXp, getUserLevel } from "./xp-service";
import {
  aggregateDailyMetrics,
  computeBehavioralMetrics,
} from "../logic/aggregation";
import { computeStreak } from "../logic/streak";
import {
  evaluateAchievements,
  ACHIEVEMENT_DEFINITIONS,
} from "../logic/achievement-engine";
import type { DailyMetrics, UserStats } from "../logic/types";
import { FocusSessionStatus, TaskStatus } from "../logic/types";

/**
 * §4 v2 — Run daily aggregation for a user (idempotent batch).
 *
 * Debounced batch job — recomputing for (user_id, date) always
 * recomputes from usage_sessions, never increments in place.
 */
export function runDailyAggregation(
  userId: string,
  date: string
): DailyMetrics {
  const sessions = store.getUserSessions(userId, date);
  const tasks = store.getUserTasks(userId).filter((t) => {
    const taskDate = t.completedAt?.toISOString().slice(0, 10) ?? t.createdAt.toISOString().slice(0, 10);
    return taskDate === date;
  });
  const habits = store.getUserHabits(userId);
  const habitLogs = store
    .getUserHabitLogs(userId)
    .filter((l) => l.date === date);
  const goals = store.getUserGoals(userId);
  const historicalMetrics = store
    .getUserDailyMetrics(userId)
    .filter((m) => m.date !== date); // exclude today

  // Calculate focus minutes for the day
  const focusSessions = store
    .getUserFocusSessions(userId)
    .filter(
      (f) =>
        f.status === FocusSessionStatus.COMPLETED &&
        f.completedAt &&
        f.completedAt.toISOString().slice(0, 10) === date
    );
  const focusMinutes = focusSessions.reduce(
    (sum, f) => sum + f.actualMinutes,
    0
  );

  // §4 — Aggregate core metrics
  const coreMetrics = aggregateDailyMetrics(sessions, focusMinutes, tasks);

  // §6 — Compute behavioral metrics
  const behavioralMetrics = computeBehavioralMetrics(
    sessions,
    focusMinutes,
    tasks,
    habits,
    habitLogs,
    goals,
    historicalMetrics
  );

  const dailyMetrics: DailyMetrics = {
    id: `${userId}:${date}`,
    userId,
    date,
    totalScreenTime: coreMetrics.totalScreenTime,
    appOpens: coreMetrics.appOpens,
    focusMinutes: coreMetrics.focusMinutes,
    taskCompletionRate: coreMetrics.taskCompletionRate,
    ...behavioralMetrics,
  };

  // Upsert (idempotent)
  store.upsertDailyMetrics(dailyMetrics);
  return dailyMetrics;
}

/**
 * §12 v2 — Recompute streaks from source data (nightly batch).
 *
 * Derived from habit_logs history, not an incrementally mutated counter.
 */
export function recomputeStreaks(userId: string, today: string): void {
  const habitLogs = store.getUserHabitLogs(userId);

  const streak = computeStreak(habitLogs, today);
  streak.userId = userId;

  store.upsertStreakRecord(streak);
}

/**
 * §13 — Run achievement evaluation (part of nightly batch).
 *
 * One evaluation pass over rule_version-tagged definitions.
 */
export function evaluateUserAchievements(userId: string): string[] {
  const stats = getUserStats(userId);
  const alreadyUnlocked = new Set(
    store.getUserAchievements(userId).map((a) => a.achievementId)
  );

  const newlyUnlocked = evaluateAchievements(
    stats,
    ACHIEVEMENT_DEFINITIONS,
    alreadyUnlocked
  );

  const unlockedIds: string[] = [];

  for (const achievement of newlyUnlocked) {
    const added = store.addUserAchievement({
      userId,
      achievementId: achievement.id,
      unlockedAt: new Date(),
    });
    if (added) {
      unlockedIds.push(achievement.id);
    }
  }

  return unlockedIds;
}

/**
 * §4/§12/§13 — Run the full nightly batch for a user.
 *
 * Combines daily aggregation, streak recomputation, and achievement evaluation
 * in a single pass.
 */
export function runNightlyBatch(
  userId: string,
  date: string
): {
  metrics: DailyMetrics;
  newAchievements: string[];
} {
  // 1. Aggregate daily metrics
  const metrics = runDailyAggregation(userId, date);

  // 2. Recompute streaks
  recomputeStreaks(userId, date);

  // 3. Evaluate achievements
  const newAchievements = evaluateUserAchievements(userId);

  return { metrics, newAchievements };
}

/**
 * Get aggregate user stats for achievement evaluation.
 */
function getUserStats(userId: string): UserStats {
  const totalXp = getTotalXp(userId);
  const level = getUserLevel(userId);
  const streakRecord = store.streakRecords.get(userId);
  const completedTasks = store
    .getUserTasks(userId)
    .filter((t) => t.status === TaskStatus.COMPLETED).length;
  const totalFocusMinutes = store
    .getUserFocusSessions(userId)
    .filter((f) => f.status === FocusSessionStatus.COMPLETED)
    .reduce((sum, f) => sum + f.actualMinutes, 0);
  const totalHabitsCompleted = store
    .getUserHabitLogs(userId)
    .filter((l) => l.completed).length;

  return {
    totalXp,
    level,
    currentStreak: streakRecord?.currentStreak ?? 0,
    bestStreak: streakRecord?.bestStreak ?? 0,
    totalTasksCompleted: completedTasks,
    totalFocusMinutes,
    totalHabitsCompleted,
  };
}

/**
 * Get user stats (exposed for dashboard/API).
 */
export function getPublicUserStats(userId: string): UserStats {
  return getUserStats(userId);
}
