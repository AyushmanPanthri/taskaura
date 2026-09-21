// ============================================================
// LifeXP — XP Service
// Maps to Logic System File v2 §9
// Combines logic + persistence through the store
// ============================================================

import { store } from "./store";
import {
  calculateRewardXp,
  calculateStreakBonus,
  calculateFinalXp,
  calculateLevel,
  calculateTotalXp,
  generateIdempotencyKey,
  getBaseXp,
  levelProgress,
} from "../logic/xp-engine";
import type { XPTransaction } from "../logic/types";
import {
  Difficulty,
  RewardType,
  XPSourceType,
} from "../logic/types";

/**
 * Generate a UUID v4.
 */
function newId(): string {
  return crypto.randomUUID();
}

/**
 * §9 — Award XP through the single shared internal function.
 *
 * Every write path to xp_transactions goes through this one function
 * rather than each service writing independently (v2).
 *
 * Idempotent: returns the existing transaction if already awarded.
 */
export function awardXp(params: {
  userId: string;
  sourceType: XPSourceType;
  sourceId: string;
  rewardType?: RewardType;
  difficulty?: Difficulty;
  streakDays?: number;
  /** Override the amount (for ADJUSTMENT type) */
  overrideAmount?: number;
}): { transaction: XPTransaction; isNew: boolean } {
  const {
    userId,
    sourceType,
    sourceId,
    rewardType = RewardType.COMPLETION,
    difficulty = Difficulty.NORMAL,
    streakDays = 0,
    overrideAmount,
  } = params;

  // Generate idempotency key
  const idempotencyKey = generateIdempotencyKey(
    sourceType,
    sourceId,
    rewardType
  );

  // Check if already awarded (idempotent)
  const existing = Array.from(store.xpTransactions.values()).find(
    (t) => t.idempotencyKey === idempotencyKey
  );
  if (existing) {
    return { transaction: existing, isNew: false };
  }

  // Calculate XP
  const baseXp =
    store.taskTypeConfigs.get(sourceType)?.baseXp ?? getBaseXp(sourceType);
  const difficultyMultiplier =
    sourceType === XPSourceType.ADJUSTMENT ? 1 : undefined;
  const amount =
    overrideAmount ??
    calculateFinalXp(baseXp, difficulty, streakDays);

  const transaction: XPTransaction = {
    id: newId(),
    userId,
    amount,
    sourceType,
    sourceId,
    rewardType,
    idempotencyKey,
    baseXp,
    difficultyMultiplier:
      difficultyMultiplier ??
      (
        { EASY: 0.8, NORMAL: 1.0, HARD: 1.25, EPIC: 1.5 } as Record<
          string,
          number
        >
      )[difficulty] ??
      1.0,
    streakBonus: calculateStreakBonus(streakDays),
    createdAt: new Date(),
  };

  // Write to store (with idempotency constraint)
  const added = store.addXpTransaction(transaction);
  return { transaction, isNew: added };
}

/**
 * Get user's total XP.
 */
export function getTotalXp(userId: string): number {
  return store.getTotalXp(userId);
}

/**
 * Get user's current level (derived from total XP, never stored).
 */
export function getUserLevel(userId: string): number {
  return calculateLevel(getTotalXp(userId));
}

/**
 * Get user's level progress (0.0 – 1.0).
 */
export function getUserLevelProgress(userId: string): number {
  return levelProgress(getTotalXp(userId));
}

/**
 * Get user's XP transaction history.
 */
export function getXpHistory(userId: string): XPTransaction[] {
  return store
    .getUserXpTransactions(userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * §9 v2 — Create an adjustment transaction (offsetting correction).
 *
 * Corrections are new offsetting transactions with negative amount
 * and a reference to the original. Never UPDATE or DELETE.
 */
export function createAdjustment(
  userId: string,
  originalTransactionId: string,
  adjustmentAmount: number,
  reason: string
): { transaction: XPTransaction; isNew: boolean } {
  return awardXp({
    userId,
    sourceType: XPSourceType.ADJUSTMENT,
    sourceId: `adj:${originalTransactionId}:${reason}`,
    rewardType: RewardType.ADJUSTMENT,
    overrideAmount: adjustmentAmount,
  });
}
