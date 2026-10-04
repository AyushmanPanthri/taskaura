import { prisma } from "../prisma";
import {
  levelFor,
  levelProgress as getLevelProgress,
} from "../logic/economy";
import {
  ACHIEVEMENT_DEFINITIONS,
  evaluateAchievements,
} from "../logic/achievement-engine";
import type { UserStats } from "../logic/types";
import type {
  CompletionFeedbackType,
  CompletionGamification,
  GamificationCelebration,
} from "../logic/completion-gamification";
import { getWeekEnd, getWeekStart } from "../logic/leaderboard";
import { achievementRepository } from "../repositories/achievement-repository";

interface CompletionGamificationOptions {
  userId: string;
  xpAwarded: number;
  capped?: boolean;
  reduced?: boolean;
  reason?: string;
  feedbackType: CompletionFeedbackType;
  celebration?: GamificationCelebration;
}

function normalizedConditionType(type: string): string {
  switch (type.toUpperCase()) {
    case "TASK_COMPLETED":
    case "TASKS_COMPLETED":
      return "tasks_completed";
    case "STREAK_REACHED":
    case "STREAK_THRESHOLD":
      return "streak_threshold";
    case "FOCUS_MINUTES":
      return "focus_minutes";
    default:
      return type.toLowerCase();
  }
}

