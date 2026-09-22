// ============================================================
// Task Aura — Phase D: PostgreSQL Concurrency Suite
// Tests 20 simultaneous requests against live PostgreSQL database.
// Verifies atomic transactions, unique constraints, and single-payout invariants.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { taskRepository } from "../lib/repositories/task-repository";
import { focusRepository } from "../lib/repositories/focus-repository";
import { habitRepository } from "../lib/repositories/habit-repository";
import { achievementRepository } from "../lib/repositories/achievement-repository";
import { xpRepository } from "../lib/repositories/xp-repository";
import { Difficulty, XPSourceType, RewardType } from "../lib/logic/types";

const CONCURRENCY_USER_ID = "user_test_concurrency";

describe("Phase D — PostgreSQL Concurrency & Atomic Invariants", () => {
  beforeAll(async () => {
    // Clean up test user
    await prisma.xPTransaction.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.task.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.focusSession.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.habitLog.deleteMany({ where: { habit: { userId: CONCURRENCY_USER_ID } } });
    await prisma.habit.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.userAchievement.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.user.deleteMany({ where: { id: CONCURRENCY_USER_ID } });

    // Create test user
    await prisma.user.create({
      data: {
        id: CONCURRENCY_USER_ID,
        email: "concurrency@taskaura.test",
        passwordHash: "test_hash",
        displayName: "Concurrency Tester",
      },
    });
  });

  afterAll(async () => {
    await prisma.xPTransaction.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.task.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.focusSession.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.habitLog.deleteMany({ where: { habit: { userId: CONCURRENCY_USER_ID } } });
    await prisma.habit.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.userAchievement.deleteMany({ where: { userId: CONCURRENCY_USER_ID } });
    await prisma.user.deleteMany({ where: { id: CONCURRENCY_USER_ID } });
    await prisma.$disconnect();
  });

  // ── Scenario A: 20 Simultaneous Task Completion Requests ──────
  it("Scenario A: 20 simultaneous task completions yield exactly 1 payout and 1 completion", async () => {
    // 1. Create task
    const task = await taskRepository.createTask(CONCURRENCY_USER_ID, {
      title: "Concurrency Biology Quiz",
      difficulty: Difficulty.NORMAL,
    });

    const idempotencyKey = `payout:TASK:${task.id}`;
    const payout = {
      amount: 150,
      baseXp: 150,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
      rewardType: "COMPLETION",
    };

    // 2. Fire 20 simultaneous complete requests
    const promises = Array.from({ length: 20 }, () =>
      taskRepository.completeTaskTransaction(
        CONCURRENCY_USER_ID,
        task.id,
        idempotencyKey,
        payout
      )
    );

    const results = await Promise.all(promises);

    // 3. Exactly one request must be primary, 19 must resolve as duplicates
    const primaryWins = results.filter((r) => !r.isDuplicate);
    const duplicates = results.filter((r) => r.isDuplicate);

    expect(primaryWins.length).toBe(1);
    expect(duplicates.length).toBe(19);

    // 4. Verify authoritative database state
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.status).toBe("COMPLETED");

    const txs = await prisma.xPTransaction.findMany({
      where: { userId: CONCURRENCY_USER_ID, sourceId: task.id },
    });
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(150);
  });

  // ── Scenario B: 20 Simultaneous Focus-Start Requests ──────────
  it("Scenario B: 20 simultaneous focus-start requests yield exactly 1 RUNNING session", async () => {
    // 20 requests attempting to start a focus session simultaneously
    const attempts = Array.from({ length: 20 }, (_, idx) =>
      focusRepository
        .startSession(CONCURRENCY_USER_ID, {
          requiredMinutes: 25,
          clientEventId: `evt_focus_concurrency_${idx}`,
          expectedHeartbeats: 25,
        })
        .then(() => ({ success: true }))
        .catch((err: Error) => ({ success: false, error: err.message }))
    );

    const results = await Promise.all(attempts);

    const successfulStarts = results.filter((r) => r.success);
    const rejectedStarts = results.filter((r) => !r.success);

    // Exactly one must succeed, 19 must be rejected
    expect(successfulStarts.length).toBe(1);
    expect(rejectedStarts.length).toBe(19);

    // Database must have exactly 1 RUNNING session
    const runningCount = await prisma.focusSession.count({
      where: { userId: CONCURRENCY_USER_ID, status: "RUNNING" },
    });
    expect(runningCount).toBe(1);

    // Clean up active session for subsequent tests
    const active = await focusRepository.findActiveSession(CONCURRENCY_USER_ID);
    if (active) {
      await focusRepository.abandonSession(CONCURRENCY_USER_ID, active.id);
    }
  });

  // ── Scenario C: Simultaneous Habit Logging ────────────────────
  it("Scenario C: simultaneous habit logging creates 1 valid daily log without duplicate reward", async () => {
    const habit = await habitRepository.createHabit(CONCURRENCY_USER_ID, {
      title: "Concurrent Hydration",
    });

    const date = "2026-09-22";
    const idempotencyKey = `payout:HABIT:${habit.id}:${date}`;
    const payout = {
      amount: 40,
      baseXp: 40,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
      rewardType: "COMPLETION",
    };

    // 10 simultaneous log attempts for the same date
    const promises = Array.from({ length: 10 }, () =>
      habitRepository.logHabitTransaction(
        CONCURRENCY_USER_ID,
        habit.id,
        date,
        true,
        idempotencyKey,
        payout
      )
    );

    const results = await Promise.all(promises);

    const primaryLogs = results.filter((r) => !r.isDuplicate);
    const duplicateLogs = results.filter((r) => r.isDuplicate);

    expect(primaryLogs.length).toBe(1);
    expect(duplicateLogs.length).toBe(9);

    // Verify DB has exactly 1 habit log for this date
    const logs = await prisma.habitLog.findMany({
      where: { habitId: habit.id, date },
    });
    expect(logs.length).toBe(1);

    // Verify exactly 1 XP transaction for this habit log
    const txs = await prisma.xPTransaction.findMany({
      where: { userId: CONCURRENCY_USER_ID, sourceId: habit.id },
    });
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(40);
  });

  // ── Scenario D: Simultaneous Achievement Unlock Attempts ──────
  it("Scenario D: simultaneous achievement unlock attempts yield exactly 1 record", async () => {
    const achievementId = "ach_streak_3";

    // 15 simultaneous unlock attempts
    const promises = Array.from({ length: 15 }, () =>
      achievementRepository.unlockAchievement(CONCURRENCY_USER_ID, achievementId)
    );

    const results = await Promise.all(promises);

    const freshUnlocks = results.filter((r) => r.unlocked);
    const skippedUnlocks = results.filter((r) => !r.unlocked);

    expect(freshUnlocks.length).toBe(1);
    expect(skippedUnlocks.length).toBe(14);

    // Exactly 1 row in DB
    const records = await prisma.userAchievement.findMany({
      where: { userId: CONCURRENCY_USER_ID, achievementId },
    });
    expect(records.length).toBe(1);
  });

  // ── Scenario E: Simultaneous XP Payouts with Same Idempotency Key
  it("Scenario E: simultaneous XP payouts with the same idempotency key create 1 ledger transaction", async () => {
    const fixedIdempotencyKey = `payout:BONUS:${CONCURRENCY_USER_ID}:daily_goal_2026_09_22`;

    const promises = Array.from({ length: 20 }, () =>
      xpRepository.recordTransaction({
        userId: CONCURRENCY_USER_ID,
        amount: 250,
        sourceType: XPSourceType.DAILY_GOAL,
        sourceId: "daily_goal_bonus",
        rewardType: RewardType.BONUS,
        idempotencyKey: fixedIdempotencyKey,
        baseXp: 250,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
      })
    );

    const results = await Promise.all(promises);

    const freshTxs = results.filter((r) => !r.isDuplicate);
    const dedupedTxs = results.filter((r) => r.isDuplicate);

    expect(freshTxs.length).toBe(1);
    expect(dedupedTxs.length).toBe(19);

    const count = await prisma.xPTransaction.count({
      where: { userId: CONCURRENCY_USER_ID, idempotencyKey: fixedIdempotencyKey },
    });
    expect(count).toBe(1);
  });
});
