// ============================================================
// Task Aura — POST /api/v1/focus/:id/abandon
// Abandons an active focus session
//
// MIGRATION (Stage 3): Previously read/wrote InMemoryStore.
// Now uses focusRepository (Prisma) for durable PostgreSQL updates.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { focusRepository } from "@/lib/repositories/focus-repository";

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
    const updated = await focusRepository.abandonSession(user.id, id);

    return apiSuccess(updated);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to abandon focus session";
    if (message.includes("not found")) {
      return apiError("NOT_FOUND", message, 404);
    }
    return safeCatchError(err);
  }
}
