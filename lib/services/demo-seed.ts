// ============================================================
// Task Aura — Authoritative Demo Profile Seeder (§21)
// Seeds canonical demo profile directly into PostgreSQL with valid UUIDs.
// No in-memory store dependency.
// ============================================================

import { prisma } from "../prisma";

export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000014";
export const DEMO_TASK_1_ID = "00000000-0000-0000-0000-000000000001";
export const DEMO_TASK_2_ID = "00000000-0000-0000-0000-000000000002";
export const DEMO_HABIT_1_ID = "00000000-0000-0000-0000-000000000003";
export const DEMO_HABIT_2_ID = "00000000-0000-0000-0000-000000000004";
export const DEMO_HABIT_3_ID = "00000000-0000-0000-0000-000000000005";
export const DEMO_GOAL_ID = "00000000-0000-0000-0000-000000000006";

export const DEMO_PEER_1_ID = "00000000-0000-0000-0000-000000000021";
export const DEMO_PEER_2_ID = "00000000-0000-0000-0000-000000000022";
export const DEMO_PEER_3_ID = "00000000-0000-0000-0000-000000000023";
export const DEMO_PEER_4_ID = "00000000-0000-0000-0000-000000000024";

/**
 * Backward-compatible stub for callers expecting synchronous call.
 * Actual durable state is seeded via seedDatabaseDemoProfile().
 */
export function ensureDemoSeed(): void {
  // Pure PostgreSQL persistence — no in-memory store
}

/**
 * Seeds the canonical demo profile into PostgreSQL for integration tests.
 * Clean, repeatable, and fully isolated.
 */
