import { describe, it, expect, beforeEach } from "vitest";
import {
  cumulativeXp,
  xpToNext,
  levelFor,
  levelProgress,
  computeRawXp,
  applySoftCap,
  streakBonusXp,
  focusCreditedMinutes,
  roundXp,
  payoutKey,
  LEVEL_CONFIG,
  VerificationKind,
} from "../lib/logic/economy";
import {
  validateTaskTransition,
} from "../lib/logic/task-engine";
import {
  closeDay,
  isCommitmentMet,
  StreakDayState,
} from "../lib/logic/streak";
import {
  evaluateAchievements,
  ACHIEVEMENT_DEFINITIONS,
} from "../lib/logic/achievement-engine";
import { getWeekStart, getWeekEnd, computeWeeklyScores } from "../lib/logic/leaderboard";
import { store } from "../lib/services/store";
import {
  createTask,
  completeTask,
} from "../lib/services/task-service";
import {
  startFocusSession,
  completeFocusSession,
} from "../lib/services/focus-service";
import {
  reverseTransaction,
} from "../lib/services/xp-service";
import {
  Difficulty,
  FocusSessionStatus,
  TaskStatus,
  XPSourceType,
  RewardType,
  XPTransaction,
} from "../lib/logic/types";

const USER = "user-hardening-test";

beforeEach(() => {
  store.reset();
});

// ============================================================
// STEP 4 & 24 — LEVEL SYSTEM TESTS
// ============================================================
describe("Level System (§10 & Invariant I3)", () => {
  it("computes exact cumulative XP for early levels", () => {
    expect(cumulativeXp(1)).toBe(0);
    expect(cumulativeXp(2)).toBe(300);
    expect(cumulativeXp(3)).toBe(700);
    expect(cumulativeXp(4)).toBe(1200);
    expect(cumulativeXp(5)).toBe(1800);
    expect(cumulativeXp(6)).toBe(2500);
    expect(cumulativeXp(8)).toBe(4200);
    expect(cumulativeXp(10)).toBe(6300);
    expect(cumulativeXp(12)).toBe(8800);
    expect(cumulativeXp(15)).toBe(13300);
    expect(cumulativeXp(18)).toBe(18700);
    expect(cumulativeXp(20)).toBe(22800);
  });

  it("xp_to_next matches spec formula: 100 * (L + 2)", () => {
    expect(xpToNext(1)).toBe(300);
    expect(xpToNext(2)).toBe(400);
    expect(xpToNext(18)).toBe(2000);
    expect(xpToNext(20)).toBe(2200);
  });

  it("handles 0 XP and 1 XP correctly", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(1)).toBe(1);
    expect(levelFor(-50)).toBe(1); // floor clamp
  });

  it("Invariant I3: levelFor(cumulative(L)) = L and levelFor(cumulative(L) - 1) = L - 1 for L = 2..100", () => {
    for (let L = 2; L <= 100; L++) {
      const boundary = cumulativeXp(L);
      expect(levelFor(boundary)).toBe(L);
      expect(levelFor(boundary - 1)).toBe(L - 1);
      expect(levelFor(boundary + 1)).toBe(L);
    }
  });

  it("handles very large XP without overflow or errors", () => {
    expect(levelFor(1_000_000)).toBeGreaterThan(100);
    expect(levelProgress(1_000_000).fraction).toBeGreaterThanOrEqual(0);
    expect(levelProgress(1_000_000).fraction).toBeLessThan(1);
  });

  it("level progress computes accurate xpIntoLevel and fraction", () => {
    // Level 18 is at 18,700 XP, xpToNext is 2,000 XP.
    // Dashboard example: Level 18 with 1,880 / 2,000 XP = 20,580 total XP.
    const p = levelProgress(20580);
    expect(p.level).toBe(18);
    expect(p.xpIntoLevel).toBe(1880);
    expect(p.xpToNext).toBe(2000);
    expect(p.fraction).toBeCloseTo(1880 / 2000, 5);
  });

  it("LEVEL_CONFIG contains 100 levels with titles every 5 levels", () => {
    expect(LEVEL_CONFIG).toHaveLength(100);
    expect(LEVEL_CONFIG[0].title).toBe("Novice");
    expect(LEVEL_CONFIG[4].title).toBe("Apprentice");
    expect(LEVEL_CONFIG[9].title).toBe("Adept");
    expect(LEVEL_CONFIG[14].title).toBe("Focus Knight");
    expect(LEVEL_CONFIG[19].title).toBe("Master");
    expect(LEVEL_CONFIG[99].title).toBe("Zenith");
  });
});

