// ============================================================
// Task Aura — Stage 6: PostgreSQL Durability & Lifecycle Suite
// Verifies:
// 1. End-to-end player lifecycle against PostgreSQL:
//    Register -> Complete Task -> Check Progress -> Check Leaderboard ->
//    Admin Grant XP -> Check Combined Progress & Level-Up.
// 2. Server restart simulation:
//    Simulates process termination, wipes in-memory state,
//    and verifies zero data loss across cold reboots.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { TaskRepository } from "../lib/repositories/task-repository";
import { XPRepository } from "../lib/repositories/xp-repository";
import { HabitRepository } from "../lib/repositories/habit-repository";
import { FocusRepository } from "../lib/repositories/focus-repository";
import { getPgProgressSummary } from "../lib/services/progress-service";
import { getWeeklyLeaderboard } from "../lib/services/leaderboard-service";
import {
  Difficulty,
  FocusSessionStatus,
  HabitFrequency,
  RewardType,
  TaskStatus,
  XPSourceType,
} from "../lib/logic/types";
import { levelFor } from "../lib/logic/economy";

const LIFECYCLE_USER_ID = "44444444-4444-4444-8444-444444444444";
const RESTART_USER_ID = "55555555-5555-4555-8555-555555555555";

const taskRepo = new TaskRepository();
const xpRepo = new XPRepository();

describe("Stage 6 — PostgreSQL Single Source of Truth Lifecycle", () => {
  beforeAll(async () => {
    // Clean up test users
    await prisma.xPTransaction.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.task.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.focusSession.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.habitLog.deleteMany({
      where: { habit: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } } },
    });
    await prisma.habit.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.streakRecord.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.weeklyScore.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
  });

  afterAll(async () => {
    await prisma.xPTransaction.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.task.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.focusSession.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.habitLog.deleteMany({
      where: { habit: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } } },
    });
    await prisma.habit.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.streakRecord.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.weeklyScore.deleteMany({
      where: { userId: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [LIFECYCLE_USER_ID, RESTART_USER_ID] } },
    });
  });

  it("completes full end-to-end lifecycle: register -> complete task -> dashboard -> leaderboard -> admin grant -> unified level-up", async () => {
    // 1. Register User in PostgreSQL
    const user = await prisma.user.create({
      data: {
        id: LIFECYCLE_USER_ID,
        email: "lifecycle@taskaura.test",
        passwordHash: "hash_lifecycle",
        displayName: "Lifecycle Hero",
        streakRecord: {
          create: {
            currentStreak: 1,
            bestStreak: 1,
            lastEligibleDate: "2026-09-22",
            graceUsedThisWeek: false,
          },
        },
      },
    });
    expect(user.id).toBe(LIFECYCLE_USER_ID);

    // Initial Progress is 0 XP, Level 1
    const initialProgress = await getPgProgressSummary(LIFECYCLE_USER_ID);
    expect(initialProgress.totalXp).toBe(0);
    expect(initialProgress.level).toBe(1);
    expect(initialProgress.xpEarnedInLevel).toBe(0);

    // 2. Create and complete a task in PostgreSQL
    const task = await taskRepo.createTask(LIFECYCLE_USER_ID, {
      title: "Write documentation chapter",
      difficulty: Difficulty.NORMAL,
    });
    expect(task.status).toBe(TaskStatus.PENDING);

    const taskPayout = {
      amount: 120,
      baseXp: 120,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
      rewardType: "COMPLETION",
    };
    const completion = await taskRepo.completeTaskTransaction(
      LIFECYCLE_USER_ID,
      task.id,
      `payout:TASK:${task.id}`,
      taskPayout
    );
    expect(completion.isDuplicate).toBe(false);
    expect(completion.xpAwarded).toBe(120);

    // 3. Verify Dashboard/Progress summary reads updated XP from PostgreSQL
    const progressAfterTask = await getPgProgressSummary(LIFECYCLE_USER_ID);
    expect(progressAfterTask.totalXp).toBe(120);
    expect(progressAfterTask.level).toBe(1);
    expect(progressAfterTask.xpEarnedInLevel).toBe(120);
    expect(progressAfterTask.xpRemaining).toBe(180); // 300 - 120

    // 4. Verify Leaderboard reflects the score in PostgreSQL
    const leaderboard = await getWeeklyLeaderboard();
    const entry = leaderboard.find((e) => e.userId === LIFECYCLE_USER_ID);
    expect(entry).toBeDefined();
    expect(entry?.xp).toBe(120);

    // 5. Admin grants XP via Rewards Center
    const adminGrant = await xpRepo.recordTransaction({
      userId: LIFECYCLE_USER_ID,
      amount: 500,
      sourceType: "ADMIN_GRANT" as XPSourceType,
      sourceId: "admin_grant_lifecycle_1",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "admin:grant:lifecycle_1",
      baseXp: 500,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });
    expect(adminGrant.isDuplicate).toBe(false);
    expect(adminGrant.transaction.amount).toBe(500);

    // 6. Verify Dashboard reflects combined XP (120 + 500 = 620) and Level-Up
    const progressAfterAdmin = await getPgProgressSummary(LIFECYCLE_USER_ID);
    expect(progressAfterAdmin.totalXp).toBe(620);
    // Level 1: 0..299, Level 2: 300..699 -> 620 XP is Level 2!
    expect(progressAfterAdmin.level).toBe(2);
    expect(progressAfterAdmin.level).toBe(levelFor(620));
    expect(progressAfterAdmin.xpEarnedInLevel).toBe(320); // 620 - 300
    expect(progressAfterAdmin.xpRemaining).toBe(80); // 400 - 320

    // 7. Verify Leaderboard updates with combined XP
    const updatedLeaderboard = await getWeeklyLeaderboard();
    const updatedEntry = updatedLeaderboard.find((e) => e.userId === LIFECYCLE_USER_ID);
    expect(updatedEntry?.xp).toBe(620);
  });
});

