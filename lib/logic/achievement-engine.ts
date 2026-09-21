// ============================================================
// LifeXP — Achievement Engine
// Maps to Logic System File v2 §13
// Pure functions — no side effects, no DB access
// ============================================================

import type {
  AchievementCondition,
  AchievementDefinition,
  UserAchievement,
  UserStats,
} from "./types";

// ── §13 — Default Achievement Definitions ────────────────────

/**
 * Achievement definitions — evaluated as a batch during nightly
 * recomputation, not scattered across event handlers.
 *
 * Each achievement has a rule_version so new achievements can be
 * added without touching completion-handling code.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // XP milestones
  {
    id: "xp_100",
    name: "First Steps",
    description: "Earn your first 100 XP",
    ruleVersion: 1,
    condition: { type: "xp_threshold", threshold: 100 },
  },
  {
    id: "xp_500",
    name: "Getting Serious",
    description: "Earn 500 XP total",
    ruleVersion: 1,
    condition: { type: "xp_threshold", threshold: 500 },
  },
  {
    id: "xp_1000",
    name: "Thousand Club",
    description: "Earn 1,000 XP total",
    ruleVersion: 1,
    condition: { type: "xp_threshold", threshold: 1000 },
  },
  {
    id: "xp_5000",
    name: "XP Master",
    description: "Earn 5,000 XP total",
    ruleVersion: 1,
    condition: { type: "xp_threshold", threshold: 5000 },
  },
  {
    id: "xp_10000",
    name: "Legend",
    description: "Earn 10,000 XP total",
    ruleVersion: 1,
    condition: { type: "xp_threshold", threshold: 10000 },
  },

  // Streak milestones
  {
    id: "streak_3",
    name: "Three-Peat",
    description: "Achieve a 3-day streak",
    ruleVersion: 1,
    condition: { type: "streak_threshold", threshold: 3 },
  },
  {
    id: "streak_7",
    name: "Week Warrior",
    description: "Achieve a 7-day streak",
    ruleVersion: 1,
    condition: { type: "streak_threshold", threshold: 7 },
  },
  {
    id: "streak_14",
    name: "Fortnight Strong",
    description: "Achieve a 14-day streak",
    ruleVersion: 1,
    condition: { type: "streak_threshold", threshold: 14 },
  },
  {
    id: "streak_30",
    name: "Monthly Master",
    description: "Achieve a 30-day streak",
    ruleVersion: 1,
    condition: { type: "streak_threshold", threshold: 30 },
  },

  // Task milestones
  {
    id: "tasks_1",
    name: "Task Starter",
    description: "Complete your first task",
    ruleVersion: 1,
    condition: { type: "tasks_completed", threshold: 1 },
  },
  {
    id: "tasks_10",
    name: "Task Machine",
    description: "Complete 10 tasks",
    ruleVersion: 1,
    condition: { type: "tasks_completed", threshold: 10 },
  },
  {
    id: "tasks_50",
    name: "Productivity Pro",
    description: "Complete 50 tasks",
    ruleVersion: 1,
    condition: { type: "tasks_completed", threshold: 50 },
  },
  {
    id: "tasks_100",
    name: "Century Achiever",
    description: "Complete 100 tasks",
    ruleVersion: 1,
    condition: { type: "tasks_completed", threshold: 100 },
  },

  // Focus milestones
  {
    id: "focus_60",
    name: "Deep Focus",
    description: "Accumulate 60 focus minutes",
    ruleVersion: 1,
    condition: { type: "focus_minutes", threshold: 60 },
  },
  {
    id: "focus_300",
    name: "Focus Champion",
    description: "Accumulate 300 focus minutes",
    ruleVersion: 1,
    condition: { type: "focus_minutes", threshold: 300 },
  },
  {
    id: "focus_1000",
    name: "Zen Master",
    description: "Accumulate 1,000 focus minutes",
    ruleVersion: 1,
    condition: { type: "focus_minutes", threshold: 1000 },
  },

  // Level milestones
  {
    id: "level_5",
    name: "Rising Star",
    description: "Reach Level 5",
    ruleVersion: 1,
    condition: { type: "level_reached", threshold: 5 },
  },
  {
    id: "level_10",
    name: "Double Digits",
    description: "Reach Level 10",
    ruleVersion: 1,
    condition: { type: "level_reached", threshold: 10 },
  },
  {
    id: "level_25",
    name: "Quarter Century",
    description: "Reach Level 25",
    ruleVersion: 1,
    condition: { type: "level_reached", threshold: 25 },
  },

  // Habit milestones
  {
    id: "habits_10",
    name: "Habit Formed",
    description: "Complete habits 10 times",
    ruleVersion: 1,
    condition: { type: "habits_completed", threshold: 10 },
  },
  {
    id: "habits_50",
    name: "Habit Master",
    description: "Complete habits 50 times",
    ruleVersion: 1,
    condition: { type: "habits_completed", threshold: 50 },
  },
];

// ── Public API ───────────────────────────────────────────────

/**
 * §13 — Check if a single achievement condition is met.
 */
export function checkCondition(
  condition: AchievementCondition,
  stats: UserStats
): boolean {
  switch (condition.type) {
    case "xp_threshold":
      return stats.totalXp >= condition.threshold;
    case "streak_threshold":
      return stats.bestStreak >= condition.threshold;
    case "tasks_completed":
      return stats.totalTasksCompleted >= condition.threshold;
    case "focus_minutes":
      return stats.totalFocusMinutes >= condition.threshold;
    case "level_reached":
      return stats.level >= condition.threshold;
    case "habits_completed":
      return stats.totalHabitsCompleted >= condition.threshold;
    default:
      return false;
  }
}

/**
 * §13 — Evaluate all achievement definitions against user stats.
 *
 * Achievement checks run as part of the same nightly batch as
 * streak/metric recomputation — one evaluation pass over
 * rule_version-tagged definitions.
 *
 * Returns newly unlocked achievement IDs (not already in unlockedIds).
 */
export function evaluateAchievements(
  stats: UserStats,
  definitions: AchievementDefinition[],
  alreadyUnlockedIds: Set<string>
): AchievementDefinition[] {
  const newlyUnlocked: AchievementDefinition[] = [];

  for (const def of definitions) {
    // Skip already unlocked
    if (alreadyUnlockedIds.has(def.id)) continue;

    if (checkCondition(def.condition, stats)) {
      newlyUnlocked.push(def);
    }
  }

  return newlyUnlocked;
}

/**
 * Get progress toward an achievement (0.0 – 1.0).
 */
export function getAchievementProgress(
  condition: AchievementCondition,
  stats: UserStats
): number {
  let current: number;

  switch (condition.type) {
    case "xp_threshold":
      current = stats.totalXp;
      break;
    case "streak_threshold":
      current = stats.bestStreak;
      break;
    case "tasks_completed":
      current = stats.totalTasksCompleted;
      break;
    case "focus_minutes":
      current = stats.totalFocusMinutes;
      break;
    case "level_reached":
      current = stats.level;
      break;
    case "habits_completed":
      current = stats.totalHabitsCompleted;
      break;
    default:
      current = 0;
  }

  return Math.min(1.0, current / condition.threshold);
}
