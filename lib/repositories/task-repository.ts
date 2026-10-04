// Task Aura — Task Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { Task, TaskStatus, TaskSource, Difficulty } from "../logic/types";
import {
  ANTI_FARMING_CONFIG,
  calculateMinimumDurationMs,
  calculateTaskRewardAuthoritative,
  clampDifficulty,
  focusCreditedMinutes,
  payoutKey,
  ECONOMY,
  VerificationKind,
} from "../logic/economy";
import { evaluateSuspiciousPatterns } from "../logic/anti-farming";
import { shouldCapXp } from "../logic/focus-engine";

export interface TaskFilter {
  status?: TaskStatus;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  difficulty?: Difficulty;
  estimatedMinutes?: number | null;
  dueAt?: Date | null;
  source?: TaskSource;
  questId?: string | null;
}

export interface CompleteTaskOptions {
  markDoneWithoutReward?: boolean;
  focusVerified?: boolean;
}

export interface CompleteTaskResult {
  task: Task;
  isDuplicate: boolean;
  xpAwarded: number;
  bonusXp: number;
  xpCapped?: boolean;
  xpReduced?: boolean;
  rejected?: boolean;
  reason?: string;
  classification?: "NORMAL" | "SUSPICIOUS" | "BLOCKED_REWARD";
  /** Populated when reason === "TOO_FAST" */
  minimumRequiredDurationMs?: number;
  /** Populated when reason === "TOO_FAST" */
  serverDurationMs?: number;
}

/** Tasks created before this timestamp are grandfathered under legacy duration rules */
export const GRANDFATHER_CUTOFF = new Date("2026-09-23T00:00:00Z");

export class TaskRepository {
  async listTasks(userId: string, filter?: TaskFilter): Promise<Task[]> {
    const rows = await prisma.task.findMany({
      where: {
        userId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      description: r.description,
      difficulty: r.difficulty as Difficulty,
      status: r.status as TaskStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      estimatedMinutes: r.estimatedMinutes,
      completionAttempts: r.completionAttempts,
      dueAt: r.dueAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    }));
  }

