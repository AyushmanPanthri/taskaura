// ============================================================
// Task Aura — /api/v1/tasks
// GET:  List user tasks  (PostgreSQL — taskRepository)
// POST: Create a new task (PostgreSQL — taskRepository)
//
// MIGRATION (Stage 3): Previously read/wrote to InMemoryStore.
// Now uses taskRepository (Prisma) for durable PostgreSQL persistence.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { taskRepository } from "@/lib/repositories/task-repository";
import { Difficulty, TaskStatus } from "@/lib/logic/types";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status") as TaskStatus | null;

    const tasks = await taskRepository.listTasks(user.id, statusFilter ? { status: statusFilter } : undefined);

    return apiSuccess(tasks);
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      return apiError("INVALID_INPUT", "Task title is required", 400);
    }

    const difficulty = body.difficulty
      ? (body.difficulty.toUpperCase() as Difficulty)
      : Difficulty.NORMAL;

    const estimatedMinutes =
      body.estimatedMinutes !== undefined && body.estimatedMinutes !== null
        ? Number(body.estimatedMinutes)
        : undefined;

    const task = await taskRepository.createTask(user.id, {
      title: body.title.trim(),
      description: body.description ? String(body.description).trim() : null,
      difficulty,
      estimatedMinutes,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    });

    return apiSuccess(task, 201);
  } catch (err: unknown) {
    const error = err as Error;
    if (
      error?.message?.includes("Daily task creation limit") ||
      error?.message?.includes("require an estimated duration")
    ) {
      return apiError("INVALID_INPUT", error.message, 400);
    }
    return safeCatchError(err);
  }
}
