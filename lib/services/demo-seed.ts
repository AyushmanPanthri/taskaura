// ============================================================
// Task Aura — Authoritative Demo Profile Seeder (§21)
//
// Seeds the canonical server-side profile:
//   - userId: "user_demo_14d"
//   - Goal: "Exam Preparation"
//   - Level 18, with 1,880 / 2,000 XP (Total XP: 20,580)
//   - Streak: 6 days (1 grace token)
//   - 14 days of historical DailyMetrics (Maturity: ESTABLISHED)
//   - 2 active tasks, 3 habits, achievements, and leaderboard
// ============================================================

import { store } from "./store";
import {
  Difficulty,
  GoalStatus,
  HabitFrequency,
  RewardType,
  TaskSource,
  TaskStatus,
  XPSourceType,
} from "../logic/types";
import { snapshotLeaderboard } from "./leaderboard-service";

export const DEMO_USER_ID = "user_demo_14d";

let isSeeded = false;

export function ensureDemoSeed(): void {
  if (isSeeded && store.users.has(DEMO_USER_ID)) {
    return;
  }

  // 1. User Record
  store.users.set(DEMO_USER_ID, {
    id: DEMO_USER_ID,
    email: "demo@taskaura.dev",
    passwordHash: "demo_hash",
    displayName: "Alex Rivera",
    timezone: "UTC",
    createdAt: new Date(Date.now() - 15 * 86400_000),
  });

  store.userSettings.set(DEMO_USER_ID, {
    userId: DEMO_USER_ID,
    dailyGoalXp: 50,
    weekdayWeekendSplit: false,
    retentionDays: 90,
  });

  // 2. Goal: Exam Preparation
  store.goals.set("goal_exam_prep", {
    id: "goal_exam_prep",
    userId: DEMO_USER_ID,
    title: "Exam Preparation",
    description: "Prepare thoroughly for upcoming comprehensive board exams",
    category: "ACADEMIC",
    targetValue: 100,
    currentValue: 65,
    status: GoalStatus.ACTIVE,
    createdAt: new Date(Date.now() - 14 * 86400_000),
  });

  // 3. 14 Days of DailyMetrics (History establishing ESTABLISHED maturity >= 7 days)
  const today = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const dateStr = d.toISOString().slice(0, 10);

    store.dailyMetrics.set(`${DEMO_USER_ID}:${dateStr}`, {
      id: `metric_${DEMO_USER_ID}_${dateStr}`,
      userId: DEMO_USER_ID,
      date: dateStr,
      totalScreenTime: 14400,
      appOpens: 42,
      focusMinutes: 35 + (i % 4) * 10,
      distractionIndex: 15 + (i % 5) * 2,
      taskCompletionRate: 0.75 + (i % 2) * 0.1,
      focusScore: 82,
      consistencyScore: 88,
      goalAlignment: 90,
      taskReliability: 85,
      routineStability: 80,
    });
  }

  // 4. Streak Tracking: 6 Days Active Streak
  store.streakRecords.set(DEMO_USER_ID, {
    userId: DEMO_USER_ID,
    currentStreak: 6,
    bestStreak: 12,
    lastEligibleDate: today.toISOString().slice(0, 10),
    graceUsedThisWeek: false,
  });

  // Seed last 6 days as active streak history
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today.getTime() - i * 86400_000);
    const dateStr = d.toISOString().slice(0, 10);
    store.streakDays.set(`${DEMO_USER_ID}:${dateStr}`, {
      userId: DEMO_USER_ID,
      localDate: dateStr,
      status: "SUCCESS",
      streakAfter: 7 - i,
    });
  }

  // 5. Authoritative XP Ledger summing exactly to 20,580 XP (Level 18, 1,880/2,000 XP)
  // Historical transactions: 18,700 baseline XP + 1,880 current level XP = 20,580
  const baselineBatch = 18_700;
  store.xpTransactions.set(`tx_demo_historical`, {
    id: "tx_demo_historical",
    userId: DEMO_USER_ID,
    amount: baselineBatch,
    sourceType: XPSourceType.TASK,
    sourceId: "task_historical_batch",
    rewardType: RewardType.COMPLETION,
    idempotencyKey: `init:${DEMO_USER_ID}:historical`,
    baseXp: baselineBatch,
    difficultyMultiplier: 1,
    streakBonus: 0,
    createdAt: new Date(today.getTime() - 7 * 86400_000),
    status: "VALID",
    breakdown: {
      kind: "TASK",
      minutes: 30,
      base: baselineBatch,
      effort: 1,
      difficulty: 1,
      difficultyName: "NORMAL",
      verification: 1,
      verificationKind: "FOCUS_VERIFIED",
      raw: baselineBatch,
      paid: baselineBatch,
      softCapped: false,
    },
  });

  // Current level progress: 1,880 XP across recent hours today (current week)
  store.xpTransactions.set(`tx_demo_recent_1`, {
    id: "tx_demo_recent_1",
    userId: DEMO_USER_ID,
    amount: 1000,
    sourceType: XPSourceType.FOCUS_SESSION,
    sourceId: "focus_session_recent_1",
    rewardType: RewardType.COMPLETION,
    idempotencyKey: `init:${DEMO_USER_ID}:recent_1`,
    baseXp: 1000,
    difficultyMultiplier: 1,
    streakBonus: 0,
    createdAt: new Date(today.getTime() - 4 * 3600_000),
    status: "VALID",
    breakdown: {
      kind: "FOCUS_SESSION",
      minutes: 45,
      base: 1000,
      effort: 1,
      difficulty: 1,
      difficultyName: "NORMAL",
      verification: 1,
      verificationKind: "FOCUS_VERIFIED",
      raw: 1000,
      paid: 1000,
      softCapped: false,
    },
  });

  store.xpTransactions.set(`tx_demo_recent_2`, {
    id: "tx_demo_recent_2",
    userId: DEMO_USER_ID,
    amount: 880,
    sourceType: XPSourceType.TASK,
    sourceId: "task_recent_2",
    rewardType: RewardType.COMPLETION,
    idempotencyKey: `init:${DEMO_USER_ID}:recent_2`,
    baseXp: 880,
    difficultyMultiplier: 1,
    streakBonus: 0,
    createdAt: new Date(today.getTime() - 2 * 3600_000),
    status: "VALID",
    breakdown: {
      kind: "TASK",
      minutes: 30,
      base: 880,
      effort: 1,
      difficulty: 1,
      difficultyName: "NORMAL",
      verification: 1,
      verificationKind: "SELF_CONFIRMED",
      raw: 880,
      paid: 880,
      softCapped: false,
    },
  });

  // Reconcile user progress cache to guarantee Level 18, 20,580 XP
  store.reconcileUserProgress(DEMO_USER_ID);

  // 6. Tasks: 2 Open Tasks
  store.tasks.set("task_demo_1", {
    id: "task_demo_1",
    userId: DEMO_USER_ID,
    title: "Review Biology Core Concepts (Ch. 4-6)",
    description: "Focus on cellular respiration and metabolic pathways",
    difficulty: Difficulty.HARD,
    estimatedMinutes: 45,
    status: TaskStatus.IN_PROGRESS,
    source: TaskSource.USER,
    questId: null,
    dueAt: null,
    completedAt: null,
    createdAt: new Date(today.getTime() - 3600_000 * 3),
  });

  store.tasks.set("task_demo_2", {
    id: "task_demo_2",
    userId: DEMO_USER_ID,
    title: "Complete 20 Practice Questions",
    description: "Timed practice run without notes",
    difficulty: Difficulty.NORMAL,
    estimatedMinutes: 30,
    status: TaskStatus.PENDING,
    source: TaskSource.USER,
    questId: null,
    dueAt: null,
    completedAt: null,
    createdAt: new Date(today.getTime() - 3600_000 * 2),
  });

  // 7. Habits & Logs
  const habit1Id = "habit_demo_review";
  const habit2Id = "habit_demo_flashcards";
  const habit3Id = "habit_demo_hydration";

  store.habits.set(habit1Id, {
    id: habit1Id,
    userId: DEMO_USER_ID,
    title: "Morning Review",
    frequency: HabitFrequency.DAILY,
    streakCurrent: 6,
    streakBest: 12,
    createdAt: new Date(today.getTime() - 14 * 86400_000),
  });

  store.habits.set(habit2Id, {
    id: habit2Id,
    userId: DEMO_USER_ID,
    title: "Anki Flashcards",
    frequency: HabitFrequency.DAILY,
    streakCurrent: 4,
    streakBest: 8,
    createdAt: new Date(today.getTime() - 14 * 86400_000),
  });

  store.habits.set(habit3Id, {
    id: habit3Id,
    userId: DEMO_USER_ID,
    title: "Hydration Check",
    frequency: HabitFrequency.DAILY,
    streakCurrent: 10,
    streakBest: 14,
    createdAt: new Date(today.getTime() - 14 * 86400_000),
  });

  // Log habit 1 as completed today
  const todayStr = today.toISOString().slice(0, 10);
  store.addHabitLog({
    id: `log_${habit1Id}_${todayStr}`,
    habitId: habit1Id,
    date: todayStr,
    completed: true,
  });

  // 8. Achievements
  store.userAchievements.push({
    userId: DEMO_USER_ID,
    achievementId: "FIRST_FOCUS",
    unlockedAt: new Date(today.getTime() - 10 * 86400_000),
  });
  store.userAchievements.push({
    userId: DEMO_USER_ID,
    achievementId: "CONSISTENCY_7",
    unlockedAt: new Date(today.getTime() - 5 * 86400_000),
  });
  store.userAchievements.push({
    userId: DEMO_USER_ID,
    achievementId: "LEVEL_10",
    unlockedAt: new Date(today.getTime() - 3 * 86400_000),
  });

  // 9. Seed other competitive users for leaderboard
  const peers = [
    { id: "user_alex_c", name: "Alex Chen", xp: 24500 },
    { id: "user_priya_s", name: "Priya S.", xp: 19800 },
    { id: "user_marcus_w", name: "Marcus W.", xp: 16200 },
    { id: "user_sofia_l", name: "Sofia L.", xp: 14100 },
  ];

  for (const peer of peers) {
    store.users.set(peer.id, {
      id: peer.id,
      email: `${peer.id}@example.com`,
      passwordHash: "peer_hash",
      displayName: peer.name,
      timezone: "UTC",
      createdAt: new Date(today.getTime() - 30 * 86400_000),
    });
    store.xpTransactions.set(`tx_${peer.id}`, {
      id: `tx_${peer.id}`,
      userId: peer.id,
      amount: peer.xp,
      sourceType: XPSourceType.TASK,
      sourceId: `task_${peer.id}`,
      rewardType: RewardType.COMPLETION,
      idempotencyKey: `init:${peer.id}`,
      baseXp: peer.xp,
      difficultyMultiplier: 1,
      streakBonus: 0,
      createdAt: today,
      status: "VALID",
    });
  }

  // Generate current week leaderboard snapshot
  snapshotLeaderboard();

  isSeeded = true;
}

// Automatically ensure seeded upon module load
ensureDemoSeed();
