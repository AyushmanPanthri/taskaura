// ============================================================
// LifeXP — Daily Aggregation Engine
// Maps to Logic System File v2 §4, §6
// Pure functions — no side effects, no DB access
// ============================================================

import type { DailyMetrics, UsageSession, Goal, Task, Habit, HabitLog } from "./types";
import { TaskStatus } from "./types";
import { SESSION_OVERLAP_THRESHOLD, METRIC_WEIGHTS } from "./constants";

// ── §4 — Session Merging ─────────────────────────────────────

/**
 * Calculate overlap ratio between two sessions with the same package.
 * Returns a value between 0.0 and 1.0.
 */
function sessionOverlapRatio(a: UsageSession, b: UsageSession): number {
  const overlapStart = Math.max(a.startTime.getTime(), b.startTime.getTime());
  const overlapEnd = Math.min(a.endTime.getTime(), b.endTime.getTime());
  const overlapMs = Math.max(0, overlapEnd - overlapStart);

  const shorterDurationMs = Math.min(
    a.endTime.getTime() - a.startTime.getTime(),
    b.endTime.getTime() - b.startTime.getTime()
  );

  if (shorterDurationMs <= 0) return 0;
  return overlapMs / shorterDurationMs;
}

/**
 * §4 v2 — Merge overlapping sessions for the same package.
 *
 * Sessions sharing >50% time overlap for the same package_name
 * are merged before aggregation, not summed.
 */
export function mergeOverlappingSessions(
  sessions: UsageSession[]
): UsageSession[] {
  if (sessions.length <= 1) return [...sessions];

  // Group by package_name
  const byPackage = new Map<string, UsageSession[]>();
  for (const session of sessions) {
    const group = byPackage.get(session.packageName) ?? [];
    group.push(session);
    byPackage.set(session.packageName, group);
  }

  const merged: UsageSession[] = [];

  for (const [, packageSessions] of byPackage) {
    // Sort by start time
    const sorted = [...packageSessions].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    const mergedGroup: UsageSession[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = mergedGroup[mergedGroup.length - 1];

      if (sessionOverlapRatio(last, current) > SESSION_OVERLAP_THRESHOLD) {
        // Merge: extend the last session to cover both
        const mergedSession: UsageSession = {
          ...last,
          endTime: new Date(
            Math.max(last.endTime.getTime(), current.endTime.getTime())
          ),
          startTime: new Date(
            Math.min(last.startTime.getTime(), current.startTime.getTime())
          ),
          durationSeconds: 0, // recalculated below
        };
        mergedSession.durationSeconds = Math.round(
          (mergedSession.endTime.getTime() -
            mergedSession.startTime.getTime()) /
            1000
        );
        mergedGroup[mergedGroup.length - 1] = mergedSession;
      } else {
        mergedGroup.push(current);
      }
    }

    merged.push(...mergedGroup);
  }

  return merged;
}

// ── §4 — Daily Aggregation ───────────────────────────────────

/**
 * §4 — Aggregate usage sessions into daily metrics.
 *
 * total_screen_time   = Σ app_session_duration
 * app_usage[app]      = Σ duration for that app
 * category_usage[cat] = Σ duration for that category
 * app_opens           = count(valid sessions)
 * focus_minutes       = Σ completed focus-session minutes
 * task_completion_rate = completed_tasks / planned_tasks
 *
 * Runs as an idempotent batch — re-running for a given (user_id, date)
 * always recomputes from usage_sessions, never increments in place.
 */
export function aggregateDailyMetrics(
  sessions: UsageSession[],
  focusMinutes: number,
  tasks: Task[]
): Pick<
  DailyMetrics,
  "totalScreenTime" | "appOpens" | "focusMinutes" | "taskCompletionRate"
