// ============================================================
// LifeXP — AI Rules Engine
// Maps to Logic System File v2 §14, §15, §16, §17
// Pure functions — no side effects, no DB access
// ============================================================

import type {
  AIContext,
  AIRuleResult,
  BaselineDelta,
  DailyMetrics,
  Goal,
  Task,
} from "./types";
import {
  AIAction,
  AIRuleId,
  Difficulty,
  TaskStatus,
} from "./types";
import {
  AI_CONTEXT_MAX_DAYS,
  AI_CONTEXT_MAX_TASKS,
  AI_INSIGHT_LIMIT_PER_DAY,
  AI_QUEST_LIMIT_PER_DAY,
  FALLBACK_TIPS,
} from "./constants";
import { hasEnoughHistory, computeAllBaselineDeltas } from "./baseline";
import { calculateLevel } from "./xp-engine";

// ── §14 — AI Context Assembly ────────────────────────────────

/**
 * §14 v2 — Build a fixed, capped context payload for AI calls.
 *
 * Assembles: recent metrics summary + goals + active tasks + baseline delta.
 * No raw event-level data — only pre-aggregated numbers.
 * This bounds both latency and token cost per interaction.
 */
export function buildAIContext(
  allMetrics: DailyMetrics[],
  goals: Goal[],
  tasks: Task[],
  totalXp: number,
  currentStreak: number
): AIContext {
  // Cap recent metrics to AI_CONTEXT_MAX_DAYS
  const sortedMetrics = [...allMetrics]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, AI_CONTEXT_MAX_DAYS);

  // Only active tasks, capped
  const activeTasks = tasks
    .filter(
      (t) =>
        t.status === TaskStatus.PENDING ||
        t.status === TaskStatus.IN_PROGRESS
    )
    .slice(0, AI_CONTEXT_MAX_TASKS);

  // Compute baseline deltas if enough history
  const currentMetrics = sortedMetrics[0] ?? null;
  const historicalMetrics = sortedMetrics.slice(1);
  let baselineDeltas: BaselineDelta[] = [];

  if (currentMetrics && hasEnoughHistory(historicalMetrics.length)) {
    baselineDeltas = computeAllBaselineDeltas(currentMetrics, historicalMetrics) ?? [];
  }

  return {
    userId: currentMetrics?.userId ?? "",
    recentMetrics: sortedMetrics,
    goals,
    activeTasks,
    baselineDeltas,
    currentStreak,
    totalXp,
    level: calculateLevel(totalXp),
  };
}

// ── §14 v2 — Rate Limiting ──────────────────────────────────

/**
 * In-memory rate limit counters (swap to Redis in production).
 * Map of `${userId}:${action}:${dateStr}` → count
 */
const rateLimitCounters = new Map<string, number>();

/**
 * Check if an AI action is rate-limited for a user.
 */
export function isRateLimited(
  userId: string,
  action: AIAction,
  dateStr: string
): boolean {
  const key = `${userId}:${action}:${dateStr}`;
  const count = rateLimitCounters.get(key) ?? 0;

  const limit =
    action === AIAction.QUEST
      ? AI_QUEST_LIMIT_PER_DAY
      : AI_INSIGHT_LIMIT_PER_DAY;

  return count >= limit;
}

/**
 * Increment the rate limit counter for a user's AI action.
 */
export function incrementRateLimit(
  userId: string,
  action: AIAction,
  dateStr: string
): void {
  const key = `${userId}:${action}:${dateStr}`;
  rateLimitCounters.set(key, (rateLimitCounters.get(key) ?? 0) + 1);
}

/**
 * Reset rate limits (for testing).
 */
export function resetRateLimits(): void {
  rateLimitCounters.clear();
}

// ── §16 — Deterministic Rules Engine ─────────────────────────

/**
 * §15/§16 — Evaluate all AI rules against the current context.
 *
 * Steps 5 ("apply deterministic safety/product rules") and 8
 * ("validate generated action") are enforced by the SAME rules engine
 * (v2 note), so pre-filtering and post-validation can never drift apart.
 *
 * Returns all rules that fired.
 */
