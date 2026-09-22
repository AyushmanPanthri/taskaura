// ============================================================
// Task Aura — POST /api/v1/habits/:id/log
// Idempotent habit logging for a specific date
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { logHabit } from "@/lib/services/habit-service";

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
    const body = await req.json().catch(() => ({}));
    const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;
    const completed = typeof body.completed === "boolean" ? body.completed : true;

    const result = logHabit(user.id, id, { date, completed });

    return apiSuccess({
      log: result.log,
      xpAwarded: result.xpAwarded,
      isDuplicate: result.isDuplicate,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to log habit";
    const status = message.includes("not found") ? 404 : 400;
    return apiError("BAD_REQUEST", message, status);
  }
}
