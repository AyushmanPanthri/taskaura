// ============================================================
// Task Aura — POST /api/v1/focus/:id/complete
// Server-authoritative focus completion & XP award
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { completeFocusSession } from "@/lib/services/focus-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const session = store.focusSessions.get(id);
    if (!session || session.userId !== user.id) {
      return apiError("NOT_FOUND", "Focus session not found", 404);
    }

    const body = await req.json().catch(() => ({}));
    const clientElapsedSeconds = typeof body.clientElapsedSeconds === "number" ? body.clientElapsedSeconds : undefined;

    const streakDays = store.streakRecords.get(user.id)?.currentStreak ?? 0;

    const result = completeFocusSession(id, streakDays, { clientElapsedSeconds });

    return apiSuccess({
      session: result.session,
      xpAwarded: result.xpAwarded,
      bonusXp: result.bonusXp,
      capped: result.capped,
      isDuplicate: result.isDuplicate,
      evidenceOnly: result.evidenceOnly,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete focus session";
    return apiError("BAD_REQUEST", message, 400);
  }
}
