// ============================================================
// Task Aura — GET /api/v1/progress
// Authoritative user progression endpoint
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getUserProgressSummary } from "@/lib/services/progress-service";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const progress = getUserProgressSummary(user.id);
    return apiSuccess(progress);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch progress";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
