// ============================================================
// Task Aura — Economy (pure functions, zero imports)
// Maps to Logic System File v2 §9 (XP engine) and §10 (levels)
//
// Everything that decides "how much XP" or "which level" lives here
// so it can be tested without a store, a clock or the other logic files.
// ============================================================

export type DifficultyName = "EASY" | "NORMAL" | "HARD" | "EPIC";
export type VerificationKind = "FOCUS_VERIFIED" | "SELF_CONFIRMED";
export type PayoutKind = "FOCUS_SESSION" | "TASK" | "AI_QUEST" | "HABIT";
export type RootType = "QUEST" | "TASK" | "FOCUS" | "HABIT";

/** All tunable constants in one place (Logic File, Appendix A). */
export const ECONOMY = {
  base: { FOCUS_SESSION: 100, TASK: 150, AI_QUEST: 150, HABIT: 75 },
  /** Reference minutes for the effort factor. Habits are flat. */
  refMinutes: { FOCUS_SESSION: 45, TASK: 30, AI_QUEST: 45 },
  effortMin: 0.4,
  effortMax: 1.5,
  difficulty: { EASY: 0.8, NORMAL: 1.0, HARD: 1.25, EPIC: 1.5 },
  verification: { FOCUS_VERIFIED: 1.0, SELF_CONFIRMED: 0.8 },
  /** User-chosen HARD / EPIC only count for longer work. */
  hardMinMinutes: 45,
  epicMinMinutes: 90,

  dailyGoalXp: 50,
  streakBonusPerDay: 5,
  streakBonusMax: 50,

  softCapXp: 1000,
  softCapRate: 0.25,

  minDwellMs: 60_000,
  selfConfirmedTasksPerDay: 5,
  tasksCreatedPerDay: 20,

  focusMinMinutes: 10,
  focusMinShareOfPlanned: 0.8,
  focusMaxCreditShare: 1.25,
  focusStaleGraceMinutes: 30,
  focusPlannedMinMinutes: 5,
  focusPlannedMaxMinutes: 180,

  dailyCommitmentFocusMinutes: 25,
  taskMinMinutes: 5,
  taskMaxMinutes: 240,
  taskDefaultMinutes: 30,
} as const;

// ── Levels ───────────────────────────────────────────────────
// xp_to_next(L)  = 100 × (L + 2)
// cumulative(L)  = 50 × (L − 1) × (L + 4)

/** Total XP required to reach `level`. Level 1 = 0 XP. */
export function cumulativeXp(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return 50 * (L - 1) * (L + 4);
}

/** XP required for level — alias to cumulativeXp for single authoritative implementation. */
export const xpRequiredForLevel = cumulativeXp;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 100 * (Math.max(1, Math.floor(level)) + 2);
}

/**
 * Level for a given total XP. Negative totals (possible after reversals)
 * are treated as 0 so a level never drops below 1.
 */
export function levelFor(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = Math.max(1, Math.floor((-3 + Math.sqrt(25 + xp / 12.5)) / 2));
  // Guard against floating-point error at exact boundaries.
  while (cumulativeXp(level + 1) <= xp) level++;
  while (level > 1 && cumulativeXp(level) > xp) level--;
  return level;
}

export interface LevelConfigEntry {
  level: number;
  cumulativeXp: number;
  xpToNext: number;
  title?: string;
}

const LEVEL_TITLES: Record<number, string> = {
  1: "Novice",
  5: "Apprentice",
  10: "Adept",
  15: "Focus Knight",
  20: "Master",
  25: "Grandmaster",
  30: "Champion",
  35: "Hero",
  40: "Legend",
  45: "Mythic",
  50: "Immortal",
  55: "Ascendant",
  60: "Vanguard",
  65: "Paragon",
  70: "Luminary",
  75: "Transcendent",
  80: "Sovereign",
  85: "Eternal",
  90: "Apex",
  95: "Demiurge",
  100: "Zenith",
};

/** Pre-generated authoritative level configuration for levels 1–100 (data-only). */
export const LEVEL_CONFIG: LevelConfigEntry[] = Array.from({ length: 100 }, (_, i) => {
  const level = i + 1;
  return {
    level,
    cumulativeXp: cumulativeXp(level),
    xpToNext: xpToNext(level),
    title: LEVEL_TITLES[level],
  };
});

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  /** 0.0 – 1.0, for progress bars */
  fraction: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelFor(xp);
  const into = xp - cumulativeXp(level);
  const next = xpToNext(level);
  return { level, xpIntoLevel: into, xpToNext: next, fraction: into / next };
}

