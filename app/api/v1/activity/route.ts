import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import type { ActivityItem } from "@/lib/logic/activity";
import { levelFor } from "@/lib/logic/economy";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const [
      tasks,
      focusSessions,
      habitLogs,
      xpTransactions,
      xpAggregate,
      achievements,
      streakRecord,
    ] = await Promise.all([
      prisma.task.findMany({
        where: { userId: user.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { id: true, title: true, completedAt: true },
      }),
      prisma.focusSession.findMany({
        where: { userId: user.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 10,
        select: {
          id: true,
          actualMinutes: true,
          completedAt: true,
        },
      }),
      prisma.habitLog.findMany({
        where: { completed: true, habit: { userId: user.id } },
        orderBy: { date: "desc" },
        take: 10,
        include: { habit: { select: { title: true } } },
      }),
      prisma.xPTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          sourceType: true,
          sourceId: true,
          createdAt: true,
        },
      }),
      prisma.xPTransaction.aggregate({
        where: { userId: user.id },
        _sum: { amount: true },
      }),
      prisma.userAchievement.findMany({
        where: { userId: user.id },
        orderBy: { unlockedAt: "desc" },
        take: 10,
        include: { achievement: { select: { name: true, description: true } } },
      }),
      prisma.streakRecord.findUnique({
        where: { userId: user.id },
        select: { currentStreak: true, lastEligibleDate: true },
      }),
    ]);

    const xpBySource = new Map(
      xpTransactions.map((transaction) => [
        `${transaction.sourceType}:${transaction.sourceId}`,
        transaction.amount,
      ])
    );
    const activity: ActivityItem[] = [];

    for (const task of tasks) {
      if (!task.completedAt) continue;
      const taskXp =
        xpBySource.get(`TASK:${task.id}`) ??
        xpBySource.get(`AI_QUEST:${task.id}`);
      activity.push({
        id: `task:${task.id}`,
        type: "TASK",
        label: `Completed ${task.title}`,
        createdAt: task.completedAt.toISOString(),
        ...(taskXp !== undefined ? { xpAwarded: taskXp } : {}),
      });
    }

    for (const session of focusSessions) {
      if (!session.completedAt) continue;
      const focusXp = xpBySource.get(`FOCUS_SESSION:${session.id}`);
      activity.push({
        id: `focus:${session.id}`,
        type: "FOCUS",
        label: "Completed a focus session",
        detail: `${Math.round(session.actualMinutes)} minutes`,
        createdAt: session.completedAt.toISOString(),
        ...(focusXp !== undefined ? { xpAwarded: focusXp } : {}),
      });
    }

    for (const log of habitLogs) {
      const habitXp = xpBySource.get(`HABIT:${log.habitId}:${log.date}`);
      activity.push({
        id: `habit:${log.habitId}:${log.date}`,
        type: "HABIT",
        label: `Completed ${log.habit.title}`,
        createdAt: new Date(`${log.date}T12:00:00.000Z`).toISOString(),
        ...(habitXp !== undefined ? { xpAwarded: habitXp } : {}),
      });
    }

    let runningTotal = Math.max(0, xpAggregate._sum.amount ?? 0);
    for (const transaction of xpTransactions) {
      const afterTotal = runningTotal;
      const beforeTotal = Math.max(0, afterTotal - transaction.amount);
      const previousLevel = levelFor(beforeTotal, 100);
      const newLevel = levelFor(afterTotal, 100);
      if (newLevel > previousLevel) {
        activity.push({
          id: `level:${transaction.id}`,
          type: "LEVEL_UP",
          label: `Reached Level ${newLevel}`,
          createdAt: transaction.createdAt.toISOString(),
          xpAwarded: transaction.amount,
        });
      }
      runningTotal = beforeTotal;
    }

    for (const achievement of achievements) {
      activity.push({
        id: `achievement:${achievement.id}`,
        type: "ACHIEVEMENT",
        label: `Unlocked ${achievement.achievement.name}`,
        detail: achievement.achievement.description,
        createdAt: achievement.unlockedAt.toISOString(),
      });
    }

    if (streakRecord?.currentStreak && streakRecord.lastEligibleDate) {
      activity.push({
        id: `streak:${streakRecord.lastEligibleDate}`,
        type: "STREAK",
        label: `${streakRecord.currentStreak} day streak`,
        createdAt: new Date(
          `${streakRecord.lastEligibleDate}T12:00:00.000Z`
        ).toISOString(),
      });
    }

    activity.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
    );

    return apiSuccess(activity.slice(0, 10));
  } catch (err) {
    return safeCatchError(err);
  }
}