  async findById(userId: string, id: string): Promise<Task | null> {
    const r = await prisma.task.findFirst({
      where: { id, userId },
    });
    if (!r) return null;

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      description: r.description,
      difficulty: r.difficulty as Difficulty,
      status: r.status as TaskStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      estimatedMinutes: r.estimatedMinutes,
      completionAttempts: r.completionAttempts,
      dueAt: r.dueAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  async createTask(userId: string, input: CreateTaskInput): Promise<Task> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Daily task creation limit
    const countCreatedToday = await prisma.task.count({
      where: {
        userId,
        createdAt: { gte: todayStart },
      },
    });

    if (countCreatedToday >= ANTI_FARMING_CONFIG.dailyTasksCreatedLimit) {
      throw new Error(
        `Daily task creation limit of ${ANTI_FARMING_CONFIG.dailyTasksCreatedLimit} tasks reached for today.`
      );
    }

    const requestedDifficulty = input.difficulty ?? Difficulty.NORMAL;
    const estimatedMinutes =
      input.estimatedMinutes ??
      (requestedDifficulty === Difficulty.HARD
        ? ANTI_FARMING_CONFIG.hardMinMinutes
        : requestedDifficulty === Difficulty.EPIC
        ? ANTI_FARMING_CONFIG.epicMinMinutes
        : ECONOMY.taskDefaultMinutes);

    // Policy: HARD below 45m or EPIC below 90m is normalized to NORMAL via clampDifficulty
    const effectiveDifficulty = clampDifficulty(requestedDifficulty, estimatedMinutes) as Difficulty;

    const r = await prisma.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        difficulty: effectiveDifficulty,
        estimatedMinutes,
        dueAt: input.dueAt ?? null,
        source: input.source ?? TaskSource.USER,
        questId: input.questId ?? null,
        status: TaskStatus.PENDING,
      },
    });

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      description: r.description,
      difficulty: r.difficulty as Difficulty,
      status: r.status as TaskStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      estimatedMinutes: r.estimatedMinutes,
      completionAttempts: r.completionAttempts,
      dueAt: r.dueAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  async startTask(userId: string, id: string): Promise<Task> {
    const existing = await prisma.task.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new Error("Task not found");
    }
    if (existing.status !== TaskStatus.PENDING) {
      throw new Error(`Cannot start task in status ${existing.status}`);
    }

    const now = new Date();
    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: now,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      title: updated.title,
      description: updated.description,
      difficulty: updated.difficulty as Difficulty,
      status: updated.status as TaskStatus,
      startedAt: updated.startedAt,
      completedAt: updated.completedAt,
      estimatedMinutes: updated.estimatedMinutes,
      completionAttempts: updated.completionAttempts,
      dueAt: updated.dueAt,
      source: updated.source as TaskSource,
      questId: updated.questId,
      createdAt: updated.createdAt,
    };
  }

  async updateTask(
    userId: string,
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      difficulty: Difficulty;
      estimatedMinutes: number;
      status: TaskStatus;
      dueAt: Date | null;
    }>
  ): Promise<Task | null> {
    const existing = await prisma.task.findFirst({ where: { id, userId } });
    if (!existing) return null;

    // Immutability after start: difficulty & estimated duration are frozen once IN_PROGRESS
    if (existing.status !== TaskStatus.PENDING) {
      if (data.difficulty && data.difficulty !== existing.difficulty) {
        throw new Error(
          `Difficulty cannot be modified once a task is ${existing.status}`
        );
      }
      if (
        data.estimatedMinutes !== undefined &&
        data.estimatedMinutes !== existing.estimatedMinutes
      ) {
        throw new Error(
          `Estimated duration cannot be modified once a task is ${existing.status}`
        );
      }
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
    if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
    if (data.dueAt !== undefined) updateData.dueAt = data.dueAt;

    if (data.status && data.status !== existing.status) {
      updateData.status = data.status;

      if (data.status === TaskStatus.IN_PROGRESS && !existing.startedAt) {
        updateData.startedAt = now;
      }

      // Condition 2: If setting status to COMPLETED via generic update (e.g. PATCH)
      if (data.status === TaskStatus.COMPLETED) {
        updateData.completedAt = now;
        updateData.completionAttempts = { increment: 1 };

        // Direct PENDING -> COMPLETED bypass attempt: 0 XP awarded, audit event created
        if (existing.status === TaskStatus.PENDING) {
          await prisma.adminAuditLog.create({
            data: {
              adminUserId: userId,
              action: "TASK_COMPLETED_ZERO_XP",
              targetUserId: userId,
              metadata: JSON.stringify({
                taskId: id,
                title: existing.title,
                reason: "NEVER_STARTED",
                via: "GENERIC_PATCH",
                serverTimestamp: now.toISOString(),
                rawCalculatedXp: 0,
                paidXp: 0,
              }),
              createdAt: now,
            },
          });
        }
      }
    }

    const r = await prisma.task.update({
      where: { id },
      data: updateData,
    });

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      description: r.description,
      difficulty: r.difficulty as Difficulty,
      status: r.status as TaskStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      estimatedMinutes: r.estimatedMinutes,
      completionAttempts: r.completionAttempts,
      dueAt: r.dueAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  /**
   * Atomic, transaction-safe task completion with layered anti-farming protections:
   * 1. Server-authoritative timing (startedAt -> completedAt)
   * 2. Direct PENDING completion: 0 XP (Require Start rule)
   * 3. Minimum duration validation (80% of estimate, >= 60s)
   * 4. Rejected completions keep task IN_PROGRESS and record attempt counters
   * 5. Daily creation, completion, attempt limits and daily XP caps
   * 6. Suspicious pattern classification (NORMAL, SUSPICIOUS, BLOCKED_REWARD)
   * 7. First-five lifetime SELF_CONFIRMED task ramp-up (50% XP, floor 1)
   * 8. Atomic XP ledger write with strict idempotency key
   */
  async completeTaskTransaction(
    userId: string,
    taskId: string,
    idempotencyKeyOrOptions?: string | CompleteTaskOptions,
    directPayout?: {
      amount: number;
      baseXp: number;
      difficultyMultiplier: number;
      streakBonus: number;
      rewardType: string;
    }
  ): Promise<CompleteTaskResult> {
    const isDirectCall = typeof idempotencyKeyOrOptions === "string";
    const explicitIdempotencyKey = isDirectCall ? idempotencyKeyOrOptions : undefined;
    const options = isDirectCall ? undefined : idempotencyKeyOrOptions;

    return prisma.$transaction(async (tx) => {
      const serverNow = new Date();
      const todayStart = new Date(
        serverNow.getFullYear(),
        serverNow.getMonth(),
        serverNow.getDate()
      );

      // 1. Lock and load task from PostgreSQL
      const taskRow = await tx.task.findFirst({
        where: { id: taskId, userId },
      });

      if (!taskRow) {
        throw new Error("Task not found");
      }

      // 2. Determine idempotency key
      const isQuest = taskRow.questId != null || taskRow.source === TaskSource.AI;
      const rootType = isQuest ? ("QUEST" as const) : ("TASK" as const);
      const rootId = isQuest && taskRow.questId ? taskRow.questId : taskRow.id;
      const idempotencyKey = explicitIdempotencyKey ?? payoutKey({ type: rootType, id: rootId });

      // 3. Idempotency check: Already completed task or existing payout returns original result
      const existingTx = await tx.xPTransaction.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey,
          },
        },
      });

      if (taskRow.status === TaskStatus.COMPLETED || existingTx) {
        return {
          task: {
            id: taskRow.id,
            userId: taskRow.userId,
            title: taskRow.title,
            description: taskRow.description,
            difficulty: taskRow.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: taskRow.startedAt,
            completedAt: taskRow.completedAt ?? serverNow,
            estimatedMinutes: taskRow.estimatedMinutes,
            completionAttempts: taskRow.completionAttempts,
            dueAt: taskRow.dueAt,
            source: taskRow.source as TaskSource,
            questId: taskRow.questId,
            createdAt: taskRow.createdAt,
          },
          isDuplicate: true,
          xpAwarded: 0,
          bonusXp: 0,
        };
      }

      if (
        taskRow.status === TaskStatus.CANCELLED ||
        taskRow.status === TaskStatus.EXPIRED
      ) {
        throw new Error(`Cannot complete task with status ${taskRow.status}`);
      }

      // Direct low-level repository invocation (e.g. from existing test suites passing explicit payout):
      if (isDirectCall && directPayout) {
        await tx.xPTransaction.create({
          data: {
            userId,
            amount: directPayout.amount,
            sourceType: "TASK",
            sourceId: taskId,
            rewardType: directPayout.rewardType,
            idempotencyKey,
            baseXp: directPayout.baseXp,
            difficultyMultiplier: directPayout.difficultyMultiplier,
            streakBonus: directPayout.streakBonus,
            createdAt: serverNow,
          },
        });

        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: directPayout.amount,
          bonusXp: directPayout.streakBonus,
        };
      }

      // 4. Daily completion-attempt quota check (includes successful, rejected, and zero-xp)
      const dailyAttempts = await tx.adminAuditLog.count({
        where: {
          targetUserId: userId,
          action: {
            in: [
              "TASK_COMPLETED",
              "TASK_COMPLETION_REJECTED",
              "TASK_COMPLETED_ZERO_XP",
              "TASK_BLOCKED_REWARD",
              "TASK_SUSPICIOUS_PATTERN",
            ],
          },
          createdAt: { gte: todayStart },
        },
      });

      if (dailyAttempts >= ANTI_FARMING_CONFIG.dailyCompletionAttemptsLimit) {
        throw new Error(
          `Daily completion-attempt limit (${ANTI_FARMING_CONFIG.dailyCompletionAttemptsLimit}) reached for today.`
        );
      }

      // FOCUS_VERIFIED derivation — server-only, never from request body.
      // Conditions: FocusSession exists with same userId AND taskId, status COMPLETED,
      // completedAt within the last 30 minutes, and consumedAt null.
      let focusVerified = false;
      const thirtyMinutesAgo = new Date(serverNow.getTime() - 30 * 60_000);
      const qualifyingSession = taskRow.id
        ? await tx.focusSession.findFirst({
            where: {
              userId,
              taskId: taskRow.id,
              status: "COMPLETED",
              completedAt: { gte: thirtyMinutesAgo },
              consumedAt: null,
            },
          })
        : null;

      if (qualifyingSession) {
        // Guard 1: session must have positive credited minutes (no instant-complete bypass)
        const credited = focusCreditedMinutes(
          qualifyingSession.actualMinutes ?? 0,
          qualifyingSession.requiredMinutes
        );
        // Guard 2: session must not be heartbeat-capped (suspicious/backgrounded)
        const capped = shouldCapXp(
          qualifyingSession.heartbeatCount,
          qualifyingSession.expectedHeartbeats,
          qualifyingSession.actualMinutes ?? 0
        );
        if (credited > 0 && !capped) {
          focusVerified = true;
          // Consume the session atomically so it cannot be reused.
          await tx.focusSession.update({
            where: { id: qualifyingSession.id },
            data: { consumedAt: serverNow },
          });
        }
      }

      const verification: VerificationKind = focusVerified
        ? "FOCUS_VERIFIED"
        : "SELF_CONFIRMED";

      // 5. Handle Voluntary Zero XP OR Never-Started (PENDING) Task
      // Decision 1 (Option a): Direct PENDING -> COMPLETED transitions to COMPLETED,
      // but pays 0 XP and logs audit record (reason: NEVER_STARTED).
      if (options?.markDoneWithoutReward || taskRow.status === TaskStatus.PENDING) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        const reason =
          taskRow.status === TaskStatus.PENDING || !taskRow.startedAt
            ? "NEVER_STARTED"
            : options?.markDoneWithoutReward
            ? "VOLUNTARY_ZERO_XP"
            : "NEVER_STARTED";

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_COMPLETED_ZERO_XP",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              reason,
              previousState: taskRow.status,
              newState: "COMPLETED",
              serverTimestamp: serverNow.toISOString(),
              rawCalculatedXp: 0,
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          reason,
        };
      }

      // 6. Timing validation for IN_PROGRESS tasks
      const startedAt = taskRow.startedAt ?? taskRow.createdAt;
      const serverDurationMs = Math.max(0, serverNow.getTime() - startedAt.getTime());
      const minimumRequiredDurationMs = calculateMinimumDurationMs(
        taskRow.estimatedMinutes
      );

      // Early completion before minimum duration:
      // Rejected completion — task remains IN_PROGRESS (Decision 4)
      if (serverDurationMs < minimumRequiredDurationMs) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            completionAttempts: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_COMPLETION_REJECTED",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              reason: "TOO_FAST",
              previousState: "IN_PROGRESS",
              newState: "IN_PROGRESS",
              serverDurationMs,
              minimumRequiredDurationMs,
              estimatedMinutes: taskRow.estimatedMinutes,
              serverTimestamp: serverNow.toISOString(),
              rawCalculatedXp: 0,
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.IN_PROGRESS,
            startedAt: updated.startedAt,
            completedAt: null,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          rejected: true,
          reason: "TOO_FAST",
          minimumRequiredDurationMs,
          serverDurationMs,
        };
      }

      // 7. Sub-60-second estimated duration earns 0 XP
      if (taskRow.estimatedMinutes < 1) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_COMPLETED_ZERO_XP",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              reason: "SUB_60_SECONDS",
              serverTimestamp: serverNow.toISOString(),
              serverDurationMs,
              estimatedMinutes: taskRow.estimatedMinutes,
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          reason: "SUB_60_SECONDS",
        };
      }

      // 8. Daily successful completion quota check
      const dailyCompletedCount = await tx.task.count({
        where: {
          userId,
          status: TaskStatus.COMPLETED,
          completedAt: { gte: todayStart },
        },
      });

      if (dailyCompletedCount >= ANTI_FARMING_CONFIG.dailyTasksCompletedLimit) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_COMPLETED_ZERO_XP",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              reason: "DAILY_COMPLETION_LIMIT",
              dailyCompletedCount,
              limit: ANTI_FARMING_CONFIG.dailyTasksCompletedLimit,
              serverTimestamp: serverNow.toISOString(),
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          reason: "DAILY_COMPLETION_LIMIT",
        };
      }

      // 9. Daily XP cap from tasks
      const todayXpAggregate = await tx.xPTransaction.aggregate({
        _sum: { amount: true },
        where: {
          userId,
          sourceType: "TASK",
          createdAt: { gte: todayStart },
        },
      });
      const todayTaskXp = todayXpAggregate._sum.amount ?? 0;

      if (todayTaskXp >= ANTI_FARMING_CONFIG.dailyTaskXpCap) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_COMPLETED_ZERO_XP",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              reason: "DAILY_TASK_XP_CAP",
              todayTaskXp,
              cap: ANTI_FARMING_CONFIG.dailyTaskXpCap,
              serverTimestamp: serverNow.toISOString(),
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          reason: "DAILY_TASK_XP_CAP",
        };
      }

      // 10a. Self-confirmed daily limit (5 XP-earning SELF_CONFIRMED task completions per day).
      // Runs before suspicious-pattern detection so the reason is always specific.
      // Verification for this task is SELF_CONFIRMED (focusVerified is never true from the
      // public route). We count paid TASK/COMPLETION transactions today as the proxy —
      // the same mechanism used by dailyTaskXpCap above.
      if (verification === "SELF_CONFIRMED") {
        const selfConfirmedToday = await tx.xPTransaction.count({
          where: {
            userId,
            sourceType: "TASK",
            rewardType: "COMPLETION",
            createdAt: { gte: todayStart },
          },
        });

        if (selfConfirmedToday >= ECONOMY.selfConfirmedTasksPerDay) {
          const updated = await tx.task.update({
            where: { id: taskId },
            data: {
              status: TaskStatus.COMPLETED,
              completedAt: serverNow,
              completionAttempts: { increment: 1 },
            },
          });

          await tx.adminAuditLog.create({
            data: {
              adminUserId: userId,
              action: "TASK_COMPLETED_ZERO_XP",
              targetUserId: userId,
              metadata: JSON.stringify({
                taskId,
                title: taskRow.title,
                reason: "SELF_CONFIRMED_LIMIT",
                selfConfirmedToday,
                limit: ECONOMY.selfConfirmedTasksPerDay,
                serverTimestamp: serverNow.toISOString(),
                paidXp: 0,
              }),
              createdAt: serverNow,
            },
          });

          return {
            task: {
              id: updated.id,
              userId: updated.userId,
              title: updated.title,
              description: updated.description,
              difficulty: updated.difficulty as Difficulty,
              status: TaskStatus.COMPLETED,
              startedAt: updated.startedAt,
              completedAt: updated.completedAt,
              estimatedMinutes: updated.estimatedMinutes,
              completionAttempts: updated.completionAttempts,
              dueAt: updated.dueAt,
              source: updated.source as TaskSource,
              questId: updated.questId,
              createdAt: updated.createdAt,
            },
            isDuplicate: false,
            xpAwarded: 0,
            bonusXp: 0,
            reason: "SELF_CONFIRMED_LIMIT",
          };
        }
      }

      // 10. Suspicious Pattern Detection
      const past24h = new Date(serverNow.getTime() - 24 * 60 * 60_000);
      const recentCompletedRows = await tx.task.findMany({
        where: {
          userId,
          status: TaskStatus.COMPLETED,
          completedAt: { gte: past24h },
        },
        select: {
          id: true,
          title: true,
          completedAt: true,
          difficulty: true,
        },
        orderBy: { completedAt: "desc" },
      });

      const rejectedAttempts24h = await tx.adminAuditLog.count({
        where: {
          targetUserId: userId,
          action: "TASK_COMPLETION_REJECTED",
          createdAt: { gte: past24h },
        },
      });

      const abandonedHardEpic24h = await tx.task.count({
        where: {
          userId,
          difficulty: { in: ["HARD", "EPIC"] },
          status: { in: [TaskStatus.CANCELLED, TaskStatus.EXPIRED] },
          createdAt: { gte: past24h },
        },
      });

      const sevenDaysAgo = new Date(serverNow.getTime() - 7 * 24 * 60 * 60_000);
      const pastWeekCompletedCount = await tx.task.count({
        where: {
          userId,
          status: TaskStatus.COMPLETED,
          completedAt: { gte: sevenDaysAgo, lt: todayStart },
        },
      });
      const trailing7DayAverage = pastWeekCompletedCount / 7;

      const patternResult = evaluateSuspiciousPatterns({
        currentTaskId: taskId,
        currentTaskTitle: taskRow.title,
        currentTaskDifficulty: taskRow.difficulty,
        serverDurationMs,
        minimumRequiredDurationMs,
        recentCompletions: recentCompletedRows.map((r) => ({
          taskId: r.id,
          title: r.title,
          completedAt: r.completedAt ?? serverNow,
          difficulty: r.difficulty,
        })),
        rejectedAttemptsLast24h: rejectedAttempts24h,
        abandonedHardEpicCountLast24h: abandonedHardEpic24h,
        trailing7DayAverageDailyCompletions: trailing7DayAverage,
        todayCompletionsCount: dailyCompletedCount,
        now: serverNow,
      });

      // If BLOCKED_REWARD: Task completes, but XP = 0, high-priority audit event created
      if (patternResult.blockReward) {
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            completedAt: serverNow,
            completionAttempts: { increment: 1 },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: userId,
            action: "TASK_BLOCKED_REWARD",
            targetUserId: userId,
            metadata: JSON.stringify({
              taskId,
              title: taskRow.title,
              classification: "BLOCKED_REWARD",
              signals: patternResult.signals,
              serverTimestamp: serverNow.toISOString(),
              serverDurationMs,
              paidXp: 0,
            }),
            createdAt: serverNow,
          },
        });

        return {
          task: {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            description: updated.description,
            difficulty: updated.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt,
            estimatedMinutes: updated.estimatedMinutes,
            completionAttempts: updated.completionAttempts,
            dueAt: updated.dueAt,
            source: updated.source as TaskSource,
            questId: updated.questId,
            createdAt: updated.createdAt,
          },
          isDuplicate: false,
          xpAwarded: 0,
          bonusXp: 0,
          classification: "BLOCKED_REWARD",
          reason: "BLOCKED_REWARD",
        };
      }

      // 11. Authoritative Reward Calculation
      const isGrandfathered = taskRow.createdAt < GRANDFATHER_CUTOFF;
      const lifetimeSelfConfirmed = await tx.xPTransaction.count({
        where: {
          userId,
          sourceType: "TASK",
          rewardType: "COMPLETION",
        },
      });

      const rewardResult = calculateTaskRewardAuthoritative({
        minutes: taskRow.estimatedMinutes,
        difficulty: taskRow.difficulty,
        verification,
        isGrandfathered,
        lifetimeSelfConfirmedCount: lifetimeSelfConfirmed,
      });

      let payoutAmount = rewardResult.finalXp;
      // Clamp to remaining daily task XP cap if approaching limit
      const remainingXpQuota = Math.max(0, ANTI_FARMING_CONFIG.dailyTaskXpCap - todayTaskXp);
      if (payoutAmount > remainingXpQuota) {
        payoutAmount = remainingXpQuota;
      }

      // 12. Streak bonus calculation
      const streakRecord = await tx.streakRecord.findUnique({
        where: { userId },
        select: { currentStreak: true },
      });
      const streakBonus = Math.min(
        (streakRecord?.currentStreak ?? 0) * ECONOMY.streakBonusPerDay,
        ECONOMY.streakBonusMax
      );

      // 13. Write XP transaction atomically
      if (payoutAmount > 0) {
        await tx.xPTransaction.create({
          data: {
            userId,
            amount: payoutAmount,
            sourceType: isQuest ? "AI_QUEST" : "TASK",
            sourceId: taskId,
            rewardType: "COMPLETION",
            idempotencyKey,
            baseXp: rewardResult.rawXp,
            difficultyMultiplier: 1.0,
            streakBonus,
            createdAt: serverNow,
          },
        });
      }

      // 14. Mark task COMPLETED
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: serverNow,
          completionAttempts: { increment: 1 },
        },
      });

      // 15. Record comprehensive reward audit event
      const auditAction =
        patternResult.classification === "SUSPICIOUS"
          ? "TASK_SUSPICIOUS_PATTERN"
          : "TASK_COMPLETED";

      await tx.adminAuditLog.create({
        data: {
          adminUserId: userId,
          action: auditAction,
          targetUserId: userId,
          metadata: JSON.stringify({
            taskId,
            title: taskRow.title,
            serverTimestamp: serverNow.toISOString(),
            previousState: "IN_PROGRESS",
            newState: "COMPLETED",
            estimatedDurationMinutes: taskRow.estimatedMinutes,
            actualServerDurationMs: serverDurationMs,
            minimumRequiredDurationMs,
            verificationType: verification,
            calculatedRawXp: rewardResult.rawXp,
            paidXp: payoutAmount,
            streakBonus,
            isReducedNewUser: rewardResult.isReducedNewUser,
            suspiciousPatternClassification: patternResult.classification,
            signals: patternResult.signals,
          }),
          createdAt: serverNow,
        },
      });

      return {
        task: {
          id: updated.id,
          userId: updated.userId,
          title: updated.title,
          description: updated.description,
          difficulty: updated.difficulty as Difficulty,
          status: TaskStatus.COMPLETED,
          startedAt: updated.startedAt,
          completedAt: updated.completedAt,
          estimatedMinutes: updated.estimatedMinutes,
          completionAttempts: updated.completionAttempts,
          dueAt: updated.dueAt,
          source: updated.source as TaskSource,
          questId: updated.questId,
          createdAt: updated.createdAt,
        },
        isDuplicate: false,
        xpAwarded: payoutAmount,
        bonusXp: streakBonus,
        xpCapped: payoutAmount < rewardResult.finalXp,
        xpReduced: rewardResult.isReducedNewUser,
        classification: patternResult.classification,
      };
    });
  }
}

export const taskRepository = new TaskRepository();
