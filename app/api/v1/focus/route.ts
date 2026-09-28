// ============================================================
// Task Aura — GET /api/v1/focus
// Lists user's focus sessions and active session
//
// MIGRATION (Stage 3): Previously read from InMemoryStore.
// Now uses focusRepository (Prisma) for durable PostgreSQL reads.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { focusRepository } from "@/lib/repositories/focus-repository";
import { FocusSessionStatus } from "@/lib/logic/types";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const [runningSession, allSessions] = await Promise.all([
      focusRepository.findActiveSession(user.id),
      focusRepository.listSessions(user.id),
    ]);

    return apiSuccess({
      runningSession,
      sessions: allSessions.slice(0, 30),
    });
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
    if (!body) {
      return apiError("INVALID_INPUT", "Request body is required", 400);
    }

    const requiredMinutes =
      typeof body.requiredMinutes === "number" ? body.requiredMinutes : null;
    const clientEventId =
      typeof body.clientEventId === "string" ? body.clientEventId : null;

    if (!requiredMinutes || !clientEventId) {
      return apiError(
        "INVALID_INPUT",
        "requiredMinutes and clientEventId are required",
        400
      );
    }

    // Calculate expected heartbeats server-side (one every 30s)
    const expectedHeartbeats = Math.ceil((requiredMinutes * 60) / 30);

    const session = await focusRepository.startSession(user.id, {
      requiredMinutes,
      clientEventId,
      expectedHeartbeats,
    });

    return apiSuccess(session, 201);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to start focus session";
    if (message.includes("already running")) {
      return apiError("CONFLICT", message, 409);
    }
    return safeCatchError(err);
  }
}
