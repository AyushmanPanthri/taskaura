// ============================================================
// Task Aura — XP Service
// Maps to Logic System File v2 §9 (XP engine) and §10 (levels)
// Combines logic + persistence through the store
//
// v2 rules enforced here:
//   • One activity, one payout  → key = payout:{rootType}:{rootId}
//   • Streak bonus once per day → separate ledger entry, key streak:{date}
//   • Daily soft cap            → payout XP above 1,000/day paid at 25%
//   • Never edit the ledger     → corrections are negative reversal rows
// ============================================================

import { store } from "./store";
import {
  ECONOMY,
  applySoftCap,
  computeRawXp,
  dailyGoalKey,
  levelFor,
  levelProgress as levelProgressDetail,
  localDateString,
  payoutKey,
  reversalKey,
  streakBonusKey,
  streakBonusXp,
  focusCreditedMinutes,
} from "../logic/economy";
import type {
  LevelProgress,
  PayoutKind,
  RootType,
  VerificationKind,
  XpBreakdown,
} from "../logic/economy";
import { validateFocusSession } from "../logic/focus-engine";
import type { XPTransaction } from "../logic/types";
import {
  Difficulty,
  FocusSessionStatus,
  RewardType,
  XPSourceType,
} from "../logic/types";

const newId = (): string => crypto.randomUUID();

/** Bonus entries never count toward the daily soft cap. */
const BONUS_SOURCES = new Set<string>([
  String(XPSourceType.DAILY_GOAL),
  String(XPSourceType.STREAK_BONUS),
]);

export function getUserTimeZone(userId: string): string {
  return store.users.get(userId)?.timezone ?? "UTC";
}

// ── Payouts ──────────────────────────────────────────────────

export interface PayoutResult {
  /** null only when there was nothing to pay */
  transaction: XPTransaction | null;
  paidXp: number;
  /** false when this root activity had already been paid (idempotent retry) */
  isNew: boolean;
  softCapped: boolean;
}

/** Payout XP already earned by the user on a local date (bonuses excluded). */
export function payoutXpEarnedOn(userId: string, localDate: string): number {
  const tz = getUserTimeZone(userId);
  let sum = 0;
  for (const t of store.getUserXpTransactions(userId)) {
    if (BONUS_SOURCES.has(String(t.sourceType))) continue;
    if (localDateString(t.createdAt, tz) !== localDate) continue;
    sum += t.amount;
  }
  return sum;
}

/**
 * §9.3/§9.4 — Pay the ROOT activity exactly once.
 *
 * Root = quest > task > focus session. A focus session linked to a task or
 * quest is evidence only and never calls this function itself; the parent
 * pays. XP is computed here from server-side rules and never from client input.
 */
export function awardPayout(params: {
  userId: string;
  sourceType: XPSourceType;
  root: { type: RootType; id: string };
  kind: PayoutKind;
  minutes?: number | null;
  difficulty?: Difficulty | string;
  verification?: VerificationKind;
  /** Server clock. Only tests and internal callers pass this. */
  now?: Date;
}): PayoutResult {
  const { userId, sourceType, root, kind } = params;
  const now = params.now ?? new Date();
  const key = payoutKey(root);

  // Idempotent: the same root can never pay twice, whatever the reward type.
  const existing = store.getXpTransactionByKey(userId, key);
  if (existing) {
    return {
      transaction: existing,
      paidXp: existing.amount,
      isNew: false,
      softCapped: existing.breakdown?.softCapped ?? false,
    };
  }

  // Base XP stays tunable through the store config, with a safe default.
  const baseXp =
    store.taskTypeConfigs.get(String(sourceType))?.baseXp ?? undefined;

  const { raw, breakdown } = computeRawXp({
    kind,
    baseXp,
    minutes: params.minutes,
    difficulty: params.difficulty ? String(params.difficulty) : undefined,
    verification: params.verification,
  });

  const tz = getUserTimeZone(userId);
  const localDate = localDateString(now, tz);
  const earned = payoutXpEarnedOn(userId, localDate);
  const paid = applySoftCap(raw, earned);

  if (paid <= 0) {
    return { transaction: null, paidXp: 0, isNew: false, softCapped: false };
  }

  const tx: XPTransaction = {
    id: newId(),
    userId,
    amount: paid,
    sourceType,
    sourceId: root.id,
    rewardType: RewardType.COMPLETION,
    idempotencyKey: key,
    baseXp: breakdown.base,
    difficultyMultiplier: breakdown.difficulty,
    streakBonus: 0, // streak bonus is its own daily ledger entry (v2)
    createdAt: now,
    breakdown: { ...breakdown, paid, softCapped: paid < raw },
  };

  if (!store.addXpTransaction(tx)) {
    // Lost a race with an identical request: return the winner.
    const winner = store.getXpTransactionByKey(userId, key)!;
    return {
      transaction: winner,
      paidXp: winner.amount,
      isNew: false,
      softCapped: winner.breakdown?.softCapped ?? false,
    };
  }
  return { transaction: tx, paidXp: paid, isNew: true, softCapped: paid < raw };
}

