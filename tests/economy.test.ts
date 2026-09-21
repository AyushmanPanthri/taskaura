import { describe, it, expect } from "vitest";
import {
  ECONOMY,
  applySoftCap,
  clampDifficulty,
  computeRawXp,
  cumulativeXp,
  effortFactor,
  focusCreditedMinutes,
  levelFor,
  levelProgress,
  localDateString,
  payoutKey,
  streakBonusXp,
  xpToNext,
} from "../lib/logic/economy";

describe("levels (Logic File §10)", () => {
  it("matches the documented table", () => {
    expect(cumulativeXp(1)).toBe(0);
    expect(cumulativeXp(2)).toBe(300);
    expect(cumulativeXp(10)).toBe(6300);
    expect(cumulativeXp(18)).toBe(18700);
    expect(xpToNext(18)).toBe(2000);
  });

  it("levelFor round-trips at every boundary for levels 2..100", () => {
    for (let L = 2; L <= 100; L++) {
      expect(levelFor(cumulativeXp(L))).toBe(L);
      expect(levelFor(cumulativeXp(L) - 1)).toBe(L - 1);
    }
    expect(levelFor(0)).toBe(1);
  });

  it("never drops below level 1 after reversals push the total negative", () => {
    expect(levelFor(-50)).toBe(1);
    expect(levelProgress(-50).xpIntoLevel).toBe(0);
  });

  it("dashboard example: Level 18 at 1,880 / 2,000, quest crosses into Level 19", () => {
    const before = cumulativeXp(18) + 1880;
    expect(before).toBe(20580);
    const p = levelProgress(before);
    expect(p.level).toBe(18);
    expect(p.xpIntoLevel).toBe(1880);
    expect(p.xpToNext).toBe(2000);
    expect(levelProgress(before + 150).level).toBe(19);
  });

  it("is consistent with the old-formula bug being gone", () => {
    // v1: floor(sqrt(xp/100)) + 1 would put 1,600 XP at level 5
    expect(levelFor(1600)).toBe(4);
  });
});

describe("XP formula (Logic File §9.2 examples)", () => {
  it("standalone 45-min session = 100", () => {
    expect(computeRawXp({ kind: "FOCUS_SESSION", minutes: 45 }).raw).toBe(100);
  });
  it("AI quest 45 min NORMAL verified = 150", () => {
    expect(
      computeRawXp({ kind: "AI_QUEST", minutes: 45, verification: "FOCUS_VERIFIED" }).raw
    ).toBe(150);
  });
  it("task 30 min NORMAL self-confirmed = 120", () => {
    expect(
      computeRawXp({ kind: "TASK", minutes: 30, verification: "SELF_CONFIRMED" }).raw
    ).toBe(120);
  });
  it("task 5 min EASY self-confirmed = 38", () => {
    expect(
      computeRawXp({ kind: "TASK", minutes: 5, difficulty: "EASY", verification: "SELF_CONFIRMED" }).raw
    ).toBe(38);
  });
  it("task 60 min HARD verified = 281", () => {
    expect(
      computeRawXp({ kind: "TASK", minutes: 60, difficulty: "HARD", verification: "FOCUS_VERIFIED" }).raw
    ).toBe(281);
  });
  it("habit is flat 75 and ignores minutes", () => {
    expect(computeRawXp({ kind: "HABIT", minutes: 999 }).raw).toBe(75);
  });
  it("effort factor is clamped to 0.4 .. 1.5", () => {
    expect(effortFactor("TASK", 1)).toBe(0.4);
    expect(effortFactor("TASK", 600)).toBe(1.5);
    expect(effortFactor("HABIT", 600)).toBe(1);
  });
});

describe("difficulty clamp (§7.3)", () => {
  it("HARD needs 45+ minutes, EPIC needs 90+", () => {
    expect(clampDifficulty("HARD", 30)).toBe("NORMAL");
    expect(clampDifficulty("HARD", 45)).toBe("HARD");
    expect(clampDifficulty("EPIC", 60)).toBe("NORMAL");
    expect(clampDifficulty("EPIC", 90)).toBe("EPIC");
    expect(clampDifficulty("EASY", 5)).toBe("EASY");
  });
});

describe("daily soft cap", () => {
  it("pays 200 at 88 when 950 is already earned", () => {
    expect(applySoftCap(200, 950)).toBe(88);
  });
  it("pays in full below the cap", () => {
    expect(applySoftCap(150, 0)).toBe(150);
    expect(applySoftCap(150, 850)).toBe(150);
  });
  it("pays 25% once the cap is exhausted", () => {
    expect(applySoftCap(100, 1000)).toBe(25);
    expect(applySoftCap(100, 5000)).toBe(25);
  });
});

describe("streak bonus", () => {
  it("is min(5 × days, 50)", () => {
    expect(streakBonusXp(0)).toBe(0);
    expect(streakBonusXp(1)).toBe(5);
    expect(streakBonusXp(6)).toBe(30);
    expect(streakBonusXp(10)).toBe(50);
    expect(streakBonusXp(99)).toBe(50);
  });
});

describe("focus credit", () => {
  it("is 0 below max(10 min, 80% of planned)", () => {
    expect(focusCreditedMinutes(9, 10)).toBe(0);
    expect(focusCreditedMinutes(35, 45)).toBe(0); // 80% of 45 = 36
    expect(focusCreditedMinutes(36, 45)).toBe(36);
  });
  it("is capped at 1.25 × planned", () => {
    expect(focusCreditedMinutes(120, 45)).toBe(56.25);
  });
});

describe("keys and dates", () => {
  it("payout key ignores reward type (one activity, one payout)", () => {
    expect(payoutKey({ type: "QUEST", id: "q1" })).toBe("payout:QUEST:q1");
  });
  it("local date follows the timezone", () => {
    const d = new Date("2026-09-21T20:00:00Z"); // 01:30 next day in Delhi
    expect(localDateString(d, "UTC")).toBe("2026-09-21");
    expect(localDateString(d, "Asia/Kolkata")).toBe("2026-09-22");
    expect(localDateString(d, "Not/AZone")).toBe("2026-09-21");
  });
  it("exposes the constants the docs promise", () => {
    expect(ECONOMY.softCapXp).toBe(1000);
    expect(ECONOMY.selfConfirmedTasksPerDay).toBe(5);
  });
});
