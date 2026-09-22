// ============================================================
// Task Aura — POST /api/v1/tasks/:id/cancel
// Terminal cancellation for tasks
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { updateTaskStatus } from "@/lib/services/task-service";
import { TaskStatus } from "@/lib/logic/types";

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

    const updatedTask = updateTaskStatus(id, TaskStatus.CANCELLED);
    return apiSuccess(updatedTask);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel task";
    return apiError("BAD_REQUEST", message, 400);
  }
}
