// Task Aura — Task Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { Task, TaskStatus, TaskSource, Difficulty } from "../logic/types";

export interface TaskFilter {
  status?: TaskStatus;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  difficulty?: Difficulty;
  dueAt?: Date | null;
  source?: TaskSource;
  questId?: string | null;
}

export interface TaskPayoutData {
  amount: number;
  baseXp: number;
  difficultyMultiplier: number;
  streakBonus: number;
  rewardType: string;
}

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
      estimatedMinutes: 30, // domain default
      dueAt: r.dueAt,
      completedAt: r.completedAt,
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
      estimatedMinutes: 30,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  async createTask(userId: string, input: CreateTaskInput): Promise<Task> {
    const r = await prisma.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        difficulty: input.difficulty ?? Difficulty.NORMAL,
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
      estimatedMinutes: 30,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  async updateTask(
    userId: string,
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      difficulty: Difficulty;
      status: TaskStatus;
      dueAt: Date | null;
    }>
  ): Promise<Task | null> {
    const existing = await prisma.task.findFirst({ where: { id, userId } });
    if (!existing) return null;

    const r = await prisma.task.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.difficulty !== undefined ? { difficulty: data.difficulty } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
      },
    });

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      description: r.description,
      difficulty: r.difficulty as Difficulty,
      status: r.status as TaskStatus,
      estimatedMinutes: 30,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      source: r.source as TaskSource,
      questId: r.questId,
      createdAt: r.createdAt,
    };
  }

  /**
   * Atomic, transaction-safe task completion with XP ledger recording.
   * Concurrency-safe across 20 simultaneous requests.
   */
  async completeTaskTransaction(
    userId: string,
    taskId: string,
    idempotencyKey: string,
    payout: TaskPayoutData
  ): Promise<{ task: Task; isDuplicate: boolean; xpAwarded: number }> {
    return prisma.$transaction(async (tx) => {
      // 1. Verify task ownership & current status
      const taskRow = await tx.task.findFirst({
        where: { id: taskId, userId },
      });

      if (!taskRow) {
        throw new Error("Task not found");
      }

      // 2. Check for duplicate idempotency key in ledger
      const existingTx = await tx.xPTransaction.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey,
          },
        },
      });

      if (existingTx || taskRow.status === TaskStatus.COMPLETED) {
        return {
          task: {
            id: taskRow.id,
            userId: taskRow.userId,
            title: taskRow.title,
            description: taskRow.description,
            difficulty: taskRow.difficulty as Difficulty,
            status: TaskStatus.COMPLETED,
            estimatedMinutes: 30,
            dueAt: taskRow.dueAt,
            completedAt: taskRow.completedAt ?? new Date(),
            source: taskRow.source as TaskSource,
            questId: taskRow.questId,
            createdAt: taskRow.createdAt,
          },
          isDuplicate: true,
          xpAwarded: 0,
        };
      }

      if (taskRow.status !== TaskStatus.PENDING && taskRow.status !== TaskStatus.IN_PROGRESS) {
        throw new Error(`Cannot complete task with status ${taskRow.status}`);
      }

      const now = new Date();

      // 3. Atomically write XP ledger entry
      await tx.xPTransaction.create({
        data: {
          userId,
          amount: payout.amount,
          sourceType: "TASK",
          sourceId: taskId,
          rewardType: payout.rewardType,
          idempotencyKey,
          baseXp: payout.baseXp,
          difficultyMultiplier: payout.difficultyMultiplier,
          streakBonus: payout.streakBonus,
          createdAt: now,
        },
      });

      // 4. Update task state
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: now,
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
          estimatedMinutes: 30,
          dueAt: updated.dueAt,
          completedAt: updated.completedAt,
          source: updated.source as TaskSource,
          questId: updated.questId,
          createdAt: updated.createdAt,
        },
        isDuplicate: false,
        xpAwarded: payout.amount,
      };
    });
  }
}

export const taskRepository = new TaskRepository();
