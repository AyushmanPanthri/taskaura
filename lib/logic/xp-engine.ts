// ============================================================
// LifeXP — XP Engine
// Maps to Logic System File v2 §9, §10, §11
// Pure functions — no side effects, no DB access
// ============================================================

import { createHash } from "crypto";
import {
  Difficulty,
  RewardType,
  XPSourceType,
} from "./types";
import {
  BASE_XP,
  DIFFICULTY_MULTIPLIER,
  LEVEL_XP_DIVISOR,
  MAX_STREAK_BONUS,
  STREAK_BONUS_PER_DAY,
} from "./constants";

/**
 * §10 — Calculate reward XP based on base value and difficulty.
 *
 * reward_xp = round(base_xp × difficulty_multiplier)
 */
export function calculateRewardXp(
  baseXp: number,
  difficulty: Difficulty
): number {
  const multiplier = DIFFICULTY_MULTIPLIER[difficulty];
  return Math.round(baseXp * multiplier);
}

/**
 * §10 — Calculate streak bonus XP.
 *
 * streak_bonus = min(streak_days × 5, 50)
 */
export function calculateStreakBonus(streakDays: number): number {
  return Math.min(streakDays * STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS);
}

/**
 * §10 — Calculate final XP including difficulty and streak.
 *
 * final_xp = reward_xp + streak_bonus
 */
export function calculateFinalXp(
  baseXp: number,
  difficulty: Difficulty,
  streakDays: number
): number {
  const rewardXp = calculateRewardXp(baseXp, difficulty);
  const streakBonus = calculateStreakBonus(streakDays);
  return rewardXp + streakBonus;
}

/**
 * §11 — Calculate level from total XP.
 *
 * level = floor(sqrt(total_xp / 100)) + 1
 *
 * Always derived on read, never stored as mutable state (v2 efficiency note).
 */
export function calculateLevel(totalXp: number): number {
  if (totalXp < 0) return 1;
  return Math.floor(Math.sqrt(totalXp / LEVEL_XP_DIVISOR)) + 1;
}

/**
 * Calculate XP required to reach a given level.
 * Inverse of calculateLevel: xp = (level - 1)² × 100
 */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.pow(level - 1, 2) * LEVEL_XP_DIVISOR;
}

/**
 * Calculate progress within current level (0.0 – 1.0).
 */
export function levelProgress(totalXp: number): number {
  const currentLevel = calculateLevel(totalXp);
  const currentLevelXp = xpRequiredForLevel(currentLevel);
  const nextLevelXp = xpRequiredForLevel(currentLevel + 1);
  const range = nextLevelXp - currentLevelXp;
  if (range <= 0) return 0;
  return (totalXp - currentLevelXp) / range;
}

/**
 * §9 v2 — Generate idempotency key for XP transactions.
 *
 * idempotency_key = hash(source_type + source_id + reward_type)
 *
 * Enforced as a DB unique index. Every write to xp_transactions
 * goes through this single function.
 */
export function generateIdempotencyKey(
  sourceType: XPSourceType,
  sourceId: string,
  rewardType: RewardType
): string {
  const raw = `${sourceType}:${sourceId}:${rewardType}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Get the default base XP for a source type.
 * In production, this would read from task_type_config table.
 */
export function getBaseXp(sourceType: XPSourceType): number {
  return BASE_XP[sourceType];
}

/**
 * §9 — Calculate total XP from a list of transaction amounts.
 *
 * total_xp = Σ valid XP transactions
 * Ledger is append-only and immutable — corrections are negative ADJUSTMENT rows.
 */
export function calculateTotalXp(transactionAmounts: number[]): number {
  return transactionAmounts.reduce((sum, amount) => sum + amount, 0);
}
