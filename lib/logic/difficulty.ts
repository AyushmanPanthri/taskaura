// ============================================================
// LifeXP — Adaptive Difficulty
// Maps to Logic System File v2 §10, §11 (product file)
// Pure functions — no side effects, no DB access
// ============================================================

import { Difficulty, QuestStatus } from "./types";
import {
  DIFFICULTY_ORDER,
  DIFFICULTY_DECREASE_THRESHOLD,
  DIFFICULTY_INCREASE_THRESHOLD,
  MAX_DIFFICULTY_STEP_CHANGE,
} from "./constants";

/**
 * Get the index of a difficulty level in the ordered list.
 */
function difficultyIndex(difficulty: Difficulty): number {
  return DIFFICULTY_ORDER.indexOf(difficulty);
}

/**
 * §11 (Product File) — Adapt difficulty based on completion history.
 *
 * - Increase gradually on repeated success
 * - Reduce/split/reschedule on repeated failure
 * - Cap at one difficulty step per adjustment cycle (never EASY → EPIC)
 *
 * @param currentDifficulty - Current difficulty level
 * @param recentOutcomes - Array of recent quest/task outcomes (true = success, false = failure/dismiss)
 * @returns The new difficulty level
 */
export function adaptDifficulty(
  currentDifficulty: Difficulty,
  recentOutcomes: boolean[]
): Difficulty {
  if (recentOutcomes.length === 0) return currentDifficulty;

  const currentIdx = difficultyIndex(currentDifficulty);

  // Count consecutive successes/failures from the end
  let consecutiveSuccesses = 0;
  let consecutiveFailures = 0;

  // Walk backwards through outcomes
  for (let i = recentOutcomes.length - 1; i >= 0; i--) {
    if (recentOutcomes[i]) {
      if (consecutiveFailures > 0) break;
      consecutiveSuccesses++;
    } else {
      if (consecutiveSuccesses > 0) break;
      consecutiveFailures++;
    }
  }

  // Determine adjustment
  let newIdx = currentIdx;

  if (consecutiveSuccesses >= DIFFICULTY_INCREASE_THRESHOLD) {
    // Increase difficulty by at most MAX_DIFFICULTY_STEP_CHANGE
    newIdx = Math.min(
      DIFFICULTY_ORDER.length - 1,
      currentIdx + MAX_DIFFICULTY_STEP_CHANGE
    );
  } else if (consecutiveFailures >= DIFFICULTY_DECREASE_THRESHOLD) {
    // Decrease difficulty by at most MAX_DIFFICULTY_STEP_CHANGE
    newIdx = Math.max(0, currentIdx - MAX_DIFFICULTY_STEP_CHANGE);
  }

  return DIFFICULTY_ORDER[newIdx];
}

/**
 * Convert quest outcomes to a boolean array for adaptDifficulty.
 */
export function questOutcomesToBooleans(
  questStatuses: QuestStatus[]
): boolean[] {
  return questStatuses.map(
    (status) =>
      status === QuestStatus.COMPLETED
  );
}

/**
 * Get difficulty display info.
 */
export function getDifficultyInfo(difficulty: Difficulty): {
  label: string;
  emoji: string;
  color: string;
} {
  switch (difficulty) {
    case Difficulty.EASY:
      return { label: "Easy", emoji: "🟢", color: "#22c55e" };
    case Difficulty.NORMAL:
      return { label: "Normal", emoji: "🔵", color: "#3b82f6" };
    case Difficulty.HARD:
      return { label: "Hard", emoji: "🟠", color: "#f97316" };
    case Difficulty.EPIC:
      return { label: "Epic", emoji: "🔴", color: "#ef4444" };
  }
}
