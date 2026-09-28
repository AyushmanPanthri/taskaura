// ============================================================
// Task Aura — AI Service (PostgreSQL-backed)
// Assembles AI context from PostgreSQL repositories/Prisma
// ============================================================

import { prisma } from "../prisma";
import { metricsRepository } from "../repositories/metrics-repository";
import { taskRepository } from "../repositories/task-repository";
import { buildAIContext } from "../logic/ai-rules";
import type { AIContext, Goal, GoalStatus } from "../logic/types";

export interface AIContextWithGoals {
  context: AIContext;
  goals: Goal[];
}

export async function getPostgresAIContext(userId: string): Promise<AIContextWithGoals> {
  const [metrics, goalsRaw, tasks, xpAgg, streakRecord] = await Promise.all([
    metricsRepository.listRecentMetrics(userId, 14),
    prisma.goal.findMany({ where: { userId } }),
    taskRepository.listTasks(userId),
    prisma.xPTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
    prisma.streakRecord.findUnique({
      where: { userId },
      select: { currentStreak: true },
    }),
  ]);

  const goals: Goal[] = goalsRaw.map((g) => ({
    id: g.id,
    userId: g.userId,
    title: g.title,
    description: g.description,
    category: g.category,
    targetValue: g.targetValue,
    currentValue: g.currentValue,
    status: g.status as GoalStatus,
    createdAt: g.createdAt,
  }));

  const totalXp = xpAgg._sum.amount ?? 0;
  const currentStreak = streakRecord?.currentStreak ?? 0;

  const context = buildAIContext(metrics, goals, tasks, totalXp, currentStreak);
  return { context, goals };
}
