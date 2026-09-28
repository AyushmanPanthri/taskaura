// ============================================================
// Task Aura — POST /api/v1/tasks/:id/complete
// Server-Authoritative Task Completion & Anti-XP-Farming Pipeline
//
// CORE SECURITY PRINCIPLE:
// The server is authoritative. The client may only request "complete this task".
// Any client-supplied userId, xp, reward, totalXp, level, streakBonus,
// startedAt, completedAt, or elapsedTime are strictly ignored.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { taskRepository } from "@/lib/repositories/task-repository";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    // 1. Authenticate session
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;

    // Optional voluntary mark-done without reward flag.
    // Client-supplied xp, reward, elapsedTime, userId etc. are ignored.
    const body = await req.json().catch(() => ({}));
    const markDoneWithoutReward = body?.markDoneWithoutReward === true;

    // 2. Authoritative completion transaction
    const result = await taskRepository.completeTaskTransaction(user.id, id, {
      markDoneWithoutReward,
    });

    return apiSuccess({
      task: result.task,
      xpAwarded: result.xpAwarded,
      bonusXp: result.bonusXp,
      isDuplicate: result.isDuplicate,
      rejected: result.rejected ?? false,
      reason: result.reason,
      classification: result.classification,
    });
  } catch (err: unknown) {
    const error = err as Error;
    if (error?.message === "Task not found") {
      return apiError("NOT_FOUND", "Task not found", 404);
    }
    if (error?.message?.includes("Cannot complete task with status")) {
      return apiError("INVALID_TRANSITION", error.message, 400);
    }
    if (error?.message?.includes("Daily completion-attempt limit")) {
      return apiError("RATE_LIMIT_EXCEEDED", error.message, 429);
    }
    return safeCatchError(err);
  }
}
