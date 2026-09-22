// Task Aura — Habit Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { Habit, HabitFrequency } from "../logic/types";

export interface CreateHabitInput {
  title: string;
  frequency?: HabitFrequency;
}

export interface HabitPayoutData {
  amount: number;
  baseXp: number;
  difficultyMultiplier: number;
  streakBonus: number;
  rewardType: string;
}

export class HabitRepository {
  async listHabits(userId: string): Promise<Habit[]> {
    const rows = await prisma.habit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      frequency: r.frequency as HabitFrequency,
      streakCurrent: r.streakCurrent,
      streakBest: r.streakBest,
      createdAt: r.createdAt,
    }));
  }

  async findById(userId: string, id: string): Promise<Habit | null> {
    const r = await prisma.habit.findFirst({
      where: { id, userId },
    });
    if (!r) return null;

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      frequency: r.frequency as HabitFrequency,
      streakCurrent: r.streakCurrent,
      streakBest: r.streakBest,
      createdAt: r.createdAt,
    };
  }

  async createHabit(userId: string, input: CreateHabitInput): Promise<Habit> {
    const r = await prisma.habit.create({
      data: {
        userId,
        title: input.title,
        frequency: input.frequency ?? HabitFrequency.DAILY,
        streakCurrent: 0,
        streakBest: 0,
      },
    });

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      frequency: r.frequency as HabitFrequency,
      streakCurrent: r.streakCurrent,
      streakBest: r.streakBest,
      createdAt: r.createdAt,
    };
  }

  async updateHabit(
    userId: string,
    id: string,
    data: Partial<{ title: string; frequency: HabitFrequency }>
  ): Promise<Habit | null> {
    const existing = await prisma.habit.findFirst({ where: { id, userId } });
    if (!existing) return null;

    const r = await prisma.habit.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
      },
    });

    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      frequency: r.frequency as HabitFrequency,
      streakCurrent: r.streakCurrent,
      streakBest: r.streakBest,
      createdAt: r.createdAt,
    };
  }

  async getLogs(habitId: string) {
    return prisma.habitLog.findMany({
      where: { habitId },
      orderBy: { date: "desc" },
    });
  }

  /**
   * Atomic, transaction-safe habit logging.
   * Concurrency-safe against simultaneous requests for the same date.
   */
  async logHabitTransaction(
    userId: string,
    habitId: string,
    date: string,
    completed: boolean,
    idempotencyKey: string,
    payout: HabitPayoutData
  ): Promise<{ log: { id: string; habitId: string; date: string; completed: boolean }; isDuplicate: boolean; xpAwarded: number }> {
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Verify habit ownership
        const habit = await tx.habit.findFirst({
          where: { id: habitId, userId },
        });

        if (!habit) {
          throw new Error("Habit not found");
        }

        // 2. Check for duplicate habit log on this date
        const existingLog = await tx.habitLog.findUnique({
          where: {
            habitId_date: {
              habitId,
              date,
            },
          },
        });

        if (existingLog) {
          return {
            log: {
              id: existingLog.id,
              habitId: existingLog.habitId,
              date: existingLog.date,
              completed: existingLog.completed,
            },
            isDuplicate: true,
            xpAwarded: 0,
          };
        }

        // 3. Create habit log
        const newLog = await tx.habitLog.create({
          data: {
            habitId,
            date,
            completed,
          },
        });

        let xpAwarded = 0;
        if (completed && payout.amount > 0) {
          // 4. Verify idempotency in XP ledger
          const existingTx = await tx.xPTransaction.findUnique({
            where: {
              userId_idempotencyKey: {
                userId,
                idempotencyKey,
              },
            },
          });

          if (!existingTx) {
            await tx.xPTransaction.create({
              data: {
                userId,
                amount: payout.amount,
                sourceType: "HABIT",
                sourceId: habitId,
                rewardType: payout.rewardType,
                idempotencyKey,
                baseXp: payout.baseXp,
                difficultyMultiplier: payout.difficultyMultiplier,
                streakBonus: payout.streakBonus,
              },
            });
            xpAwarded = payout.amount;
          }

          // Update streaks
          const nextStreak = habit.streakCurrent + 1;
          const nextBest = Math.max(habit.streakBest, nextStreak);
          await tx.habit.update({
            where: { id: habitId },
            data: {
              streakCurrent: nextStreak,
              streakBest: nextBest,
            },
          });
        }

        return {
          log: {
            id: newLog.id,
            habitId: newLog.habitId,
            date: newLog.date,
            completed: newLog.completed,
          },
          isDuplicate: false,
          xpAwarded,
        };
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        const existingLog = await prisma.habitLog.findUnique({
          where: { habitId_date: { habitId, date } },
        });
        if (existingLog) {
          return {
            log: {
              id: existingLog.id,
              habitId: existingLog.habitId,
              date: existingLog.date,
              completed: existingLog.completed,
            },
            isDuplicate: true,
            xpAwarded: 0,
          };
        }
      }
      throw err;
    }
  }
}

export const habitRepository = new HabitRepository();
