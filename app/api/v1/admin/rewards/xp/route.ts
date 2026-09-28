// ============================================================
// TaskAura — /api/v1/admin/rewards/xp
// POST: Grant XP to a user via the existing idempotent XP ledger
// Uses XPSourceType.ADJUSTMENT so existing economy is respected
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { xpRepository } from "@/lib/repositories/xp-repository";
import { XPSourceType, RewardType } from "@/lib/logic/types";
import { generateIdempotencyKey } from "@/lib/logic/xp-engine";

const MAX_XP_GRANT = 10000;
const MAX_REASON_LEN = 500;

export async function POST(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;
    const admin = adminCheck as { id: string };

    const body = await req.json();
    const userId = body.userId || body.targetUserId;
    const { amount, reason } = body;

    if (!userId || typeof userId !== "string")
      return apiError("BAD_REQUEST", "userId or targetUserId is required", 400);
    if (!Number.isInteger(amount) || amount <= 0)
      return apiError("BAD_REQUEST", "amount must be a positive integer", 400);
    if (amount > MAX_XP_GRANT)
      return apiError("BAD_REQUEST", `XP grant cannot exceed ${MAX_XP_GRANT}`, 400);
    if (!reason || typeof reason !== "string" || reason.trim().length === 0)
      return apiError("BAD_REQUEST", "reason is required", 400);
    if (reason.length > MAX_REASON_LEN)
      return apiError("BAD_REQUEST", `Reason must be ≤ ${MAX_REASON_LEN} characters`, 400);

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true },
    });
    if (!targetUser) return apiError("NOT_FOUND", "Target user not found", 404);

    // Use timestamp-based source ID to allow repeated grants (each is unique)
    const sourceId = `admin-grant:${admin.id}:${userId}:${Date.now()}`;
    const idempotencyKey = generateIdempotencyKey(
      XPSourceType.ADJUSTMENT,
      sourceId,
      RewardType.ADJUSTMENT
    );

    const result = await xpRepository.recordTransaction({
      userId,
      amount,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId,
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey,
      baseXp: amount,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: "XP_GRANTED",
        targetUserId: userId,
        metadata: JSON.stringify({
          amount,
          reason: reason.trim(),
          transactionId: result.transaction.id,
          isDuplicate: result.isDuplicate,
        }),
      },
    });

    return apiSuccess({
      granted: !result.isDuplicate,
      amount: result.transaction.amount,
      transaction: {
        id: result.transaction.id,
        amount: result.transaction.amount,
        createdAt: result.transaction.createdAt,
      },
      targetUser: { id: targetUser.id, displayName: targetUser.displayName },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