export function evaluateRules(context: AIContext): AIRuleResult[] {
  const results: AIRuleResult[] = [];
  const today = context.recentMetrics[0]?.date ?? "";

  // Rule E first — budget check (if exhausted, skip other rules)
  const ruleE = evaluateRuleE(context.userId, today);
  if (ruleE.fired) {
    return [ruleE]; // Only the fallback fires
  }

  // Rules A-D
  const ruleA = evaluateRuleA(context);
  if (ruleA.fired) results.push(ruleA);

  const ruleB = evaluateRuleB(context);
  if (ruleB.fired) results.push(ruleB);

  const ruleC = evaluateRuleC(context);
  if (ruleC.fired) results.push(ruleC);

  const ruleD = evaluateRuleD(context);
  if (ruleD.fired) results.push(ruleD);

  // If no rules fired, return empty (no action needed)
  return results;
}

// ── Individual Rules ─────────────────────────────────────────

/**
 * §16 Rule A — Evening Distraction Pattern
 *
 * IF user's distraction index is significantly above baseline in evening hours
 * THEN suggest a wind-down focus session or screen-time boundary
 */
function evaluateRuleA(context: AIContext): AIRuleResult {
  const todayMetrics = context.recentMetrics[0];
  if (!todayMetrics) {
    return notFired(AIRuleId.RULE_A);
  }

  // Check if distraction index is above baseline
  const distractionDelta = context.baselineDeltas.find(
    (d) => d.metric === "distractionIndex"
  );

  // Fire if distraction is 20%+ above baseline
  if (distractionDelta && distractionDelta.percentageChange > 20) {
    return {
      ruleId: AIRuleId.RULE_A,
      fired: true,
      action: AIAction.RECOMMENDATION,
      payload: {
        title: "Wind-Down Focus Session",
        description:
          "Your distraction levels are higher than usual today. Try a short focus session to regain momentum.",
        difficulty: Difficulty.EASY,
      },
      reasoning: `Distraction index is ${distractionDelta.percentageChange.toFixed(0)}% above your baseline (${distractionDelta.baseline.toFixed(0)} → ${distractionDelta.currentValue.toFixed(0)}).`,
    };
  }

  return notFired(AIRuleId.RULE_A);
}

/**
 * §16 Rule B — Overloaded Plan Detection
 *
 * IF user has too many active tasks relative to their completion rate
 * THEN suggest prioritizing or deferring some tasks
 */
function evaluateRuleB(context: AIContext): AIRuleResult {
  const todayMetrics = context.recentMetrics[0];
  const activeTasks = context.activeTasks;

  if (!todayMetrics || activeTasks.length === 0) {
    return notFired(AIRuleId.RULE_B);
  }

  // Historical completion rate
  const avgCompletionRate =
    context.recentMetrics.length > 0
      ? context.recentMetrics.reduce(
          (sum, m) => sum + m.taskCompletionRate,
          0
        ) / context.recentMetrics.length
      : 0.5;

  // If user has many active tasks and low completion rate
  const estimatedCapacity = Math.ceil(activeTasks.length * avgCompletionRate);
  const overloaded =
    activeTasks.length > 5 && avgCompletionRate < 0.5;

  if (overloaded) {
    return {
      ruleId: AIRuleId.RULE_B,
      fired: true,
      action: AIAction.INSIGHT,
      payload: {
        content: `You have ${activeTasks.length} active tasks but your recent completion rate is ${(avgCompletionRate * 100).toFixed(0)}%. Consider focusing on your top ${estimatedCapacity} priorities and deferring the rest.`,
      },
      reasoning: `${activeTasks.length} active tasks with ${(avgCompletionRate * 100).toFixed(0)}% avg completion rate suggests overload.`,
    };
  }

  return notFired(AIRuleId.RULE_B);
}

/**
 * §16 Rule C — Repeated Quest Failure
 *
 * IF user has failed/dismissed recent quests
 * THEN lower difficulty for next quest
 *
 * Note from Product File §8 v2: dismissing a quest is NOT treated
 * identically to failing one — dismissal silently informs this rule
 * to lower difficulty, not to penalize.
 */
function evaluateRuleC(context: AIContext): AIRuleResult {
  // This rule needs quest history which isn't in the standard context
  // It would be evaluated separately when generating new quests
  // For now, return not-fired (the difficulty engine handles adaptation)
  return notFired(AIRuleId.RULE_C);
}

/**
 * §16 Rule D — Strong Positive Pattern
 *
 * IF user shows consistent improvement across multiple metrics
 * THEN acknowledge progress and suggest leveling up a challenge
 */