> & {
  appUsage: Map<string, number>;
  categoryUsage: Map<string, number>;
} {
  // First merge overlapping sessions
  const mergedSessions = mergeOverlappingSessions(sessions);

  // total_screen_time = Σ app_session_duration
  const totalScreenTime = mergedSessions.reduce(
    (sum, s) => sum + s.durationSeconds,
    0
  );

  // app_opens = count(valid sessions)
  const appOpens = mergedSessions.length;

  // app_usage[app] = Σ duration for that app
  const appUsage = new Map<string, number>();
  for (const s of mergedSessions) {
    appUsage.set(
      s.packageName,
      (appUsage.get(s.packageName) ?? 0) + s.durationSeconds
    );
  }

  // category_usage[cat] = Σ duration for that category
  const categoryUsage = new Map<string, number>();
  for (const s of mergedSessions) {
    const cat = s.category ?? "uncategorized";
    categoryUsage.set(cat, (categoryUsage.get(cat) ?? 0) + s.durationSeconds);
  }

  // task_completion_rate = completed_tasks / planned_tasks
  const plannedTasks = tasks.filter(
    (t) =>
      t.status !== TaskStatus.CANCELLED
  );
  const completedTasks = tasks.filter(
    (t) => t.status === TaskStatus.COMPLETED
  );
  const taskCompletionRate =
    plannedTasks.length > 0 ? completedTasks.length / plannedTasks.length : 0;

  return {
    totalScreenTime,
    appOpens,
    focusMinutes,
    taskCompletionRate,
    appUsage,
    categoryUsage,
  };
}

// ── §6 — Behavioral Metrics ─────────────────────────────────

/**
 * §6 — Compute the six behavioral metrics.
 *
 * All six are computed once per day as part of the same aggregation batch,
 * cached in daily_metrics. The dashboard reads a precomputed row.
 *
 * All scores are normalized to 0–100.
 */
export function computeBehavioralMetrics(
  sessions: UsageSession[],
  focusMinutes: number,
  tasks: Task[],
  habits: Habit[],
  habitLogs: HabitLog[],
  goals: Goal[],
  historicalMetrics: DailyMetrics[]
): Pick<
  DailyMetrics,
  | "distractionIndex"
  | "focusScore"
  | "consistencyScore"
  | "goalAlignment"
  | "taskReliability"
  | "routineStability"
> {
  const mergedSessions = mergeOverlappingSessions(sessions);

  return {
    distractionIndex: computeDistractionIndex(mergedSessions),
    focusScore: computeFocusScore(mergedSessions, focusMinutes),
    consistencyScore: computeConsistencyScore(
      habitLogs,
      habits,
      historicalMetrics
    ),
    goalAlignment: computeGoalAlignment(mergedSessions, goals),
    taskReliability: computeTaskReliability(tasks),
    routineStability: computeRoutineStability(
      mergedSessions,
      historicalMetrics
    ),
  };
}

/**
 * Distraction Index: higher = more distracted.
 * Based on app switching frequency, short sessions, and category diversity.
 */
function computeDistractionIndex(sessions: UsageSession[]): number {
  if (sessions.length === 0) return 0;

  const w = METRIC_WEIGHTS.distractionIndex;

  // App switch frequency (sessions per hour)
  const totalHours = sessions.reduce((s, sess) => s + sess.durationSeconds, 0) / 3600;
  const switchRate = totalHours > 0 ? sessions.length / totalHours : 0;
  // Normalize: 60 switches/hour = 100
  const switchScore = Math.min(100, (switchRate / 60) * 100);

  // Short session ratio (sessions < 60 seconds)
  const shortSessions = sessions.filter((s) => s.durationSeconds < 60).length;
  const shortRatio = shortSessions / sessions.length;
  const shortScore = shortRatio * 100;

  // Category diversity (unique categories / sessions)
  const uniqueCategories = new Set(
    sessions.map((s) => s.category ?? "uncategorized")
  ).size;
  const diversityScore = Math.min(
    100,
    (uniqueCategories / Math.max(sessions.length, 1)) * 100
  );

  return Math.round(
    switchScore * w.appSwitchWeight +
      shortScore * w.shortSessionWeight +
      diversityScore * w.categoryMixWeight
  );
}

/**
 * Focus Score: higher = more focused.
 * Based on focus session minutes, long usage sessions, and category concentration.
 */
function computeFocusScore(
  sessions: UsageSession[],
  focusMinutes: number
): number {
  const w = METRIC_WEIGHTS.focusScore;

  // Focus minutes (cap at 240 min = 4 hours for 100)
  const focusScore = Math.min(100, (focusMinutes / 240) * 100);

  // Long session ratio (sessions > 5 minutes)
  const longSessions = sessions.filter((s) => s.durationSeconds > 300).length;
  const longRatio =
    sessions.length > 0 ? longSessions / sessions.length : 0;
  const longScore = longRatio * 100;

  // Category focus (top category % of total time)
  const categoryTime = new Map<string, number>();
  let totalTime = 0;
  for (const s of sessions) {
    const cat = s.category ?? "uncategorized";
    categoryTime.set(cat, (categoryTime.get(cat) ?? 0) + s.durationSeconds);
    totalTime += s.durationSeconds;
  }
  const maxCatTime = Math.max(0, ...categoryTime.values());
  const categoryFocus = totalTime > 0 ? (maxCatTime / totalTime) * 100 : 0;

  return Math.round(
    focusScore * w.focusMinutesWeight +
      longScore * w.longSessionWeight +
      categoryFocus * w.categoryFocusWeight
  );
}

