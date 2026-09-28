// ============================================================
// TaskAura — /api/v1/admin/users/[id]
// Single user detail view, update, and delete for Admin.
// SECURITY INVARIANT: passwordHash is NEVER selected, returned,
// logged, or exposed in any response, log line, or audit record.
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { calculateLevel } from "@/lib/logic/xp-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const { id } = await params;
    if (!id) return apiError("BAD_REQUEST", "User ID required", 400);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        email: true,
        isGuest: true,
        role: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        // SECURITY: passwordHash is explicitly NOT selected
        xpTransactions: {
          select: { amount: true, sourceType: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        tasks: {
          select: { id: true, title: true, status: true, difficulty: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        habits: {
          select: { id: true, title: true, frequency: true, streakCurrent: true, streakBest: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        userAchievements: {
          select: { unlockedAt: true, achievement: { select: { name: true, description: true } } },
          orderBy: { unlockedAt: "desc" },
        },
        quests: {
          select: { id: true, title: true, difficulty: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        streakRecord: {
          select: { currentStreak: true, bestStreak: true, lastEligibleDate: true },
        },
      },
    });

    if (!user) return apiError("NOT_FOUND", "User not found", 404);

    const totalXp = user.xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const level = calculateLevel(totalXp);

    return apiSuccess({
      user: {
        id: user.id,
        name: user.displayName || (user.isGuest ? "Guest" : "Adventurer"),
        displayName: user.displayName || (user.isGuest ? "Guest" : "Adventurer"),
        email: user.email,
        isGuest: user.isGuest,
        role: user.role,
        avatar: user.avatar || "🧑‍💻",
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        level,
        totalXp,
        streak: user.streakRecord ?? { currentStreak: 0, bestStreak: 0 },
        recentXp: user.xpTransactions,
        tasks: user.tasks,
        habits: user.habits,
        achievements: user.userAchievements,
        quests: user.quests,
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const { id } = await params;
    if (!id) return apiError("BAD_REQUEST", "User ID required", 400);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return apiError("BAD_REQUEST", "Invalid JSON body", 400);
    }

    // Email updates are strictly out of scope for this endpoint
    if ("email" in body) {
      return apiError("BAD_REQUEST", "Email updates are not allowed via this endpoint", 400);
    }

    // Password updates are forbidden
    if ("password" in body || "passwordHash" in body) {
      return apiError("BAD_REQUEST", "Password updates are strictly forbidden via admin endpoints", 400);
    }

    // Validate role
    if (body.role !== undefined) {
      if (body.role !== "USER" && body.role !== "ADMIN") {
        return apiError("BAD_REQUEST", "Role must be USER or ADMIN", 400);
      }
    }

    // Validate displayName
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || body.displayName.trim().length === 0 || body.displayName.trim().length > 100) {
        return apiError("BAD_REQUEST", "Display name must be a string between 1 and 100 characters", 400);
      }
    }

    // Validate avatar
    if (body.avatar !== undefined) {
      if (typeof body.avatar !== "string" || body.avatar.trim().length === 0 || body.avatar.length > 50) {
        return apiError("BAD_REQUEST", "Avatar must be a string up to 50 characters", 400);
      }
    }

    const hasUpdate = body.displayName !== undefined || body.avatar !== undefined || body.role !== undefined;
    if (!hasUpdate) {
      return apiError("BAD_REQUEST", "At least one of displayName, avatar, or role must be provided", 400);
    }

    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        avatar: true,
        role: true,
        email: true,
        isGuest: true,
      },
    });

    if (!targetUser) return apiError("NOT_FOUND", "User not found", 404);

    const updateData: { displayName?: string; avatar?: string; role?: "USER" | "ADMIN" } = {};
    if (typeof body.displayName === "string") updateData.displayName = body.displayName.trim();
    if (typeof body.avatar === "string") updateData.avatar = body.avatar.trim();
    if (body.role === "USER" || body.role === "ADMIN") updateData.role = body.role;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        displayName: true,
        email: true,
        isGuest: true,
        role: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        // SECURITY: passwordHash is explicitly NOT selected
        streakRecord: { select: { currentStreak: true, bestStreak: true } },
        xpTransactions: { select: { amount: true } },
      },
    });

    // Write to AdminAuditLog
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminCheck.id,
        action: "USER_UPDATED",
        targetUserId: id,
        metadata: JSON.stringify({
          updatedFields: Object.keys(updateData),
          previous: {
            displayName: targetUser.displayName,
            avatar: targetUser.avatar,
            role: targetUser.role,
          },
          current: {
            displayName: updatedUser.displayName,
            avatar: updatedUser.avatar,
            role: updatedUser.role,
          },
        }),
      },
    });

    const totalXp = updatedUser.xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const level = calculateLevel(totalXp);

    return apiSuccess({
      user: {
        id: updatedUser.id,
        name: updatedUser.displayName || (updatedUser.isGuest ? "Guest" : "Adventurer"),
        displayName: updatedUser.displayName || (updatedUser.isGuest ? "Guest" : "Adventurer"),
        email: updatedUser.email,
        isGuest: updatedUser.isGuest,
        role: updatedUser.role,
        avatar: updatedUser.avatar || "🧑‍💻",
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
        level,
        totalXp,
        streak: updatedUser.streakRecord ?? { currentStreak: 0, bestStreak: 0 },
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const { id } = await params;
    if (!id) return apiError("BAD_REQUEST", "User ID required", 400);

    // Prevent an admin from deleting their own account via this endpoint
    if (adminCheck.id === id) {
      return apiError("BAD_REQUEST", "Admin cannot delete their own account via this endpoint", 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isGuest: true,
      },
    });

    if (!targetUser) return apiError("NOT_FOUND", "User not found", 404);

    // Audit log written before deletion
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminCheck.id,
        action: "USER_DELETED",
        targetUserId: id,
        metadata: JSON.stringify({
          deletedUser: {
            id: targetUser.id,
            email: targetUser.email,
            displayName: targetUser.displayName,
            role: targetUser.role,
            isGuest: targetUser.isGuest,
          },
        }),
      },
    });

    // Delete user — cascades per schema onDelete: Cascade
    await prisma.user.delete({
      where: { id },
    });

    return apiSuccess({
      deleted: true,
      id,
      message: `User ${targetUser.email || targetUser.displayName || id} deleted successfully`,
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
