// ============================================================
// Task Aura — /api/v1/habits
// GET:  List user habits with today's completion status
// POST: Create a new habit
//
// MIGRATION (Stage 3): Previously read/wrote to InMemoryStore.
// Now uses habitRepository (Prisma) for durable PostgreSQL persistence.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { habitRepository } from "@/lib/repositories/habit-repository";
import { prisma } from "@/lib/prisma";
import { HabitFrequency } from "@/lib/logic/types";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const today = new Date().toISOString().slice(0, 10);
    const habits = await habitRepository.listHabits(user.id);

    // Decorate each habit with today's completion status from PostgreSQL
    const habitIds = habits.map((h) => h.id);
    const todayLogs = habitIds.length > 0
      ? await prisma.habitLog.findMany({
          where: { habitId: { in: habitIds }, date: today },
          select: { habitId: true, completed: true },
        })
      : [];

    const completedTodaySet = new Set(
      todayLogs.filter((l) => l.completed).map((l) => l.habitId)
    );

    const habitsWithStatus = habits.map((h) => ({
      ...h,
      completedToday: completedTodaySet.has(h.id),
      streak: h.streakCurrent,
    }));

    return apiSuccess(habitsWithStatus);
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      return apiError("INVALID_INPUT", "Habit title is required", 400);
    }

    const habit = await habitRepository.createHabit(user.id, {
      title: body.title.trim(),
      frequency: body.frequency as HabitFrequency | undefined,
    });

    return apiSuccess(habit, 201);
  } catch (err) {
    return safeCatchError(err);
  }
}
