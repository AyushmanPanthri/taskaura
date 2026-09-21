// ============================================================
// LifeXP — Focus Session Engine
// Maps to Logic System File v2 §8
// Pure functions — no side effects, no DB access
// ============================================================

import type { FocusSession } from "./types";
import { FocusSessionStatus } from "./types";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_TOLERANCE_RATIO,
} from "./constants";

/**
 * §8 — Calculate expected heartbeat count for a given duration.
 *
 * Client pings every ~30-60s (HEARTBEAT_INTERVAL_SECONDS).
 */
export function calculateExpectedHeartbeats(
  durationMinutes: number
): number {
  const durationSeconds = durationMinutes * 60;
  return Math.floor(durationSeconds / HEARTBEAT_INTERVAL_SECONDS);
}

/**
 * §8 v2 — Check if heartbeat count is suspicious.
 *
 * The server checks that heartbeat count is consistent with claimed
 * duration (with tolerance for brief gaps). This catches the trivial
 * exploit of starting a timer, backgrounding the app for hours, and
 * claiming a giant completed session.
 *
 * Returns true if the session has a suspicious heartbeat gap.
 */
export function shouldCapXp(
  heartbeatCount: number,
  expectedHeartbeats: number,
  durationMinutes: number
): boolean {
  // If very short session, no heartbeat validation needed
  if (durationMinutes <= 1) return false;

  // If no heartbeats expected (shouldn't happen), flag as suspicious
  if (expectedHeartbeats <= 0) return true;

  const ratio = heartbeatCount / expectedHeartbeats;
  return ratio < HEARTBEAT_TOLERANCE_RATIO;
}

/**
 * §8 — Validate a completed focus session.
 *
 * Returns an object describing the validation result:
 * - valid: whether the session qualifies for XP
 * - capped: whether XP should be capped at threshold
 * - reason: human-readable explanation
 */
export function validateFocusSession(session: FocusSession): {
  valid: boolean;
  capped: boolean;
  reason: string;
} {
  // Must be completed
  if (session.status !== FocusSessionStatus.COMPLETED) {
    return {
      valid: false,
      capped: false,
      reason: "Session is not completed",
    };
  }

  // Must meet required threshold
  if (session.actualMinutes < session.requiredMinutes) {
    return {
      valid: false,
      capped: false,
      reason: `Session duration (${session.actualMinutes}m) is less than required (${session.requiredMinutes}m)`,
    };
  }

  // Check heartbeat consistency
  const expected = calculateExpectedHeartbeats(session.actualMinutes);
  if (shouldCapXp(session.heartbeatCount, expected, session.actualMinutes)) {
    return {
      valid: true,
      capped: true,
      reason:
        "Session heartbeats inconsistent with duration — XP capped at threshold",
    };
  }

  return {
    valid: true,
    capped: false,
    reason: "Session validated successfully",
  };
}

/**
 * Calculate actual minutes from start/end timestamps.
 */
export function calculateActualMinutes(
  startedAt: Date,
  completedAt: Date
): number {
  const diffMs = completedAt.getTime() - startedAt.getTime();
  return Math.max(0, diffMs / (1000 * 60));
}

/**
 * Valid focus session state transitions.
 */
const FOCUS_TRANSITIONS: Record<
  FocusSessionStatus,
  FocusSessionStatus[]
> = {
  [FocusSessionStatus.RUNNING]: [
    FocusSessionStatus.COMPLETED,
    FocusSessionStatus.ABANDONED,
  ],
  [FocusSessionStatus.COMPLETED]: [],
  [FocusSessionStatus.ABANDONED]: [],
};

/**
 * Validate a focus session status transition.
 */
export function validateFocusTransition(
  currentStatus: FocusSessionStatus,
  targetStatus: FocusSessionStatus
): boolean {
  return (
    FOCUS_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false
  );
}
