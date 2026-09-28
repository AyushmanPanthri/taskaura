// ============================================================
// TaskAura — /api/v1/admin/quests/[id]
// GET: single quest detail
// PATCH: edit quest metadata
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const VALID_DIFFICULTIES = ["EASY", "NORMAL", "HARD", "EPIC", "LEGENDARY"];
const VALID_STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "EXPIRED"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const { id } = await params;
    const quest = await prisma.quest.findUnique({
      where: { id },
      include: {
        _count: { select: { questAssignments: true } },
        questAssignments: {
          select: {
            userId: true,
            assignedAt: true,
            user: { select: { displayName: true, avatar: true, email: true } },
          },
          take: 50,
        },
      },
    });

    if (!quest) return apiError("NOT_FOUND", "Quest not found", 404);

    return apiSuccess({
      quest: {
        ...quest,
        assignedCount: quest._count.questAssignments,
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
    const admin = adminCheck as { id: string };

    const { id } = await params;
    const body = await req.json();
    const { title, description, difficulty, xpReward, deadline, status } = body;

    const existing = await prisma.quest.findUnique({ where: { id } });
    if (!existing) return apiError("NOT_FOUND", "Quest not found", 404);

    // Validate supplied fields
    if (title !== undefined && (typeof title !== "string" || title.trim().length === 0))
      return apiError("BAD_REQUEST", "Title cannot be empty", 400);
    if (difficulty !== undefined && !VALID_DIFFICULTIES.includes(difficulty))
      return apiError("BAD_REQUEST", "Invalid difficulty", 400);
    if (status !== undefined && !VALID_STATUSES.includes(status))
      return apiError("BAD_REQUEST", "Invalid status", 400);
    if (xpReward !== undefined && xpReward !== null && (!Number.isInteger(xpReward) || xpReward < 0))
      return apiError("BAD_REQUEST", "XP reward must be a non-negative integer", 400);

    let parsedDeadline: Date | null | undefined;
    if (deadline === null) parsedDeadline = null;
    else if (deadline !== undefined) {
      parsedDeadline = new Date(deadline);
      if (isNaN(parsedDeadline.getTime()))
        return apiError("BAD_REQUEST", "Invalid deadline date", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const quest = await tx.quest.update({
        where: { id },
        data: {
          ...(title !== undefined && { title: title.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          ...(difficulty !== undefined && { difficulty }),
          ...(status !== undefined && { status }),
          ...(xpReward !== undefined && { xpReward }),
          ...(parsedDeadline !== undefined && { deadline: parsedDeadline }),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId: admin.id,
          action: "QUEST_UPDATED",
          targetQuestId: id,
          metadata: JSON.stringify({ updatedFields: Object.keys(body) }),
        },
      });

      return quest;
    });

    return apiSuccess({ quest: updated });
  } catch (err) {
    return safeCatchError(err);
  }
}
