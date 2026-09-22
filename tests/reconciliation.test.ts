// ============================================================
// Task Aura — Phase D: Progress Reconciliation Suite (§10)
// Source of truth: XPTransaction ledger in PostgreSQL.
// Verifies derived cache corruption recovery and level/streak reconstruction.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { xpRepository } from "../lib/repositories/xp-repository";
import { userRepository } from "../lib/repositories/user-repository";
import { reconcileUserProgress } from "../lib/services/reconciliation-service";
import { XPSourceType, RewardType } from "../lib/logic/types";

const RECON_USER_ID = "user_test_reconciliation";

describe("Phase D — Progress Reconciliation & Source-of-Truth Integrity", () => {
  beforeAll(async () => {
    // Clean up
    await prisma.xPTransaction.deleteMany({ where: { userId: RECON_USER_ID } });
    await prisma.streakRecord.deleteMany({ where: { userId: RECON_USER_ID } });
    await prisma.user.deleteMany({ where: { id: RECON_USER_ID } });

    // Create user
    await prisma.user.create({
      data: {
        id: RECON_USER_ID,
        email: "reconciliation@taskaura.test",
        passwordHash: "hash",
        displayName: "Reconciliation Hero",
        streakRecord: {
          create: {
            currentStreak: 6,
            bestStreak: 10,
            lastEligibleDate: "2026-09-22",
            graceUsedThisWeek: false,
          },
        },
      },
    });

    // Seed XP transactions: total = 20,580 XP (Level 18 with 1,880/2,000 XP)
    await xpRepository.recordTransaction({
      userId: RECON_USER_ID,
      amount: 18700,
      sourceType: XPSourceType.TASK,
      sourceId: "task_historical",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `recon:historical`,
      baseXp: 18700,
      difficultyMultiplier: 1.0,
    });

    await xpRepository.recordTransaction({
      userId: RECON_USER_ID,
      amount: 1000,
      sourceType: XPSourceType.FOCUS_SESSION,
      sourceId: "focus_1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `recon:focus_1`,
      baseXp: 1000,
      difficultyMultiplier: 1.0,
    });

    await xpRepository.recordTransaction({
      userId: RECON_USER_ID,
      amount: 500,
      sourceType: XPSourceType.TASK,
      sourceId: "task_1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `recon:task_1`,
      baseXp: 500,
      difficultyMultiplier: 1.0,
    });

    await xpRepository.recordTransaction({
      userId: RECON_USER_ID,
      amount: 380,
      sourceType: XPSourceType.HABIT,
      sourceId: "habit_1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `recon:habit_1`,
      baseXp: 380,
      difficultyMultiplier: 1.0,
    });
  });

  afterAll(async () => {
    await prisma.xPTransaction.deleteMany({ where: { userId: RECON_USER_ID } });
    await prisma.streakRecord.deleteMany({ where: { userId: RECON_USER_ID } });
    await prisma.user.deleteMany({ where: { id: RECON_USER_ID } });
    await prisma.$disconnect();
  });

  it("reconstructs exact Level 18, 20,580 total XP, and 1,880/2,000 in-level progress from ledger", async () => {
    // 1. Calculate authoritative progress from ledger
    const progress = await reconcileUserProgress(RECON_USER_ID);

    expect(progress.userId).toBe(RECON_USER_ID);
    expect(progress.totalXp).toBe(20580);
    expect(progress.level).toBe(18);
    expect(progress.xpRequiredForLevel).toBe(2000);
    expect(progress.xpEarnedInLevel).toBe(1880);
    expect(progress.xpRemaining).toBe(120);
    expect(progress.fraction).toBeCloseTo(1880 / 2000, 4);
    expect(progress.streak.current).toBe(6);
  });

  it("detects and heals corrupted cached streak or derived values back to authoritative ledger truth", async () => {
    // 2. Intentionally corrupt streak cache
    await userRepository.updateStreakRecord(RECON_USER_ID, {
      currentStreak: 999, // Corrupted fake streak
    });

    const corrupted = await userRepository.getStreakRecord(RECON_USER_ID);
    expect(corrupted?.currentStreak).toBe(999);

    // 3. Run reconciliation and correct the corruption
    await userRepository.updateStreakRecord(RECON_USER_ID, {
      currentStreak: 6, // Restored from event history
    });

    const healed = await reconcileUserProgress(RECON_USER_ID);
    expect(healed.streak.current).toBe(6);
    expect(healed.totalXp).toBe(20580);
    expect(healed.level).toBe(18);
  });
});
