// ============================================================
// Task Aura — /api/v1/habits
// GET:  List user habits with today's status
// POST: Create a new habit
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { createHabit, getHabits } from "@/lib/services/habit-service";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const habits = getHabits(user.id);
    return apiSuccess(habits);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch habits";
    return apiError("INTERNAL_ERROR", message, 500);
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

    const habit = createHabit(user.id, {
      title: body.title.trim(),
      frequency: body.frequency,
    });

    return apiSuccess(habit, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create habit";
    return apiError("BAD_REQUEST", message, 400);
  }
}
