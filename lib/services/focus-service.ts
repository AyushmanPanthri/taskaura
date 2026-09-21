// ============================================================
// Task Aura — Focus Service
// Maps to Logic System File v2 §8 (focus sessions) and §9 (XP engine)
// Combines focus engine logic + persistence
//
// v2 rules enforced here:
//   • One RUNNING session per user (stale ones are abandoned)
//   • A session may be linked to a task/quest at START (immutable)
//   • A linked session is EVIDENCE: the parent task/quest pays once,
//     the session never pays separately
//   • XP is decided on the server from server timestamps
// ============================================================

import { store } from "./store";
import { awardPayout, maybeGrantDailyBonuses } from "./xp-service";
import { completeTask, taskRootRef } from "./task-service";
import {
  ECONOMY,
  focusCreditedMinutes,
  payoutKey,
} from "../logic/economy";
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
  TaskSource,
  TaskStatus,
  XPSourceType,
} from "../logic/types";

/**
 * §8 — Start a new focus session.
 *
 * Retrying with the same clientEventId returns the existing session.
 */
export function startFocusSession(params: {
  userId: string;
  requiredMinutes: number;
  clientEventId: string;
  /** Optional: link the session to a task (or an AI quest task). Immutable. */
  taskId?: string;
}): FocusSession {
  const { userId, requiredMinutes, clientEventId } = params;

  // Idempotent retry
  const retry = store
    .getUserFocusSessions(userId)
    .find((s) => s.clientEventId === clientEventId);
  if (retry) return retry;

  if (
    !Number.isFinite(requiredMinutes) ||
    requiredMinutes < ECONOMY.focusPlannedMinMinutes ||
    requiredMinutes > ECONOMY.focusPlannedMaxMinutes
  ) {
    throw new Error(
      `requiredMinutes must be between ${ECONOMY.focusPlannedMinMinutes} and ${ECONOMY.focusPlannedMaxMinutes}`
    );
  }

  // Only one RUNNING session per user; stale ones are abandoned.
  const now = new Date();
  for (const s of store.getUserFocusSessions(userId)) {
    if (s.status !== FocusSessionStatus.RUNNING) continue;
    const staleAfterMs =
      (s.requiredMinutes + ECONOMY.focusStaleGraceMinutes) * 60_000;
    if (now.getTime() - s.startedAt.getTime() > staleAfterMs) {
      abandonFocusSession(s.id);
    } else {
      throw new Error("A focus session is already running");
    }
  }

  // Optional link to a task / quest
  let taskId: string | null = null;
  if (params.taskId) {
    const task = store.tasks.get(params.taskId);
    if (!task || task.userId !== userId) {
      throw new Error(`Task not found: ${params.taskId}`);
    }
    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.CANCELLED ||
      task.status === TaskStatus.EXPIRED
    ) {
      throw new Error(`Cannot link a ${task.status} task`);
    }
    taskId = task.id;
  }

  const session: FocusSession = {
    id: crypto.randomUUID(),
    clientEventId,
    userId,
    status: FocusSessionStatus.RUNNING,
    startedAt: now, // server time is authoritative
    completedAt: null,
    requiredMinutes,
    actualMinutes: 0,
    heartbeatCount: 0,
    expectedHeartbeats: calculateExpectedHeartbeats(requiredMinutes),
    taskId,
  };

  store.focusSessions.set(session.id, session);
  return session;
}

/**
 * §8 — Record a heartbeat ping from the client (~every 30–60 s).
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

/** XP already paid for a finished session (standalone or via its parent). */
function paidForSession(session: FocusSession): number {
  const linked = session.taskId ? store.tasks.get(session.taskId) : undefined;
  const root = linked
    ? taskRootRef(linked)
    : ({ type: "FOCUS", id: session.id } as const);
  return store.getXpTransactionByKey(session.userId, payoutKey(root))?.amount ?? 0;
}

