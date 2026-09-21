// ============================================================
// Task Aura — Task Service
// Maps to Logic System File v2 §7 (tasks) and §9 (XP engine)
// Combines task engine logic + persistence
// ============================================================

import { store } from "./store";
import {
  awardPayout,
  getUserTimeZone,
  maybeGrantDailyBonuses,
} from "./xp-service";
import {
  ECONOMY,
  clampDifficulty,
  focusCreditedMinutes,
  localDateString,
  payoutKey,
} from "../logic/economy";
import type { RootType } from "../logic/economy";
import { validateFocusSession } from "../logic/focus-engine";
import {
  validateTaskTransition,
  getExpiredTasks,
} from "../logic/task-engine";
import type { FocusSession, Task } from "../logic/types";
import {
  Difficulty,
  FocusSessionStatus,
  TaskSource,
  TaskStatus,
  XPSourceType,
} from "../logic/types";

export type NoXpReason = "TOO_FAST" | "SELF_CONFIRMED_LIMIT";

/** Root activity that gets paid: a quest (if the task belongs to one) or the task itself. */
export function taskRootRef(task: Task): { type: RootType; id: string } {
  return task.questId
    ? { type: "QUEST", id: task.questId }
    : { type: "TASK", id: task.id };
}

/**
 * Create a new task.
 *
 * User-created tasks are limited to 20 per local day, and a HARD / EPIC tier
 * is only honoured for work of 45 / 90+ minutes (otherwise NORMAL).
 */
export function createTask(params: {
  userId: string;
  title: string;
  description?: string;
  difficulty?: Difficulty;
  /** Planned effort, 5–240 min. Defaults to 30. */
  estimatedMinutes?: number;
  dueAt?: Date;
  source?: TaskSource;
  questId?: string;
}): Task {
  const source = params.source ?? TaskSource.USER;
  const now = new Date();

  const minutes = params.estimatedMinutes ?? ECONOMY.taskDefaultMinutes;
  if (
    !Number.isFinite(minutes) ||
    minutes < ECONOMY.taskMinMinutes ||
    minutes > ECONOMY.taskMaxMinutes
  ) {
    throw new Error(
      `estimatedMinutes must be between ${ECONOMY.taskMinMinutes} and ${ECONOMY.taskMaxMinutes}`
    );
  }

  let difficulty = params.difficulty ?? Difficulty.NORMAL;
  if (source === TaskSource.USER) {
    const tz = getUserTimeZone(params.userId);
    const today = localDateString(now, tz);
    const createdToday = store
      .getUserTasks(params.userId)
      .filter(
        (t) =>
          t.source === TaskSource.USER &&
          localDateString(t.createdAt, tz) === today
      ).length;
    if (createdToday >= ECONOMY.tasksCreatedPerDay) {
      throw new Error(
        `Daily task limit reached (${ECONOMY.tasksCreatedPerDay} per day)`
      );
    }
    difficulty = clampDifficulty(String(difficulty), minutes) as unknown as Difficulty;
  }

  const task: Task = {
    id: crypto.randomUUID(),
    userId: params.userId,
    title: params.title,
    description: params.description ?? null,
    difficulty,
    estimatedMinutes: minutes,
    status: TaskStatus.PENDING,
    dueAt: params.dueAt ?? null,
    completedAt: null,
    source,
    questId: params.questId ?? null,
    createdAt: now,
  };

  store.tasks.set(task.id, task);
  return task;
}

/**
 * §7 — Update task status with state machine validation.
 * Returns the updated task or throws if the transition is invalid.
 */
export function updateTaskStatus(
  taskId: string,
  targetStatus: TaskStatus,
  now: Date = new Date()
): Task {
  const task = store.tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (!validateTaskTransition(task.status, targetStatus)) {
    throw new Error(`Invalid transition: ${task.status} → ${targetStatus}`);
  }

  const updatedTask: Task = {
    ...task,
    status: targetStatus,
    completedAt: targetStatus === TaskStatus.COMPLETED ? now : task.completedAt,
  };

  store.tasks.set(taskId, updatedTask);
  return updatedTask;
}