// ── Daily goal and streak bonus (once per local day) ─────────

function addBonus(
  userId: string,
  sourceType: XPSourceType,
  key: string,
  localDate: string,
  amount: number,
  now: Date
): number {
  const tx: XPTransaction = {
    id: newId(),
    userId,
    amount,
    sourceType,
    sourceId: localDate,
    rewardType: RewardType.COMPLETION,
    idempotencyKey: key,
    baseXp: amount,
    difficultyMultiplier: 1,
    streakBonus: 0,
    createdAt: now,
    breakdown: {
      kind: String(sourceType),
      minutes: null,
      base: amount,
      effort: 1,
      difficulty: 1,
      difficultyName: "NORMAL",
      verification: 1,
      verificationKind: "FOCUS_VERIFIED",
      raw: amount,
      paid: amount,
      softCapped: false,
    },
  };
  return store.addXpTransaction(tx) ? amount : 0;
}

/**
 * Grant DAILY_GOAL (+50) and STREAK_BONUS (min(5 × streak, 50)) — each at most
 * once per local day, whatever number of activities trigger the call.
 * `streakDays` = the user's streak length including today.
 */
export function grantDailyBonuses(
  userId: string,
  streakDays: number,
  now: Date = new Date()
): { dailyGoalXp: number; streakBonusXp: number } {
  const localDate = localDateString(now, getUserTimeZone(userId));
  const dailyGoalXp = addBonus(
    userId,
    XPSourceType.DAILY_GOAL,
    dailyGoalKey(localDate),
    localDate,
    ECONOMY.dailyGoalXp,
    now
  );
  const bonus = streakBonusXp(streakDays);
  const streak =
    bonus > 0
      ? addBonus(
          userId,
          XPSourceType.STREAK_BONUS,
          streakBonusKey(localDate),
          localDate,
          bonus,
          now
        )
      : 0;
  return { dailyGoalXp, streakBonusXp: streak };
}

/** Verified focus minutes the user has completed on a local date. */
export function verifiedFocusMinutesOn(
  userId: string,
  localDate: string
): number {
  const tz = getUserTimeZone(userId);
  return store
    .getUserFocusSessions(userId)
    .filter(
      (s) =>
        s.status === FocusSessionStatus.COMPLETED &&
        s.completedAt != null &&
        localDateString(s.completedAt, tz) === localDate &&
        validateFocusSession(s).valid
    )
    .reduce(
      (sum, s) => sum + focusCreditedMinutes(s.actualMinutes, s.requiredMinutes),
      0
    );
}

/** Default daily commitment: 25 verified focus minutes, or every habit logged. */
export function isDailyCommitmentMet(userId: string, now: Date): boolean {
  const localDate = localDateString(now, getUserTimeZone(userId));
  if (verifiedFocusMinutesOn(userId, localDate) >= ECONOMY.dailyCommitmentFocusMinutes) {
    return true;
  }
  const habits = store.getUserHabits(userId);
  if (habits.length === 0) return false;
  const done = new Set(
    store
      .getUserHabitLogs(userId)
      .filter((l) => l.date === localDate && l.completed)
      .map((l) => l.habitId)
  );
  return habits.every((h) => done.has(h.id));
}

/** Call after any payout: grants the daily bonuses the first time the commitment is met. */
export function maybeGrantDailyBonuses(
  userId: string,
  streakDays: number,
  now: Date = new Date()
): { dailyGoalXp: number; streakBonusXp: number } {
  if (!isDailyCommitmentMet(userId, now)) {
    return { dailyGoalXp: 0, streakBonusXp: 0 };
  }
  return grantDailyBonuses(userId, streakDays, now);
}

// ── Reversals and adjustments (never edit or delete) ─────────

/**
 * Undo a payout with an offsetting negative row. One reversal per original
 * (key reversal:{id}), so double-clicking Undo cannot subtract twice.
 */
