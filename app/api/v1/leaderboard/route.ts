// ============================================================
// Task Aura — GET /api/v1/leaderboard
// Returns authoritative weekly leaderboard snapshot (UTC Monday-Sunday)
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getLeaderboard, getUserRank, snapshotLeaderboard } from "@/lib/services/leaderboard-service";
import { store } from "@/lib/services/store";
import { getWeekStart, getWeekEnd } from "@/lib/logic/leaderboard";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const now = new Date();
    const weekStartObj = getWeekStart(now);
    const weekEndObj = getWeekEnd(now);
    const weekStartStr = weekStartObj.toISOString().slice(0, 10);
    const weekEndStr = weekEndObj.toISOString().slice(0, 10);

    // If store has no snapshots for current week, generate one
    let scores = getLeaderboard(weekStartStr);
    if (scores.length === 0) {
      scores = snapshotLeaderboard(weekStartObj, weekEndObj);
    }

    const selfRank = getUserRank(user.id, weekStartStr);

    // Privacy-compliant public leaderboard view
    const entries = scores.map((s) => {
      const isSelf = s.userId === user.id;
      const u = store.users.get(s.userId);
      const rawName = u?.displayName ?? "Productivity Hero";

      // Anonymize other users according to privacy rules (e.g. "First L.")
      let displayName = rawName;
      if (!isSelf) {
        const parts = rawName.split(" ");
        if (parts.length > 1) {
          displayName = `${parts[0]} ${parts[1][0]}.`;
        }
      }

      return {
        rank: s.rank,
        name: isSelf ? "You" : displayName,
        weeklyXp: s.totalXp,
        isSelf,
      };
    });

    return apiSuccess({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      userRank: selfRank ? { rank: selfRank.rank, weeklyXp: selfRank.totalXp } : null,
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch leaderboard";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