// ============================================================
// STEP 6, 7 & 8 — XP FORMULA & WORKED EXAMPLES
// ============================================================
describe("XP Formula & Worked Examples (§9.2)", () => {
  it("Worked Example 1: Standalone 45-min timed session = 100 XP", () => {
    const { raw } = computeRawXp({
      kind: "FOCUS_SESSION",
      minutes: 45,
      difficulty: "NORMAL",
      verification: "FOCUS_VERIFIED",
    });
    expect(raw).toBe(100);
  });

  it("Worked Example 2: 45-min AI quest linked session = 150 XP", () => {
    const { raw } = computeRawXp({
      kind: "AI_QUEST",
      minutes: 45,
      difficulty: "NORMAL",
      verification: "FOCUS_VERIFIED",
    });
    expect(raw).toBe(150);
  });

  it("Worked Example 3: 30-min normal self-confirmed task = 120 XP", () => {
    const { raw } = computeRawXp({
      kind: "TASK",
      minutes: 30,
      difficulty: "NORMAL",
      verification: "SELF_CONFIRMED",
    });
    expect(raw).toBe(120);
  });

  it("Worked Example 4: 5-min easy self-confirmed task (clamp floor 0.4) = 38 XP", () => {
    const { raw } = computeRawXp({
      kind: "TASK",
      minutes: 5,
      difficulty: "EASY",
      verification: "SELF_CONFIRMED",
    });
    expect(raw).toBe(38);
  });

  it("Worked Example 5: 60-min hard linked task (clamp ceiling 1.5) = 281 XP", () => {
    const { raw } = computeRawXp({
      kind: "TASK",
      minutes: 60,
      difficulty: "HARD",
      verification: "FOCUS_VERIFIED",
    });
    expect(raw).toBe(281);
  });

  it("Worked Example 6: Daily soft cap (950 earned, 200 raw) = 88 XP", () => {
    expect(applySoftCap(200, 950)).toBe(88);
  });

  it("enforces authoritative rounding policy roundXp()", () => {
    expect(roundXp(87.5)).toBe(88);
    expect(roundXp(38.4)).toBe(38);
    expect(roundXp(281.25)).toBe(281);
    expect(roundXp(NaN)).toBe(0);
    expect(roundXp(Infinity)).toBe(0);
  });

  describe("Invalid Input Policy (Step 8)", () => {
    it("rejects negative minutes and awards 0 XP", () => {
      const { raw } = computeRawXp({
        kind: "TASK",
        minutes: -15,
        difficulty: "NORMAL",
        verification: "SELF_CONFIRMED",
      });
      expect(raw).toBe(0);
    });

    it("treats zero minutes as no meaningful reward (0 XP)", () => {
      const { raw } = computeRawXp({
        kind: "TASK",
        minutes: 0,
        difficulty: "NORMAL",
        verification: "SELF_CONFIRMED",
      });
      expect(raw).toBe(0);
    });

    it("falls back invalid difficulty to NORMAL", () => {
      const { raw } = computeRawXp({
        kind: "TASK",
        minutes: 30,
        difficulty: "INVALID_TIER",
        verification: "SELF_CONFIRMED",
      });
      expect(raw).toBe(120); // normal 150 * 1.0 * 1.0 * 0.8 = 120
    });

    it("rejects invalid verification mode and awards 0 XP", () => {
      const { raw } = computeRawXp({
        kind: "TASK",
        minutes: 30,
        difficulty: "NORMAL",
        verification: "BOGUS_MODE" as unknown as VerificationKind,
      });
      expect(raw).toBe(0);
    });

    it("rejects non-finite base XP and awards 0 XP", () => {
      const { raw } = computeRawXp({
        kind: "TASK",
        baseXp: NaN,
        minutes: 30,
      });
      expect(raw).toBe(0);
    });
  });
});

