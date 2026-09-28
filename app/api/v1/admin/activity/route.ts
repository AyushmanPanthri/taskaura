// ============================================================
// TaskAura — /api/v1/admin/activity
// GET: Paginated admin audit log
// Never returns passwords, hashes, or session tokens
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.adminAuditLog.count(),
    ]);

    // Resolve admin display names in batch
    const adminIds = [...new Set(logs.map((l) => l.adminUserId))];
    const admins = await prisma.user.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, displayName: true, avatar: true },
    });
    const adminMap = new Map(admins.map((a) => [a.id, a]));

    // Resolve target user display names
    const targetIds = [...new Set(logs.map((l) => l.targetUserId).filter(Boolean))] as string[];
    const targets = targetIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, displayName: true },
    }) : [];
    const targetMap = new Map(targets.map((t) => [t.id, t]));

    const enriched = logs.map((log) => ({
      id: log.id,
      action: log.action,
      adminUserId: log.adminUserId,
      adminName: adminMap.get(log.adminUserId)?.displayName ?? "Unknown",
      adminAvatar: adminMap.get(log.adminUserId)?.avatar ?? "👑",
      targetUserId: log.targetUserId,
      targetUserName: log.targetUserId ? (targetMap.get(log.targetUserId)?.displayName ?? "Unknown") : null,
      targetQuestId: log.targetQuestId,
      metadata: (() => {
        try { return JSON.parse(log.metadata); } catch { return {}; }
      })(),
      createdAt: log.createdAt,
    }));

    return apiSuccess({
      logs: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
