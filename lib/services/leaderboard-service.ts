// ============================================================
// LifeXP — Leaderboard Service
// Maps to Logic System File v2 §18
// Combines leaderboard logic + persistence
// ============================================================

import { store } from "./store";
import {
  createLeaderboardSnapshot,
  getWeekStart,
  getWeekEnd,
} from "../logic/leaderboard";
import type { WeeklyScore } from "../logic/types";

/**
 * §18 v2 — Snapshot the leaderboard (scheduled job).
 *
 * NOT computed live per request. Scheduled every 15-30 minutes
 * during the active week, finalized at week_end.
 * GET /leaderboard reads the snapshot from store directly.
 */
export function snapshotLeaderboard(
  weekStart?: Date,
  weekEnd?: Date
): WeeklyScore[] {
  const now = new Date();
  const start = weekStart ?? getWeekStart(now);
  const end = weekEnd ?? getWeekEnd(now);

  const allTransactions = Array.from(store.xpTransactions.values());
  const snapshot = createLeaderboardSnapshot(allTransactions, start, end);

  // Replace current week's scores in store
  const weekStartStr = start.toISOString().slice(0, 10);
  store.weeklyScores = store.weeklyScores.filter(
    (s) => s.weekStart !== weekStartStr
  );
  store.weeklyScores.push(...snapshot);

  return snapshot;
}

/**
 * §18 — Get the leaderboard for a given week.
 *
 * Reads the pre-computed snapshot. Guarantees all users see
 * identical data at the same moment.
 */
export function getLeaderboard(weekStart?: string): WeeklyScore[] {
  const targetWeek =
    weekStart ?? getWeekStart(new Date()).toISOString().slice(0, 10);

  return store.weeklyScores
    .filter((s) => s.weekStart === targetWeek)
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Get a user's rank for the current week.
 */
export function getUserRank(
  userId: string,
  weekStart?: string
): WeeklyScore | null {
  const board = getLeaderboard(weekStart);
  return board.find((s) => s.userId === userId) ?? null;
}
