// ============================================================
// LifeXP — Focus Service
// Maps to Logic System File v2 §8
// Combines focus engine logic + persistence
// ============================================================

import { store } from "./store";
import { awardXp } from "./xp-service";
import {
  validateFocusSession,
  validateFocusTransition,
  calculateActualMinutes,
  calculateExpectedHeartbeats,
} from "../logic/focus-engine";
import type { FocusSession } from "../logic/types";
import {
  Difficulty,
  FocusSessionStatus,
  XPSourceType,
} from "../logic/types";

/**
 * §8 — Start a new focus session.
 */
export function startFocusSession(params: {
  userId: string;
  requiredMinutes: number;
  clientEventId: string;
}): FocusSession {
  const session: FocusSession = {
    id: crypto.randomUUID(),
    clientEventId: params.clientEventId,
    userId: params.userId,
    status: FocusSessionStatus.RUNNING,
    startedAt: new Date(),
    completedAt: null,
    requiredMinutes: params.requiredMinutes,
    actualMinutes: 0,
    heartbeatCount: 0,
    expectedHeartbeats: calculateExpectedHeartbeats(params.requiredMinutes),
  };

  store.focusSessions.set(session.id, session);
  return session;
}

/**
 * §8 v2 — Record a heartbeat ping from the client.
 *
 * Client pings every ~30-60s while the timer runs.
 */
export function recordHeartbeat(sessionId: string): FocusSession {
  const session = store.focusSessions.get(sessionId);
  if (!session) throw new Error(`Focus session not found: ${sessionId}`);

  if (session.status !== FocusSessionStatus.RUNNING) {
    throw new Error(`Cannot record heartbeat for ${session.status} session`);
  }

  const updated: FocusSession = {
    ...session,
    heartbeatCount: session.heartbeatCount + 1,
  };

  store.focusSessions.set(sessionId, updated);
  return updated;
}

/**
 * §8 — Complete a focus session and validate for XP.
 *
 * Validates heartbeats against duration. If suspicious gap detected,
 * session still completes but XP is capped at required_threshold.
 */
export function completeFocusSession(
  sessionId: string,
  streakDays: number = 0
): {
  session: FocusSession;
  xpAwarded: number;
  capped: boolean;
  isDuplicate: boolean;
} {
  const session = store.focusSessions.get(sessionId);
  if (!session) throw new Error(`Focus session not found: ${sessionId}`);

  // If already completed, idempotent return
  if (session.status === FocusSessionStatus.COMPLETED) {
    const existingXp = Array.from(store.xpTransactions.values()).find(
      (tx) =>
        tx.sourceType === XPSourceType.FOCUS_SESSION &&
        tx.sourceId === sessionId
    );
    return {
      session,
      xpAwarded: existingXp?.amount ?? 0,
      capped: false,
      isDuplicate: true,
    };
  }

  // Validate transition
  if (
    !validateFocusTransition(session.status, FocusSessionStatus.COMPLETED)
  ) {
    throw new Error(
      `Cannot complete session in ${session.status} status`
    );
  }

  // Calculate actual minutes
  const completedAt = new Date();
  const actualMinutes = calculateActualMinutes(
    session.startedAt,
    completedAt
  );

  // Update session
  const updatedSession: FocusSession = {
    ...session,
    status: FocusSessionStatus.COMPLETED,
    completedAt,
    actualMinutes,
    expectedHeartbeats: calculateExpectedHeartbeats(actualMinutes),
  };

  store.focusSessions.set(sessionId, updatedSession);

  // Validate session
  const validation = validateFocusSession(updatedSession);

  if (!validation.valid) {
    return {
      session: updatedSession,
      xpAwarded: 0,
      capped: false,
      isDuplicate: false,
    };
  }

  // Award XP (idempotent)
  const { transaction, isNew } = awardXp({
    userId: session.userId,
    sourceType: XPSourceType.FOCUS_SESSION,
    sourceId: sessionId,
    difficulty: Difficulty.NORMAL,
    streakDays,
  });

  return {
    session: updatedSession,
    xpAwarded: transaction.amount,
    capped: validation.capped,
    isDuplicate: !isNew,
  };
}

/**
 * §8 — Abandon a focus session (no XP awarded).
 */
export function abandonFocusSession(sessionId: string): FocusSession {
  const session = store.focusSessions.get(sessionId);
  if (!session) throw new Error(`Focus session not found: ${sessionId}`);

  if (
    !validateFocusTransition(session.status, FocusSessionStatus.ABANDONED)
  ) {
    throw new Error(
      `Cannot abandon session in ${session.status} status`
    );
  }

  const updated: FocusSession = {
    ...session,
    status: FocusSessionStatus.ABANDONED,
    completedAt: new Date(),
    actualMinutes: calculateActualMinutes(session.startedAt, new Date()),
  };

  store.focusSessions.set(sessionId, updated);
  return updated;
}

/**
 * Get user's focus sessions.
 */
export function getUserFocusSessions(userId: string): FocusSession[] {
  return store.getUserFocusSessions(userId);
}
