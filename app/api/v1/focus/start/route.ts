// ============================================================
// Task Aura — POST /api/v1/focus/start
// Starts a new focus session (enforces single running session via PostgreSQL)
//
// MIGRATION (Stage 3): Migrated from InMemoryStore to focusRepository (PostgreSQL).
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { focusRepository } from "@/lib/repositories/focus-repository";
import { ECONOMY } from "@/lib/logic/economy";

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = await req.json().catch(() => ({}));
    const rawMinutes = body.requiredMinutes;
    // Validate requiredMinutes: must be an integer within [focusPlannedMinMinutes, focusPlannedMaxMinutes]
    if (
      typeof rawMinutes !== "number" ||
      !Number.isFinite(rawMinutes) ||
      !Number.isInteger(rawMinutes) ||
      rawMinutes < ECONOMY.focusPlannedMinMinutes ||
      rawMinutes > ECONOMY.focusPlannedMaxMinutes
    ) {
      return apiError(
        "BAD_REQUEST",
        `requiredMinutes must be an integer between ${ECONOMY.focusPlannedMinMinutes} and ${ECONOMY.focusPlannedMaxMinutes}`,
        400
      );
    }
    const requiredMinutes = rawMinutes;
    const clientEventId = typeof body.clientEventId === "string" && body.clientEventId.trim()
      ? body.clientEventId.trim()
      : crypto.randomUUID();
    const expectedHeartbeats = Math.floor((requiredMinutes * 60) / 30);
    // taskId is optional; validation (ownership, non-completed) happens in the repository.
    const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : null;

    const session = await focusRepository.startSession(user.id, {
      requiredMinutes,
      clientEventId,
      expectedHeartbeats,
      taskId,
    });

    return apiSuccess(session, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start focus session";
    return apiError("BAD_REQUEST", message, 400);
  }
}
