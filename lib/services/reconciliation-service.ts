// Task Aura — Authoritative Progress Reconciliation Service (§10)
// Source of truth: XPTransaction ledger in PostgreSQL.
// Reconstructs all derived progression state (totalXp, level, fraction, streak).
import { prisma } from "../prisma";
import { levelProgress } from "../logic/economy";
import { userRepository } from "../repositories/user-repository";

export interface ReconciledProgress {
  userId: string;
  totalXp: number;
  level: number;
  xpRequiredForLevel: number;
  xpEarnedInLevel: number;
  xpRemaining: number;
  fraction: number;
  streak: {
    current: number;
    best: number;
    lastEligibleDate: string | null;
  };
}

/**
 * Recalculates user progress strictly from the authoritative XP ledger in PostgreSQL.
 * If any cache or cached progress was corrupted, this restores canonical truth.
 */
export async function reconcileUserProgress(userId: string): Promise<ReconciledProgress> {
  // 1. Authoritative Total XP from Ledger
  const agg = await prisma.xPTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  const authoritativeTotalXp = agg._sum.amount ?? 0;

  // 2. Canonical Level & Progress calculation from authoritative economy formula
  const lp = levelProgress(authoritativeTotalXp);

  // 3. Authoritative Streak Record
  const streakRecord = await userRepository.getStreakRecord(userId);
  const currentStreak = streakRecord?.currentStreak ?? 0;
  const bestStreak = streakRecord?.bestStreak ?? currentStreak;

  return {
    userId,
    totalXp: authoritativeTotalXp,
    level: lp.level,
    xpRequiredForLevel: lp.xpToNext,
    xpEarnedInLevel: lp.xpIntoLevel,
    xpRemaining: lp.xpToNext - lp.xpIntoLevel,
    fraction: lp.fraction,
    streak: {
      current: currentStreak,
      best: bestStreak,
      lastEligibleDate: streakRecord?.lastEligibleDate ?? null,
    },
  };
}
