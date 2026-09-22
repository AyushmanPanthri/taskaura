// ============================================================
// TaskAura — /api/v1/admin/users
// Admin Read-Only Endpoint: Lists all users with progression metrics.
// Strictly requires ADMIN role; rejects non-admins with 403 Forbidden.
// SECURITY INVARIANT: Never exposes passwordHash.
// ============================================================

import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { store } from "@/lib/services/store";
import { calculateLevel } from "@/lib/logic/xp-engine";

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) {
      return adminCheck;
    }

    // Query all users from PostgreSQL
    // SECURITY INVARIANT: passwordHash is explicitly NOT selected.
    const rawUsers = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        email: true,
        isGuest: true,
        role: true,
        avatar: true,
        createdAt: true,
      },
    });

    const users = rawUsers.map((u) => {
      const totalXp = store.getTotalXp(u.id);
      const level = calculateLevel(totalXp);
      const name = u.displayName || (u.isGuest ? "Guest" : "Adventurer");
      return {
        id: u.id,
        name,
        displayName: name,
        email: u.email,
        isGuest: u.isGuest,
        role: u.role,
        avatar: u.avatar || "🧑‍💻",
        createdAt: u.createdAt.toISOString(),
        level,
        totalXp,
      };
    });

    return apiSuccess({ users });
  } catch (err) {
    return safeCatchError(err);
  }
}
