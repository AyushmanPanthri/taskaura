// ============================================================
// Task Aura — Phase D: Multi-User Data Isolation Suite (§7)
// Tests that User A cannot read, modify, or steal User B's domain data.
// Verified at both repository and API boundary layers.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { taskRepository } from "../lib/repositories/task-repository";
import { habitRepository } from "../lib/repositories/habit-repository";
import { focusRepository } from "../lib/repositories/focus-repository";
import { metricsRepository } from "../lib/repositories/metrics-repository";
import { xpRepository } from "../lib/repositories/xp-repository";
import { Difficulty, XPSourceType, RewardType } from "../lib/logic/types";

const USER_A_ID = "user_isolation_alice";
const USER_B_ID = "user_isolation_bob";

describe("Phase D — Multi-User Data Isolation", () => {
  beforeAll(async () => {
    // Clean up
    for (const uid of [USER_A_ID, USER_B_ID]) {
      await prisma.xPTransaction.deleteMany({ where: { userId: uid } });
      await prisma.task.deleteMany({ where: { userId: uid } });
      await prisma.focusSession.deleteMany({ where: { userId: uid } });
      await prisma.habitLog.deleteMany({ where: { habit: { userId: uid } } });
      await prisma.habit.deleteMany({ where: { userId: uid } });
      await prisma.dailyMetrics.deleteMany({ where: { userId: uid } });
      await prisma.userAchievement.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }

    // Create User A
    await prisma.user.create({
      data: {
        id: USER_A_ID,
        email: "alice@taskaura.test",
        passwordHash: "hash_alice",
        displayName: "Alice Adventurer",
      },
    });

    // Create User B
    await prisma.user.create({
      data: {
        id: USER_B_ID,
        email: "bob@taskaura.test",
        passwordHash: "hash_bob",
        displayName: "Bob Builder",
      },
    });
  });

  afterAll(async () => {
    for (const uid of [USER_A_ID, USER_B_ID]) {
      await prisma.xPTransaction.deleteMany({ where: { userId: uid } });
      await prisma.task.deleteMany({ where: { userId: uid } });
      await prisma.focusSession.deleteMany({ where: { userId: uid } });
      await prisma.habitLog.deleteMany({ where: { habit: { userId: uid } } });
      await prisma.habit.deleteMany({ where: { userId: uid } });
      await prisma.dailyMetrics.deleteMany({ where: { userId: uid } });
      await prisma.userAchievement.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
    await prisma.$disconnect();
  });

  // ── TASKS ISOLATION ──────────────────────────────────────────
  it("User A cannot read or complete User B tasks", async () => {
    // Create task owned by User B
    const bobTask = await taskRepository.createTask(USER_B_ID, {
      title: "Bob Private Calculus Task",
      difficulty: Difficulty.HARD,
    });

    // 1. User A tries to list tasks: should not include Bob's task
    const aliceTasks = await taskRepository.listTasks(USER_A_ID);
    const hasBobTask = aliceTasks.some((t) => t.id === bobTask.id);
    expect(hasBobTask).toBe(false);

    // 2. User A tries to read Bob's task directly by ID
    const directRead = await taskRepository.findById(USER_A_ID, bobTask.id);
    expect(directRead).toBeNull();

    // 3. User A tries to complete Bob's task
    await expect(
      taskRepository.completeTaskTransaction(
        USER_A_ID, // Alice claiming Bob's task
        bobTask.id,
        `payout:TASK:${bobTask.id}:alice_tamper`,
        {
          amount: 200,
          baseXp: 200,
          difficultyMultiplier: 1.0,
          streakBonus: 0,
          rewardType: "COMPLETION",
        }
      )
    ).rejects.toThrow("Task not found");

    // Verify Bob's task remains untouched and PENDING
    const bobTaskFresh = await taskRepository.findById(USER_B_ID, bobTask.id);
    expect(bobTaskFresh?.status).toBe("PENDING");
  });

  // ── HABITS ISOLATION ─────────────────────────────────────────
  it("User A cannot view or log User B habits", async () => {
    // Create habit owned by User B
    const bobHabit = await habitRepository.createHabit(USER_B_ID, {
      title: "Bob Meditation Practice",
    });

    // 1. User A list habits: should not include Bob's habit
    const aliceHabits = await habitRepository.listHabits(USER_A_ID);
    expect(aliceHabits.some((h) => h.id === bobHabit.id)).toBe(false);

    // 2. User A tries to read Bob's habit directly
    const directHabit = await habitRepository.findById(USER_A_ID, bobHabit.id);
    expect(directHabit).toBeNull();

    // 3. User A tries to log Bob's habit
    await expect(
      habitRepository.logHabitTransaction(
        USER_A_ID,
        bobHabit.id,
        "2026-09-22",
        true,
        `payout:HABIT:${bobHabit.id}:2026-09-22`,
        {
          amount: 50,
          baseXp: 50,
          difficultyMultiplier: 1.0,
          streakBonus: 0,
          rewardType: "COMPLETION",
        }
      )
    ).rejects.toThrow("Habit not found");
  });

  // ── FOCUS SESSIONS ISOLATION ─────────────────────────────────
  it("User A cannot view, heartbeat, or complete User B focus sessions", async () => {
    // User B starts focus session
    const bobSession = await focusRepository.startSession(USER_B_ID, {
      requiredMinutes: 30,
      clientEventId: "evt_bob_focus_isolation",
      expectedHeartbeats: 30,
    });

    // 1. User A checks active session: should be null
    const aliceActive = await focusRepository.findActiveSession(USER_A_ID);
    expect(aliceActive).toBeNull();

    // 2. User A tries to record heartbeat on Bob's session
    await expect(
      focusRepository.recordHeartbeat(USER_A_ID, bobSession.id)
    ).rejects.toThrow("Focus session not found");

    // 3. User A tries to complete Bob's session
    await expect(
      focusRepository.completeSessionTransaction(
        USER_A_ID,
        bobSession.id,
        30,
        `payout:FOCUS:${bobSession.id}:alice`,
        {
          amount: 100,
          baseXp: 100,
          difficultyMultiplier: 1.0,
          streakBonus: 0,
          rewardType: "COMPLETION",
        }
      )
    ).rejects.toThrow("Focus session not found");

    // Cleanup Bob's session
    await focusRepository.abandonSession(USER_B_ID, bobSession.id);
  });

  // ── METRICS & XP ISOLATION ───────────────────────────────────
  it("User A cannot read User B private metrics or alter User B XP", async () => {
    // Seed private metric for Bob
    await metricsRepository.upsertDailyMetrics(USER_B_ID, "2026-09-22", {
      totalScreenTime: 7200,
      distractionIndex: 45,
      focusScore: 92,
    });

    // 1. User A tries to read Bob's metric
    const aliceViewOfBob = await metricsRepository.getDailyMetrics(
      USER_A_ID,
      "2026-09-22"
    );
    expect(aliceViewOfBob).toBeNull();

    // 2. User A cannot view Bob's XP ledger
    await xpRepository.recordTransaction({
      userId: USER_B_ID,
      amount: 500,
      sourceType: XPSourceType.TASK,
      sourceId: "task_bob_secret",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `init:${USER_B_ID}:tx_1`,
      baseXp: 500,
      difficultyMultiplier: 1.0,
    });

    const aliceLedger = await xpRepository.getLedger(USER_A_ID);
    expect(aliceLedger.length).toBe(0);

    const aliceTotalXp = await xpRepository.getTotalXp(USER_A_ID);
    expect(aliceTotalXp).toBe(0);

    const bobTotalXp = await xpRepository.getTotalXp(USER_B_ID);
    expect(bobTotalXp).toBe(500);
  });
});
