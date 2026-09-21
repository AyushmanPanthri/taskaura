import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store } from "../lib/services/store";
import { createTask, completeTask } from "../lib/services/task-service";
import {
  startFocusSession,
  recordHeartbeat,
  completeFocusSession,
} from "../lib/services/focus-service";
import {
  getTotalXp,
  getUserLevel,
  reverseTransaction,
} from "../lib/services/xp-service";
import {
  Difficulty,
  RewardType,
  TaskSource,
  XPSourceType,
} from "../lib/logic/types";

const USER = "user-1";
const BONUS = new Set<string>(["DAILY_GOAL", "STREAK_BONUS"]);

const payouts = (userId = USER) =>
  store.getUserXpTransactions(userId).filter((t) => !BONUS.has(String(t.sourceType)));
const bonuses = (userId = USER, type?: string) =>
  store
    .getUserXpTransactions(userId)
    .filter((t) => BONUS.has(String(t.sourceType)) && (!type || String(t.sourceType) === type));

/** Run a focus session for `minutes`, pinging a heartbeat every 30 s, then complete it. */
function runSession(sessionId: string, minutes: number, streakDays = 0) {
  for (let i = 0; i < minutes * 2; i++) {
    vi.advanceTimersByTime(30_000);
    recordHeartbeat(sessionId);
  }
  return completeFocusSession(sessionId, streakDays);
}

let seq = 0;
const startSession = (minutes: number, taskId?: string, userId = USER) =>
  startFocusSession({ userId, requiredMinutes: minutes, clientEventId: `evt-${++seq}`, taskId });