// ============================================================
// STEP 5, 13 & 21 — ONE ACTIVITY ONE PAYOUT & IDEMPOTENCY
// ============================================================
describe("One Activity = One Payout (§9.3, §9.4, Invariant I2)", () => {
  it("creates idempotency key from root activity, never reward type", () => {
    expect(payoutKey({ type: "TASK", id: "t-1" })).toBe("payout:TASK:t-1");
    expect(payoutKey({ type: "QUEST", id: "q-1" })).toBe("payout:QUEST:q-1");
    expect(payoutKey({ type: "FOCUS", id: "f-1" })).toBe("payout:FOCUS:f-1");
  });

  it("repeated completeTask calls are idempotent and return the original payout", () => {
    const t = createTask({ userId: USER, title: "Idempotent task", estimatedMinutes: 30 });
    const now = new Date(t.createdAt.getTime() + 70_000);

    const first = completeTask(t.id, 0, now);
    expect(first.isDuplicate).toBe(false);
    expect(first.xpAwarded).toBe(120);

    const second = completeTask(t.id, 0, now);
    expect(second.isDuplicate).toBe(true);
    expect(second.xpAwarded).toBe(120);

    const third = completeTask(t.id, 0, now);
    expect(third.isDuplicate).toBe(true);
    expect(third.xpAwarded).toBe(120);

    const txs = store.getUserXpTransactions(USER);
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(120);
  });

  it("linked focus session does not independently pay XP", () => {
    const t = createTask({ userId: USER, title: "Linked task", estimatedMinutes: 45 });
    const session = startFocusSession({
      userId: USER,
      requiredMinutes: 45,
      clientEventId: "ev-linked",
      taskId: t.id,
    });

    const finishTime = new Date(session.startedAt.getTime() + 45 * 60_000);
    const focusRes = completeFocusSession(session.id, 0, { completedAt: finishTime });

    expect(focusRes.evidenceOnly).toBe(true);
    expect(focusRes.xpAwarded).toBe(0);
    expect(store.getUserXpTransactions(USER)).toHaveLength(0);

    // Now complete the task: it receives the verified payout
    const taskRes = completeTask(t.id, 0, finishTime);
    expect(taskRes.xpAwarded).toBe(225); // 150 * (45/30 => 1.5) * 1.0 * 1.0 = 225
    expect(taskRes.isDuplicate).toBe(false);

    // Only 1 TASK payout exists (the second transaction is the DAILY_GOAL bonus from 45 min focus)
    const taskTxs = store.getUserXpTransactions(USER).filter(tx => tx.sourceType === XPSourceType.TASK);
    expect(taskTxs).toHaveLength(1);
    expect(taskTxs[0].idempotencyKey).toBe(`payout:TASK:${t.id}`);
  });

  it("20 parallel completion requests on the same task produce exactly ONE payout (Concurrency Step 21)", async () => {
    const t = createTask({ userId: USER, title: "Concurrent task", estimatedMinutes: 30 });
    const finishTime = new Date(t.createdAt.getTime() + 75_000);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => completeTask(t.id, 0, finishTime))
      )
    );

    const newPayouts = results.filter((r) => !r.isDuplicate);
    const duplicatePayouts = results.filter((r) => r.isDuplicate);

    expect(newPayouts).toHaveLength(1);
    expect(duplicatePayouts).toHaveLength(19);
    expect(store.getUserXpTransactions(USER)).toHaveLength(1);
  });

  it("20 parallel focus-start requests on the same user produce exactly ONE running session", async () => {
    let successCount = 0;
    let errorCount = 0;

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() => {
          try {
            startFocusSession({
              userId: USER,
              requiredMinutes: 25,
              clientEventId: `event-${i}`,
            });
            successCount++;
          } catch {
            errorCount++;
          }
        })
      )
    );

    expect(successCount).toBe(1);
    expect(errorCount).toBe(19);
    const running = store.getUserFocusSessions(USER).filter(s => s.status === FocusSessionStatus.RUNNING);
    expect(running).toHaveLength(1);
  });
});

// ============================================================
// STEP 10 — TASK STATE MACHINE
// ============================================================
describe("Task State Machine (§7.1 & Step 10)", () => {
  it("allows PENDING -> IN_PROGRESS, PENDING -> COMPLETED, PENDING -> CANCELLED, PENDING -> EXPIRED", () => {
    expect(validateTaskTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).toBe(true);
    expect(validateTaskTransition(TaskStatus.PENDING, TaskStatus.COMPLETED)).toBe(true);
    expect(validateTaskTransition(TaskStatus.PENDING, TaskStatus.CANCELLED)).toBe(true);
    expect(validateTaskTransition(TaskStatus.PENDING, TaskStatus.EXPIRED)).toBe(true);
  });

  it("allows IN_PROGRESS -> COMPLETED, IN_PROGRESS -> CANCELLED, IN_PROGRESS -> EXPIRED", () => {
    expect(validateTaskTransition(TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED)).toBe(true);
    expect(validateTaskTransition(TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED)).toBe(true);
    expect(validateTaskTransition(TaskStatus.IN_PROGRESS, TaskStatus.EXPIRED)).toBe(true);
  });

  it("disallows transitions out of terminal states (COMPLETED, CANCELLED, EXPIRED)", () => {
    expect(validateTaskTransition(TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS)).toBe(false);
    expect(validateTaskTransition(TaskStatus.COMPLETED, TaskStatus.PENDING)).toBe(false);
    expect(validateTaskTransition(TaskStatus.CANCELLED, TaskStatus.COMPLETED)).toBe(false);
    expect(validateTaskTransition(TaskStatus.EXPIRED, TaskStatus.COMPLETED)).toBe(false);
  });
});