/**
 * Consistency Score: how consistently the user completes habits.
 */
function computeConsistencyScore(
  habitLogs: HabitLog[],
  habits: Habit[],
  historicalMetrics: DailyMetrics[]
): number {
  if (habits.length === 0) return 50; // neutral if no habits set

  const w = METRIC_WEIGHTS.consistencyScore;

  // Habit completion rate today
  const completedToday = habitLogs.filter((l) => l.completed).length;
  const habitRate =
    habits.length > 0 ? (completedToday / habits.length) * 100 : 0;

  // Historical consistency (std dev of task completion rates, lower = better)
  const historicalRates = historicalMetrics.map(
    (m) => m.taskCompletionRate * 100
  );
  const meanRate =
    historicalRates.length > 0
      ? historicalRates.reduce((a, b) => a + b, 0) / historicalRates.length
      : 50;
  const variance =
    historicalRates.length > 1
      ? historicalRates.reduce(
          (sum, r) => sum + Math.pow(r - meanRate, 2),
          0
        ) /
        (historicalRates.length - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  // Invert: lower std dev = higher score. stdDev of 50 = 0 score
  const consistencyFromHistory = Math.max(0, 100 - stdDev * 2);

  // Regular app usage patterns (simplified: having >3 day history = some regularity)
  const regularityScore = Math.min(100, historicalMetrics.length * 10);

  return Math.round(
    habitRate * w.habitCompletionWeight +
      consistencyFromHistory * w.regularAppUseWeight +
      regularityScore * w.sameTimeDayWeight
  );
}

/**
 * Goal Alignment: how much time is spent on goal-related categories.
 */
function computeGoalAlignment(
  sessions: UsageSession[],
  goals: Goal[]
): number {
  if (goals.length === 0) return 50;
  if (sessions.length === 0) return 0;

  // Map goal categories
  const goalCategories = new Set(
    goals.filter((g) => g.category).map((g) => g.category!)
  );
  if (goalCategories.size === 0) return 50;

  // Calculate time in goal-aligned categories
  let alignedTime = 0;
  let totalTime = 0;
  for (const s of sessions) {
    totalTime += s.durationSeconds;
    if (s.category && goalCategories.has(s.category)) {
      alignedTime += s.durationSeconds;
    }
  }

  return totalTime > 0 ? Math.round((alignedTime / totalTime) * 100) : 0;
}

/**
 * Task Reliability: how reliably the user completes tasks on time.
 */
function computeTaskReliability(tasks: Task[]): number {
  if (tasks.length === 0) return 50;

  const completed = tasks.filter(
    (t) => t.status === TaskStatus.COMPLETED
  ).length;
  const expired = tasks.filter(
    (t) => t.status === TaskStatus.EXPIRED
  ).length;
  const total = completed + expired;

  if (total === 0) return 50;
  return Math.round((completed / total) * 100);
}

/**
 * Routine Stability: how consistent the daily usage pattern is
 * compared to recent history.
 */
function computeRoutineStability(
  sessions: UsageSession[],
  historicalMetrics: DailyMetrics[]
): number {
  if (historicalMetrics.length < 2) return 50;

  // Compare today's screen time to historical average
  const todayScreenTime = sessions.reduce(
    (s, sess) => s + sess.durationSeconds,
    0
  );
  const historicalScreenTimes = historicalMetrics.map(
    (m) => m.totalScreenTime
  );
  const avgScreenTime =
    historicalScreenTimes.reduce((a, b) => a + b, 0) /
    historicalScreenTimes.length;

  if (avgScreenTime === 0) return 50;

  // Deviation from average (smaller deviation = more stable)
  const deviation = Math.abs(todayScreenTime - avgScreenTime) / avgScreenTime;
  // 0% deviation = 100, 100% deviation = 0
  return Math.round(Math.max(0, 100 - deviation * 100));
}
