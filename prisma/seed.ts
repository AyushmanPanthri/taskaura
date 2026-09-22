// Task Aura — Authoritative Production Database Seeder
// Seeds PostgreSQL with canonical profile & records
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres@127.0.0.1:5433/taskaura?schema=public";

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const DEMO_USER_ID = "user_demo_14d";

async function main() {
  console.log("🌱 Starting TaskAura database seed...");

  const passwordHash = await bcrypt.hash("taskaura123", 10);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Clean existing demo user and related records
  await prisma.session.deleteMany({ where: { userId: DEMO_USER_ID } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: DEMO_USER_ID } }).catch(() => null);
  await prisma.user.deleteMany({ where: { email: "demo@taskaura.dev" } }).catch(() => null);

  // 1. Create Demo User with Settings & StreakRecord
  const user = await prisma.user.create({
    data: {
      id: DEMO_USER_ID,
      email: "demo@taskaura.dev",
      passwordHash,
      displayName: "Alex Rivera",
      createdAt: new Date(today.getTime() - 15 * 86400_000),
      settings: {
        create: {
          dailyGoalXp: 500,
          weekdayWeekendSplit: false,
          retentionDays: 90,
        },
      },
      streakRecord: {
        create: {
          currentStreak: 6,
          bestStreak: 12,
          lastEligibleDate: todayStr,
          graceUsedThisWeek: false,
        },
      },
    },
  });
  console.log(`✓ Seeded User: ${user.displayName} (${user.email})`);

  // 2. Goal: Exam Preparation
  await prisma.goal.create({
    data: {
      id: "goal_exam_prep",
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
  console.log("✓ Seeded Goal: Exam Preparation");

  // 3. Tasks
  await prisma.task.createMany({
    data: [
      {
        id: "task_demo_1",
        userId: DEMO_USER_ID,
        title: "Review Chapter 4 Physics Problems",
        description: "Kinematics and Newton's laws problem set",
        difficulty: "HARD",
        status: "PENDING",
        dueAt: new Date(today.getTime() + 2 * 86400_000),
        source: "USER",
        createdAt: new Date(today.getTime() - 2 * 86400_000),
      },
      {
        id: "task_demo_2",
        userId: DEMO_USER_ID,
        title: "Cellular Respiration Flashcards",
        description: "Krebs cycle and electron transport chain terminology",
        difficulty: "NORMAL",
        status: "PENDING",
        dueAt: new Date(today.getTime() + 1 * 86400_000),
        source: "USER",
        createdAt: new Date(today.getTime() - 1 * 86400_000),
      },
    ],
  });
  console.log("✓ Seeded 2 Active Tasks");

  // 4. Habits with today's log for habit 1
  await prisma.habit.create({
    data: {
      id: "habit_demo_flashcards",
      userId: DEMO_USER_ID,
      title: "Daily Flashcard Review",
      frequency: "DAILY",
      streakCurrent: 14,
      streakBest: 21,
      createdAt: new Date(today.getTime() - 20 * 86400_000),
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
      id: "habit_demo_deepwork",
      userId: DEMO_USER_ID,
      title: "Morning Deep Work (45 min)",
      frequency: "DAILY",
      streakCurrent: 6,
      streakBest: 10,
      createdAt: new Date(today.getTime() - 10 * 86400_000),
    },
  });

  await prisma.habit.create({
    data: {
      id: "habit_demo_review",
      userId: DEMO_USER_ID,
      title: "Weekly Lecture Review",
      frequency: "DAILY",
      streakCurrent: 3,
      streakBest: 5,
      createdAt: new Date(today.getTime() - 7 * 86400_000),
    },
  });
  console.log("✓ Seeded 3 Habits");

  // 5. 14 Days of DailyMetrics
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
  console.log("✓ Seeded 14 Days of DailyMetrics");

  // 6. Authoritative XP Ledger summing to exactly 20,580 XP
  // 18,700 (Level 18 threshold) + 1,000 + 500 + 380 = 20,580 (Level 18, 1,880/2,000 XP)
  await prisma.xPTransaction.createMany({
    data: [
      {
        id: "tx_demo_historical",
        userId: DEMO_USER_ID,
        amount: 18700,
        sourceType: "TASK",
        sourceId: "task_historical_batch",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:historical`,
        baseXp: 18700,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 7 * 86400_000),
      },
      {
        id: "tx_demo_recent_1",
        userId: DEMO_USER_ID,
        amount: 1000,
        sourceType: "FOCUS_SESSION",
        sourceId: "focus_session_recent_1",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_1`,
        baseXp: 1000,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 1 * 86400_000),
      },
      {
        id: "tx_demo_recent_2",
        userId: DEMO_USER_ID,
        amount: 500,
        sourceType: "TASK",
        sourceId: "task_recent_2",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_2`,
        baseXp: 500,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 5 * 3600_000),
      },
      {
        id: "tx_demo_recent_3",
        userId: DEMO_USER_ID,
        amount: 380,
        sourceType: "HABIT",
        sourceId: "habit_recent_3",
        rewardType: "COMPLETION",
        idempotencyKey: `init:${DEMO_USER_ID}:recent_3`,
        baseXp: 380,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(today.getTime() - 1 * 3600_000),
      },
    ],
  });
  console.log("✓ Seeded XP Ledger (20,580 total XP -> Level 18 with 1,880/2,000 XP)");

  // 7. Achievements
  await prisma.achievement.upsert({
    where: { id: "ach_first_task" },
    create: {
      id: "ach_first_task",
      name: "First Step",
      description: "Complete your first task",
      condition: JSON.stringify({ type: "TASK_COMPLETED", threshold: 1 }),
    },
    update: {},
  });

  await prisma.achievement.upsert({
    where: { id: "ach_streak_3" },
    create: {
      id: "ach_streak_3",
      name: "On Fire",
      description: "Reach a 3-day completion streak",
      condition: JSON.stringify({ type: "STREAK_REACHED", threshold: 3 }),
    },
    update: {},
  });

  await prisma.achievement.upsert({
    where: { id: "ach_focus_master" },
    create: {
      id: "ach_focus_master",
      name: "Deep Diver",
      description: "Accumulate 120 minutes of focus time",
      condition: JSON.stringify({ type: "FOCUS_MINUTES", threshold: 120 }),
    },
    update: {},
  });

  await prisma.userAchievement.createMany({
    data: [
      {
        userId: DEMO_USER_ID,
        achievementId: "ach_first_task",
        unlockedAt: new Date(today.getTime() - 10 * 86400_000),
      },
      {
        userId: DEMO_USER_ID,
        achievementId: "ach_streak_3",
        unlockedAt: new Date(today.getTime() - 4 * 86400_000),
      },
    ],
  });
  console.log("✓ Seeded Achievements");

  // 8. Weekly Score & Leaderboard
  // Calculate Monday-Sunday of current week
  const dayOfWeek = (today.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOfWeek));
  const sunday = new Date(monday.getTime() + 6 * 86400_000);
  const weekStartStr = monday.toISOString().slice(0, 10);
  const weekEndStr = sunday.toISOString().slice(0, 10);

  await prisma.weeklyScore.upsert({
    where: {
      userId_weekStart: {
        userId: DEMO_USER_ID,
        weekStart: weekStartStr,
      },
    },
    create: {
      userId: DEMO_USER_ID,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      totalXp: 20580,
      rank: 1,
    },
    update: {
      totalXp: 20580,
      rank: 1,
    },
  });

  // Seed simulated peer competitors
  const peers = [
    { email: "jordan.m@taskaura.dev", name: "Jordan Miller", xp: 19450, rank: 2 },
    { email: "sam.t@taskaura.dev", name: "Sam Taylor", xp: 18200, rank: 3 },
    { email: "taylor.k@taskaura.dev", name: "Taylor Kim", xp: 16800, rank: 4 },
  ];

  for (const peer of peers) {
    let peerUser = await prisma.user.findUnique({ where: { email: peer.email } });
    if (!peerUser) {
      peerUser = await prisma.user.create({
        data: {
          email: peer.email,
          passwordHash,
          displayName: peer.name,
        },
      });
    }

    await prisma.weeklyScore.upsert({
      where: {
        userId_weekStart: {
          userId: peerUser.id,
          weekStart: weekStartStr,
        },
      },
      create: {
        userId: peerUser.id,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        totalXp: peer.xp,
        rank: peer.rank,
      },
      update: {
        totalXp: peer.xp,
        rank: peer.rank,
      },
    });
  }

  console.log("✓ Seeded Weekly Leaderboard");
  console.log("🎉 Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
