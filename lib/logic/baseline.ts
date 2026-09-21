// ============================================================
// LifeXP — Personal Baseline Logic
// Maps to Logic System File v2 §5
// Pure functions — no side effects, no DB access
// ============================================================

import type { BaselineDelta, DailyMetrics } from "./types";
import {
  BASELINE_EPSILON,
  MIN_BASELINE_DAYS,
  TRIMMED_MEAN_THRESHOLD,
  WEEKDAY_WEEKEND_SPLIT_THRESHOLD,
} from "./constants";

// ── Helpers ──────────────────────────────────────────────────

/** Get day of week (0=Sunday..6=Saturday) from YYYY-MM-DD string */
function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr).getDay();
}

/** Check if a date string falls on a weekday (Mon-Fri) */
function isWeekday(dateStr: string): boolean {
  const day = getDayOfWeek(dateStr);
  return day >= 1 && day <= 5;
}

/**
 * §5 v2 — Trimmed mean: drop the single highest and lowest value.
 * Used once ≥7 days of data exist to prevent outlier distortion.
 */
function trimmedMean(values: number[]): number {
  if (values.length < 3) {
    // Not enough to trim — use regular mean
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const sorted = [...values].sort((a, b) => a - b);
  // Drop first (lowest) and last (highest)
  const trimmed = sorted.slice(1, -1);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

/** Plain arithmetic mean */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Public API ───────────────────────────────────────────────

/**
 * §5 — Check if there's enough history for baseline-driven recommendations.
 *
 * Require minimum of 5 eligible days before any baseline-driven
 * recommendation fires. Fewer than that, the AI pipeline is restricted
 * to insight/observation-only, no quest or recommendation actions.
 */
export function hasEnoughHistory(dayCount: number): boolean {
  return dayCount >= MIN_BASELINE_DAYS;
}

/**
 * Extract a specific numeric metric from DailyMetrics by key name.
 */
type MetricKey = keyof Pick<
  DailyMetrics,
  | "totalScreenTime"
  | "appOpens"
  | "focusMinutes"
  | "taskCompletionRate"
  | "distractionIndex"
  | "focusScore"
  | "consistencyScore"
  | "goalAlignment"
  | "taskReliability"
  | "routineStability"
>;

/**
 * §5 — Compute the personal baseline for a given metric.
 *
 * baseline(metric) = average(metric over eligible historical days)
 *
 * v2 reliability hardening:
 * - Require minimum 5 eligible days
 * - Trimmed mean (drop highest/lowest) once ≥7 days
 * - Weekday/weekend split only with ≥14 days per bucket
 */
export function computeBaseline(
  historicalMetrics: DailyMetrics[],
  metricKey: MetricKey,
  options?: {
    /** Current date string (YYYY-MM-DD) for weekday/weekend split */
    currentDate?: string;
    /** Force weekday/weekend split even if not enough data */
    forceSplit?: boolean;
  }
): number | null {
  if (historicalMetrics.length < MIN_BASELINE_DAYS) {
    return null; // Not enough data
  }

  const currentDate = options?.currentDate;
  const forceSplit = options?.forceSplit ?? false;

  // Try weekday/weekend split if we have enough data and know the current day
  if (currentDate) {
    const currentIsWeekday = isWeekday(currentDate);

    const weekdayMetrics = historicalMetrics.filter((m) => isWeekday(m.date));
    const weekendMetrics = historicalMetrics.filter((m) => !isWeekday(m.date));

    const relevantBucket = currentIsWeekday ? weekdayMetrics : weekendMetrics;

    // §5 v2: Weekday/weekend split only activates once ≥14 days per bucket
    if (
      forceSplit ||
      relevantBucket.length >= WEEKDAY_WEEKEND_SPLIT_THRESHOLD
    ) {
      const values = relevantBucket.map((m) => m[metricKey] as number);
      if (values.length >= MIN_BASELINE_DAYS) {
        return values.length >= TRIMMED_MEAN_THRESHOLD
          ? trimmedMean(values)
          : mean(values);
      }
    }
    // Fall through to combined baseline
  }

  // Combined baseline (no weekday/weekend split)
  const values = historicalMetrics.map((m) => m[metricKey] as number);

  // §5 v2: Trimmed mean once ≥7 days exist
  if (values.length >= TRIMMED_MEAN_THRESHOLD) {
    return trimmedMean(values);
  }

  return mean(values);
}

/**
 * §5 — Compute delta and percentage change between current value and baseline.
 *
 * delta = current_value - baseline
 * percentage_change = (current_value - baseline) / max(baseline, ε) × 100
 */
export function computeDelta(
  currentValue: number,
  baseline: number
): { delta: number; percentageChange: number } {
  const delta = currentValue - baseline;
  const percentageChange =
    (delta / Math.max(baseline, BASELINE_EPSILON)) * 100;

  return {
    delta: Math.round(delta * 100) / 100,
    percentageChange: Math.round(percentageChange * 100) / 100,
  };
}

/**
 * §5 — Compute baseline deltas for all tracked metrics.
 * Returns null if not enough history exists.
 */
export function computeAllBaselineDeltas(
  currentMetrics: DailyMetrics,
  historicalMetrics: DailyMetrics[]
): BaselineDelta[] | null {
  if (!hasEnoughHistory(historicalMetrics.length)) {
    return null;
  }

  const metricKeys: MetricKey[] = [
    "totalScreenTime",
    "appOpens",
    "focusMinutes",
    "taskCompletionRate",
    "distractionIndex",
    "focusScore",
    "consistencyScore",
    "goalAlignment",
    "taskReliability",
    "routineStability",
  ];

  const deltas: BaselineDelta[] = [];

  for (const key of metricKeys) {
    const baseline = computeBaseline(historicalMetrics, key, {
      currentDate: currentMetrics.date,
    });

    if (baseline === null) continue;

    const currentValue = currentMetrics[key] as number;
    const { delta, percentageChange } = computeDelta(currentValue, baseline);

    deltas.push({
      metric: key,
      baseline,
      currentValue,
      delta,
      percentageChange,
    });
  }

  return deltas;
}
