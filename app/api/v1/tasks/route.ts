// ============================================================
// Task Aura — /api/v1/tasks
// GET:  List user tasks
// POST: Create a new task (server owns XP calculation & status)
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { createTask } from "@/lib/services/task-service";
import { Difficulty } from "@/lib/logic/types";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    let tasks = store.getUserTasks(user.id);
    if (statusFilter) {
      tasks = tasks.filter((t) => t.status === statusFilter);
    }

    // Sort newest first
    tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return apiSuccess(tasks);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch tasks";
    return apiError("INTERNAL_ERROR", message, 500);
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

    // Client cannot provide: xp, rewardXp, totalXp, status, userId. Server owns all of them.
    const difficulty = body.difficulty ? (body.difficulty.toUpperCase() as Difficulty) : Difficulty.NORMAL;
    const estimatedMinutes = typeof body.estimatedMinutes === "number" ? body.estimatedMinutes : 30;
    const dueAt = body.dueAt ? new Date(body.dueAt) : undefined;

    const task = createTask({
      userId: user.id,
      title: body.title.trim(),
      description: body.description ? String(body.description).trim() : undefined,
      difficulty,
      estimatedMinutes,
      dueAt,
    });

    return apiSuccess(task, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create task";
    return apiError("BAD_REQUEST", message, 400);
  }
}
