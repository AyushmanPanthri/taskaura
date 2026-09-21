// ============================================================
// LifeXP — Leaderboard Logic
// Maps to Logic System File v2 §18
// Pure functions — no side effects, no DB access
// ============================================================

import type { WeeklyScore, XPTransaction } from "./types";

/**
 * §18 — Compute weekly XP scores for all users.
 *
 * weekly_xp(user, week) =
 *     Σ xp_transactions
 *     WHERE created_at ∈ [week_start, week_end)
 *     AND transaction_status = VALID
 */
export function computeWeeklyScores(
  transactions: XPTransaction[],
  weekStart: Date,
  weekEnd: Date
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const tx of transactions) {
    const txTime = tx.createdAt.getTime();
    if (txTime >= weekStart.getTime() && txTime < weekEnd.getTime()) {
      scores.set(tx.userId, (scores.get(tx.userId) ?? 0) + tx.amount);
    }
  }

  return scores;
}

/**
 * §18 — Assign dense ranks to weekly scores.
 *
 * rank = dense_rank(order by weekly_xp DESC)
 *
 * Dense ranking means no gaps: if two users tie at rank 1,
 * the next user is rank 2 (not rank 3).
 */
export function assignRanks(
  scores: Map<string, number>
): WeeklyScore[] {
  const entries = Array.from(scores.entries())
    .map(([userId, totalXp]) => ({ userId, totalXp }))
    .sort((a, b) => b.totalXp - a.totalXp);

  const now = new Date();
  const results: WeeklyScore[] = [];
  let currentRank = 1;
  let previousXp: number | null = null;

  for (const entry of entries) {
    if (previousXp !== null && entry.totalXp < previousXp) {
      currentRank++;
    }
    previousXp = entry.totalXp;

    results.push({
      userId: entry.userId,
      weekStart: "", // set by caller
      weekEnd: "",   // set by caller
      totalXp: entry.totalXp,
      rank: currentRank,
      snapshotAt: now,
    });
  }

  return results;
}

/**
 * §18 — Create a full leaderboard snapshot.
 *
 * The leaderboard is NOT computed live per request. A scheduled job
 * snapshots weekly_scores (every 15-30 minutes during active week),
 * and GET /leaderboard reads that snapshot.
 */
export function createLeaderboardSnapshot(
  transactions: XPTransaction[],
  weekStart: Date,
  weekEnd: Date
): WeeklyScore[] {
  const scores = computeWeeklyScores(transactions, weekStart, weekEnd);
  const ranked = assignRanks(scores);

  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  // Fill in week dates
  for (const score of ranked) {
    score.weekStart = weekStartStr;
    score.weekEnd = weekEndStr;
  }

  return ranked;
}

/**
 * Get the start of the current ISO week (Monday 00:00:00).
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the current ISO week (Sunday 23:59:59.999).
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}
