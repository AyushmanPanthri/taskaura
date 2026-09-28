// ============================================================
// Task Aura — GET /api/v1/progress
// Authoritative user progression endpoint
//
// FIX (2026-09): Switched from the in-memory store to the
// PostgreSQL-authoritative progress service. The old service read
// totalXp from an in-memory Map that is never updated by admin XP
// grants (which write directly to the DB via xpRepository). This
// caused admin-granted XP to be silently invisible on the player
// dashboard, leaderboard, and level display despite a successful
// DB write + audit log entry. The new service always aggregates
// SUM(xp_transactions) from Prisma — the true source of truth.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { getPgProgressSummary } from "@/lib/services/pg-progress-service";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const progress = await getPgProgressSummary(user.id);
    return apiSuccess(progress);
  } catch (err) {
    return safeCatchError(err);
  }
}
