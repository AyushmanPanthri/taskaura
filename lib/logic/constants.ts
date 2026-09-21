// ============================================================
// LifeXP — Constants & Configuration
// Maps to Logic System File v2 §9, §10, §14
// ============================================================

import { Difficulty, XPSourceType } from "./types";

// ── §10 — XP Base Values (default, overridable via task_type_config) ──

export const BASE_XP: Record<XPSourceType, number> = {
  [XPSourceType.FOCUS_SESSION]: 100,
  [XPSourceType.TASK]: 150,
  [XPSourceType.HABIT]: 75,
  [XPSourceType.AI_QUEST]: 150,
  [XPSourceType.DAILY_GOAL]: 50,
  [XPSourceType.STREAK_BONUS]: 25,
  [XPSourceType.ADJUSTMENT]: 0, // adjustments use explicit amounts
};

// ── §10 — Difficulty Multipliers ──

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  [Difficulty.EASY]: 0.8,
  [Difficulty.NORMAL]: 1.0,
  [Difficulty.HARD]: 1.25,
  [Difficulty.EPIC]: 1.5,
};

// ── §10 — Streak Bonus ──

/** Max XP from streak bonus */
export const MAX_STREAK_BONUS = 50;

/** XP per streak day */
export const STREAK_BONUS_PER_DAY = 5;

// ── §11 — Level System ──

/** Divisor in level formula: level = floor(sqrt(totalXp / LEVEL_XP_DIVISOR)) + 1 */
export const LEVEL_XP_DIVISOR = 100;

// ── §5 — Baseline Thresholds ──

/** Minimum eligible days before baseline-driven recommendations fire */
export const MIN_BASELINE_DAYS = 5;

/** Days needed before trimmed mean is used */
export const TRIMMED_MEAN_THRESHOLD = 7;

/** Days per bucket needed before weekday/weekend split activates */
export const WEEKDAY_WEEKEND_SPLIT_THRESHOLD = 14;

/** Small epsilon to prevent division by zero in percentage calculations */
export const BASELINE_EPSILON = 0.001;

// ── §8 — Focus Session ──

/** Heartbeat interval in seconds (client pings every ~30-60s) */
export const HEARTBEAT_INTERVAL_SECONDS = 45;

/** Tolerance ratio for heartbeat validation (e.g. 0.6 = allow 40% missed heartbeats) */
export const HEARTBEAT_TOLERANCE_RATIO = 0.6;

// ── §4 — Aggregation ──

/** Overlap threshold for session merging (>50% overlap = merge) */
export const SESSION_OVERLAP_THRESHOLD = 0.5;

// ── §12 — Streak Logic ──

/** Grace days allowed per rolling 7-day window */
export const STREAK_GRACE_DAYS_PER_WEEK = 1;

/** Rolling window size for grace day tracking */
export const STREAK_GRACE_WINDOW_DAYS = 7;

// ── §14 — AI Rate Limits ──

/** Max quest-generation calls per user per day */
export const AI_QUEST_LIMIT_PER_DAY = 1;

/** Max insight calls per user per day */
export const AI_INSIGHT_LIMIT_PER_DAY = 5;

/** Max number of recent daily metrics included in AI context */
export const AI_CONTEXT_MAX_DAYS = 7;

/** Max active tasks included in AI context */
export const AI_CONTEXT_MAX_TASKS = 10;

// ── §11 — Adaptive Difficulty ──

/** Max difficulty steps that can change in one adaptation cycle */
export const MAX_DIFFICULTY_STEP_CHANGE = 1;

/** Consecutive successes to trigger difficulty increase */
export const DIFFICULTY_INCREASE_THRESHOLD = 3;

/** Consecutive failures to trigger difficulty decrease */
export const DIFFICULTY_DECREASE_THRESHOLD = 2;

// ── §4 — Behavioral Metric Weights ──

/** Weights for computing behavioral metrics — can be tuned without code changes */
export const METRIC_WEIGHTS = {
  distractionIndex: {
    appSwitchWeight: 0.4,
    shortSessionWeight: 0.3,
    categoryMixWeight: 0.3,
  },
  focusScore: {
    focusMinutesWeight: 0.5,
    longSessionWeight: 0.3,
    categoryFocusWeight: 0.2,
  },
  consistencyScore: {
    sameTimeDayWeight: 0.4,
    regularAppUseWeight: 0.3,
    habitCompletionWeight: 0.3,
  },
};

// ── Difficulty level ordering (for adaptive difficulty logic) ──

export const DIFFICULTY_ORDER: Difficulty[] = [
  Difficulty.EASY,
  Difficulty.NORMAL,
  Difficulty.HARD,
  Difficulty.EPIC,
];

// ── Static fallback content for AI (Rule E) ──

export const FALLBACK_TIPS = [
  "Try putting your phone face-down during your next focus session — out of sight often means out of mind.",
  "Consider tackling your hardest task first thing in the morning when willpower is highest.",
  "A short 5-minute walk between tasks can improve focus for the next work block.",
  "Review your completed tasks from yesterday — momentum builds confidence.",
  "Try the 2-minute rule: if a task takes less than 2 minutes, do it now.",
  "Set a specific end time for social media — open loops drain attention.",
  "Batch similar tasks together to reduce context-switching costs.",
  "Celebrate small wins — acknowledging progress fuels more progress.",
];
