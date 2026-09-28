// ============================================================
// TaskAura — /api/v1/admin/quests/[id]/assign
// POST: assign quest to users (SPECIFIC | GLOBAL)
// Server-side fan-out — never client-filtered
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;
    const admin = adminCheck as { id: string };

    const { id: questId } = await params;
    const body = await req.json();
    const { targetType, userIds } = body;

    const quest = await prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) return apiError("NOT_FOUND", "Quest not found", 404);

    let assignedCount = 0;

    await prisma.$transaction(async (tx) => {
      if (targetType === "GLOBAL") {
        const allUsers = await tx.user.findMany({ select: { id: true } });
        await tx.questAssignment.createMany({
          data: allUsers.map((u) => ({ questId, userId: u.id })),
          skipDuplicates: true,
        });
        assignedCount = allUsers.length;

        await tx.quest.update({
          where: { id: questId },
          data: { targetType: "GLOBAL" },
        });
      } else if (targetType === "SPECIFIC" || targetType === "MULTIPLE") {
        if (!Array.isArray(userIds) || userIds.length === 0)
          throw new Error("userIds array required for SPECIFIC/MULTIPLE assignment");

        // Validate all userIds exist
        const existingUsers = await tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true },
        });
        if (existingUsers.length !== userIds.length)
          throw new Error("One or more user IDs do not exist");

        await tx.questAssignment.createMany({
          data: userIds.map((uid: string) => ({ questId, userId: uid })),
          skipDuplicates: true,
        });
        assignedCount = userIds.length;
      } else {
        throw new Error("targetType must be GLOBAL, SPECIFIC, or MULTIPLE");
      }

      await tx.adminAuditLog.create({
        data: {
          adminUserId: admin.id,
          action: "QUEST_ASSIGNED",
          targetQuestId: questId,
          metadata: JSON.stringify({
            targetType,
            assignedCount,
            questTitle: quest.title,
          }),
        },
      });
    });

    return apiSuccess({ questId, assignedCount, targetType });
  } catch (err) {
    if (err instanceof Error && (
      err.message.includes("userIds array required") ||
      err.message.includes("do not exist") ||
      err.message.includes("targetType must be")
    )) {
      return apiError("BAD_REQUEST", err.message, 400);
    }
    return safeCatchError(err);
  }
}
