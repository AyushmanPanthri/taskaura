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
  verification: { FOCUS_VERIFIED: 1.5, SELF_CONFIRMED: 0.5 },
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

/**
 * Authoritative Anti-Farming & Completion Integrity Configuration.
 * Centralized policy limits and initial tunable defaults.
 */
export const ANTI_FARMING_CONFIG = {
  /** Minimum completion threshold: 80% of estimated duration. */
  minCompletionShareOfEstimated: 0.8,
  /** Absolute minimum duration (ms) for any XP-eligible task (60 seconds). */
  minAbsoluteDurationMs: 60_000,
  /** Minimum estimated minutes required for user-selected HARD difficulty. */
  hardMinMinutes: 45,
  /** Minimum estimated minutes required for user-selected EPIC difficulty. */
  epicMinMinutes: 90,

  /** Max tasks a user may create per calendar day. */
  dailyTasksCreatedLimit: 20,
  /** Max successful task completions awarded XP per calendar day. */
  dailyTasksCompletedLimit: 15,
  /** Max total completion attempts (successful + rejected) per calendar day. */
  dailyCompletionAttemptsLimit: 30,
  /** Daily cap on total XP earned specifically from tasks. */
  dailyTaskXpCap: 1000,

  /** New-user onboarding progression ramp-up: first N lifetime SELF_CONFIRMED tasks. */
  newUserRampUpTaskCount: 5,
  /** Multiplier applied to raw XP during onboarding ramp-up (50%). */
  newUserRampUpMultiplier: 0.5,

  // ── Suspicious Pattern Thresholds ──────────────────────────────
  // INITIAL DEFAULTS subject to tuning after real usage data exists:

  /** Burst threshold: >= 5 completions in burst window. Starting guess for automated batch check-offs. */
  suspiciousBurstCount: 5,
  /** Burst window: 10 minutes in milliseconds. */
  suspiciousBurstWindowMs: 10 * 60_000,
  /** Rejection threshold: >= 3 speed/eligibility rejections in 24h. Starting guess for timing brute-force attempts. */
  suspiciousRejectedAttemptsThreshold: 3,
  /** Abandoned threshold: >= 3 abandoned/cancelled HARD/EPIC tasks in 24h. Starting guess for multiplier probing. */
  suspiciousAbandonHardEpicCount: 3,
  /** Baseline velocity ratio: > 3.0x trailing 7-day daily average. Starting guess for abnormal volume spikes. */
  suspiciousDailyBaselineMultiplier: 3.0,
  /** Minimum daily completion floor before baseline velocity ratio can trigger (protects casual variance). */
  suspiciousDailyBaselineMinFloor: 10,
} as const;

/**
 * Authoritative calculation of minimum required duration before a task
 * is eligible for completion and XP reward.
 *
 * Formula: max(60,000 ms, floor(estimatedMinutes * 60,000 * 0.8))
 *
 * Rounding behavior:
 * - Computed in integer milliseconds.
 * - Fractional milliseconds are floored (Math.floor).
 * - Clamped at configured lower bound (60,000 ms).
 * - Tasks with estimated duration < 60s (e.g. < 1 min) require 60,000 ms,
 *   but earn 0 XP per anti-farming rules.
 *
 * Authoritative examples:
 *   5 min task  -> max(60s, floor(5 * 60 * 0.8)s)  = max(60s, 240s)  = 4 min (240,000 ms)
 *  15 min task  -> max(60s, floor(15 * 60 * 0.8)s) = max(60s, 720s) = 12 min (720,000 ms)
 *  30 min task  -> max(60s, floor(30 * 60 * 0.8)s) = max(60s, 1440s) = 24 min (1,440,000 ms)
 *  60 min task  -> max(60s, floor(60 * 60 * 0.8)s) = max(60s, 2880s) = 48 min (2,880,000 ms)
 */
export function calculateMinimumDurationMs(estimatedMinutes: number): number {
  const estimatedMs = Math.max(0, estimatedMinutes) * 60_000;
  const rawShare = Math.floor(estimatedMs * ANTI_FARMING_CONFIG.minCompletionShareOfEstimated);
  return Math.max(ANTI_FARMING_CONFIG.minAbsoluteDurationMs, rawShare);
}

export interface AuthoritativeTaskRewardOptions {
  minutes: number;
  difficulty: string;
  verification: VerificationKind;
  isGrandfathered?: boolean;
  lifetimeSelfConfirmedCount?: number;
}

