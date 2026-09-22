// ============================================================
// Task Aura — POST /api/v1/ai/recommendations
// Proposes a workload or habit recommendation (proposal only, no XP)
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { store } from "@/lib/services/store";
import { buildAIContext, evaluateRules } from "@/lib/logic/ai-rules";
import { AIAction, Difficulty } from "@/lib/logic/types";

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
    const rules = evaluateRules(context);

    const recRule = rules.find((r) => r.fired && r.action === AIAction.RECOMMENDATION);

    if (recRule && recRule.payload) {
      return apiSuccess({
        title: recRule.payload.title ?? "Recommended Focus Session",
        description: recRule.payload.description ?? "Optimize your focus based on recent patterns.",
        difficulty: recRule.payload.difficulty ?? Difficulty.NORMAL,
        reasoning: recRule.reasoning,
      });
    }

    return apiSuccess({
      title: "Maintain Steady Rhythm",
      description: "Continue with your planned daily tasks and keep your focus streak alive.",
      difficulty: Difficulty.NORMAL,
      reasoning: "Performance is steady within baseline parameters.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate recommendation";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
