// ============================================================
// LifeXP — Task Service
// Maps to Logic System File v2 §7
// Combines task engine logic + persistence
// ============================================================

import { store } from "./store";
import { awardXp } from "./xp-service";
import {
  validateTaskTransition,
  getExpiredTasks,
  isTerminalState,
} from "../logic/task-engine";
import type { Task } from "../logic/types";
import {
  Difficulty,
  TaskSource,
  TaskStatus,
  XPSourceType,
} from "../logic/types";

/**
 * Create a new task.
 */
export function createTask(params: {
  userId: string;
  title: string;
  description?: string;
  difficulty?: Difficulty;
  dueAt?: Date;
  source?: TaskSource;
  questId?: string;
}): Task {
  const task: Task = {
    id: crypto.randomUUID(),
    userId: params.userId,
    title: params.title,
    description: params.description ?? null,
    difficulty: params.difficulty ?? Difficulty.NORMAL,
    status: TaskStatus.PENDING,
    dueAt: params.dueAt ?? null,
    completedAt: null,
    source: params.source ?? TaskSource.USER,
    questId: params.questId ?? null,
    createdAt: new Date(),
  };

  store.tasks.set(task.id, task);
  return task;
}

/**
 * §7 — Update task status with state machine validation.
 *
 * Returns the updated task or throws if transition is invalid.
 */
export function updateTaskStatus(
  taskId: string,
  targetStatus: TaskStatus
): Task {
  const task = store.tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (!validateTaskTransition(task.status, targetStatus)) {
    throw new Error(
      `Invalid transition: ${task.status} → ${targetStatus}`
    );
  }

  const updatedTask: Task = {
    ...task,
    status: targetStatus,
    completedAt:
      targetStatus === TaskStatus.COMPLETED ? new Date() : task.completedAt,
  };

  store.tasks.set(taskId, updatedTask);
  return updatedTask;
}

/**
 * §7 v2 — Complete a task and award XP (idempotent).
 *
 * POST /tasks/:id/complete must be safe to call twice.
 * Enforced via unique constraint on xp_transactions.
 */
export function completeTask(
  taskId: string,
  streakDays: number = 0
): { task: Task; xpAwarded: number; isDuplicate: boolean } {
  const task = store.tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // If already completed, this is idempotent
  if (task.status === TaskStatus.COMPLETED) {
    const existingXp = Array.from(store.xpTransactions.values()).find(
      (tx) =>
        tx.sourceType === XPSourceType.TASK && tx.sourceId === taskId
    );
    return {
      task,
      xpAwarded: existingXp?.amount ?? 0,
      isDuplicate: true,
    };
  }

  // Transition to completed
  const updatedTask = updateTaskStatus(taskId, TaskStatus.COMPLETED);

  // Award XP (idempotent via idempotency key)
  const sourceType =
    task.source === TaskSource.AI
      ? XPSourceType.AI_QUEST
      : XPSourceType.TASK;

  const { transaction, isNew } = awardXp({
    userId: task.userId,
    sourceType,
    sourceId: taskId,
    difficulty: task.difficulty,
    streakDays,
  });

  return {
    task: updatedTask,
    xpAwarded: transaction.amount,
    isDuplicate: !isNew,
  };
}

/**
 * §7 v2 — Expire tasks past their due date (scheduled job).
 *
 * Tasks past `due_at` transition to EXPIRED via a periodic job,
 * not by checking ad hoc on every read.
 */
export function expireOverdueTasks(): Task[] {
  const now = new Date();
  const allTasks = Array.from(store.tasks.values());
  const expired = getExpiredTasks(allTasks, now);

  for (const task of expired) {
    updateTaskStatus(task.id, TaskStatus.EXPIRED);
  }

  return expired;
}

/**
 * Get a user's tasks, optionally filtered by status.
 */
export function getUserTasks(
  userId: string,
  status?: TaskStatus
): Task[] {
  const tasks = store.getUserTasks(userId);
  return status ? tasks.filter((t) => t.status === status) : tasks;
}

/**
 * Get a single task by ID.
 */
export function getTask(taskId: string): Task | undefined {
  return store.tasks.get(taskId);
}
