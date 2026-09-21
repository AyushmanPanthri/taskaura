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
 * v2: delegates to economy.ts table-based formula.
 * Always derived on read, never stored as mutable state.
 */
import { levelFor, levelProgress as levelProgressDetail, cumulativeXp } from "./economy";
export const calculateLevel = (totalXp: number): number => levelFor(totalXp);

/**
 * Calculate XP required to reach a given level.
 * v2: delegates to economy.ts cumulative function.
 */
export const xpRequiredForLevel = (level: number): number => cumulativeXp(level);

/**
 * Calculate progress within current level (0.0 – 1.0).
 * v2: delegates to economy.ts.
 */
export const levelProgress = (totalXp: number): number => levelProgressDetail(totalXp).fraction;


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