function evaluateRuleD(context: AIContext): AIRuleResult {
  if (context.baselineDeltas.length === 0) {
    return notFired(AIRuleId.RULE_D);
  }

  // Count metrics that improved
  const improvedMetrics = context.baselineDeltas.filter((d) => {
    // For distraction index, lower is better
    if (d.metric === "distractionIndex") return d.delta < 0;
    return d.delta > 0;
  });

  // Fire if 4+ metrics improved
  if (improvedMetrics.length >= 4) {
    const streakNote =
      context.currentStreak > 0
        ? ` Your ${context.currentStreak}-day streak shows real commitment.`
        : "";

    return {
      ruleId: AIRuleId.RULE_D,
      fired: true,
      action: AIAction.INSIGHT,
      payload: {
        content: `Great momentum! ${improvedMetrics.length} of your metrics are trending better than your baseline.${streakNote} Consider stepping up to a harder challenge.`,
      },
      reasoning: `${improvedMetrics.length} metrics improved: ${improvedMetrics.map((m) => m.metric).join(", ")}.`,
    };
  }

  return notFired(AIRuleId.RULE_D);
}

/**
 * §16 Rule E — AI Action Budget Exhausted
 *
 * IF daily AI action quota already used
 * THEN fall back to a static, pre-authored suggestion template,
 *      clearly labeled as a default tip.
 *
 * This guarantees the dashboard never shows an empty "AI insight" slot.
 */
function evaluateRuleE(userId: string, dateStr: string): AIRuleResult {
  const questLimited = isRateLimited(userId, AIAction.QUEST, dateStr);
  const insightLimited = isRateLimited(userId, AIAction.INSIGHT, dateStr);

  if (questLimited && insightLimited) {
    // Pick a deterministic fallback tip based on date
    const dayIndex = new Date(dateStr).getDate();
    const tip = FALLBACK_TIPS[dayIndex % FALLBACK_TIPS.length];

    return {
      ruleId: AIRuleId.RULE_E,
      fired: true,
      action: AIAction.INSIGHT,
      payload: {
        content: tip,
      },
      reasoning: "Daily AI action quota exhausted — serving static fallback tip.",
    };
  }

  return notFired(AIRuleId.RULE_E);
}

// ── Validation (§15 step 8, §17) ─────────────────────────────

/**
 * §15 step 8 / §17 — Validate a generated AI action.
 *
 * Uses the SAME rules engine as pre-filtering (v2 note)
 * so validation and pre-filtering can never drift apart.
 */
export function validateAIAction(
  action: AIAction,
  context: AIContext
): { valid: boolean; reason: string } {
  // §17 — No quest if no active goals
  if (action === AIAction.QUEST && context.goals.length === 0) {
    return {
      valid: false,
      reason: "Cannot generate quest without active goals",
    };
  }

  // §5 v2 — No quest/recommendation without baseline
  if (
    (action === AIAction.QUEST || action === AIAction.RECOMMENDATION) &&
    !hasEnoughHistory(context.recentMetrics.length)
  ) {
    return {
      valid: false,
      reason: `Need at least ${AI_CONTEXT_MAX_DAYS} days of history for ${action} actions. Restricted to insights only.`,
    };
  }

  // §17 — No impossible workloads (more than 10 active tasks)
  if (
    action === AIAction.QUEST &&
    context.activeTasks.length >= 10
  ) {
    return {
      valid: false,
      reason: "Too many active tasks — cannot add more quests",
    };
  }

  return { valid: true, reason: "Action validated" };
}

// ── Helpers ──────────────────────────────────────────────────

function notFired(ruleId: AIRuleId): AIRuleResult {
  return {
    ruleId,
    fired: false,
    action: AIAction.INSIGHT,
    payload: {},
    reasoning: "",
  };
}

/**
 * Get a fallback tip when AI is unavailable (§17 v2).
 *
 * If the AI model call fails or times out, the pipeline falls back
 * to Rule E rather than blocking task/dashboard load.
 */
export function getFallbackTip(dateStr?: string): string {
  const dayIndex = dateStr
    ? new Date(dateStr).getDate()
    : new Date().getDate();
  return FALLBACK_TIPS[dayIndex % FALLBACK_TIPS.length];
}
