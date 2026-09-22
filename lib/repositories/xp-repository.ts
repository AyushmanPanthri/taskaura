// Task Aura — XP Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { XPSourceType, RewardType } from "../logic/types";

export interface RecordXPInput {
  userId: string;
  amount: number;
  sourceType: XPSourceType;
  sourceId: string;
  rewardType: RewardType;
  idempotencyKey: string;
  baseXp: number;
  difficultyMultiplier: number;
  streakBonus?: number;
}

export class XPRepository {
  async getLedger(userId: string) {
    return prisma.xPTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getTotalXp(userId: string): Promise<number> {
    const agg = await prisma.xPTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async findTransactionByIdempotency(userId: string, idempotencyKey: string) {
    return prisma.xPTransaction.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
    });
  }

  /**
   * Concurrency-safe, atomic XP payout recording.
   */
  async recordTransaction(input: RecordXPInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.xPTransaction.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });

        if (existing) {
          return {
            transaction: existing,
            isDuplicate: true,
          };
        }

        const created = await tx.xPTransaction.create({
          data: {
            userId: input.userId,
            amount: input.amount,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            rewardType: input.rewardType,
            idempotencyKey: input.idempotencyKey,
            baseXp: input.baseXp,
            difficultyMultiplier: input.difficultyMultiplier,
            streakBonus: input.streakBonus ?? 0,
          },
        });

        return {
          transaction: created,
          isDuplicate: false,
        };
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        const existing = await prisma.xPTransaction.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          return {
            transaction: existing,
            isDuplicate: true,
          };
        }
      }
      throw err;
    }
  }
}

export const xpRepository = new XPRepository();
