// ============================================================
// Task Aura — GET /api/v1/ai/insights
// Deterministic rule-based insights (zero XP mutation)
//
// MIGRATION (Stage 4): Migrated from InMemoryStore to PostgreSQL.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess } from "@/lib/api/response";
import { evaluateRules, getFallbackTip } from "@/lib/logic/ai-rules";
import { getPostgresAIContext } from "@/lib/services/ai-service";

export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { context } = await getPostgresAIContext(user.id);
    const rules = evaluateRules(context);

    // Find any fired insight or recommendation
    const activeRule = rules.find((r) => r.fired);

    if (activeRule && activeRule.payload.content) {
      return apiSuccess({
        content: activeRule.payload.content,
        ruleId: activeRule.ruleId,
        reasoning: activeRule.reasoning,
        isFallback: false,
      });
    }

    // Default fallback tip
    const fallback = getFallbackTip();
    return apiSuccess({
      content: fallback,
      ruleId: "RULE_E",
      reasoning: "General productivity guideline",
      isFallback: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate insights";
    return apiError("INTERNAL_ERROR", message, 500);
  }
}
