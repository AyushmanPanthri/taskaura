// ============================================================
// Task Aura — POST /api/v1/focus/:id/heartbeat
// Records active heartbeat during focus session
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { recordHeartbeat } from "@/lib/services/focus-service";

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

    const updated = recordHeartbeat(id);
    return apiSuccess(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record heartbeat";
    return apiError("BAD_REQUEST", message, 400);
  }
}
