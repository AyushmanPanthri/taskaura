// ============================================================
// Task Aura — POST /api/v1/ai/quests
// Proposes and registers an AI Quest task (no immediate XP)
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { createTask } from "@/lib/services/task-service";
import { buildAIContext, validateAIAction } from "@/lib/logic/ai-rules";
import { AIAction, Difficulty, GoalStatus, TaskSource } from "@/lib/logic/types";

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const metrics = store.getUserDailyMetrics(user.id);
    const goals = store.getUserGoals(user.id);
    const tasks = store.getUserTasks(user.id);
    const totalXp = store.getTotalXp(user.id);
    const streak = store.streakRecords.get(user.id)?.currentStreak ?? 0;

    const context = buildAIContext(metrics, goals, tasks, totalXp, streak);

    // Validate quest generation readiness (§14, §17: active goals & data maturity)
    const validation = validateAIAction(AIAction.QUEST, context);
    if (!validation.valid) {
      return apiError("QUEST_NOT_AVAILABLE", validation.reason, 400);
    }

    const primaryGoal = goals.find((g) => g.status === GoalStatus.ACTIVE) ?? goals[0];
    const goalTitle = primaryGoal ? primaryGoal.title : "Productivity Mastery";

    // Propose quest task
    const questTask = createTask({
      userId: user.id,
      title: `Quest: Deep Practice — ${goalTitle}`,
      description: `Targeted 45-minute focused preparation aligned with your goal: ${goalTitle}.`,
      difficulty: Difficulty.HARD,
      estimatedMinutes: 45,
      source: TaskSource.AI,
    });

    return apiSuccess(
      {
        questTask,
        message: "Quest generated successfully. Complete this quest to earn authoritative XP.",
      },
      201
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate quest";
    return apiError("BAD_REQUEST", message, 400);
  }
}
