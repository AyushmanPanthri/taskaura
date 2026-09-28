// ============================================================
// Task Aura — Anti-Farming & Suspicious Pattern Detector
// Deterministic (non-AI), server-side rule engine
// ============================================================

import { ANTI_FARMING_CONFIG } from "./economy";

export type SuspiciousPatternClassification = "NORMAL" | "SUSPICIOUS" | "BLOCKED_REWARD";

export interface PatternDetectionInput {
  currentTaskId: string;
  currentTaskTitle: string;
  currentTaskDifficulty: string;
  serverDurationMs: number;
  minimumRequiredDurationMs: number;

  /** Recent completions within the last 24 hours (most recent first) */
  recentCompletions: Array<{
    taskId: string;
    title: string;
    completedAt: Date;
    difficulty: string;
  }>;

  /** Number of rejected completion attempts in the last 24 hours */
  rejectedAttemptsLast24h: number;

  /** Number of HARD/EPIC tasks created and abandoned/cancelled in the last 24 hours */
  abandonedHardEpicCountLast24h: number;

  /** Trailing 7-day average daily completions (excluding today) */
  trailing7DayAverageDailyCompletions: number;

  /** Total successful completions today */
  todayCompletionsCount: number;

  /** Current server timestamp */
  now: Date;
}

export interface PatternDetectionResult {
  classification: SuspiciousPatternClassification;
  signals: string[];
  blockReward: boolean;
  requiresFlaggedAudit: boolean;
}

/**
 * Deterministically evaluates task completion patterns to detect farming,
 * automated scripting, or rapid abuse.
 *
 * Output actions:
 * - NORMAL: Standard execution, full calculated XP awarded.
 * - SUSPICIOUS: XP is paid normally, but a flagged audit event is created
 *   for admin review in AdminAuditLog.
 * - BLOCKED_REWARD: Task completion is recorded, but XP = 0 and a high-priority
 *   security audit event is created. Block applies only to this completion.
 */
export function evaluateSuspiciousPatterns(
  input: PatternDetectionInput
): PatternDetectionResult {
  const signals: string[] = [];

  const burstWindowStart = new Date(
    input.now.getTime() - ANTI_FARMING_CONFIG.suspiciousBurstWindowMs
  );

  // 1. Rapid completions in unusually short interval (burst window)
  const burstCompletions = input.recentCompletions.filter(
    (c) => c.completedAt >= burstWindowStart
  );

  if (burstCompletions.length >= ANTI_FARMING_CONFIG.suspiciousBurstCount) {
    signals.push(
      `Burst completions detected: ${burstCompletions.length} tasks completed within 10 minutes (threshold: ${ANTI_FARMING_CONFIG.suspiciousBurstCount})`
    );
  } else if (burstCompletions.length >= 3) {
    signals.push(
      `Elevated completion velocity: ${burstCompletions.length} tasks completed within 10 minutes`
    );
  }

  // 2. Repeated identical task titles within 24h
  const normalizedTitle = input.currentTaskTitle.trim().toLowerCase();
  const identicalTitles = input.recentCompletions.filter(
    (c) => c.title.trim().toLowerCase() === normalizedTitle
  );
  if (identicalTitles.length >= 4) {
    signals.push(
      `Repeated identical titles: "${input.currentTaskTitle}" completed ${identicalTitles.length + 1} times in 24h`
    );
  }

  // 3. Repeated minimum-duration or below-minimum rejected attempts
  if (
    input.rejectedAttemptsLast24h >=
    ANTI_FARMING_CONFIG.suspiciousRejectedAttemptsThreshold
  ) {
    signals.push(
      `High rejected attempt frequency: ${input.rejectedAttemptsLast24h} attempts failed timing/eligibility in 24h (threshold: ${ANTI_FARMING_CONFIG.suspiciousRejectedAttemptsThreshold})`
    );
  }

  // 4. Repeatedly creating HARD/EPIC tasks only to abandon or fail them
  if (
    input.abandonedHardEpicCountLast24h >=
    ANTI_FARMING_CONFIG.suspiciousAbandonHardEpicCount
  ) {
    signals.push(
      `Repeated HARD/EPIC abandonment: ${input.abandonedHardEpicCountLast24h} high-tier tasks abandoned in 24h (threshold: ${ANTI_FARMING_CONFIG.suspiciousAbandonHardEpicCount})`
    );
  }

  // 5. Abnormal daily completion volume relative to user's trailing 7-day baseline
  if (
    input.todayCompletionsCount >=
    ANTI_FARMING_CONFIG.suspiciousDailyBaselineMinFloor
  ) {
    const baseline = Math.max(1, input.trailing7DayAverageDailyCompletions);
    const velocityRatio = input.todayCompletionsCount / baseline;
    if (velocityRatio >= ANTI_FARMING_CONFIG.suspiciousDailyBaselineMultiplier) {
      signals.push(
        `Volume velocity spike: today's completions (${input.todayCompletionsCount}) is ${velocityRatio.toFixed(1)}x trailing 7-day baseline (${baseline.toFixed(1)}/day)`
      );
    }
  }

  // Determine classification
  // Severe signals trigger BLOCKED_REWARD:
  // - Critical burst >= 5 in 10m
  // - Repeated identical titles >= 5
  // - High rejections >= 3 combined with another anomaly
  const hasSevereBurst = burstCompletions.length >= ANTI_FARMING_CONFIG.suspiciousBurstCount;
  const hasSevereDuplication = identicalTitles.length >= 5;
  const hasSevereRejectionHistory =
    input.rejectedAttemptsLast24h >=
    ANTI_FARMING_CONFIG.suspiciousRejectedAttemptsThreshold;

  if (hasSevereBurst || hasSevereDuplication || (hasSevereRejectionHistory && signals.length >= 2)) {
    return {
      classification: "BLOCKED_REWARD",
      signals,
      blockReward: true,
      requiresFlaggedAudit: true,
    };
  }

  if (signals.length > 0) {
    return {
      classification: "SUSPICIOUS",
      signals,
      blockReward: false,
      requiresFlaggedAudit: true,
    };
  }

  return {
    classification: "NORMAL",
    signals: [],
    blockReward: false,
    requiresFlaggedAudit: false,
  };
}
