// ============================================================
// TaskAura — Leveling System Audit Suite (Phase 2)
// Validates 9-case test matrix for Leveling math, caps, reversals,
// max-level clamping, and progress calculation consistency.
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import {
  levelFor,
  levelProgress,
  cumulativeXp,
  xpToNext,
} from "../lib/logic/economy";
import { getPgProgressSummary } from "../lib/services/pg-progress-service";
import { xpRepository } from "../lib/repositories/xp-repository";
import { taskRepository } from "../lib/repositories/task-repository";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { XPSourceType, RewardType, TaskStatus } from "../lib/logic/types";

const TEST_USER = "00000000-0000-0000-0000-000000000091";

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init);
}

describe("Leveling System Audit Suite (Phase 2)", () => {
  beforeEach(async () => {
    await prisma.xPTransaction.deleteMany({
      where: { userId: TEST_USER },
    });
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [{ adminUserId: TEST_USER }, { targetUserId: TEST_USER }],
      },
    });
    await prisma.task.deleteMany({
      where: { userId: TEST_USER },
    });
    await prisma.user.upsert({
      where: { id: TEST_USER },
      update: {},
      create: {
        id: TEST_USER,
        displayName: "Leveling Tester",
        email: "leveling@taskaura.dev",
      },
    });
  });

  // ── 1. MINIMUM LEVEL BOUNDARY ────────────────────────────────
  it("1. levelFor(0) returns level 1", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(-100)).toBe(1);
  });

  // ── 2. MAX LEVEL BOUNDARY ─────────────────────────────────────
  it("2. levelFor(totalXpForLevel100) returns level 100", () => {
    const xpLevel100 = cumulativeXp(100); // 514,800 XP
    expect(xpLevel100).toBe(514800);
    expect(levelFor(xpLevel100)).toBe(100);

    // Overcap past level 100 clamps to level 100 when maxLevel is passed
    expect(levelFor(xpLevel100 + 50000, 100)).toBe(100);
  });

  // ── 3. THRESHOLD PRECISION ────────────────────────────────────
  it("3. levelFor(totalXp) 1 XP below threshold returns previous level", () => {
    // Level 2 threshold is cumulativeXp(2) = 300
    expect(levelFor(cumulativeXp(2) - 1)).toBe(1);
    expect(levelFor(cumulativeXp(2))).toBe(2);

    // Level 10 threshold is cumulativeXp(10) = 6,300
    expect(levelFor(cumulativeXp(10) - 1)).toBe(9);
    expect(levelFor(cumulativeXp(10))).toBe(10);

    // Level 50 threshold is cumulativeXp(50) = 132,300
    expect(levelFor(cumulativeXp(50) - 1)).toBe(49);
    expect(levelFor(cumulativeXp(50))).toBe(50);

    // Level 100 threshold is cumulativeXp(100) = 514,800
    expect(levelFor(cumulativeXp(100) - 1)).toBe(99);
    expect(levelFor(cumulativeXp(100))).toBe(100);
  });

  // ── 4. LEVEL SPAN CONSISTENCY ─────────────────────────────────
  it("4. xpIntoLevel + xpToNext equals level span across low, mid, high, and extreme levels", () => {
    const testLevels = [1, 5, 25, 50, 75, 99];

    for (const lvl of testLevels) {
      const baseXP = cumulativeXp(lvl);
      const span = xpToNext(lvl);

      // Check at 0% into level
      const p0 = levelProgress(baseXP);
      expect(p0.level).toBe(lvl);
      expect(p0.xpIntoLevel).toBe(0);
      expect(p0.xpToNext).toBe(span);
      expect(p0.fraction).toBe(0);

      // Check at midpoint of level
      const midXP = baseXP + Math.floor(span / 2);
      const pMid = levelProgress(midXP);
      expect(pMid.level).toBe(lvl);
      expect(pMid.xpIntoLevel).toBe(Math.floor(span / 2));
      expect(pMid.xpToNext).toBe(span);
      // xpIntoLevel + xpRemaining == level span
      const xpRemaining = pMid.xpToNext - pMid.xpIntoLevel;
      expect(pMid.xpIntoLevel + xpRemaining).toBe(span);
      expect(pMid.fraction).toBeCloseTo(0.5, 1);

      // Check at 1 XP before next level
      const highXP = baseXP + span - 1;
      const pHigh = levelProgress(highXP);
      expect(pHigh.level).toBe(lvl);
      expect(pHigh.xpIntoLevel).toBe(span - 1);
      expect(pHigh.xpToNext).toBe(span);
      expect(pHigh.fraction).toBeLessThan(1.0);
    }
  });

  // ── 5. MAX LEVEL USER CLAMP ───────────────────────────────────
  it("5. Level 100 user: progress fields do not error or return nonsensical values", async () => {
    const xpMax = cumulativeXp(100) + 25000; // 539,800 XP (exceeds cap)
    const prog = levelProgress(xpMax, 100);

    expect(prog.level).toBe(100);
    expect(prog.xpToNext).toBe(0);
    expect(prog.fraction).toBe(1.0);
    expect(prog.xpIntoLevel).toBe(25000);

    // Record in DB and check getPgProgressSummary
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: xpMax,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-max-level",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:max-level",
      baseXp: xpMax,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summary = await getPgProgressSummary(TEST_USER);
    expect(summary.level).toBe(100);
    expect(summary.xpRequiredForLevel).toBe(0);
    expect(summary.xpRemaining).toBe(0);
    expect(summary.levelProgressPercentage).toBe(100);
    expect(summary.fraction).toBe(1.0);
    expect(summary.rankTitle).toBe("The Slime");
    expect(summary.nextTitleAt).toBeNull();
    expect(summary.title).toBe("Zenith");
  });

  // ── 6. DAILY XP CAP PARTIAL-DAY SCENARIO ──────────────────────
  it("6. Daily XP cap partial-day scenario: progress fields are accurate mid-cap and resume next day", async () => {
    // 1. Seed 950 task XP today (50 XP room left under 1000 dailyTaskXpCap)
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: 950,
      sourceType: XPSourceType.TASK,
      sourceId: "prior-task-today",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:prior:today",
      baseXp: 950,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // Verify progress at 950 XP:
    // Level 1: 0-300, Level 2: 300-700, Level 3: 700-1200
    // At 950 XP -> Level 3, into: 250, next: 500, remaining: 250
    const summaryMid = await getPgProgressSummary(TEST_USER);
    expect(summaryMid.totalXp).toBe(950);
    expect(summaryMid.level).toBe(3);
    expect(summaryMid.xpEarnedInLevel).toBe(250);
    expect(summaryMid.xpRemaining).toBe(250);

    // 2. Complete 30m NORMAL task (normally 120 XP, but capped to remaining 50 XP)
    const task = await taskRepository.createTask(TEST_USER, {
      title: "Capped Mid-day Task",
      estimatedMinutes: 30,
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 30 * 60_000) },
    });

    const res = await completeTaskRoute(
      makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER }),
      { params: Promise.resolve({ id: task.id }) }
    );
    const json = await res.json();
    expect(json.data.xpAwarded).toBe(50); // Capped to 50

    // Progress accurately reflects exactly 1000 XP
    const summaryCapped = await getPgProgressSummary(TEST_USER);
    expect(summaryCapped.totalXp).toBe(1000);
    expect(summaryCapped.level).toBe(3);
    expect(summaryCapped.xpEarnedInLevel).toBe(300);
    expect(summaryCapped.xpRemaining).toBe(200);

    // 3. Simulate next calendar day by backdating today's transactions
    const yesterday = new Date(Date.now() - 26 * 60 * 60_000);
    await prisma.xPTransaction.updateMany({
      where: { userId: TEST_USER },
      data: { createdAt: yesterday },
    });

    // Seed 5 prior task transactions yesterday so onboarding 50% ramp-up is satisfied
    for (let i = 0; i < 5; i++) {
      await prisma.xPTransaction.create({
        data: {
          userId: TEST_USER,
          amount: 100,
          sourceType: "TASK",
          sourceId: `seed-task-${i}`,
          rewardType: "COMPLETION",
          idempotencyKey: `seed-task-idem-${i}`,
          baseXp: 100,
          difficultyMultiplier: 1.0,
          streakBonus: 0,
          createdAt: yesterday,
        },
      });
    }

    // Complete another 30m task on the new day: full 120 XP contributes
    const nextDayTask = await taskRepository.createTask(TEST_USER, {
      title: "Next Day Task",
      estimatedMinutes: 30,
    });
    await prisma.task.update({
      where: { id: nextDayTask.id },
      data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 30 * 60_000) },
    });

    const resNextDay = await completeTaskRoute(
      makeReq(`/api/v1/tasks/${nextDayTask.id}/complete`, "POST", {}, { "x-user-id": TEST_USER }),
      { params: Promise.resolve({ id: nextDayTask.id }) }
    );
    const jsonNextDay = await resNextDay.json();
    expect(jsonNextDay.data.xpAwarded).toBe(120);

    // Resumed progress accurately totals 1,620 XP (1000 + 500 + 120)
    // Level 4 threshold is 1200, span is 600
    const summaryNextDay = await getPgProgressSummary(TEST_USER);
    expect(summaryNextDay.totalXp).toBe(1620);
    expect(summaryNextDay.level).toBe(4);
    expect(summaryNextDay.xpEarnedInLevel).toBe(420);
    expect(summaryNextDay.xpRemaining).toBe(180);
  });

  // ── 7. MULTI-LEVEL BOUNDARY REVERSAL ─────────────────────────
  it("7. Multi-level reversal: dropping from level 40 to level 12 atomically updates level, rankTitle, and progress", async () => {
    // Level 40 requires cumulativeXp(40) = 50 * 39 * 44 = 85,800 XP
    const xpForLevel40 = cumulativeXp(40);
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: xpForLevel40,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-level-40",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:level-40",
      baseXp: xpForLevel40,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summary40 = await getPgProgressSummary(TEST_USER);
    expect(summary40.level).toBe(40);
    expect(summary40.rankTitle).toBe("Sung Jinwoo");
    expect(summary40.rankTier).toBe(5);
    expect(summary40.title).toBe("Legend");

    // Level 12 requires cumulativeXp(12) = 50 * 11 * 16 = 8,800 XP
    // Reversal deduction: 85,800 - 8,800 = 77,000 XP
    const deduction = xpForLevel40 - cumulativeXp(12);
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: -deduction,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "reversal-audit-action-multi",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "reversal:level-40-to-12",
      baseXp: -deduction,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // Verify atomic drop to level 12 and title demotion
    const summary12 = await getPgProgressSummary(TEST_USER);
    expect(summary12.totalXp).toBe(cumulativeXp(12));
    expect(summary12.level).toBe(12);
    expect(summary12.rankTitle).toBe("Subaru");
    expect(summary12.rankTier).toBe(2);
    expect(summary12.nextTitleAt).toBe(13);
    expect(summary12.title).toBe("Adept"); // Level 10-14 milestone
    expect(summary12.xpEarnedInLevel).toBe(0);
    expect(summary12.xpRemaining).toBe(xpToNext(12));
  });

  // ── 8. REVERSAL BELOW ZERO XP ─────────────────────────────────
  it("8. Reversal below zero XP: totalXp and level floor correctly at 0 and level 1", async () => {
    // User has 100 XP
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: 100,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "small-grant",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:small",
      baseXp: 100,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // Erroneous reversal of -500 XP (net ledger is -400)
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: -500,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "excessive-reversal",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "reversal:excessive",
      baseXp: -500,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summary = await getPgProgressSummary(TEST_USER);
    // Floored at 0 and level 1
    expect(summary.totalXp).toBe(0);
    expect(summary.level).toBe(1);
    expect(summary.rankTitle).toBe("Deku");
    expect(summary.rankTier).toBe(1);
    expect(summary.title).toBe("Novice");
    expect(summary.xpEarnedInLevel).toBe(0);
    expect(summary.xpRemaining).toBe(300);
    expect(summary.fraction).toBe(0);
  });

  // ── 9. TITLE VS RANKTITLE BEHAVIOR ───────────────────────────
  it("9. title and rankTitle both behave consistently with distinct semantic roles", async () => {
    // Level 6: 2,700 XP
    // title: "Apprentice" (RPG mastery, level 5 milestone)
    // rankTitle: "Subaru" (Anime milestone, tier 2)
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: cumulativeXp(6),
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-level-6",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:title-check-6",
      baseXp: cumulativeXp(6),
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summary6 = await getPgProgressSummary(TEST_USER);
    expect(summary6.level).toBe(6);
    expect(summary6.title).toBe("Apprentice");
    expect(summary6.rankTitle).toBe("Subaru");
    expect(summary6.rankTier).toBe(2);

    // Level 25: 34,800 XP
    // title: "Grandmaster" (RPG mastery, level 25 milestone)
    // rankTitle: "Naruto" (Anime milestone, tier 4: level 23-35)
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: cumulativeXp(25) - cumulativeXp(6),
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-level-25",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:title-check-25",
      baseXp: cumulativeXp(25) - cumulativeXp(6),
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summary25 = await getPgProgressSummary(TEST_USER);
    expect(summary25.level).toBe(25);
    expect(summary25.title).toBe("Grandmaster");
    expect(summary25.rankTitle).toBe("Naruto");
    expect(summary25.rankTier).toBe(4);
  });
});