beforeEach(() => {
  store.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("task completion", () => {
  it("completing twice pays exactly once", () => {
    const t = createTask({ userId: USER, title: "Read chapter" });
    vi.advanceTimersByTime(120_000);
    const first = completeTask(t.id);
    const second = completeTask(t.id);
    expect(first.xpAwarded).toBe(120); // 150 × 1.0 × 1.0 × 0.8
    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.xpAwarded).toBe(120);
    expect(payouts()).toHaveLength(1);
  });

  it("a task completed within 60 s of creation earns nothing", () => {
    const t = createTask({ userId: USER, title: "Instant" });
    const r = completeTask(t.id);
    expect(r.reason).toBe("TOO_FAST");
    expect(r.xpAwarded).toBe(0);
    expect(payouts()).toHaveLength(0);
    expect(completeTask(t.id).isDuplicate).toBe(true);
  });

  it("only the first 5 self-confirmed tasks per day earn XP", () => {
    const ids = Array.from({ length: 6 }, (_, i) => createTask({ userId: USER, title: `t${i}` }).id);
    vi.advanceTimersByTime(120_000);
    const results = ids.map((id) => completeTask(id));
    expect(results.slice(0, 5).every((r) => r.xpAwarded === 120)).toBe(true);
    expect(results[5].reason).toBe("SELF_CONFIRMED_LIMIT");
    expect(results[5].xpAwarded).toBe(0);
  });

  it("HARD / EPIC are clamped to NORMAL for short tasks, and 20 tasks/day max", () => {
    const t = createTask({ userId: USER, title: "x", difficulty: Difficulty.EPIC, estimatedMinutes: 30 });
    expect(t.difficulty).toBe(Difficulty.NORMAL);
    for (let i = 0; i < 19; i++) createTask({ userId: USER, title: `t${i}` });
    expect(() => createTask({ userId: USER, title: "21st" })).toThrow(/Daily task limit/);
  });
});

describe("one activity, one payout", () => {
  it("a focus session linked to an AI quest pays the quest once, not twice", () => {
    const quest = createTask({
      userId: USER,
      title: "45-min focus quest",
      source: TaskSource.AI,
      questId: "quest-1",
      estimatedMinutes: 45,
    });
    const session = startSession(45, quest.id);
    const done = runSession(session.id, 45);

    expect(done.xpAwarded).toBe(150); // 150 × 1.0 × 1.0 × 1.0
    expect(done.evidenceOnly).toBe(false);
    expect(payouts()).toHaveLength(1);
    expect(payouts()[0].idempotencyKey).toBe("payout:QUEST:quest-1");
    expect(bonuses()).toHaveLength(1); // DAILY_GOAL only (streak 0)
    expect(getTotalXp(USER)).toBe(150 + 50);

    // Retrying either completion changes nothing.
    const again = completeFocusSession(session.id);
    expect(again.isDuplicate).toBe(true);
    expect(again.xpAwarded).toBe(150);
    expect(completeTask(quest.id).isDuplicate).toBe(true);
    expect(getTotalXp(USER)).toBe(200);
  });

  it("a session linked to an ordinary task is evidence; the task then pays at the verified rate", () => {
    const task = createTask({ userId: USER, title: "Write report", estimatedMinutes: 30 });
    const session = startSession(25, task.id);
    const done = runSession(session.id, 25);
    expect(done.evidenceOnly).toBe(true);
    expect(done.xpAwarded).toBe(0);
    expect(payouts()).toHaveLength(0);

    const r = completeTask(task.id);
    expect(r.xpAwarded).toBe(150); // verified: 150 × 1.0 × 1.0 × 1.0 (not 120)
    expect(payouts()).toHaveLength(1);
    expect(payouts()[0].breakdown?.verificationKind).toBe("FOCUS_VERIFIED");
  });

  it("a standalone 45-min session pays 100 once", () => {
    const s = startSession(45);
    const done = runSession(s.id, 45);
    expect(done.xpAwarded).toBe(100);
    expect(completeFocusSession(s.id).isDuplicate).toBe(true);
    expect(payouts()).toHaveLength(1);
  });
});

describe("daily bonuses", () => {
  it("DAILY_GOAL and STREAK_BONUS are granted once per day, however many activities", () => {
    const a = startSession(45);
    const first = runSession(a.id, 45, 6);
    expect(first.bonusXp).toBe(50 + 30); // daily goal + min(5 × 6, 50)
    const b = startSession(45);
    const second = runSession(b.id, 45, 6);
    expect(second.bonusXp).toBe(0);
    expect(bonuses(USER, "DAILY_GOAL")).toHaveLength(1);
    expect(bonuses(USER, "STREAK_BONUS")).toHaveLength(1);
  });

  it("bonus keys are per user, so two users both receive today's bonus", () => {
    runSession(startSession(45, undefined, "user-a").id, 45);
    runSession(startSession(45, undefined, "user-b").id, 45);
    expect(bonuses("user-a", "DAILY_GOAL")).toHaveLength(1);
    expect(bonuses("user-b", "DAILY_GOAL")).toHaveLength(1);
  });

  it("no daily goal is paid for a session below the 25-minute commitment", () => {
    const s = startSession(15);
    runSession(s.id, 15);
    expect(bonuses()).toHaveLength(0);
  });
});

describe("soft cap and focus sessions", () => {
  it("XP above 1,000 payout XP in a day is paid at 25%", () => {
    store.addXpTransaction({
      id: "seed",
      userId: USER,
      amount: 950,
      sourceType: XPSourceType.TASK,
      sourceId: "seed-task",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:TASK:seed-task",
      baseXp: 150,
      difficultyMultiplier: 1,
      streakBonus: 0,
      createdAt: new Date(),
    });
    const s = startSession(45);
    const done = runSession(s.id, 45);
    expect(done.xpAwarded).toBe(63); // 50 at full + 50 × 0.25 = 62.5 → 63
    expect(done.capped).toBe(true);
  });

  it("only one RUNNING session per user; same clientEventId is an idempotent retry", () => {
    const a = startFocusSession({ userId: USER, requiredMinutes: 25, clientEventId: "same" });
    expect(startFocusSession({ userId: USER, requiredMinutes: 25, clientEventId: "same" }).id).toBe(a.id);
    expect(() =>
      startFocusSession({ userId: USER, requiredMinutes: 25, clientEventId: "other" })
    ).toThrow(/already running/);
  });

  it("a session that ends too early earns nothing", () => {
    const s = startSession(45);
    const done = runSession(s.id, 20); // needs 36+ min
    expect(done.xpAwarded).toBe(0);
    expect(payouts()).toHaveLength(0);
  });
});

describe("reversals and levels", () => {
  it("a reversal offsets the payout once, even if requested twice", () => {
    const t = createTask({ userId: USER, title: "Oops" });
    vi.advanceTimersByTime(120_000);
    completeTask(t.id);
    const original = payouts()[0];
    const r1 = reverseTransaction(USER, original.id, "undo");
    const r2 = reverseTransaction(USER, original.id, "undo again");
    expect(r1.isNew).toBe(true);
    expect(r2.isNew).toBe(false);
    expect(getTotalXp(USER)).toBe(0);
    expect(store.getUserXpTransactions(USER)).toHaveLength(2);
  });

  it("level comes from the v2 table: 20,580 XP is Level 18, +150 is Level 19", () => {
    const seed = (amount: number, id: string) =>
      store.addXpTransaction({
        id,
        userId: USER,
        amount,
        sourceType: XPSourceType.TASK,
        sourceId: id,
        rewardType: RewardType.COMPLETION,
        idempotencyKey: `payout:TASK:${id}`,
        baseXp: 0,
        difficultyMultiplier: 1,
        streakBonus: 0,
        createdAt: new Date(),
      });
    seed(20580, "a");
    expect(getUserLevel(USER)).toBe(18);
    seed(150, "b");
    expect(getUserLevel(USER)).toBe(19);
  });
});
