// ============================================================
// Task Aura — POST /api/v1/tasks/:id/cancel
// Terminal cancellation for tasks
//
// MIGRATION (Stage 3): Previously read/wrote to InMemoryStore.
// Now uses taskRepository (Prisma) for durable PostgreSQL persistence.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { taskRepository } from "@/lib/repositories/task-repository";
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
    const task = await taskRepository.findById(user.id, id);
    if (!task) {
      return apiError("NOT_FOUND", "Task not found", 404);
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED ||
      task.status === TaskStatus.EXPIRED
    ) {
      return apiError(
        "INVALID_STATE",
        `Cannot cancel task in terminal state (${task.status})`,
        400
      );
    }

    const updated = await taskRepository.updateTask(user.id, id, {
      status: TaskStatus.CANCELLED,
    });

    return apiSuccess(updated);
  } catch (err) {
    return safeCatchError(err);
  }
}
