// ============================================================
// Task Aura — POST /api/v1/tasks/:id/start
// Explicit server-authoritative task start transition
// Records startedAt using server clock
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { taskRepository } from "@/lib/repositories/task-repository";

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
    const task = await taskRepository.startTask(user.id, id);

    return apiSuccess({
      task,
      startedAt: task.startedAt,
    });
  } catch (err: unknown) {
    const error = err as Error;
    if (error?.message === "Task not found") {
      return apiError("NOT_FOUND", "Task not found", 404);
    }
    if (error?.message?.includes("Cannot start task in status")) {
      return apiError("INVALID_STATE", error.message, 400);
    }
    return safeCatchError(err);
  }
}
