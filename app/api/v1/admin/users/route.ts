// ============================================================
// TaskAura — /api/v1/admin/users
// Admin Read-Only Endpoint: Lists all users with progression metrics.
// Now supports: ?search= ?role= ?accountType= ?page= ?limit=
// XP is read from PostgreSQL xp_transactions (not in-memory store).
// SECURITY INVARIANT: Never exposes passwordHash or session tokens.
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { calculateLevel } from "@/lib/logic/xp-engine";

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const url = new URL(req.url);
    const search = url.searchParams.get("search")?.trim() || undefined;
    const role = url.searchParams.get("role") || undefined;
    const accountType = url.searchParams.get("accountType") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = {};
    if (role === "ADMIN") where.role = "ADMIN";
    else if (role === "USER") where.role = "USER";
    if (accountType === "guest") where.isGuest = true;
    else if (accountType === "registered") where.isGuest = false;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rawUsers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          displayName: true,
          email: true,
          isGuest: true,
          role: true,
          avatar: true,
          createdAt: true,
          // SECURITY INVARIANT: passwordHash is explicitly NOT selected
          _count: { select: { tasks: true, habits: true } },
          streakRecord: { select: { currentStreak: true, bestStreak: true } },
          xpTransactions: { select: { amount: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const users = rawUsers.map((u) => {
      const totalXp = u.xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      const level = calculateLevel(totalXp);
      return {
        id: u.id,
        name: u.displayName || (u.isGuest ? "Guest" : "Adventurer"),
        displayName: u.displayName || (u.isGuest ? "Guest" : "Adventurer"),
        email: u.email,
        isGuest: u.isGuest,
        role: u.role,
        avatar: u.avatar || "🧑‍💻",
        createdAt: u.createdAt.toISOString(),
        level,
        totalXp,
        streak: u.streakRecord?.currentStreak ?? 0,
        taskCount: u._count.tasks,
        habitCount: u._count.habits,
      };
    });

    return apiSuccess({
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
