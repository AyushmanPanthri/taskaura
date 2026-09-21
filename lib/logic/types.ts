// ============================================================
// LifeXP — Core Type Definitions
// Maps to Logic System File v2 §3, §7, §8, §9, §13, §14, §19
// ============================================================

// ── Enums ────────────────────────────────────────────────────

export enum Difficulty {
  EASY = "EASY",
  NORMAL = "NORMAL",
  HARD = "HARD",
  EPIC = "EPIC",
}

export enum TaskStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum TaskSource {
  USER = "USER",
  AI = "AI",
}

export enum FocusSessionStatus {
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  ABANDONED = "ABANDONED",
}

export enum QuestStatus {
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  DISMISSED = "DISMISSED",
}

export enum GoalStatus {
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  ARCHIVED = "ARCHIVED",
}

export enum SyncStatus {
  PENDING = "PENDING",
  SYNCED = "SYNCED",
  FAILED = "FAILED",
}

export enum HabitFrequency {
  DAILY = "DAILY",
  WEEKDAYS = "WEEKDAYS",
  WEEKENDS = "WEEKENDS",
  CUSTOM = "CUSTOM",
}

/** §9 — XP source types (what generated the XP) */
export enum XPSourceType {
  FOCUS_SESSION = "FOCUS_SESSION",
  TASK = "TASK",
  HABIT = "HABIT",
  AI_QUEST = "AI_QUEST",
  DAILY_GOAL = "DAILY_GOAL",
  STREAK_BONUS = "STREAK_BONUS",
  ADJUSTMENT = "ADJUSTMENT", // v2: offsetting corrections, never UPDATE/DELETE
}

/** §9 — Reward types for idempotency keying */
export enum RewardType {
  COMPLETION = "COMPLETION",
  BONUS = "BONUS",
  ADJUSTMENT = "ADJUSTMENT",
}

/** §14 — AI tool actions */
export enum AIAction {
  INSIGHT = "insight",
  RECOMMENDATION = "recommendation",
  QUEST = "quest",
}

/** §16 — AI rule identifiers */
export enum AIRuleId {
  RULE_A = "RULE_A", // evening distraction
  RULE_B = "RULE_B", // overloaded plan
  RULE_C = "RULE_C", // repeated quest failure
  RULE_D = "RULE_D", // strong positive pattern
  RULE_E = "RULE_E", // budget exhausted fallback
}

// ── Data Interfaces ──────────────────────────────────────────

/** §3 — Usage session event */
export interface UsageSession {
  id: string;
  clientEventId: string;
  userId: string;
  packageName: string;
  appName: string;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  date: string; // YYYY-MM-DD, timezone-aware
  category: string | null;
  source: string;
  syncStatus: SyncStatus;
}

/** §4 — Daily aggregated metrics */
export interface DailyMetrics {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  totalScreenTime: number; // seconds
  appOpens: number;
  focusMinutes: number;
  taskCompletionRate: number; // 0.0 – 1.0
  // §6 — Behavioral metrics
  distractionIndex: number;
  focusScore: number;
  consistencyScore: number;
  goalAlignment: number;
  taskReliability: number;
  routineStability: number;
}

/** §7 — Task */
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  difficulty: Difficulty;
  status: TaskStatus;
  dueAt: Date | null;
  completedAt: Date | null;
  source: TaskSource;
  questId: string | null;
  createdAt: Date;
  estimatedMinutes?: number | null;
}

/** §8 — Focus session */
export interface FocusSession {
  id: string;
  clientEventId: string;
  userId: string;
  status: FocusSessionStatus;
  startedAt: Date;
  completedAt: Date | null;
  requiredMinutes: number;
  actualMinutes: number;
  heartbeatCount: number;
  expectedHeartbeats: number;
  taskId?: string | null;
}

/** §9 — XP transaction (append-only ledger) */
export interface XPTransaction {
  id: string;
  userId: string;
  amount: number;
  sourceType: XPSourceType;
  sourceId: string;
  rewardType: RewardType;
  idempotencyKey: string;
  baseXp: number;
  difficultyMultiplier: number;
  streakBonus: number;
  createdAt: Date;
  breakdown?: import("./economy").XpBreakdown;
}

/** Goal */
export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  category: string | null;
  targetValue: number;
  currentValue: number;
  status: GoalStatus;
  createdAt: Date;
}

/** Habit */
export interface Habit {
  id: string;
  userId: string;
  title: string;
  frequency: HabitFrequency;
  streakCurrent: number;
  streakBest: number;
  createdAt: Date;
}

/** Habit log entry */
export interface HabitLog {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  completed: boolean;
}

/** §13 — Achievement definition */
export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  ruleVersion: number;
  condition: AchievementCondition;
}

/** Achievement condition — evaluated by achievement engine */
export interface AchievementCondition {
  type: "xp_threshold" | "streak_threshold" | "tasks_completed" | "focus_minutes" | "level_reached" | "habits_completed";
  threshold: number;
}

/** User's unlocked achievement */
export interface UserAchievement {
  userId: string;
  achievementId: string;
  unlockedAt: Date;
}

/** §14 — AI context payload (capped, pre-aggregated) */
export interface AIContext {
  userId: string;
  recentMetrics: DailyMetrics[];
  goals: Goal[];
  activeTasks: Task[];
  baselineDeltas: BaselineDelta[];
  currentStreak: number;
  totalXp: number;
  level: number;
}

/** §5 — Baseline delta */
export interface BaselineDelta {
  metric: string;
  baseline: number;
  currentValue: number;
  delta: number;
  percentageChange: number;
}

/** §18 — Weekly leaderboard score */
export interface WeeklyScore {
  userId: string;
  weekStart: string;
  weekEnd: string;
  totalXp: number;
  rank: number;
  snapshotAt: Date;
}

/** Quest (AI-generated) */
export interface Quest {
  id: string;
  userId: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  status: QuestStatus;
  triggeringRule: AIRuleId;
  sourceMetrics: string; // JSON
  createdAt: Date;
}

/** AI insight */
export interface AIInsight {
  id: string;
  userId: string;
  type: AIAction;
  content: string;
  sourceMetricsJson: string;
  createdAt: Date;
}

/** §19 v2 — Task type config (tunable XP economy) */
export interface TaskTypeConfig {
  type: XPSourceType;
  baseXp: number;
  active: boolean;
}

/** §19 v2 — Sync audit log */
export interface SyncLogEntry {
  id: string;
  userId: string;
  clientEventId: string;
  receivedAt: Date;
  status: SyncStatus;
}

/** §12 — Streak record */
export interface StreakRecord {
  userId: string;
  currentStreak: number;
  bestStreak: number;
  lastEligibleDate: string | null;
  graceUsedThisWeek: boolean;
}

/** §16 — AI rule evaluation result */
export interface AIRuleResult {
  ruleId: AIRuleId;
  fired: boolean;
  action: AIAction;
  payload: {
    title?: string;
    description?: string;
    difficulty?: Difficulty;
    content?: string;
  };
  reasoning: string;
}

/** User stats snapshot — used by achievement engine */
export interface UserStats {
  totalXp: number;
  level: number;
  currentStreak: number;
  bestStreak: number;
  totalTasksCompleted: number;
  totalFocusMinutes: number;
  totalHabitsCompleted: number;
}