export function reverseTransaction(
  userId: string,
  originalTransactionId: string,
  reason: string,
  now: Date = new Date()
): { transaction: XPTransaction; isNew: boolean } {
  const original = store.xpTransactions.get(originalTransactionId);
  if (!original || original.userId !== userId) {
    throw new Error(`Transaction not found: ${originalTransactionId}`);
  }
  if (original.amount <= 0) {
    throw new Error("Only positive transactions can be reversed");
  }
  const key = reversalKey(originalTransactionId);
  const existing = store.getXpTransactionByKey(userId, key);
  if (existing) return { transaction: existing, isNew: false };

  const tx: XPTransaction = {
    id: newId(),
    userId,
    amount: -original.amount,
    sourceType: XPSourceType.ADJUSTMENT,
    sourceId: `reversal:${originalTransactionId}`,
    rewardType: RewardType.ADJUSTMENT,
    idempotencyKey: key,
    baseXp: 0,
    difficultyMultiplier: 1,
    streakBonus: 0,
    status: "VALID",
    reversesId: originalTransactionId,
    createdAt: now,
    breakdown: {
      kind: "REVERSAL",
      minutes: null,
      base: 0,
      effort: 1,
      difficulty: 1,
      difficultyName: "NORMAL",
      verification: 1,
      verificationKind: "FOCUS_VERIFIED",
      raw: -original.amount,
      paid: -original.amount,
      softCapped: false,
      note: reason,
    },
  };
  store.addXpTransaction(tx);
  return { transaction: tx, isNew: true };
}

/** Free-form correction (positive or negative). Prefer reverseTransaction for undo. */
export function createAdjustment(
  userId: string,
  originalTransactionId: string,
  adjustmentAmount: number,
  reason: string
): { transaction: XPTransaction; isNew: boolean } {
  return awardXp({
    userId,
    sourceType: XPSourceType.ADJUSTMENT,
    sourceId: `adj:${originalTransactionId}:${reason}`,
    rewardType: RewardType.ADJUSTMENT,
    overrideAmount: adjustmentAmount,
  });
}

// ── Legacy entry point ───────────────────────────────────────

/**
 * @deprecated Use awardPayout. Kept so existing callers (habits, API routes)
 * keep compiling. It now routes through the same one-payout-per-root logic,
 * and no longer adds a streak bonus to each payout (streakDays is ignored).
 */
export function awardXp(params: {
  userId: string;
  sourceType: XPSourceType;
  sourceId: string;
  rewardType?: RewardType;
  difficulty?: Difficulty;
  streakDays?: number;
  overrideAmount?: number;
}): { transaction: XPTransaction; isNew: boolean } {
  const { userId, sourceType, sourceId, difficulty, overrideAmount } = params;

  if (overrideAmount !== undefined || sourceType === XPSourceType.ADJUSTMENT) {
    const key = `adjust:${sourceId}`;
    const existing = store.getXpTransactionByKey(userId, key);
    if (existing) return { transaction: existing, isNew: false };
    const amount = overrideAmount ?? 0;
    const tx: XPTransaction = {
      id: newId(),
      userId,
      amount,
      sourceType,
      sourceId,
      rewardType: params.rewardType ?? RewardType.ADJUSTMENT,
      idempotencyKey: key,
      baseXp: 0,
      difficultyMultiplier: 1,
      streakBonus: 0,
      createdAt: new Date(),
      breakdown: {
        kind: "ADJUSTMENT",
        minutes: null,
        base: 0,
        effort: 1,
        difficulty: 1,
        difficultyName: "NORMAL",
        verification: 1,
        verificationKind: "FOCUS_VERIFIED",
        raw: amount,
        paid: amount,
        softCapped: false,
      },
    };
    store.addXpTransaction(tx);
    return { transaction: tx, isNew: true };
  }

  const s = String(sourceType);
  const kind: PayoutKind = s.includes("FOCUS")
    ? "FOCUS_SESSION"
    : s.includes("HABIT")
    ? "HABIT"
    : s.includes("QUEST")
    ? "AI_QUEST"
    : "TASK";
  const rootType: RootType =
    kind === "FOCUS_SESSION" ? "FOCUS" : kind === "HABIT" ? "HABIT" : "TASK";

  const result = awardPayout({
    userId,
    sourceType,
    root: { type: rootType, id: sourceId },
    kind,
    difficulty,
    verification: "SELF_CONFIRMED",
  });
  if (!result.transaction) throw new Error("No XP to award");
  return { transaction: result.transaction, isNew: result.isNew };
}

// ── Queries ──────────────────────────────────────────────────

export function getTotalXp(userId: string): number {
  return store.getTotalXp(userId);
}

/** Level derived from total XP through the v2 level table (never stored). */
export function getUserLevel(userId: string): number {
  return levelFor(getTotalXp(userId));
}

/** 0.0 – 1.0 progress inside the current level. */
export function getUserLevelProgress(userId: string): number {
  return levelProgressDetail(getTotalXp(userId)).fraction;
}

/** Everything the dashboard needs in one call. */
export function getUserProgress(
  userId: string
): LevelProgress & { totalXp: number } {
  const totalXp = getTotalXp(userId);
  return { totalXp, ...levelProgressDetail(totalXp) };
}

export function getXpHistory(userId: string): XPTransaction[] {
  return store
    .getUserXpTransactions(userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type { XpBreakdown };
