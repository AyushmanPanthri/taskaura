// ============================================================
// LifeXP — Task Engine
// Maps to Logic System File v2 §7
// Pure functions — no side effects, no DB access
// ============================================================

import type { Task } from "./types";
import { TaskStatus } from "./types";

// ── §7 — State Machine ──────────────────────────────────────

/**
 * Valid state transitions for tasks:
 *
 * PENDING → IN_PROGRESS → COMPLETED
 *    └──────────────────→ CANCELLED / EXPIRED
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]: [
    TaskStatus.IN_PROGRESS,
    TaskStatus.CANCELLED,
    TaskStatus.EXPIRED,
  ],
  [TaskStatus.IN_PROGRESS]: [
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
    TaskStatus.EXPIRED,
  ],
  [TaskStatus.COMPLETED]: [], // terminal state
  [TaskStatus.CANCELLED]: [], // terminal state
  [TaskStatus.EXPIRED]: [],   // terminal state
};

/**
 * §7 — Validate a task status transition.
 *
 * Returns true if the transition is allowed by the state machine.
 */
export function validateTaskTransition(
  currentStatus: TaskStatus,
  targetStatus: TaskStatus
): boolean {
  return VALID_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false;
}

/**
 * §7 v2 — Find tasks that should be expired.
 *
 * Tasks past `due_at` transition to EXPIRED via a periodic job,
 * not by checking "is this task expired?" ad hoc on every read.
 * This keeps task-state queries fast and consistent.
 */
export function getExpiredTasks(tasks: Task[], now: Date): Task[] {
  return tasks.filter((task) => {
    if (
      task.status !== TaskStatus.PENDING &&
      task.status !== TaskStatus.IN_PROGRESS
    ) {
      return false;
    }
    if (!task.dueAt) return false;
    return task.dueAt.getTime() < now.getTime();
  });
}

/**
 * Check if a task is in a terminal state (no further transitions possible).
 */
export function isTerminalState(status: TaskStatus): boolean {
  return VALID_TRANSITIONS[status]?.length === 0;
}

/**
 * Get allowed next states for a task.
 */
export function getAllowedTransitions(
  currentStatus: TaskStatus
): TaskStatus[] {
  return VALID_TRANSITIONS[currentStatus] ?? [];
}
