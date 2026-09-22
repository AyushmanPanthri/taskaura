// ============================================================
// Task Aura — /api/v1/tasks/:id
// GET:   Fetch single task
// PATCH: Update task details or transition status
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { updateTaskStatus } from "@/lib/services/task-service";
import { TaskStatus } from "@/lib/logic/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
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

    return apiSuccess(task);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch task";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
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

    // Terminal states cannot be edited
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED ||
      task.status === TaskStatus.EXPIRED
    ) {
      return apiError("INVALID_STATE", `Cannot update task in terminal state (${task.status})`, 400);
    }

    const body = await req.json().catch(() => ({}));

    // If status transition requested
    if (body.status && body.status !== task.status) {
      const targetStatus = body.status as TaskStatus;
      updateTaskStatus(id, targetStatus);
    }

    // Update allowable metadata fields
    const updated = store.tasks.get(id)!;
    if (typeof body.title === "string" && body.title.trim()) {
      updated.title = body.title.trim();
    }
    if (body.description !== undefined) {
      updated.description = body.description ? String(body.description).trim() : null;
    }
    if (body.dueAt !== undefined) {
      updated.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    }
    store.tasks.set(id, updated);

    return apiSuccess(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update task";
    return apiError("BAD_REQUEST", message, 400);
  }
}
