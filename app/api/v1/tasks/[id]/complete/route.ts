// ============================================================
// Task Aura — POST /api/v1/tasks/:id/complete
// Idempotent task completion with authoritative server XP
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { completeTask } from "@/lib/services/task-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const task = store.tasks.get(id);
    if (!task || task.userId !== user.id) {
      return apiError("NOT_FOUND", "Task not found", 404);
    }

    // Server derives streak from authoritative store
    const streakDays = store.streakRecords.get(user.id)?.currentStreak ?? 0;

    // Server completes task and computes authoritative XP
    const result = completeTask(id, streakDays);

    return apiSuccess({
      task: result.task,
      xpAwarded: result.xpAwarded,
      bonusXp: result.bonusXp,
      isDuplicate: result.isDuplicate,
      reason: result.reason,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete task";
    return apiError("BAD_REQUEST", message, 400);
  }
}
