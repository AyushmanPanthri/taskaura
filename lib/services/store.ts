// ============================================================
// LifeXP — In-Memory Data Store
// Hackathon MVP — replaces PostgreSQL + Redis
// Mirrors the schema from prisma/schema.prisma
// ============================================================

import type {
  UsageSession,
  DailyMetrics,
  Task,
  FocusSession,
  XPTransaction,
  Goal,
  Habit,
  HabitLog,
  Quest,
  AIInsight,
  WeeklyScore,
  StreakRecord,
  UserAchievement,
  SyncLogEntry,
  TaskTypeConfig,
} from "../logic/types";
import { XPSourceType } from "../logic/types";
import { BASE_XP } from "../logic/constants";

// ── User ─────────────────────────────────────────────────────

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  timezone: string;
  createdAt: Date;
}

export interface StoredUserSettings {
  userId: string;
  dailyGoalXp: number;
  weekdayWeekendSplit: boolean;
  retentionDays: number;
}

// ── Store ────────────────────────────────────────────────────

class InMemoryStore {
  users = new Map<string, StoredUser>();
  userSettings = new Map<string, StoredUserSettings>();
  usageSessions = new Map<string, UsageSession>();
  goals = new Map<string, Goal>();
  tasks = new Map<string, Task>();
  habits = new Map<string, Habit>();
  habitLogs = new Map<string, HabitLog>();
  dailyMetrics = new Map<string, DailyMetrics>(); // key: `${userId}:${date}`
  focusSessions = new Map<string, FocusSession>();
  xpTransactions = new Map<string, XPTransaction>();
  userAchievements: UserAchievement[] = [];
  quests = new Map<string, Quest>();
  aiInsights = new Map<string, AIInsight>();
  weeklyScores: WeeklyScore[] = [];
  streakRecords = new Map<string, StreakRecord>(); // key: userId
  syncLogs: SyncLogEntry[] = [];
  taskTypeConfigs = new Map<string, TaskTypeConfig>();

  // Idempotency key index (mirrors DB unique constraint)
  private xpIdempotencyKeys = new Set<string>();
  // Client event ID index (mirrors DB unique constraint)
  private clientEventIds = new Set<string>();
  // User achievement index (mirrors DB unique constraint)
  private userAchievementKeys = new Set<string>();

  constructor() {
    // Initialize default task type configs from constants
    for (const [type, baseXp] of Object.entries(BASE_XP)) {
      this.taskTypeConfigs.set(type, {
        type: type as XPSourceType,
        baseXp,
        active: true,
      });
    }
  }

  // ── Query helpers ────────────────────────────────────────

  getUserSessions(userId: string, date?: string): UsageSession[] {
    return Array.from(this.usageSessions.values()).filter(
      (s) => s.userId === userId && (!date || s.date === date)
    );
  }

  getUserTasks(userId: string): Task[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.userId === userId
    );
  }

  getUserGoals(userId: string): Goal[] {
    return Array.from(this.goals.values()).filter(
      (g) => g.userId === userId
    );
  }

  getUserHabits(userId: string): Habit[] {
    return Array.from(this.habits.values()).filter(
      (h) => h.userId === userId
    );
  }

  getUserHabitLogs(userId: string): HabitLog[] {
    const userHabitIds = new Set(
      this.getUserHabits(userId).map((h) => h.id)
    );
    return Array.from(this.habitLogs.values()).filter((l) =>
      userHabitIds.has(l.habitId)
    );
  }

  getUserDailyMetrics(userId: string): DailyMetrics[] {
    return Array.from(this.dailyMetrics.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  getUserXpTransactions(userId: string): XPTransaction[] {
    return Array.from(this.xpTransactions.values()).filter(
      (t) => t.userId === userId
    );
  }

  getUserAchievements(userId: string): UserAchievement[] {
    return this.userAchievements.filter((a) => a.userId === userId);
  }

  getUserQuests(userId: string): Quest[] {
    return Array.from(this.quests.values()).filter(
      (q) => q.userId === userId
    );
  }

  getUserFocusSessions(userId: string): FocusSession[] {
    return Array.from(this.focusSessions.values()).filter(
      (f) => f.userId === userId
    );
  }

  getTotalXp(userId: string): number {
    return this.getUserXpTransactions(userId).reduce(
      (sum, t) => sum + t.amount,
      0
    );
  }

  // ── Idempotent write helpers ─────────────────────────────

  /**
   * Add XP transaction with idempotency check.
   * Returns false if the idempotency key already exists (duplicate).
   */
  addXpTransaction(tx: XPTransaction): boolean {
    if (this.xpIdempotencyKeys.has(tx.idempotencyKey)) {
      return false; // Duplicate — idempotent no-op
    }
    this.xpIdempotencyKeys.add(tx.idempotencyKey);
    this.xpTransactions.set(tx.id, tx);
    return true;
  }

  /**
   * Add usage session with client event ID dedup.
   * Returns false if the client event ID already exists.
   */
  addUsageSession(session: UsageSession): boolean {
    if (this.clientEventIds.has(session.clientEventId)) {
      return false; // Duplicate
    }
    this.clientEventIds.add(session.clientEventId);
    this.usageSessions.set(session.id, session);
    return true;
  }

  /**
   * Add user achievement with uniqueness check.
   * Returns false if already unlocked.
   */
  addUserAchievement(ua: UserAchievement): boolean {
    const key = `${ua.userId}:${ua.achievementId}`;
    if (this.userAchievementKeys.has(key)) {
      return false; // Already unlocked
    }
    this.userAchievementKeys.add(key);
    this.userAchievements.push(ua);
    return true;
  }

  /**
   * Upsert daily metrics (idempotent — always replaces for userId+date).
   */
  upsertDailyMetrics(metrics: DailyMetrics): void {
    const key = `${metrics.userId}:${metrics.date}`;
    this.dailyMetrics.set(key, metrics);
  }

  /**
   * Upsert streak record (one per user).
   */
  upsertStreakRecord(record: StreakRecord): void {
    this.streakRecords.set(record.userId, record);
  }

  /**
   * Reset entire store (for testing).
   */
  reset(): void {
    this.users.clear();
    this.userSettings.clear();
    this.usageSessions.clear();
    this.goals.clear();
    this.tasks.clear();
    this.habits.clear();
    this.habitLogs.clear();
    this.dailyMetrics.clear();
    this.focusSessions.clear();
    this.xpTransactions.clear();
    this.userAchievements = [];
    this.quests.clear();
    this.aiInsights.clear();
    this.weeklyScores = [];
    this.streakRecords.clear();
    this.syncLogs = [];
    this.xpIdempotencyKeys.clear();
    this.clientEventIds.clear();
    this.userAchievementKeys.clear();
  }
}

// Singleton
export const store = new InMemoryStore();
