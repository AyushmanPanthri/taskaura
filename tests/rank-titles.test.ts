// ============================================================
// TaskAura — Rank Title System Test Suite
// Validates 7-item test matrix: pure function, boundaries,
// admin grants, XP reversals (level demotion), and leaderboard isolation
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { getRankTitle, getRankTitleInfo, RANK_TIERS } from "../lib/logic/rank-titles";
import { cumulativeXp } from "../lib/logic/economy";
import { getPgProgressSummary } from "../lib/services/pg-progress-service";
import { xpRepository } from "../lib/repositories/xp-repository";
import { snapshotLeaderboard } from "../lib/services/leaderboard-service";
import { XPSourceType, RewardType } from "../lib/logic/types";

const TEST_USER = "00000000-0000-0000-0000-000000000081";
const TEST_USER_2 = "00000000-0000-0000-0000-000000000082";

describe("Rank Title System (Phase 2 Addendum)", () => {
  beforeEach(async () => {
    // Clean test state
    await prisma.xPTransaction.deleteMany({
      where: { userId: { in: [TEST_USER, TEST_USER_2] } },
    });
    await prisma.weeklyScore.deleteMany({
      where: { userId: { in: [TEST_USER, TEST_USER_2] } },
    });
    await prisma.user.upsert({
      where: { id: TEST_USER },
      update: {},
      create: {
        id: TEST_USER,
        displayName: "Title Hero",
        email: "hero@taskaura.dev",
      },
    });
    await prisma.user.upsert({
      where: { id: TEST_USER_2 },
      update: {},
      create: {
        id: TEST_USER_2,
        displayName: "Rival Hero",
        email: "rival@taskaura.dev",
      },
    });
  });

  // ── 1. LEVEL 1 USER ──────────────────────────────────────────
  it("1. Level 1 user receives 'Deku'", () => {
    expect(getRankTitle(1)).toBe("Deku");
    const info = getRankTitleInfo(1);
    expect(info.rankTitle).toBe("Deku");
    expect(info.rankTier).toBe(1);
    expect(info.nextTitleAt).toBe(6);
  });

  // ── 2 & 3. TIER BOUNDARY TESTS ────────────────────────────────
  it("2 & 3. Level exactly at and 1 below tier boundaries", () => {
    // Tier 1 -> 2 boundary: Level 5 is Deku, Level 6 is Subaru
    expect(getRankTitle(5)).toBe("Deku");
    expect(getRankTitle(6)).toBe("Subaru");
    expect(getRankTitleInfo(5).nextTitleAt).toBe(6);
    expect(getRankTitleInfo(6).nextTitleAt).toBe(13);

    // Tier 2 -> 3 boundary: Level 12 is Subaru, Level 13 is Asta
    expect(getRankTitle(12)).toBe("Subaru");
    expect(getRankTitle(13)).toBe("Asta");

    // Tier 3 -> 4 boundary: Level 22 is Asta, Level 23 is Naruto
    expect(getRankTitle(22)).toBe("Asta");
    expect(getRankTitle(23)).toBe("Naruto");

    // Tier 4 -> 5 boundary: Level 35 is Naruto, Level 36 is Sung Jinwoo
    expect(getRankTitle(35)).toBe("Naruto");
    expect(getRankTitle(36)).toBe("Sung Jinwoo");

    // Tier 5 -> 6 boundary: Level 50 is Sung Jinwoo, Level 51 is Goku
    expect(getRankTitle(50)).toBe("Sung Jinwoo");
    expect(getRankTitle(51)).toBe("Goku");

    // Tier 6 -> 7 boundary: Level 70 is Goku, Level 71 is Saitama
    expect(getRankTitle(70)).toBe("Goku");
    expect(getRankTitle(71)).toBe("Saitama");

    // Tier 7 -> 8 boundary: Level 90 is Saitama, Level 91 is The Slime
    expect(getRankTitle(90)).toBe("Saitama");
    expect(getRankTitle(91)).toBe("The Slime");
  });

  // ── 4. MAX LEVEL USER ─────────────────────────────────────────
  it("4. Max level (100) receives 'The Slime' and nextTitleAt is null", () => {
    expect(getRankTitle(100)).toBe("The Slime");
    const info = getRankTitleInfo(100);
    expect(info.rankTitle).toBe("The Slime");
    expect(info.rankTier).toBe(8);
    expect(info.nextTitleAt).toBeNull();
  });

  // ── 5. ADMIN XP GRANT CROSSING BOUNDARY ───────────────────────
  it("5. Admin grants XP pushing user across a tier boundary -> title updates on next read", async () => {
    // Fresh user starts with 0 XP (level 1)
    const summaryInitial = await getPgProgressSummary(TEST_USER);
    expect(summaryInitial.level).toBe(1);
    expect(summaryInitial.rankTitle).toBe("Deku");
    expect(summaryInitial.rankTier).toBe(1);

    // Level 6 requires cumulativeXp(6) = 2,700 XP
    const xpNeededForLevel6 = cumulativeXp(6);
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: xpNeededForLevel6,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-tier-upgrade",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "admin-grant:level-6",
      baseXp: xpNeededForLevel6,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // Re-read progress summary directly from PostgreSQL
    const summaryAfter = await getPgProgressSummary(TEST_USER);
    expect(summaryAfter.level).toBe(6);
    expect(summaryAfter.rankTitle).toBe("Subaru");
    expect(summaryAfter.rankTier).toBe(2);
    expect(summaryAfter.nextTitleAt).toBe(13);
  });

  // ── 6. XP REVERSAL (LEVEL DEMOTION) ───────────────────────────
  it("6. XP reversal drops a user's level back across a tier boundary -> title correctly demotes", async () => {
    // 1. Grant user enough XP to reach Level 6 (Subaru)
    const xpForLevel6 = cumulativeXp(6);
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: xpForLevel6,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "grant-before-reversal",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "grant:before-reversal",
      baseXp: xpForLevel6,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    const summaryBeforeReversal = await getPgProgressSummary(TEST_USER);
    expect(summaryBeforeReversal.level).toBe(6);
    expect(summaryBeforeReversal.rankTitle).toBe("Subaru");

    // 2. Issue a negative XP reversal transaction dropping XP back below Level 6 (e.g. to Level 4)
    // Level 4 requires cumulativeXp(4) = 1,400 XP. So deduct (xpForLevel6 - 1,400)
    const xpDeduction = xpForLevel6 - cumulativeXp(4);
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: -xpDeduction,
      sourceType: XPSourceType.ADJUSTMENT,
      sourceId: "reversal-audit-action",
      rewardType: RewardType.ADJUSTMENT,
      idempotencyKey: "reversal:hero:1",
      baseXp: -xpDeduction,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // 3. Read progress summary again: title must demote automatically back to Deku
    const summaryAfterReversal = await getPgProgressSummary(TEST_USER);
    expect(summaryAfterReversal.level).toBe(4);
    expect(summaryAfterReversal.rankTitle).toBe("Deku");
    expect(summaryAfterReversal.rankTier).toBe(1);
    expect(summaryAfterReversal.nextTitleAt).toBe(6);
  });

  // ── 7. LEADERBOARD ISOLATION (ZERO COUPLING) ──────────────────
  it("7. Title is never used in leaderboard sort/rank calculation", async () => {
    // User 1 has 5,000 XP (Level 8, Subaru)
    await xpRepository.recordTransaction({
      userId: TEST_USER,
      amount: 5000,
      sourceType: XPSourceType.TASK,
      sourceId: "task-1",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:user1:task1",
      baseXp: 5000,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // User 2 has 25,000 XP (Level 18, Asta)
    await xpRepository.recordTransaction({
      userId: TEST_USER_2,
      amount: 25000,
      sourceType: XPSourceType.TASK,
      sourceId: "task-2",
      rewardType: RewardType.COMPLETION,
      idempotencyKey: "payout:user2:task2",
      baseXp: 25000,
      difficultyMultiplier: 1.0,
      streakBonus: 0,
    });

    // Check titles are derived purely from levels
    const p1 = await getPgProgressSummary(TEST_USER);
    const p2 = await getPgProgressSummary(TEST_USER_2);
    expect(p1.rankTitle).toBe("Subaru");
    expect(p2.rankTitle).toBe("Asta");

    // Snapshot leaderboard for current week
    const now = new Date();
    await snapshotLeaderboard();

    // Verify weekly scores are ranked strictly by totalXp descending
    const scores = await prisma.weeklyScore.findMany({
      where: { userId: { in: [TEST_USER, TEST_USER_2] } },
      orderBy: { rank: "asc" },
    });

    expect(scores).toHaveLength(2);
    // User 2 with 25,000 XP is ranked ahead of User 1 with 5,000 XP
    expect(scores[0].userId).toBe(TEST_USER_2);
    expect(scores[0].totalXp).toBe(25000);
    expect(scores[1].userId).toBe(TEST_USER);
    expect(scores[1].totalXp).toBe(5000);
    expect(scores[0].rank).toBeLessThan(scores[1].rank);
  });
});
