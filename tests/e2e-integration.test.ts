// ============================================================
// Task Aura — Phase D: End-to-End User Flow Integration Suite
// Simulates complete journey:
// 1. Register new user
// 2. Obtain authenticated session
// 3. Fetch initial progress
// 4. Create a task
// 5. Complete task with transactional XP
// 6. Verify level and XP progression
// 7. Start focus session
// 8. Record heartbeat
// 9. Complete focus session
// 10. Log habit
// 11. Check weekly leaderboard
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { GET as getProgressRoute } from "../app/api/v1/progress/route";
import { taskRepository } from "../lib/repositories/task-repository";
import { focusRepository } from "../lib/repositories/focus-repository";
import { habitRepository } from "../lib/repositories/habit-repository";
import { leaderboardRepository } from "../lib/repositories/leaderboard-repository";
import { Difficulty } from "../lib/logic/types";
import { reconcileUserProgress } from "../lib/services/reconciliation-service";

const E2E_EMAIL = "e2e.hero@taskaura.test";
const E2E_PASSWORD = "Password123!@#";

describe("Phase D — End-to-End Production Flow", () => {
  let userId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    // Clean up
    const existing = await prisma.user.findUnique({ where: { email: E2E_EMAIL } });
    if (existing) {
      await prisma.xPTransaction.deleteMany({ where: { userId: existing.id } });
      await prisma.task.deleteMany({ where: { userId: existing.id } });
      await prisma.focusSession.deleteMany({ where: { userId: existing.id } });
      await prisma.habitLog.deleteMany({ where: { habit: { userId: existing.id } } });
      await prisma.habit.deleteMany({ where: { userId: existing.id } });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    if (userId) {
      await prisma.xPTransaction.deleteMany({ where: { userId } });
      await prisma.task.deleteMany({ where: { userId } });
      await prisma.focusSession.deleteMany({ where: { userId } });
      await prisma.habitLog.deleteMany({ where: { habit: { userId } } });
      await prisma.habit.deleteMany({ where: { userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("completes full E2E user lifecycle with live PostgreSQL persistence", async () => {
    // 1. Register User
    const regReq = new Request("http://localhost:3000/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: E2E_EMAIL,
        password: E2E_PASSWORD,
        displayName: "E2E Champion",
      }),
    });

    const regRes = await registerRoute(regReq as unknown as import("next/server").NextRequest);
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();
    userId = regJson.data.user.id;
    sessionCookie = regRes.headers.get("set-cookie")!;
    expect(userId).toBeDefined();

    // 2. Fetch Initial Progress via authenticated API
    const progReq = new Request("http://localhost:3000/api/v1/progress", {
      headers: { cookie: sessionCookie },
    });
    const progRes = await getProgressRoute(progReq);
    expect(progRes.status).toBe(200);

    // 3. Create Task
    const task = await taskRepository.createTask(userId, {
      title: "Complete E2E Verification Milestone",
      difficulty: Difficulty.HARD,
    });
    expect(task.id).toBeDefined();
    expect(task.status).toBe("PENDING");

    // 4. Complete Task with Transactional XP
    const taskCompletion = await taskRepository.completeTaskTransaction(
      userId,
      task.id,
      `payout:TASK:${task.id}`,
      {
        amount: 300,
        baseXp: 200,
        difficultyMultiplier: 1.5,
        streakBonus: 0,
        rewardType: "COMPLETION",
      }
    );
    expect(taskCompletion.isDuplicate).toBe(false);
    expect(taskCompletion.xpAwarded).toBe(300);

    // 5. Start Focus Session
    const focusSession = await focusRepository.startSession(userId, {
      requiredMinutes: 25,
      clientEventId: "evt_e2e_focus_1",
      expectedHeartbeats: 25,
    });
    expect(focusSession.status).toBe("RUNNING");

    // 6. Record Heartbeat
    const hb = await focusRepository.recordHeartbeat(userId, focusSession.id);
    expect(hb.heartbeatCount).toBe(1);

    // 7. Complete Focus Session with Transactional XP
    const focusCompletion = await focusRepository.completeSessionTransaction(
      userId,
      focusSession.id,
      25,
      `payout:FOCUS:${focusSession.id}`,
      {
        amount: 250,
        baseXp: 250,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
        rewardType: "COMPLETION",
      }
    );
    expect(focusCompletion.isDuplicate).toBe(false);
    expect(focusCompletion.xpAwarded).toBe(250);

    // 8. Log Habit
    const habit = await habitRepository.createHabit(userId, {
      title: "Daily Focus Journal",
    });
    const habitLog = await habitRepository.logHabitTransaction(
      userId,
      habit.id,
      "2026-09-22",
      true,
      `payout:HABIT:${habit.id}:2026-09-22`,
      {
        amount: 75,
        baseXp: 75,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
        rewardType: "COMPLETION",
      }
    );
    expect(habitLog.xpAwarded).toBe(75);

    // 9. Verify Ledger & Authoritative Progress Reconciliation
    // Total XP = 300 (task) + 250 (focus) + 75 (habit) = 625 XP!
    const progress = await reconcileUserProgress(userId);
    expect(progress.totalXp).toBe(625);
    expect(progress.level).toBeGreaterThanOrEqual(1);

    // 10. Update and Check Weekly Leaderboard
    const today = new Date();
    const dayOfWeek = (today.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOfWeek));
    const sunday = new Date(monday.getTime() + 6 * 86400_000);
    const weekStartStr = monday.toISOString().slice(0, 10);
    const weekEndStr = sunday.toISOString().slice(0, 10);

    await leaderboardRepository.upsertWeeklyScore(
      userId,
      weekStartStr,
      weekEndStr,
      progress.totalXp,
      1
    );

    const scores = await leaderboardRepository.getWeeklyScores(weekStartStr);
    const myScore = scores.find((s) => s.userId === userId);
    expect(myScore).toBeDefined();
    expect(myScore?.totalXp).toBe(625);
  });
});
