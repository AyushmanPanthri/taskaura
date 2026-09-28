// ============================================================
// Task Aura — GET /api/v1/leaderboard
// Returns authoritative weekly leaderboard (UTC Monday-Sunday)
//
// MIGRATION (Stage 4): Previously read from InMemoryStore.weeklyScores
// which was populated by snapshotLeaderboard() — another in-memory
// function. Now reads directly from PostgreSQL using aggregate queries:
//   - SUM(xp_transactions.amount) per user for the current week
//   - Joined with user display names from the users table
// This correctly reflects all XP: player-earned AND admin-granted.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
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

    // End of week day (inclusive — next Monday 00:00 UTC is exclusive)
    const weekEndExclusive = new Date(weekEndObj);
    weekEndExclusive.setDate(weekEndExclusive.getDate() + 1);

    // Aggregate XP per user for this week from PostgreSQL xp_transactions
    // Only include real users (not guests) for the public leaderboard
    const weeklyXpRows = await prisma.xPTransaction.groupBy({
      by: ["userId"],
      where: {
        createdAt: {
          gte: weekStartObj,
          lt: weekEndExclusive,
        },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 100,
    });

    if (weeklyXpRows.length === 0) {
      return apiSuccess({
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        userRank: null,
        entries: [],
      });
    }

    // Fetch display names for all users on the leaderboard
    const leaderboardUserIds = weeklyXpRows.map((r) => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: leaderboardUserIds }, isGuest: false },
      select: { id: true, displayName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.displayName]));

    // Build ranked entries (only non-guest users)
    let rank = 0;
    let selfRank: { rank: number; weeklyXp: number } | null = null;
    const entries: {
      rank: number;
      name: string;
      weeklyXp: number;
      isSelf: boolean;
    }[] = [];

    for (const row of weeklyXpRows) {
      // Skip guests (not in userMap)
      if (!userMap.has(row.userId)) continue;

      rank++;
      const isSelf = row.userId === user.id;
      const weeklyXp = row._sum.amount ?? 0;
      const rawName = userMap.get(row.userId) ?? "Productivity Hero";

      // Anonymize other users' names (privacy): "Firstname L."
      let displayName = rawName;
      if (!isSelf) {
        const parts = rawName.split(" ");
        if (parts.length > 1) {
          displayName = parts[0] + ' ' + parts[1][0] + '.';
        } else {
          // Single-word name: use first 6 chars + dot to stay anonymized
          displayName = parts[0].slice(0, 6) + '.';
        }
      }

      if (isSelf) {
        selfRank = { rank, weeklyXp };
      }

      entries.push({
        rank,
        name: isSelf ? "You" : displayName,
        weeklyXp,
        isSelf,
      });
    }

    return apiSuccess({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      userRank: selfRank,
      entries,
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
