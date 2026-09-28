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
    TaskStatus.COMPLETED,
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

/**
 * Enforce reward-relevant field immutability:
 * Difficulty, estimated duration, and source cannot be changed once
 * a task enters IN_PROGRESS or is in a terminal state.
 */
export function canModifyRewardFields(status: TaskStatus): boolean {
  return status === TaskStatus.PENDING;
}

/**
 * Validate whether a task mutation attempts to alter reward-critical
 * fields after work has commenced.
 */
export function validateRewardFieldImmutability(
  currentTask: { status: TaskStatus; difficulty: string; estimatedMinutes?: number | null },
  updates: { difficulty?: string; estimatedMinutes?: number | null }
): { allowed: boolean; reason?: string } {
  if (canModifyRewardFields(currentTask.status)) {
    return { allowed: true };
  }

  const difficultyChanged =
    updates.difficulty !== undefined && updates.difficulty !== currentTask.difficulty;
  const durationChanged =
    updates.estimatedMinutes !== undefined &&
    updates.estimatedMinutes !== currentTask.estimatedMinutes;

  if (difficultyChanged || durationChanged) {
    return {
      allowed: false,
      reason: `Reward-relevant fields (difficulty, estimated duration) become immutable once a task enters ${currentTask.status}.`,
    };
  }

  return { allowed: true };
}

/**
 * Validates whether a task meets server-authoritative state requirements
 * to earn XP upon completion.
 *
 * Decision 1 (Require Start):
 * A task MUST transition through IN_PROGRESS with a server-clock startedAt
 * to be eligible for XP. Completing directly from PENDING yields 0 XP.
 */
export function validateTaskXpEligibility(task: {
  status: TaskStatus;
  startedAt?: Date | null;
}): { eligible: boolean; reason?: "NEVER_STARTED" | "INVALID_STATE" } {
  if (task.status === TaskStatus.PENDING || !task.startedAt) {
    return { eligible: false, reason: "NEVER_STARTED" };
  }

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return { eligible: false, reason: "INVALID_STATE" };
  }

  return { eligible: true };
}
