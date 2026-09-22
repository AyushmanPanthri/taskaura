// ============================================================
// Task Aura — Habit Service
// Integrates habit management, idempotent habit logging,
// server-authoritative XP awards, and streak progress.
// ============================================================

import { store } from "./store";
import { awardPayout, getUserTimeZone, maybeGrantDailyBonuses } from "./xp-service";
import { localDateString } from "../logic/economy";
import { isCommitmentMet } from "../logic/streak";
import type { Habit, HabitLog } from "../logic/types";
import { HabitFrequency, XPSourceType } from "../logic/types";

export interface HabitWithTodayStatus extends Habit {
  completedToday: boolean;
  streak: number;
}

/**
 * Get all habits for a user, decorated with today's completion status.
 */
export function getHabits(userId: string): HabitWithTodayStatus[] {
  const tz = getUserTimeZone(userId);
  const today = localDateString(new Date(), tz);
  const userHabits = store.getUserHabits(userId);
  const logs = store.getUserHabitLogs(userId);

  return userHabits.map((habit) => {
    const habitLogs = logs.filter((l) => l.habitId === habit.id);
    const todayLog = habitLogs.find((l) => l.date === today);
    const completedToday = todayLog ? todayLog.completed : false;

    // Calculate habit streak (consecutive completed days ending today or yesterday)
    const completedDates = new Set(
      habitLogs.filter((l) => l.completed).map((l) => l.date)
    );

    let streak = 0;
    const checkDate = new Date();
    // If not completed today yet, start checking from yesterday
    if (!completedDates.has(today)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const dStr = checkDate.toISOString().slice(0, 10);
      if (completedDates.has(dStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return {
      ...habit,
      completedToday,
      streak,
    };
  });
}

/**
 * Create a new habit.
 */
export function createHabit(
  userId: string,
  params: {
    title: string;
    frequency?: HabitFrequency;
  }
): Habit {
  const habit: Habit = {
    id: crypto.randomUUID(),
    userId,
    title: params.title.trim(),
    frequency: params.frequency ?? HabitFrequency.DAILY,
    streakCurrent: 0,
    streakBest: 0,
    createdAt: new Date(),
  };

  store.habits.set(habit.id, habit);
  return habit;
}

/**
 * Update an existing habit.
 */
export function updateHabit(
  userId: string,
  habitId: string,
  updates: Partial<{
    title: string;
    frequency: HabitFrequency;
  }>
): Habit {
  const habit = store.habits.get(habitId);
  if (!habit || habit.userId !== userId) {
    throw new Error(`Habit not found: ${habitId}`);
  }

  const updated: Habit = {
    ...habit,
    title: updates.title !== undefined ? updates.title.trim() : habit.title,
    frequency: updates.frequency !== undefined ? updates.frequency : habit.frequency,
  };

  store.habits.set(habitId, updated);
  return updated;
}

/**
 * Log a habit completion for a specific date (idempotent).
 * Enforces one log per habit/date.
 */
export function logHabit(
  userId: string,
  habitId: string,
  params?: {
    date?: string;
    completed?: boolean;
    now?: Date;
  }
): {
  log: HabitLog;
  xpAwarded: number;
  isDuplicate: boolean;
} {
  const habit = store.habits.get(habitId);
  if (!habit || habit.userId !== userId) {
    throw new Error(`Habit not found: ${habitId}`);
  }

  const now = params?.now ?? new Date();
  const tz = getUserTimeZone(userId);
  const dateStr = params?.date ?? localDateString(now, tz);
  const completed = params?.completed ?? true;

  // Check if already logged for this habit & date
  const existingLog = Array.from(store.habitLogs.values()).find(
    (l) => l.habitId === habitId && l.date === dateStr
  );

  if (existingLog) {
    return {
      log: existingLog,
      xpAwarded: 0,
      isDuplicate: true,
    };
  }

  const newLog: HabitLog = {
    id: crypto.randomUUID(),
    habitId,
    date: dateStr,
    completed,
  };

  store.addHabitLog(newLog);

  let xpAwarded = 0;
  if (completed) {
    // Authoritative XP award for root habit payout
    const payout = awardPayout({
      userId,
      sourceType: XPSourceType.HABIT,
      root: { type: "HABIT", id: `${habitId}:${dateStr}` },
      kind: "HABIT",
      verification: "SELF_CONFIRMED",
      now,
    });
    xpAwarded = payout.paidXp;

    // Evaluate daily commitment & bonuses
    const userHabits = store.getUserHabits(userId);
    const dayLogs = store.getUserHabitLogs(userId).filter((l) => l.date === dateStr && l.completed);
    const allRequiredDone = userHabits.length > 0 && dayLogs.length >= userHabits.length;

    const streakDays = store.streakRecords.get(userId)?.currentStreak ?? 0;
    if (allRequiredDone) {
      maybeGrantDailyBonuses(userId, streakDays, now);
    }

    // Update streak tracking record for today
    const focusMinutesToday = store
      .getUserFocusSessions(userId)
      .filter((s) => s.status === "COMPLETED" && localDateString(s.completedAt ?? s.startedAt, tz) === dateStr)
      .reduce((sum, s) => sum + s.actualMinutes, 0);

    const commitmentMet = isCommitmentMet({
      verifiedFocusMinutes: focusMinutesToday,
      allRequiredHabitsLogged: allRequiredDone,
    });

    store.streakDays.set(`${userId}:${dateStr}`, {
      userId,
      localDate: dateStr,
      status: commitmentMet ? "SUCCESS" : "MISS",
      streakAfter: streakDays + (commitmentMet ? 1 : 0),
    });
  }

  return {
    log: newLog,
    xpAwarded,
    isDuplicate: false,
  };
}