export async function seedDatabaseDemoProfile(): Promise<void> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 1. Demo User
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {
      displayName: "Alex Rivera",
      email: "demo@taskaura.dev",
      isGuest: false,
    },
    create: {
      id: DEMO_USER_ID,
      displayName: "Alex Rivera",
      email: "demo@taskaura.dev",
      passwordHash: "demo_hash",
      isGuest: false,
      createdAt: new Date(today.getTime() - 15 * 86400_000),
    },
  });

  // 2. Settings & Streak
  await prisma.userSettings.upsert({
    where: { userId: DEMO_USER_ID },
    update: { dailyGoalXp: 500 },
    create: { userId: DEMO_USER_ID, dailyGoalXp: 500 },
  });

  await prisma.streakRecord.upsert({
    where: { userId: DEMO_USER_ID },
    update: {
      currentStreak: 6,
      bestStreak: 12,
      lastEligibleDate: todayStr,
      graceUsedThisWeek: false,
    },
    create: {
      userId: DEMO_USER_ID,
      currentStreak: 6,
      bestStreak: 12,
      lastEligibleDate: todayStr,
      graceUsedThisWeek: false,
    },
  });

  // 3. Goal
  await prisma.goal.upsert({
    where: { id: DEMO_GOAL_ID },
    update: {
      title: "Exam Preparation",
      status: "ACTIVE",
      currentValue: 65,
      targetValue: 100,
    },
    create: {
      id: DEMO_GOAL_ID,
      userId: DEMO_USER_ID,
      title: "Exam Preparation",
      description: "Prepare thoroughly for upcoming comprehensive board exams",
      category: "ACADEMIC",
      targetValue: 100,
      currentValue: 65,
      status: "ACTIVE",
      createdAt: new Date(today.getTime() - 14 * 86400_000),
    },
  });

  // 4. Tasks & Audit Logs (clean and recreate to guarantee pristine initial state)
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: DEMO_USER_ID },
        { targetUserId: DEMO_USER_ID },
      ],
    },
  });
  await prisma.task.deleteMany({ where: { userId: DEMO_USER_ID } });

  await prisma.task.create({
    data: {
      id: DEMO_TASK_1_ID,
      userId: DEMO_USER_ID,
      title: "Review Chapter 4 Physics Problems",
      description: "Kinematics and Newton's laws problem set",
      difficulty: "HARD",
      status: "PENDING",
      dueAt: new Date(today.getTime() + 86400_000 * 2),
      source: "USER",
      createdAt: new Date(today.getTime() - 3600_000 * 5),
    },
  });

  await prisma.task.create({
    data: {
      id: DEMO_TASK_2_ID,
      userId: DEMO_USER_ID,
      title: "Cellular Respiration Flashcards",
      description: "Krebs cycle and electron transport chain terminology",
      difficulty: "NORMAL",
      status: "PENDING",
      dueAt: null,
      source: "USER",
      createdAt: new Date(today.getTime() - 3600_000 * 2),
    },
  });

  // 4b. Focus Sessions (clean any running or completed sessions)
  await prisma.focusSession.deleteMany({ where: { userId: DEMO_USER_ID } });

  // 5. Habits & HabitLog
  await prisma.habitLog.deleteMany({
    where: { habit: { userId: DEMO_USER_ID } },
  });
  await prisma.habit.deleteMany({ where: { userId: DEMO_USER_ID } });

  await prisma.habit.create({
    data: {
      id: DEMO_HABIT_1_ID,
      userId: DEMO_USER_ID,
      title: "Daily Flashcard Review",
      frequency: "DAILY",
      streakCurrent: 14,
      streakBest: 21,
      createdAt: new Date(today.getTime() - 1 * 86400_000),
      habitLogs: {
        create: {
          date: todayStr,
          completed: true,
        },
      },
    },
  });

  await prisma.habit.create({
    data: {
      id: DEMO_HABIT_2_ID,
      userId: DEMO_USER_ID,
      title: "Morning Deep Work (45 min)",
      frequency: "DAILY",
      streakCurrent: 6,
      streakBest: 10,
      createdAt: new Date(today.getTime() - 5 * 86400_000),
    },
  });

  await prisma.habit.create({
    data: {
      id: DEMO_HABIT_3_ID,
      userId: DEMO_USER_ID,
      title: "Weekly Lecture Review",
      frequency: "DAILY",
      streakCurrent: 3,
      streakBest: 5,
      createdAt: new Date(today.getTime() - 10 * 86400_000),
    },
  });

  // 6. DailyMetrics (15 days)
  await prisma.dailyMetrics.deleteMany({ where: { userId: DEMO_USER_ID } });
  const metricsData = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const dStr = d.toISOString().slice(0, 10);
    metricsData.push({
      userId: DEMO_USER_ID,
      date: dStr,
      totalScreenTime: 14400,
      appOpens: 42,
      focusMinutes: 35 + (i % 4) * 10,
      taskCompletionRate: 0.75 + (i % 2) * 0.1,
      distractionIndex: 15 + (i % 5) * 2,
      focusScore: 82,
      consistencyScore: 88,
      goalAlignment: 90,
      taskReliability: 85,
      routineStability: 80,
    });
  }
  await prisma.dailyMetrics.createMany({ data: metricsData });

  // 7. Authoritative XP Ledger summing to 20,580
  await prisma.xPTransaction.deleteMany({ where: { userId: DEMO_USER_ID } });
  await prisma.xPTransaction.createMany({
    data: [
      {
        userId: DEMO_USER_ID,
        amount: 18700,
        sourceType: "TASK",
        sourceId: "task_historical_batch",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:historical`,
        baseXp: 18700,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 2 * 3600_000),
      },
      {
        userId: DEMO_USER_ID,
        amount: 1000,
        sourceType: "FOCUS_SESSION",
        sourceId: "focus_session_recent_1",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_1`,
        baseXp: 1000,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 1 * 3600_000),
      },
      {
        userId: DEMO_USER_ID,
        amount: 500,
        sourceType: "TASK",
        sourceId: "task_recent_2",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_2`,
        baseXp: 500,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 40 * 60_000),
      },
      {
        userId: DEMO_USER_ID,
        amount: 380,
        sourceType: "HABIT",
        sourceId: "habit_recent_3",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_3`,
        baseXp: 380,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 20 * 60_000),
      },
    ],
  });

  // 8. Achievements
  const firstFocus = await prisma.achievement.findFirst({
    where: { name: "First Step" },
  });
  if (firstFocus) {
    await prisma.userAchievement.upsert({
      where: {
        userId_achievementId: {
          userId: DEMO_USER_ID,
          achievementId: firstFocus.id,
        },
      },
      update: {},
      create: {
        userId: DEMO_USER_ID,
        achievementId: firstFocus.id,
        unlockedAt: new Date(today.getTime() - 10 * 86400_000),
      },
    });
  }

  // 9. Peers for leaderboard
  const peers = [
    { id: DEMO_PEER_1_ID, name: "Alex Chen", xp: 24500, email: "alex.c@taskaura.dev" },
    { id: DEMO_PEER_2_ID, name: "Priya S.", xp: 19800, email: "priya.s@taskaura.dev" },
    { id: DEMO_PEER_3_ID, name: "Marcus W.", xp: 16200, email: "marcus.w@taskaura.dev" },
    { id: DEMO_PEER_4_ID, name: "Sofia L.", xp: 14100, email: "sofia.l@taskaura.dev" },
  ];

  for (const peer of peers) {
    await prisma.user.upsert({
      where: { id: peer.id },
      update: { displayName: peer.name },
      create: {
        id: peer.id,
        displayName: peer.name,
        email: peer.email,
        passwordHash: "peer_hash",
        isGuest: false,
      },
    });

    await prisma.xPTransaction.deleteMany({ where: { userId: peer.id } });
    await prisma.xPTransaction.create({
      data: {
        userId: peer.id,
        amount: peer.xp,
        sourceType: "TASK",
        sourceId: `peer_task_${peer.id}`,
        rewardType: "COMPLETION",
        idempotencyKey: `init:${peer.id}`,
        baseXp: peer.xp,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 3600_000),
      },
    });
  }
}