/**
 * §8 — Complete a focus session.
 *
 * Duration comes from server timestamps, never from the client.
 *   • Standalone session  → pays FOCUS_SESSION once.
 *   • Linked to an AI quest task → completes the quest task, which pays once.
 *   • Linked to an ordinary task → evidence only (0 XP now); the task pays,
 *     at the verified rate, when the user completes it.
 *
 * `streakDays` = the user's streak including today (used for the daily bonus).
 */
export function completeFocusSession(
  sessionId: string,
  streakDays: number = 0
): {
  session: FocusSession;
  xpAwarded: number;
  bonusXp: number;
  capped: boolean;
  isDuplicate: boolean;
  /** true when the session counted only as proof for a linked task */
  evidenceOnly: boolean;
} {
  const session = store.focusSessions.get(sessionId);
  if (!session) throw new Error(`Focus session not found: ${sessionId}`);

  // Already completed: idempotent return.
  if (session.status === FocusSessionStatus.COMPLETED) {
    return {
      session,
      xpAwarded: paidForSession(session),
      bonusXp: 0,
      capped: false,
      isDuplicate: true,
      evidenceOnly: false,
    };
  }

  if (!validateFocusTransition(session.status, FocusSessionStatus.COMPLETED)) {
    throw new Error(`Cannot complete session in ${session.status} status`);
  }

  const completedAt = new Date(); // server clock
  const actualMinutes = calculateActualMinutes(session.startedAt, completedAt);

  const updatedSession: FocusSession = {
    ...session,
    status: FocusSessionStatus.COMPLETED,
    completedAt,
    actualMinutes,
    expectedHeartbeats: calculateExpectedHeartbeats(actualMinutes),
  };
  store.focusSessions.set(sessionId, updatedSession);

  const validation = validateFocusSession(updatedSession);
  const credited = focusCreditedMinutes(actualMinutes, session.requiredMinutes);

  if (!validation.valid || credited === 0) {
    return {
      session: updatedSession,
      xpAwarded: 0,
      bonusXp: 0,
      capped: false,
      isDuplicate: false,
      evidenceOnly: false,
    };
  }

  // Linked session: the parent is paid, never the session itself.
  const parent = updatedSession.taskId
    ? store.tasks.get(updatedSession.taskId)
    : undefined;
  if (parent) {
    const isQuest = parent.source === TaskSource.AI || parent.questId != null;
    if (isQuest && parent.status !== TaskStatus.COMPLETED) {
      const done = completeTask(parent.id, streakDays, completedAt);
      return {
        session: updatedSession,
        xpAwarded: done.xpAwarded,
        bonusXp: done.bonusXp,
        capped: validation.capped,
        isDuplicate: done.isDuplicate,
        evidenceOnly: false,
      };
    }
    return {
      session: updatedSession,
      xpAwarded: 0,
      bonusXp: 0,
      capped: validation.capped,
      isDuplicate: false,
      evidenceOnly: true,
    };
  }

  // Standalone session
  const payout = awardPayout({
    userId: session.userId,
    sourceType: XPSourceType.FOCUS_SESSION,
    root: { type: "FOCUS", id: sessionId },
    kind: "FOCUS_SESSION",
    minutes: credited,
    difficulty: Difficulty.NORMAL,
    now: completedAt,
  });
  const bonus = maybeGrantDailyBonuses(session.userId, streakDays, completedAt);

  return {
    session: updatedSession,
    xpAwarded: payout.paidXp,
    bonusXp: bonus.dailyGoalXp + bonus.streakBonusXp,
    capped: validation.capped || payout.softCapped,
    isDuplicate: !payout.isNew,
    evidenceOnly: false,
  };
}

/**
 * §8 — Abandon a focus session (no XP awarded).
 */
export function abandonFocusSession(sessionId: string): FocusSession {
  const session = store.focusSessions.get(sessionId);
  if (!session) throw new Error(`Focus session not found: ${sessionId}`);

  if (!validateFocusTransition(session.status, FocusSessionStatus.ABANDONED)) {
    throw new Error(`Cannot abandon session in ${session.status} status`);
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
