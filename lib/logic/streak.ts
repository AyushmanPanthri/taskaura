// ============================================================
// LifeXP — Streak Logic
// Maps to Logic System File v2 §12
// Pure functions — no side effects, no DB access
// ============================================================

import type { HabitLog, StreakRecord } from "./types";
import {
  STREAK_GRACE_DAYS_PER_WEEK,
  STREAK_GRACE_WINDOW_DAYS,
} from "./constants";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get YYYY-MM-DD string for a date offset by N days.
 */
function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get all dates in a range (inclusive).
 */
function dateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  let current = startStr;
  while (current <= endStr) {
    dates.push(current);
    current = offsetDate(current, 1);
  }
  return dates;
}

// ── Public API ───────────────────────────────────────────────

/**
 * §12 — Compute streak from habit logs.
 *
 * Streak recomputation is a nightly batch job derived from habit_logs/daily_metrics
 * history, not an incrementally mutated counter (v2 append-only principle).
 *
 * Grace state: one grace day per rolling 7-day window, consumed automatically
 * the first time a day is missed. A second miss within that window breaks the streak.
 *
 * @param habitLogs - All logs for a single habit, sorted by date ascending
 * @param today - Current date as YYYY-MM-DD
 */
export function computeStreak(
  habitLogs: HabitLog[],
  today: string
): StreakRecord {
  if (habitLogs.length === 0) {
    return {
      userId: "",
      currentStreak: 0,
      bestStreak: 0,
      lastEligibleDate: null,
      graceUsedThisWeek: false,
    };
  }

  // Build a set of completed dates
  const completedDates = new Set<string>(
    habitLogs.filter((l) => l.completed).map((l) => l.date)
  );

  // Find the earliest date we have data for
  const allDates = habitLogs.map((l) => l.date).sort();
  const earliestDate = allDates[0];

  // Walk backwards from today to compute current streak
  let currentStreak = 0;
  let graceUsedInWindow = false;
  let lastEligibleDate: string | null = null;
  let checkDate = today;

  // Walk backwards day by day
  while (checkDate >= earliestDate) {
    const wasCompleted = completedDates.has(checkDate);

    if (wasCompleted) {
      currentStreak++;
      lastEligibleDate = lastEligibleDate ?? checkDate;
    } else {
      // Check if grace is available
      if (canUseGrace(completedDates, checkDate, graceUsedInWindow)) {
        // Grace consumed — streak continues but doesn't increment
        graceUsedInWindow = true;
        lastEligibleDate = lastEligibleDate ?? checkDate;
      } else {
        // Streak broken
        break;
      }
    }

    checkDate = offsetDate(checkDate, -1);
  }

  // Compute best streak ever (walk the entire history)
  const bestStreak = computeBestStreak(completedDates, earliestDate, today);

  return {
    userId: "",
    currentStreak,
    bestStreak: Math.max(currentStreak, bestStreak),
    lastEligibleDate,
    graceUsedThisWeek: graceUsedInWindow,
  };
}

/**
 * §12 v2 — Check if grace day can be used.
 *
 * One grace day per rolling 7-day window, consumed automatically
 * the first time a day is missed.
 */
export function canUseGrace(
  completedDates: Set<string>,
  missedDate: string,
  alreadyUsedThisWindow: boolean
): boolean {
  if (alreadyUsedThisWindow) return false;

  // Check the rolling 7-day window ending on missedDate
  const windowStart = offsetDate(missedDate, -(STREAK_GRACE_WINDOW_DAYS - 1));
  const windowDates = dateRange(windowStart, missedDate);

  // Count missed days in this window (excluding the current one)
  let missedInWindow = 0;
  for (const date of windowDates) {
    if (date !== missedDate && !completedDates.has(date)) {
      missedInWindow++;
    }
  }

  // Allow grace if we haven't used our one grace day this window
  return missedInWindow < STREAK_GRACE_DAYS_PER_WEEK;
}

/**
 * Compute the longest streak ever achieved.
 */
function computeBestStreak(
  completedDates: Set<string>,
  start: string,
  end: string
): number {
  let bestStreak = 0;
  let currentRun = 0;
  let graceUsed = false;

  const dates = dateRange(start, end);

  for (const date of dates) {
    if (completedDates.has(date)) {
      currentRun++;
    } else if (!graceUsed && canUseGrace(completedDates, date, false)) {
      graceUsed = true;
      // Streak continues but doesn't increment
    } else {
      bestStreak = Math.max(bestStreak, currentRun);
      currentRun = 0;
      graceUsed = false;
    }
  }

  return Math.max(bestStreak, currentRun);
}

/**
 * Check if the user completed the required daily condition.
 * This is a simplified check — in production, the "condition"
 * would be configurable per user.
 */
export function isDayEligible(
  habitLogs: HabitLog[],
  date: string,
  requiredCompletionRatio: number = 0.5
): boolean {
  const logsForDate = habitLogs.filter((l) => l.date === date);
  if (logsForDate.length === 0) return false;

  const completed = logsForDate.filter((l) => l.completed).length;
  return completed / logsForDate.length >= requiredCompletionRatio;
}