/** A completed, valid focus session linked to this task is proof of work. */
function findValidLinkedSession(task: Task): FocusSession | undefined {
  return store
    .getUserFocusSessions(task.userId)
    .find(
      (s) =>
        s.taskId === task.id &&
        s.status === FocusSessionStatus.COMPLETED &&
        validateFocusSession(s).valid &&
        focusCreditedMinutes(s.actualMinutes, s.requiredMinutes) > 0
    );
}

/** Self-confirmed tasks that already paid XP on a local date. */
function selfConfirmedTasksPaidOn(userId: string, localDate: string): number {
  const tz = getUserTimeZone(userId);
  return store
    .getUserXpTransactions(userId)
    .filter(
      (t) =>
        String(t.sourceType) === String(XPSourceType.TASK) &&
        t.breakdown?.verificationKind === "SELF_CONFIRMED" &&
        localDateString(t.createdAt, tz) === localDate
    ).length;
}

/**
 * §7.2 — Complete a task and pay its ROOT activity once.
 *
 * Safe to call repeatedly. The task always completes; XP is withheld
 * (reason returned) when a completion is too fast to be real or the
 * self-confirmed daily limit is used up.
 *
 * `now` defaults to the server clock; only tests should pass it.
 */
export function completeTask(
  taskId: string,
  streakDays: number = 0,
  now: Date = new Date()
): {
  task: Task;
  xpAwarded: number;
  bonusXp: number;
  isDuplicate: boolean;
  reason?: NoXpReason;
} {
  const task = store.tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const root = taskRootRef(task);

  // Already completed: idempotent return of the original payout.
  if (task.status === TaskStatus.COMPLETED) {
    const existing = store.getXpTransactionByKey(task.userId, payoutKey(root));
    return {
      task,
      xpAwarded: existing?.amount ?? 0,
      bonusXp: 0,
      isDuplicate: true,
    };
  }

  const linked = findValidLinkedSession(task);
  const verification = linked ? "FOCUS_VERIFIED" : "SELF_CONFIRMED";
  const isQuest = task.source === TaskSource.AI || task.questId != null;
  const isPlainUserTask = !isQuest && task.source === TaskSource.USER;

  const updatedTask = updateTaskStatus(taskId, TaskStatus.COMPLETED, now);

  // Anti-farming gates (user tasks only; AI quests are rate-limited elsewhere).
  let reason: NoXpReason | undefined;
  if (isPlainUserTask && now.getTime() - task.createdAt.getTime() < ECONOMY.minDwellMs) {
    reason = "TOO_FAST";
  } else if (isPlainUserTask && verification === "SELF_CONFIRMED") {
    const today = localDateString(now, getUserTimeZone(task.userId));
    if (
      selfConfirmedTasksPaidOn(task.userId, today) >=
      ECONOMY.selfConfirmedTasksPerDay
    ) {
      reason = "SELF_CONFIRMED_LIMIT";
    }
  }
  if (reason) {
    return { task: updatedTask, xpAwarded: 0, bonusXp: 0, isDuplicate: false, reason };
  }

  const payout = awardPayout({
    userId: task.userId,
    sourceType: isQuest ? XPSourceType.AI_QUEST : XPSourceType.TASK,
    root,
    kind: isQuest ? "AI_QUEST" : "TASK",
    minutes: task.estimatedMinutes ?? linked?.requiredMinutes ?? null,
    difficulty: task.difficulty,
    verification,
    now,
  });

  const bonus = maybeGrantDailyBonuses(task.userId, streakDays, now);

  return {
    task: updatedTask,
    xpAwarded: payout.paidXp,
    bonusXp: bonus.dailyGoalXp + bonus.streakBonusXp,
    isDuplicate: !payout.isNew,
  };
}

/**
 * §7 — Expire tasks past their due date (scheduled job).
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
export function getUserTasks(userId: string, status?: TaskStatus): Task[] {
  const tasks = store.getUserTasks(userId);
  return status ? tasks.filter((t) => t.status === status) : tasks;
}

/**
 * Get a single task by ID.
 */
export function getTask(taskId: string): Task | undefined {
  return store.tasks.get(taskId);
}
