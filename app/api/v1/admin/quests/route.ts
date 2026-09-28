// ============================================================
// TaskAura — /api/v1/admin/quests
// GET: list admin-created quests with assignment counts
// POST: create a new quest (admin forge)
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, apiError, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const VALID_DIFFICULTIES = ["EASY", "NORMAL", "HARD", "EPIC", "LEGENDARY"];
const VALID_STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "EXPIRED"];
const VALID_TARGETS = ["PERSONAL", "SPECIFIC", "GLOBAL"];
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 1000;
const MAX_XP = 10000;

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where = status ? { status } : {};

    const [quests, total] = await Promise.all([
      prisma.quest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          difficulty: true,
          status: true,
          xpReward: true,
          deadline: true,
          targetType: true,
          createdByAdmin: true,
          createdAt: true,
          _count: { select: { questAssignments: true } },
        },
      }),
      prisma.quest.count({ where }),
    ]);

    return apiSuccess({
      quests: quests.map((q) => ({
        ...q,
        assignedCount: q._count.questAssignments,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
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
    const { title, description, difficulty, xpReward, deadline, targetType, status, targetUserIds } = body;

    // Validate
    if (!title || typeof title !== "string" || title.trim().length === 0)
      return apiError("BAD_REQUEST", "Quest title is required", 400);
    if (title.length > MAX_TITLE_LEN)
      return apiError("BAD_REQUEST", `Title must be ≤ ${MAX_TITLE_LEN} characters`, 400);
    if (!description || typeof description !== "string" || description.trim().length === 0)
      return apiError("BAD_REQUEST", "Quest description is required", 400);
    if (description.length > MAX_DESC_LEN)
      return apiError("BAD_REQUEST", `Description must be ≤ ${MAX_DESC_LEN} characters`, 400);
    if (difficulty && !VALID_DIFFICULTIES.includes(difficulty))
      return apiError("BAD_REQUEST", `Difficulty must be one of: ${VALID_DIFFICULTIES.join(", ")}`, 400);
    if (xpReward !== undefined && xpReward !== null) {
      if (!Number.isInteger(xpReward) || xpReward < 0)
        return apiError("BAD_REQUEST", "XP reward must be a non-negative integer", 400);
      if (xpReward > MAX_XP)
        return apiError("BAD_REQUEST", `XP reward must be ≤ ${MAX_XP}`, 400);
    }
    if (status && !VALID_STATUSES.includes(status))
      return apiError("BAD_REQUEST", `Status must be one of: ${VALID_STATUSES.join(", ")}`, 400);
    const resolvedTarget = targetType || "PERSONAL";
    if (!VALID_TARGETS.includes(resolvedTarget))
      return apiError("BAD_REQUEST", `Target type must be one of: ${VALID_TARGETS.join(", ")}`, 400);

    let parsedDeadline: Date | undefined;
    if (deadline) {
      parsedDeadline = new Date(deadline);
      if (isNaN(parsedDeadline.getTime()))
        return apiError("BAD_REQUEST", "Invalid deadline date", 400);
    }

    const quest = await prisma.$transaction(async (tx) => {
      // For GLOBAL quests, userId is set to the admin's own id (the quest belongs to system)
      const createdQuest = await tx.quest.create({
        data: {
          userId: admin.id,
          title: title.trim(),
          description: description.trim(),
          difficulty: difficulty || "NORMAL",
          status: status || "ACTIVE",
          triggeringRule: "ADMIN_CREATED",
          sourceMetrics: "{}",
          xpReward: xpReward ?? null,
          deadline: parsedDeadline ?? null,
          targetType: resolvedTarget,
          createdByAdmin: admin.id,
        },
      });

      // Create assignments based on targetType
      if (resolvedTarget === "GLOBAL") {
        const allUsers = await tx.user.findMany({ select: { id: true } });
        await tx.questAssignment.createMany({
          data: allUsers.map((u) => ({ questId: createdQuest.id, userId: u.id })),
          skipDuplicates: true,
        });
      } else if (resolvedTarget === "SPECIFIC" && Array.isArray(targetUserIds) && targetUserIds.length > 0) {
        await tx.questAssignment.createMany({
          data: targetUserIds.map((uid: string) => ({ questId: createdQuest.id, userId: uid })),
          skipDuplicates: true,
        });
      }

      // Audit log
      await tx.adminAuditLog.create({
        data: {
          adminUserId: admin.id,
          action: "QUEST_CREATED",
          targetQuestId: createdQuest.id,
          metadata: JSON.stringify({
            title: createdQuest.title,
            difficulty: createdQuest.difficulty,
            xpReward: createdQuest.xpReward,
            targetType: resolvedTarget,
            assignedCount: resolvedTarget === "SPECIFIC" ? (targetUserIds?.length ?? 0) : null,
          }),
        },
      });

      return createdQuest;
    });

    return apiSuccess({ quest }, 201);
  } catch (err) {
    return safeCatchError(err);
  }
}
