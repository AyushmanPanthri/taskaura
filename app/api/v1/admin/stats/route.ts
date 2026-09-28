// ============================================================
// TaskAura — /api/v1/admin/stats
// System-wide telemetry for Admin Headquarters overview.
// ADMIN only. Never exposes passwords or session tokens.
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    // Run all aggregations in parallel
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      guestUsers,
      totalXpAgg,
      totalQuests,
      activeQuests,
      completedQuests,
      totalAchievements,
      newUsersThisWeek,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isGuest: true } }),
      prisma.xPTransaction.aggregate({ _sum: { amount: true } }),
      prisma.quest.count(),
      prisma.quest.count({ where: { status: "ACTIVE" } }),
      prisma.quest.count({ where: { status: "COMPLETED" } }),
      prisma.userAchievement.count(),
      prisma.user.count({ where: { createdAt: { gte: oneWeekAgo } } }),
    ]);

    const registeredUsers = totalUsers - guestUsers;
    const totalXp = totalXpAgg._sum.amount ?? 0;

    return apiSuccess({
      totalUsers,
      registeredUsers,
      guestUsers,
      newUsersThisWeek,
      totalQuests,
      activeQuests,
      completedQuests,
      totalXp,
      totalAchievements,
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