export async function buildCompletionGamification({
  userId,
  xpAwarded,
  capped = false,
  reduced = false,
  reason,
  feedbackType,
  celebration,
}: CompletionGamificationOptions): Promise<CompletionGamification> {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(now);
  const weekEndExclusive = new Date(weekEnd);
  weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 1);

  const [
    xpAggregate,
    streakRecord,
    completedTasks,
    focusAggregate,
    completedFocusSessions,
    completedHabits,
    completedQuests,
    unlockedRows,
    achievementRows,
    user,
    weeklyRows,
  ] = await Promise.all([
    prisma.xPTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
    prisma.streakRecord.findUnique({
      where: { userId },
      select: { currentStreak: true, bestStreak: true },
    }),
    prisma.task.count({ where: { userId, status: "COMPLETED" } }),
    prisma.focusSession.aggregate({
      where: { userId, status: "COMPLETED" },
      _sum: { actualMinutes: true },
    }),
    prisma.focusSession.count({ where: { userId, status: "COMPLETED" } }),
    prisma.habitLog.count({
      where: { completed: true, habit: { userId } },
    }),
    prisma.quest.count({ where: { userId, status: "COMPLETED" } }),
    prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true },
    }),
    prisma.achievement.findMany({
      select: { id: true, name: true, description: true, condition: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { isGuest: true },
    }),
    prisma.xPTransaction.groupBy({
      by: ["userId"],
      where: {
        createdAt: { gte: weekStart, lt: weekEndExclusive },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 100,
    }),
  ]);

  const newTotal = Math.max(0, xpAggregate._sum.amount ?? 0);
  const previousTotal = Math.max(0, newTotal - xpAwarded);
  const previousLevel = levelFor(previousTotal, 100);
  const newLevel = levelFor(newTotal, 100);
  const levelDetail = getLevelProgress(newTotal, 100);
  const currentStreak = streakRecord?.currentStreak ?? 0;

  const stats: UserStats = {
    totalXp: newTotal,
    level: newLevel,
    currentStreak,
    bestStreak: streakRecord?.bestStreak ?? 0,
    totalTasksCompleted: completedTasks,
    totalFocusMinutes: focusAggregate._sum.actualMinutes ?? 0,
    totalHabitsCompleted: completedHabits,
    focusSessionsCompleted: completedFocusSessions,
    questsCompleted: completedQuests,
  };

  const unlockedIds = new Set(
    unlockedRows.map((achievement) => achievement.achievementId)
  );
  const persistedAchievementFor = (definitionId: string) => {
    const definition = ACHIEVEMENT_DEFINITIONS.find(
      (candidate) => candidate.id === definitionId
    );
    if (!definition) return undefined;
    return achievementRows.find((row) => {
      try {
        const condition = JSON.parse(row.condition) as {
          type?: unknown;
          threshold?: unknown;
        };
        return (
          normalizedConditionType(String(condition.type ?? "")) ===
            definition.condition.type &&
          condition.threshold === definition.condition.threshold
        );
      } catch {
        return false;
      }
    });
  };
  const alreadyUnlockedDefinitionIds = new Set(
    ACHIEVEMENT_DEFINITIONS.filter((definition) => {
      const row = persistedAchievementFor(definition.id);
      return row !== undefined && unlockedIds.has(row.id);
    }).map((definition) => definition.id)
  );
  const definitions = evaluateAchievements(
    stats,
    ACHIEVEMENT_DEFINITIONS,
    alreadyUnlockedDefinitionIds
  );
  const newlyUnlocked: CompletionGamification["achievements"] = [];

  for (const definition of definitions) {
    const matchingRow = persistedAchievementFor(definition.id);
    if (!matchingRow) continue;

    const unlocked = await achievementRepository.unlockAchievement(
      userId,
      matchingRow.id
    );
    if (unlocked.unlocked) {
      newlyUnlocked.push({
        id: matchingRow.id,
        name: matchingRow.name,
        description: matchingRow.description,
        unlockedAt: unlocked.record.unlockedAt.toISOString(),
      });
    }
  }

  const result: CompletionGamification = {
    xp: {
      awarded: xpAwarded,
      previousTotal,
      newTotal,
      capped,
      reduced,
      reason:
        reason ??
        (reduced
          ? "NEW_USER_RAMP_UP"
          : capped
            ? "XP_LIMIT_REACHED"
            : xpAwarded > 0
              ? "COMPLETION_REWARD"
              : "NO_XP_AWARDED"),
    },
    progression: {
      previousLevel,
      newLevel,
      levelUp: newLevel > previousLevel,
      levelProgress: levelDetail.fraction,
      xpIntoLevel: levelDetail.xpIntoLevel,
      xpForNextLevel: newLevel >= 100 ? 0 : levelDetail.xpToNext,
    },
    streak: {
      changed: false,
      previous: currentStreak,
      current: currentStreak,
    },
    achievements: newlyUnlocked,
    feedback: {
      type: feedbackType,
      ...(celebration ? { celebration } : {}),
    },
  };

  if (user && !user.isGuest) {
    const leaderboardIds = weeklyRows.map((row) => row.userId);
    const rankedUsers = await prisma.user.findMany({
      where: { id: { in: leaderboardIds }, isGuest: false },
      select: { id: true },
    });
    const publicUserIds = new Set(rankedUsers.map((rankedUser) => rankedUser.id));
    const publicScores = weeklyRows
      .filter((row) => publicUserIds.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        score: row._sum.amount ?? 0,
      }));
    const currentIndex = publicScores.findIndex((row) => row.userId === userId);

    if (currentIndex >= 0) {
      const newRank = currentIndex + 1;
      const previousScore = Math.max(0, publicScores[currentIndex].score - xpAwarded);
      const previousRank =
        [...publicScores]
          .map((row) => ({
            ...row,
            score: row.userId === userId ? previousScore : row.score,
          }))
          .sort((left, right) => right.score - left.score)
          .findIndex((row) => row.userId === userId) + 1;
      result.ranking = {
        changed: previousRank !== newRank,
        previousRank,
        newRank,
      };
    }
  }

  if (celebration) {
    result.feedback.celebration = result.progression?.levelUp
      ? "LEVEL_UP"
      : newlyUnlocked.length > 0
        ? "ACHIEVEMENT_UNLOCKED"
        : result.streak?.changed &&
            [3, 7, 14, 30].includes(result.streak.current)
          ? "STREAK_MILESTONE"
          : result.ranking?.changed &&
              result.ranking.newRank < result.ranking.previousRank
            ? "RANK_UP"
            : celebration;
  }

  return result;
}