export interface AuthoritativeTaskRewardResult {
  rawXp: number;
  finalXp: number;
  isReducedNewUser: boolean;
  zeroReason?: "SUB_60_SECONDS" | "NEVER_STARTED" | "TOO_FAST";
}

/**
 * Authoritative calculation of task XP reward enforcing:
 * 1. Sub-60 second tasks earn 0 XP
 * 2. Minimum duration threshold enforcement
 * 3. HARD (>=45m) and EPIC (>=90m) difficulty constraints (with legacy grandfathering support)
 * 4. First-five lifetime SELF_CONFIRMED task onboarding ramp-up (50% XP, floor 1)
 */
export function calculateTaskRewardAuthoritative(
  options: AuthoritativeTaskRewardOptions
): AuthoritativeTaskRewardResult {
  // Sub-60s tasks receive 0 XP
  if (options.minutes < 1) {
    return { rawXp: 0, finalXp: 0, isReducedNewUser: false, zeroReason: "SUB_60_SECONDS" };
  }

  const effectiveDifficulty = options.isGrandfathered
    ? toDifficultyName(options.difficulty)
    : clampDifficulty(options.difficulty, options.minutes);

  const raw = computeRawXp({
    kind: "TASK",
    minutes: options.minutes,
    difficulty: effectiveDifficulty,
    verification: options.verification,
  }).raw;

  let finalXp = raw;
  let isReducedNewUser = false;

  // First-five lifetime self-confirmed task rule:
  // A brand-new user's first 5 SELF_CONFIRMED task completions pay 50% of the
  // normally-calculated reward, rounded down, with a floor of 1 XP if raw > 0.
  // FOCUS_VERIFIED completions are exempt from this cap regardless of count.
  if (
    options.verification === "SELF_CONFIRMED" &&
    options.lifetimeSelfConfirmedCount !== undefined &&
    options.lifetimeSelfConfirmedCount < ANTI_FARMING_CONFIG.newUserRampUpTaskCount
  ) {
    finalXp = Math.max(1, Math.floor(raw * ANTI_FARMING_CONFIG.newUserRampUpMultiplier));
    isReducedNewUser = true;
  }

  return { rawXp: raw, finalXp, isReducedNewUser };
}

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
export function levelFor(totalXp: number, maxLevel?: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = Math.max(1, Math.floor((-3 + Math.sqrt(25 + xp / 12.5)) / 2));
  // Guard against floating-point error at exact boundaries.
  while (cumulativeXp(level + 1) <= xp) level++;
  while (level > 1 && cumulativeXp(level) > xp) level--;
  return maxLevel !== undefined ? Math.min(maxLevel, level) : level;
}

export interface LevelConfigEntry {
  level: number;
  cumulativeXp: number;
  xpToNext: number;
  title?: string;
}

export const LEVEL_TITLES: Record<number, string> = {
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

/**
 * Returns the highest unlocked RPG mastery title for the given level.
 * Persists milestone title across intermediate levels (e.g. level 6-9 retain "Apprentice").
 */
export function getLegacyLevelTitle(level: number): string {
  const clamped = Math.min(100, Math.max(1, Math.floor(level)));
  const milestones = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  let activeMilestone = 1;
  for (const m of milestones) {
    if (clamped >= m) activeMilestone = m;
    else break;
  }
  return LEVEL_TITLES[activeMilestone] ?? "Novice";
}

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

export function levelProgress(totalXp: number, maxLevel?: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  const rawLevel = levelFor(xp);

  // At or above configured max level (e.g. level 100): progress bar is full, xpToNext is 0
  if (maxLevel !== undefined && rawLevel >= maxLevel) {
    const into = xp - cumulativeXp(maxLevel);
    return { level: maxLevel, xpIntoLevel: into, xpToNext: 0, fraction: 1.0 };
  }

  const into = xp - cumulativeXp(rawLevel);
  const next = xpToNext(rawLevel);
  return { level: rawLevel, xpIntoLevel: into, xpToNext: next, fraction: into / next };
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

// ── Rank Title System (Phase 2 Addendum) ─────────────────────
export {
  RANK_TIERS,
  getRankTitle,
  getRankTitleInfo,
  type RankTier,
  type RankTitleInfo,
} from "./rank-titles";
