// ============================================================
// Task Aura — /api/v1/tasks/:id
// GET:   Fetch single task
// PATCH: Update task details or transition status
//
// MIGRATION (Stage 3): Previously read/wrote to InMemoryStore.
// Now uses taskRepository (Prisma) for durable PostgreSQL persistence.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { taskRepository } from "@/lib/repositories/task-repository";
import { Difficulty, TaskStatus } from "@/lib/logic/types";

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
    const task = await taskRepository.findById(user.id, id);
    if (!task) {
      return apiError("NOT_FOUND", "Task not found", 404);
    }

    return apiSuccess(task);
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
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

    // Terminal states cannot be edited
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED ||
      task.status === TaskStatus.EXPIRED
    ) {
      return apiError(
        "INVALID_STATE",
        `Cannot update task in terminal state (${task.status})`,
        400
      );
    }

    const body = await req.json().catch(() => ({}));

    // Immutability after start: difficulty and estimated duration cannot be modified once IN_PROGRESS
    if (task.status !== TaskStatus.PENDING) {
      if (
        (body.difficulty && body.difficulty !== task.difficulty) ||
        (body.estimatedMinutes !== undefined &&
          Number(body.estimatedMinutes) !== task.estimatedMinutes)
      ) {
        return apiError(
          "IMMUTABLE_FIELD",
          "Reward-relevant fields (difficulty, estimated duration) become immutable once a task is started",
          400
        );
      }
    }

    const updates: {
      title?: string;
      description?: string | null;
      difficulty?: Difficulty;
      estimatedMinutes?: number;
      status?: TaskStatus;
      dueAt?: Date | null;
    } = {};

    if (typeof body.title === "string" && body.title.trim()) {
      updates.title = body.title.trim();
    }
    if (body.description !== undefined) {
      updates.description = body.description
        ? String(body.description).trim()
        : null;
    }
    if (body.difficulty && task.status === TaskStatus.PENDING) {
      updates.difficulty = body.difficulty.toUpperCase() as Difficulty;
    }
    if (body.estimatedMinutes !== undefined && task.status === TaskStatus.PENDING) {
      updates.estimatedMinutes = Number(body.estimatedMinutes);
    }
    if (body.dueAt !== undefined) {
      updates.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    }
    if (body.status && body.status !== task.status) {
      updates.status = body.status as TaskStatus;
    }

    const updated = await taskRepository.updateTask(user.id, id, updates);
    if (!updated) {
      return apiError("NOT_FOUND", "Task not found", 404);
    }

    return apiSuccess(updated);
  } catch (err: unknown) {
    const error = err as Error;
    if (
      error?.message?.includes("cannot be modified") ||
      error?.message?.includes("immutable")
    ) {
      return apiError("IMMUTABLE_FIELD", error.message, 400);
    }
    return safeCatchError(err);
  }
}
