// ============================================================
// TaskAura — /api/v1/admin/rewards/achievement
// POST: Grant an existing achievement to a user
// Uses existing achievementRepository (duplicate-safe)
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { achievementRepository } from "@/lib/repositories/achievement-repository";

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const achievements = await achievementRepository.listAll();
    return apiSuccess({ achievements });
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;
    const admin = adminCheck as { id: string };

    const body = await req.json();
    const userId = body.userId || body.targetUserId;
    const { achievementId } = body;

    if (!userId || typeof userId !== "string")
      return apiError("BAD_REQUEST", "userId or targetUserId is required", 400);
    if (!achievementId || typeof achievementId !== "string")
      return apiError("BAD_REQUEST", "achievementId is required", 400);

    // Verify both exist
    const [targetUser, achievement] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } }),
      prisma.achievement.findUnique({ where: { id: achievementId }, select: { id: true, name: true } }),
    ]);

    if (!targetUser) return apiError("NOT_FOUND", "Target user not found", 404);
    if (!achievement) return apiError("NOT_FOUND", "Achievement not found", 404);

    // Duplicate-safe unlock via existing repository
    const result = await achievementRepository.unlockAchievement(userId, achievementId);

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: "ACHIEVEMENT_GRANTED",
        targetUserId: userId,
        metadata: JSON.stringify({
          achievementId,
          achievementName: achievement.name,
          wasAlreadyUnlocked: !result.unlocked,
        }),
      },
    });

    return apiSuccess({
      unlocked: result.unlocked,
      alreadyHad: !result.unlocked,
      alreadyUnlocked: !result.unlocked,
      achievement: { id: achievement.id, name: achievement.name },
      targetUser: { id: targetUser.id, displayName: targetUser.displayName },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