// ── Rounding Policy ──────────────────────────────────────────
/**
 * Authoritative rounding policy: standard round-half-up for positive XP amounts.
 * Math.round(x) returns the nearest integer. Halfway values (e.g., 87.5) round toward +Infinity (88).
 */
export function roundXp(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

// ── XP formula ───────────────────────────────────────────────

export interface XpBreakdown {
  kind: string;
  minutes: number | null;
  base: number;
  effort: number;
  difficulty: number;
  difficultyName: string;
  verification: number;
  verificationKind: string;
  raw: number;
  paid: number;
  softCapped: boolean;
  note?: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Effort scales with minutes for kinds that have a reference length; habits are flat. */
export function effortFactor(
  kind: PayoutKind,
  minutes: number | null | undefined
): number {
  const ref = (ECONOMY.refMinutes as Record<string, number | undefined>)[kind];
  if (!ref || minutes == null) return 1;
  if (!Number.isFinite(minutes) || minutes < 0) return 0; // negative or non-finite minutes reject effort
  if (minutes === 0) return 0; // zero minutes result in no meaningful reward
  return clamp(minutes / ref, ECONOMY.effortMin, ECONOMY.effortMax);
}

/**
 * User-chosen HARD needs >= 45 min of work, EPIC needs >= 90 min;
 * otherwise the tier is clamped to NORMAL (Logic File §7.3).
 */
export function clampDifficulty(
  requested: string | undefined,
  estimatedMinutes: number | null | undefined
): DifficultyName {
  const minutes = estimatedMinutes ?? ECONOMY.taskDefaultMinutes;
  switch (requested) {
    case "EASY":
      return "EASY";
    case "HARD":
      return minutes >= ECONOMY.hardMinMinutes ? "HARD" : "NORMAL";
    case "EPIC":
      return minutes >= ECONOMY.epicMinMinutes ? "EPIC" : "NORMAL";
    default:
      return "NORMAL";
  }
}

export function toDifficultyName(d: string | undefined): DifficultyName {
  return d === "EASY" || d === "HARD" || d === "EPIC" ? d : "NORMAL";
}

/**
 * raw_xp = round(base × effort × difficulty × verification)
 * Verification applies to tasks and quests (self-confirmed pays 80%);
 * standalone sessions are server-timed and habits are capped by frequency.
 *
 * Input policy:
 * - Negative minutes: reject (0 XP).
 * - Zero minutes: 0 XP (no meaningful reward).
 * - Non-finite numeric input: reject (0 XP).
 * - Invalid verification mode: reject (0 XP).
 * - Invalid difficulty: fallback to NORMAL.
 */
export function computeRawXp(input: {
  kind: PayoutKind;
  baseXp?: number;
  minutes?: number | null;
  difficulty?: string;
  verification?: VerificationKind | string;
}): { raw: number; breakdown: Omit<XpBreakdown, "paid" | "softCapped"> } {
  // Reject non-finite or negative base XP
  if (input.baseXp !== undefined && (!Number.isFinite(input.baseXp) || input.baseXp < 0)) {
    return {
      raw: 0,
      breakdown: {
        kind: input.kind,
        minutes: input.minutes ?? null,
        base: 0,
        effort: 0,
        difficulty: 1,
        difficultyName: "NORMAL",
        verification: 1,
        verificationKind: "INVALID",
        raw: 0,
        note: "Invalid non-finite or negative base XP",
      },
    };
  }

  // Reject negative or non-finite minutes if provided
  if (input.minutes != null && (!Number.isFinite(input.minutes) || input.minutes < 0)) {
    return {
      raw: 0,
      breakdown: {
        kind: input.kind,
        minutes: input.minutes,
        base: input.baseXp ?? ECONOMY.base[input.kind],
        effort: 0,
        difficulty: 1,
        difficultyName: "NORMAL",
        verification: 1,
        verificationKind: "INVALID",
        raw: 0,
        note: "Negative or non-finite minutes rejected",
      },
    };
  }

  // Zero minutes produces zero effort/reward
  if (input.minutes === 0) {
    return {
      raw: 0,
      breakdown: {
        kind: input.kind,
        minutes: 0,
        base: input.baseXp ?? ECONOMY.base[input.kind],
        effort: 0,
        difficulty: 1,
        difficultyName: toDifficultyName(input.difficulty),
        verification: 1,
        verificationKind: (input.verification as VerificationKind) ?? "SELF_CONFIRMED",
        raw: 0,
        note: "Zero duration results in no reward",
      },
    };
  }

  // Reject invalid verification mode if provided
  if (
    input.verification !== undefined &&
    input.verification !== "FOCUS_VERIFIED" &&
    input.verification !== "SELF_CONFIRMED"
  ) {
    return {
      raw: 0,
      breakdown: {
        kind: input.kind,
        minutes: input.minutes ?? null,
        base: input.baseXp ?? ECONOMY.base[input.kind],
        effort: 0,
        difficulty: 1,
        difficultyName: "NORMAL",
        verification: 0,
        verificationKind: String(input.verification),
        raw: 0,
        note: "Invalid verification mode rejected",
      },
    };
  }

  const base = input.baseXp ?? ECONOMY.base[input.kind];
  const effort = effortFactor(input.kind, input.minutes);
  const difficultyName = toDifficultyName(input.difficulty);
  const difficulty = ECONOMY.difficulty[difficultyName];
  const verificationKind: VerificationKind = (input.verification as VerificationKind) ?? "SELF_CONFIRMED";
  const verification =
    input.kind === "TASK" || input.kind === "AI_QUEST"
      ? ECONOMY.verification[verificationKind]
      : 1;
  const raw = roundXp(base * effort * difficulty * verification);
  return {
    raw,
    breakdown: {
      kind: input.kind,
      minutes: input.minutes ?? null,
      base,
      effort,
      difficulty,
      difficultyName,
      verification,
      verificationKind,
      raw,
    },
  };
}

/**
 * Daily soft cap: XP above `softCapXp` earned in a local day is paid at 25%.
 * `earnedToday` = payout XP already paid today (bonuses excluded).
 */
export function applySoftCap(raw: number, earnedToday: number): number {
  const room = Math.max(0, ECONOMY.softCapXp - earnedToday);
  const full = Math.min(raw, room);
  const over = Math.max(0, raw - room);
  return roundXp(full + ECONOMY.softCapRate * over);
}

/**
 * Clock plausibility check (§8 / Appendix A):
 * |server_duration - client_elapsed| <= max(60 s, 10% of server_duration).
 */
export function isClockPlausible(
  serverDurationSeconds: number,
  clientElapsedSeconds: number
): boolean {
  const diff = Math.abs(serverDurationSeconds - clientElapsedSeconds);
  const tolerance = Math.max(60, 0.1 * serverDurationSeconds);
  return diff <= tolerance;
}

/** min(5 × streak_days, 50). Granted at most once per local day. */
export function streakBonusXp(streakDays: number): number {
  const d = Math.max(0, Math.floor(streakDays));
  return Math.min(d * ECONOMY.streakBonusPerDay, ECONOMY.streakBonusMax);
}

/** Focus credit: 0 below the threshold, otherwise capped at 1.25 × planned. */
export function focusCreditedMinutes(
  actualMinutes: number,
  plannedMinutes: number
): number {
  const threshold = Math.max(
    ECONOMY.focusMinMinutes,
    ECONOMY.focusMinShareOfPlanned * plannedMinutes
  );
  if (actualMinutes < threshold) return 0;
  return Math.min(actualMinutes, ECONOMY.focusMaxCreditShare * plannedMinutes);
}

// ── Idempotency keys ─────────────────────────────────────────
// One activity, one payout: the key is built from the ROOT activity
// (quest > task > focus session), never from the reward type.

export function payoutKey(root: { type: RootType; id: string }): string {
  return `payout:${root.type}:${root.id}`;
}
export const dailyGoalKey = (localDate: string) => `daily:${localDate}`;
export const streakBonusKey = (localDate: string) => `streak:${localDate}`;
export const reversalKey = (originalTxId: string) => `reversal:${originalTxId}`;

// ── Local dates ──────────────────────────────────────────────

/** YYYY-MM-DD in the given IANA timezone (falls back to UTC if invalid). */
export function localDateString(date: Date, timeZone: string = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
