// Task Aura — Metrics Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { DailyMetrics } from "../logic/types";

export class MetricsRepository {
  async getDailyMetrics(userId: string, date: string): Promise<DailyMetrics | null> {
    const r = await prisma.dailyMetrics.findUnique({
      where: {
        userId_date: {
          userId,
          date,
        },
      },
    });
    if (!r) return null;

    return {
      id: r.id,
      userId: r.userId,
      date: r.date,
      totalScreenTime: r.totalScreenTime,
      appOpens: r.appOpens,
      focusMinutes: r.focusMinutes,
      taskCompletionRate: r.taskCompletionRate,
      distractionIndex: r.distractionIndex,
      focusScore: r.focusScore,
      consistencyScore: r.consistencyScore,
      goalAlignment: r.goalAlignment,
      taskReliability: r.taskReliability,
      routineStability: r.routineStability,
    };
  }

  async listRecentMetrics(userId: string, limitDays: number = 14): Promise<DailyMetrics[]> {
    const rows = await prisma.dailyMetrics.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: limitDays,
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      date: r.date,
      totalScreenTime: r.totalScreenTime,
      appOpens: r.appOpens,
      focusMinutes: r.focusMinutes,
      taskCompletionRate: r.taskCompletionRate,
      distractionIndex: r.distractionIndex,
      focusScore: r.focusScore,
      consistencyScore: r.consistencyScore,
      goalAlignment: r.goalAlignment,
      taskReliability: r.taskReliability,
      routineStability: r.routineStability,
    }));
  }

  async upsertDailyMetrics(
    userId: string,
    date: string,
    data: Partial<Omit<DailyMetrics, "id" | "userId" | "date">>
  ): Promise<DailyMetrics> {
    const r = await prisma.dailyMetrics.upsert({
      where: {
        userId_date: {
          userId,
          date,
        },
      },
      create: {
        userId,
        date,
        totalScreenTime: data.totalScreenTime ?? 0,
        appOpens: data.appOpens ?? 0,
        focusMinutes: data.focusMinutes ?? 0,
        taskCompletionRate: data.taskCompletionRate ?? 0,
        distractionIndex: data.distractionIndex ?? 0,
        focusScore: data.focusScore ?? 0,
        consistencyScore: data.consistencyScore ?? 0,
        goalAlignment: data.goalAlignment ?? 0,
        taskReliability: data.taskReliability ?? 0,
        routineStability: data.routineStability ?? 0,
      },
      update: {
        ...(data.totalScreenTime !== undefined ? { totalScreenTime: data.totalScreenTime } : {}),
        ...(data.appOpens !== undefined ? { appOpens: data.appOpens } : {}),
        ...(data.focusMinutes !== undefined ? { focusMinutes: data.focusMinutes } : {}),
        ...(data.taskCompletionRate !== undefined ? { taskCompletionRate: data.taskCompletionRate } : {}),
        ...(data.distractionIndex !== undefined ? { distractionIndex: data.distractionIndex } : {}),
        ...(data.focusScore !== undefined ? { focusScore: data.focusScore } : {}),
        ...(data.consistencyScore !== undefined ? { consistencyScore: data.consistencyScore } : {}),
        ...(data.goalAlignment !== undefined ? { goalAlignment: data.goalAlignment } : {}),
        ...(data.taskReliability !== undefined ? { taskReliability: data.taskReliability } : {}),
        ...(data.routineStability !== undefined ? { routineStability: data.routineStability } : {}),
      },
    });

    return {
      id: r.id,
      userId: r.userId,
      date: r.date,
      totalScreenTime: r.totalScreenTime,
      appOpens: r.appOpens,
      focusMinutes: r.focusMinutes,
      taskCompletionRate: r.taskCompletionRate,
      distractionIndex: r.distractionIndex,
      focusScore: r.focusScore,
      consistencyScore: r.consistencyScore,
      goalAlignment: r.goalAlignment,
      taskReliability: r.taskReliability,
      routineStability: r.routineStability,
    };
  }
}

export const metricsRepository = new MetricsRepository();
