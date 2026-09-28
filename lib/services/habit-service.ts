// ============================================================
// Task Aura — Habit Service
// ============================================================

import type { Habit } from "../logic/types";

export interface HabitWithTodayStatus extends Habit {
  completedToday: boolean;
  streak: number;
}
