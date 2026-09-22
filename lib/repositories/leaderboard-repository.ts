// Task Aura — Leaderboard Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";

export interface LeaderboardEntryView {
  rank: number;
  userId: string;
  name: string;
  totalXp: number;
  isSelf: boolean;
}

export class LeaderboardRepository {
  async getWeeklyScores(weekStart: string) {
    return prisma.weeklyScore.findMany({
      where: { weekStart },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { totalXp: "desc" },
    });
  }

  async upsertWeeklyScore(
    userId: string,
    weekStart: string,
    weekEnd: string,
    totalXp: number,
    rank: number = 0
  ) {
    return prisma.weeklyScore.upsert({
      where: {
        userId_weekStart: {
          userId,
          weekStart,
        },
      },
      create: {
        userId,
        weekStart,
        weekEnd,
        totalXp,
        rank,
      },
      update: {
        totalXp,
        rank,
        snapshotAt: new Date(),
      },
    });
  }
}

export const leaderboardRepository = new LeaderboardRepository();