// ============================================================
// STEP 9 — ANTI-FARMING RULES
// ============================================================
describe("Anti-Farming Rules (§7.3 & Step 9)", () => {
  it("awards 0 XP if completed less than 60s after creation (TOO_FAST)", () => {
    const t = createTask({ userId: USER, title: "Fast task", estimatedMinutes: 30 });
    const fastTime = new Date(t.createdAt.getTime() + 30_000); // 30s
    const res = completeTask(t.id, 0, fastTime);
    expect(res.xpAwarded).toBe(0);
    expect(res.reason).toBe("TOO_FAST");
    expect(store.getUserXpTransactions(USER)).toHaveLength(0);
  });

  it("limits user task creation to 20 tasks per day", () => {
    for (let i = 0; i < 20; i++) {
      createTask({ userId: USER, title: `Task ${i}`, estimatedMinutes: 30 });
    }
    expect(() =>
      createTask({ userId: USER, title: "Task 21", estimatedMinutes: 30 })
    ).toThrow(/Daily task limit reached/);
  });

  it("clamps HARD to NORMAL if estimatedMinutes < 45", () => {
    const t = createTask({ userId: USER, title: "Short hard task", difficulty: Difficulty.HARD, estimatedMinutes: 30 });
    expect(t.difficulty).toBe(Difficulty.NORMAL);
  });

  it("clamps EPIC to NORMAL if estimatedMinutes < 90", () => {
    const t = createTask({ userId: USER, title: "Short epic task", difficulty: Difficulty.EPIC, estimatedMinutes: 60 });
    expect(t.difficulty).toBe(Difficulty.NORMAL);
  });

  it("limits self-confirmed tasks to first 5 per day for XP", () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      createTask({ userId: USER, title: `Self task ${i}`, estimatedMinutes: 30 })
    );

    for (let i = 0; i < 5; i++) {
      const finishTime = new Date(tasks[i].createdAt.getTime() + 70_000);
      const r = completeTask(tasks[i].id, 0, finishTime);
      expect(r.xpAwarded).toBe(120);
      expect(r.reason).toBeUndefined();
    }

    // 6th task completes but earns 0 XP due to limit
    const finish6 = new Date(tasks[5].createdAt.getTime() + 70_000);
    const r6 = completeTask(tasks[5].id, 0, finish6);
    expect(r6.xpAwarded).toBe(0);
    expect(r6.reason).toBe("SELF_CONFIRMED_LIMIT");
  });
});

// ============================================================
// STEP 14 — FOCUS SESSION ENGINE & CLOCK PLAUSIBILITY
// ============================================================
describe("Focus Session Engine (§8 & Step 14)", () => {
  it("rejects session duration under 10 minutes or under 80% planned", () => {
    expect(focusCreditedMinutes(8, 25)).toBe(0); // < 10m threshold
    expect(focusCreditedMinutes(15, 25)).toBe(0); // 15 < 25*0.8=20m
    expect(focusCreditedMinutes(20, 25)).toBe(20); // exactly 80%
  });

  it("caps credited minutes at 1.25x planned minutes", () => {
    expect(focusCreditedMinutes(60, 30)).toBe(37.5); // 30 * 1.25 = 37.5
  });

  it("detects clock plausibility failure and marks session ABANDONED", () => {
    const session = startFocusSession({
      userId: USER,
      requiredMinutes: 25,
      clientEventId: "clock-test",
    });
    // Server says 25 minutes elapsed (1500s), but client claims 500s (skew > 150s tolerance)
    const finish = new Date(session.startedAt.getTime() + 25 * 60_000);
    const r = completeFocusSession(session.id, 0, {
      completedAt: finish,
      clientElapsedSeconds: 500,
    });
    expect(r.xpAwarded).toBe(0);
    expect(r.session.status).toBe(FocusSessionStatus.ABANDONED);
  });
});

