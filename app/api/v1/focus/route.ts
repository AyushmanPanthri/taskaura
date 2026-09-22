// ============================================================
// Task Aura — GET /api/v1/focus
// Lists user's focus sessions and active session
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { FocusSessionStatus } from "@/lib/logic/types";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const allSessions = store.getUserFocusSessions(user.id);
    const runningSession = allSessions.find((s) => s.status === FocusSessionStatus.RUNNING) ?? null;

    // Sort newest first
    const sorted = [...allSessions].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    return apiSuccess({
      runningSession,
      sessions: sorted.slice(0, 30),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch focus sessions";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
