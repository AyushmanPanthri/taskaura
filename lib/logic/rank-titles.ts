// ============================================================
// TaskAura — Rank Title System (Phase 2 Addendum)
// Pure function mapping level -> milestone identity title
// Display/identity only — strictly decoupled from economy/ranking
// ============================================================

export interface RankTier {
  tier: number;
  title: string;
  minLevel: number;
  maxLevel: number;
}

/**
 * Eight milestone tiers front-loaded across levels 1–100.
 * Tunable starting configuration.
 */
export const RANK_TIERS: readonly RankTier[] = [
  { tier: 1, title: "Deku", minLevel: 1, maxLevel: 5 },
  { tier: 2, title: "Subaru", minLevel: 6, maxLevel: 12 },
  { tier: 3, title: "Asta", minLevel: 13, maxLevel: 22 },
  { tier: 4, title: "Naruto", minLevel: 23, maxLevel: 35 },
  { tier: 5, title: "Sung Jinwoo", minLevel: 36, maxLevel: 50 },
  { tier: 6, title: "Goku", minLevel: 51, maxLevel: 70 },
  { tier: 7, title: "Saitama", minLevel: 71, maxLevel: 90 },
  { tier: 8, title: "The Slime", minLevel: 91, maxLevel: 100 },
] as const;

export interface RankTitleInfo {
  rankTitle: string;
  rankTier: number;
  nextTitleAt: number | null;
}

/**
 * Pure function: derives the milestone rank title from current level.
 * Recomputed on every read; never persisted.
 */
export function getRankTitle(level: number): string {
  return getRankTitleInfo(level).rankTitle;
}

/**
 * Pure function: derives title, tier index, and next milestone level from current level.
 */
export function getRankTitleInfo(level: number): RankTitleInfo {
  const clampedLevel = Math.max(1, Math.floor(level));

  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    const tier = RANK_TIERS[i];
    if (clampedLevel >= tier.minLevel) {
      const nextTier = RANK_TIERS[i + 1];
      return {
        rankTitle: tier.title,
        rankTier: tier.tier,
        nextTitleAt: nextTier ? nextTier.minLevel : null,
      };
    }
  }

  return {
    rankTitle: RANK_TIERS[0].title,
    rankTier: 1,
    nextTitleAt: RANK_TIERS[1].minLevel,
  };
}