// ============================================================
// STEP 16 — STREAK ENGINE & GRACE TOKENS
// ============================================================
describe("Streak Engine (§11 & Invariant I5)", () => {
  it("qualifying day derives from focus >= 25m or habits", () => {
    expect(isCommitmentMet({ verifiedFocusMinutes: 25 })).toBe(true);
    expect(isCommitmentMet({ verifiedFocusMinutes: 24 })).toBe(false);
    expect(isCommitmentMet({ allRequiredHabitsLogged: true })).toBe(true);
    expect(isCommitmentMet({ allRequiredHabitsLogged: false })).toBe(false);
  });

  it("closeDay state machine: success increments streak and earns grace token every 7 days", () => {
    let state: StreakDayState = { streakAfter: 0, status: "SUCCESS", graceTokens: 1, longestStreak: 0 };

    for (let day = 1; day <= 6; day++) {
      state = closeDay(state, true);
      expect(state.streakAfter).toBe(day);
      expect(state.status).toBe("SUCCESS");
      expect(state.graceTokens).toBe(1);
    }

    // Day 7: earns 1 token (now 2, which is the cap)
    state = closeDay(state, true);
    expect(state.streakAfter).toBe(7);
    expect(state.graceTokens).toBe(2);

    // Day 14: already at cap 2
    for (let day = 8; day <= 14; day++) {
      state = closeDay(state, true);
    }
    expect(state.streakAfter).toBe(14);
    expect(state.graceTokens).toBe(2);
  });

  it("closeDay state machine: miss consumes grace token and maintains streak", () => {
    let state: StreakDayState = { streakAfter: 5, status: "SUCCESS", graceTokens: 1, longestStreak: 5 };
    state = closeDay(state, false);

    expect(state.streakAfter).toBe(5); // maintained
    expect(state.status).toBe("GRACE");
    expect(state.graceTokens).toBe(0); // consumed

    // Second consecutive miss resets streak to 0
    state = closeDay(state, false);
    expect(state.streakAfter).toBe(0);
    expect(state.status).toBe("MISS");
    expect(state.longestStreak).toBe(5);
  });

  it("STREAK_BONUS is min(5 * streak_days, 50) and never flat +25", () => {
    expect(streakBonusXp(0)).toBe(0);
    expect(streakBonusXp(1)).toBe(5);
    expect(streakBonusXp(5)).toBe(25);
    expect(streakBonusXp(10)).toBe(50);
    expect(streakBonusXp(20)).toBe(50); // capped at 50
  });
});

// ============================================================
// STEP 18 — ACHIEVEMENTS ENGINE
// ============================================================
describe("Achievements Engine (§12 & Step 18)", () => {
  it("evaluates core Section 12 achievements deterministically", () => {
    const unlocked = evaluateAchievements(
      {
        totalXp: 10000,
        level: 10,
        currentStreak: 7,
        bestStreak: 7,
        totalTasksCompleted: 25,
        totalFocusMinutes: 200,
        totalHabitsCompleted: 10,
        focusSessionsCompleted: 5,
        questsCompleted: 1,
        limitTargetDaysHit: 5,
        consecutiveMissDaysBeforeFocus: 3,
      },
      ACHIEVEMENT_DEFINITIONS,
      new Set()
    );

    const ids = new Set(unlocked.map((a) => a.id));
    expect(ids.has("FIRST_FOCUS")).toBe(true);
    expect(ids.has("FOCUS_5")).toBe(true);
    expect(ids.has("FIRST_QUEST")).toBe(true);
    expect(ids.has("TASKS_25")).toBe(true);
    expect(ids.has("CONSISTENCY_7")).toBe(true);
    expect(ids.has("BALANCED_WEEK")).toBe(true);
    expect(ids.has("COMEBACK")).toBe(true);
    expect(ids.has("LEVEL_10")).toBe(true);
  });

  it("does not re-unlock already unlocked achievements", () => {
    const alreadyUnlocked = new Set(["FIRST_FOCUS", "LEVEL_10"]);
    const unlocked = evaluateAchievements(
      {
        totalXp: 10000,
        level: 10,
        currentStreak: 7,
        bestStreak: 7,
        totalTasksCompleted: 25,
        totalFocusMinutes: 200,
        totalHabitsCompleted: 10,
        focusSessionsCompleted: 5,
        questsCompleted: 1,
      },
      ACHIEVEMENT_DEFINITIONS,
      alreadyUnlocked
    );
    const ids = unlocked.map((a) => a.id);
    expect(ids.includes("FIRST_FOCUS")).toBe(false);
    expect(ids.includes("LEVEL_10")).toBe(false);
  });
});

