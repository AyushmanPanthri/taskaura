// Task Aura — Achievement Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";

export class AchievementRepository {
  async listAll() {
    return prisma.achievement.findMany({
      orderBy: { name: "asc" },
    });
  }

  async getUserAchievements(userId: string) {
    return prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" },
    });
  }

  /**
   * Concurrency-safe achievement unlock: prevents duplicate unlock records
   * when multiple events trigger simultaneously.
   */
  async unlockAchievement(
    userId: string,
    achievementId: string
  ): Promise<{ unlocked: boolean; record: { id: string; userId: string; achievementId: string; unlockedAt: Date } }> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.userAchievement.findUnique({
          where: {
            userId_achievementId: {
              userId,
              achievementId,
            },
          },
        });

        if (existing) {
          return {
            unlocked: false,
            record: existing,
          };
        }

        const created = await tx.userAchievement.create({
          data: {
            userId,
            achievementId,
          },
        });

        return {
          unlocked: true,
          record: created,
        };
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        const existing = await prisma.userAchievement.findUnique({
          where: {
            userId_achievementId: {
              userId,
              achievementId,
            },
          },
        });
        if (existing) {
          return {
            unlocked: false,
            record: existing,
          };
        }
      }
      throw err;
    }
  }
}

export const achievementRepository = new AchievementRepository();