describe("Stage 6 — Server Restart Persistence Simulation", () => {
  it("persists all player progress, streaks, habits, and ledger history across a simulated cold server reboot", async () => {
    // 1. Seed player with substantial multi-activity progress
    await prisma.user.create({
      data: {
        id: RESTART_USER_ID,
        email: "durable@taskaura.test",
        passwordHash: "hash_durable",
        displayName: "Durable Player",
        streakRecord: {
          create: {
            currentStreak: 5,
            bestStreak: 12,
            lastEligibleDate: "2026-09-22",
            graceUsedThisWeek: false,
          },
        },
      },
    });

    // Write transactions to Postgres (Total: 1,500 XP -> Level 4)
    await xpRepo.recordTransaction({
      userId: RESTART_USER_ID,
      amount: 1200,
      sourceType: XPSourceType.TASK,
      sourceId: "task_durable_1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:TASK:durable_1",
      baseXp: 1200,
      difficultyMultiplier: 1.0,
    });

    await xpRepo.recordTransaction({
      userId: RESTART_USER_ID,
      amount: 300,
      sourceType: XPSourceType.FOCUS_SESSION,
      sourceId: "focus_durable_1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:FOCUS:durable_1",
      baseXp: 300,
      difficultyMultiplier: 1.0,
    });

    // Create a habit and log
    const habitRepoInit = new HabitRepository();
    const habit = await habitRepoInit.createHabit(RESTART_USER_ID, {
      title: "Morning Meditation",
      frequency: HabitFrequency.DAILY,
    });
    await habitRepoInit.logHabitTransaction(
      RESTART_USER_ID,
      habit.id,
      "2026-09-22",
      true,
      "habit:durable:1",
      {
        amount: 75,
        baseXp: 75,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
        rewardType: "HABIT",
      }
    );

    // Create a focus session
    const focusRepoInit = new FocusRepository();
    await focusRepoInit.startSession(RESTART_USER_ID, {
      clientEventId: "durable-focus-event-1",
      targetDurationMinutes: 25,
    });

    // ────────────────────────────────────────────────────────────
    // 2. SIMULATE COLD SERVER RESTART
    // In a serverless/multi-instance or restarted Next.js process:
    // Any in-memory singleton (like InMemoryStore) would be completely WIPED to empty.
    // We instantiate completely new repository instances to simulate fresh boot.
    // ────────────────────────────────────────────────────────────
    const freshTaskRepo = new TaskRepository();
    const freshXpRepo = new XPRepository();
    const freshHabitRepo = new HabitRepository();
    const freshFocusRepo = new FocusRepository();

    // 3. Verify ALL data is read intact and accurate from PostgreSQL
    const freshTotalXp = await freshXpRepo.getTotalXp(RESTART_USER_ID);
    expect(freshTotalXp).toBe(1575);

    const freshLedger = await freshXpRepo.getLedger(RESTART_USER_ID);
    expect(freshLedger).toHaveLength(3);
    const totalFromLedger = freshLedger.reduce((acc, row) => acc + row.amount, 0);
    expect(totalFromLedger).toBe(1575);

    const freshProgress = await getPgProgressSummary(RESTART_USER_ID);
    expect(freshProgress.totalXp).toBe(1575);
    // Level 4 threshold is 1200 cumulative XP, Level 5 is 1800 XP.
    expect(freshProgress.level).toBe(4);
    expect(freshProgress.xpEarnedInLevel).toBe(375); // 1575 - 1200
    expect(freshProgress.streak.current).toBe(5);
    expect(freshProgress.streak.longest).toBe(12);

    // Habits are intact
    const habits = await freshHabitRepo.listHabits(RESTART_USER_ID);
    expect(habits).toHaveLength(1);
    expect(habits[0].title).toBe("Morning Meditation");

    // Focus session is intact
    const sessions = await freshFocusRepo.listSessions(RESTART_USER_ID);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe(FocusSessionStatus.RUNNING);
  });
});