// ============================================================
// STEP 12 & 19 — XP LEDGER & RECONCILIATION
// ============================================================
describe("XP Ledger & Cache Reconciliation (§9.5, §19, Invariant I1)", () => {
  it("reversal creates an offsetting negative row with unique key", () => {
    const t = createTask({ userId: USER, title: "Reversible task", estimatedMinutes: 30 });
    const finish = new Date(t.createdAt.getTime() + 70_000);
    completeTask(t.id, 0, finish);

    const txs = store.getUserXpTransactions(USER);
    expect(txs).toHaveLength(1);
    const origId = txs[0].id;
    const origAmount = txs[0].amount;

    const rev1 = reverseTransaction(USER, origId, "accidental click");
    expect(rev1.isNew).toBe(true);
    expect(rev1.transaction.amount).toBe(-origAmount);
    expect(store.getTotalXp(USER)).toBe(0);

    // Double click on undo is idempotent
    const rev2 = reverseTransaction(USER, origId, "accidental click again");
    expect(rev2.isNew).toBe(false);
    expect(store.getUserXpTransactions(USER)).toHaveLength(2); // exactly 1 orig + 1 rev
    expect(store.getTotalXp(USER)).toBe(0);
  });

  it("Invariant I1: user_progress.total_xp matches sum of valid ledger rows and repairs corrupted cache", () => {
    const t = createTask({ userId: USER, title: "Cache test task", estimatedMinutes: 30 });
    completeTask(t.id, 0, new Date(t.createdAt.getTime() + 70_000));

    // Initialize cache and verify it's in sync
    store.reconcileUserProgress(USER);
    const inSyncCheck = store.reconcileUserProgress(USER);
    expect(inSyncCheck.repaired).toBe(false);
    expect(inSyncCheck.totalXp).toBe(120);

    // Intentionally corrupt the cache
    store.userProgressCache.set(USER, {
      totalXp: 99999,
      level: 99,
      longestStreak: 0,
      graceTokens: 1,
    });

    // Reconcile repairs from ledger
    const repairedResult = store.reconcileUserProgress(USER);
    expect(repairedResult.repaired).toBe(true);
    expect(repairedResult.totalXp).toBe(120);
    expect(repairedResult.level).toBe(levelFor(120));
  });
});

// ============================================================
// STEP 14 & LEADERBOARD — UTC WEEK BOUNDARIES
// ============================================================
describe("Leaderboard UTC Boundaries (§14 & Invariant I4)", () => {
  it("getWeekStart and getWeekEnd strictly use Monday 00:00:00 UTC", () => {
    // Wednesday 2026-09-23 15:30:00 UTC
    const date = new Date("2026-09-23T15:30:00.000Z");
    const start = getWeekStart(date);
    const end = getWeekEnd(date);

    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z"); // Monday
    expect(end.toISOString()).toBe("2026-09-28T00:00:00.000Z");   // Next Monday
    expect(start.getUTCDay()).toBe(1); // Monday
  });

  it("Invariant I4: weekly_scores.xp equals sum of transactions in week window", () => {
    const weekStart = new Date("2026-09-21T00:00:00.000Z");
    const weekEnd = new Date("2026-09-28T00:00:00.000Z");

    const txInWeek: XPTransaction = {
      id: "tx-1",
      userId: USER,
      amount: 150,
      sourceType: XPSourceType.TASK,
      sourceId: "t1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:TASK:t1",
      baseXp: 150,
      difficultyMultiplier: 1,
      streakBonus: 0,
      createdAt: new Date("2026-09-22T10:00:00.000Z"),
    };

    const txOutOfWeek: XPTransaction = {
      id: "tx-2",
      userId: USER,
      amount: 200,
      sourceType: XPSourceType.TASK,
      sourceId: "t2",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:TASK:t2",
      baseXp: 200,
      difficultyMultiplier: 1,
      streakBonus: 0,
      createdAt: new Date("2026-09-29T10:00:00.000Z"), // Next week
    };

    const scores = computeWeeklyScores([txInWeek, txOutOfWeek], weekStart, weekEnd);
    expect(scores.get(USER)).toBe(150);
  });
});
