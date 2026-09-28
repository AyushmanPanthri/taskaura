// ============================================================
// Task Aura — /api/v1/habits/:id
// PATCH: Update habit metadata
//
// MIGRATION (Stage 3): Previously read/wrote to InMemoryStore.
// Now uses habitRepository (Prisma) for durable PostgreSQL persistence.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { habitRepository } from "@/lib/repositories/habit-repository";
import { HabitFrequency } from "@/lib/logic/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const updated = await habitRepository.updateHabit(user.id, id, {
      title: body.title,
      frequency: body.frequency as HabitFrequency | undefined,
    });

    if (!updated) {
      return apiError("NOT_FOUND", "Habit not found", 404);
    }

    return apiSuccess(updated);
  } catch (err) {
    return safeCatchError(err);
  }
}
