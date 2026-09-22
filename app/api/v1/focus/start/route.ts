// ============================================================
// Task Aura — POST /api/v1/focus/start
// Starts a new focus session (enforces single running session)
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { startFocusSession } from "@/lib/services/focus-service";

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = await req.json().catch(() => ({}));
    const requiredMinutes = typeof body.requiredMinutes === "number" ? body.requiredMinutes : 25;
    const clientEventId = typeof body.clientEventId === "string" && body.clientEventId.trim()
      ? body.clientEventId.trim()
      : crypto.randomUUID();
    const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : undefined;

    const session = startFocusSession({
      userId: user.id,
      requiredMinutes,
      clientEventId,
      taskId,
    });

    return apiSuccess(session, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start focus session";
    return apiError("BAD_REQUEST", message, 400);
  }
}
