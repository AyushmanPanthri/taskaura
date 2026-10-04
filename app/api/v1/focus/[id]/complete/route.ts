// ============================================================
// Task Aura — POST /api/v1/focus/:id/complete
// Server-authoritative focus completion & XP award
//
// MIGRATION (Stage 3): Previously wrote XP only to InMemoryStore.
// Now uses focusRepository.completeSessionTransaction() which atomically:
//   1. Writes XP to xp_transactions (PostgreSQL)
//   2. Updates session status to COMPLETED (PostgreSQL)
//   3. Records actual minutes elapsed (PostgreSQL)
// This fixes the P0 data-loss bug where focus XP was lost on restart.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { focusRepository } from "@/lib/repositories/focus-repository";
import { payoutKey, computeRawXp, focusCreditedMinutes } from "@/lib/logic/economy";
import { XPSourceType, RewardType } from "@/lib/logic/types";
import {
  shouldCapXp,
  calculateExpectedHeartbeats,
} from "@/lib/logic/focus-engine";
import { buildCompletionGamification } from "@/lib/services/completion-gamification";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const session = await focusRepository.findById(user.id, id);
    if (!session) {
      return apiError("NOT_FOUND", "Focus session not found", 404);
    }

    const body = await req.json().catch(() => ({}));

    // Server calculates actual minutes from timestamps (client value is advisory only)
    const now = new Date();
    const serverElapsedMs = now.getTime() - session.startedAt.getTime();
    const serverElapsedMinutes = serverElapsedMs / 60_000;

    // Optionally trust client elapsed if it's close to server elapsed (within 20%)
    const clientElapsedSeconds =
      typeof body.clientElapsedSeconds === "number"
        ? body.clientElapsedSeconds
        : undefined;
    const clientMinutes = clientElapsedSeconds
      ? clientElapsedSeconds / 60
      : undefined;

    // Use the lower of client and server times (anti-cheat: can't claim more time than server saw)
    const rawActualMinutes = clientMinutes
      ? Math.min(serverElapsedMinutes, clientMinutes * 1.1) // 10% tolerance
      : serverElapsedMinutes;

    const actualMinutes = Math.round(rawActualMinutes * 10) / 10;

    // Compute credited minutes (enforces min share of planned)
    const credited = focusCreditedMinutes(actualMinutes, session.requiredMinutes);

    // For linked tasks, this session is evidence only — the task pays
    const evidenceOnly = false; // standalone session, not linked

    // Compute XP server-side
    const { raw: rawXp } = computeRawXp({
      kind: "FOCUS_SESSION",
      minutes: credited,
      verification: "FOCUS_VERIFIED",
    });

    // Phase 0 gap fix: Apply heartbeat consistency cap.
    // If the session has far fewer heartbeats than expected for its claimed
    // duration, cap XP at requiredMinutes (the originally planned duration)
    // rather than the full actualMinutes. This catches the exploit of
    // starting a timer, backgrounding the app for hours, and claiming a
    // giant completed session.
    //
    // NOTE: This is a UX/integrity measure — blocking is NOT load-bearing
    // for the economy. Users without the extension are unaffected.
    const expectedHeartbeats = calculateExpectedHeartbeats(actualMinutes);
    const heartbeatSuspicious = shouldCapXp(
      session.heartbeatCount,
      expectedHeartbeats,
      actualMinutes
    );
    let cappedMinutes = credited;
    if (heartbeatSuspicious && credited > session.requiredMinutes) {
      // Cap credited minutes to the planned session length
      cappedMinutes = focusCreditedMinutes(session.requiredMinutes, session.requiredMinutes);
    }
    const { raw: cappedRawXp } = heartbeatSuspicious
      ? computeRawXp({ kind: "FOCUS_SESSION", minutes: cappedMinutes, verification: "FOCUS_VERIFIED" })
      : { raw: rawXp };
    const xpToAward = cappedMinutes > 0 ? Math.max(0, Math.round(cappedRawXp)) : 0;

    // Idempotency key is the payout key — one focus session, one payout
    const idempotencyKey = payoutKey({ type: "FOCUS", id });

    const result = await focusRepository.completeSessionTransaction(
      user.id,
      id,
      actualMinutes,
      idempotencyKey,
      {
        amount: xpToAward,
        baseXp: xpToAward,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
        rewardType: RewardType.COMPLETION,
      }
    );

    const gamification = result.isDuplicate
      ? undefined
      : await buildCompletionGamification({
          userId: user.id,
          xpAwarded: result.xpAwarded,
          capped: heartbeatSuspicious,
          reason: heartbeatSuspicious ? "HEARTBEAT_CAP" : undefined,
          feedbackType: "FOCUS_COMPLETE",
        });

    return apiSuccess({
      session: result.session,
      xpAwarded: result.xpAwarded,
      bonusXp: 0,
      capped: false,
      isDuplicate: result.isDuplicate,
      evidenceOnly,
      ...(gamification ? { gamification } : {}),
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
