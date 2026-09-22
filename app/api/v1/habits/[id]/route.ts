// ============================================================
// Task Aura — /api/v1/habits/:id
// PATCH: Update habit metadata or archive status
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { updateHabit } from "@/lib/services/habit-service";

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

    const updated = updateHabit(user.id, id, {
      title: body.title,
      frequency: body.frequency,
    });

    return apiSuccess(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update habit";
    const status = message.includes("not found") ? 404 : 400;
    return apiError("BAD_REQUEST", message, status);
  }
}
