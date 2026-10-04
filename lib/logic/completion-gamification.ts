export type CompletionFeedbackType =
  | "TASK_COMPLETE"
  | "TASK_ZERO_XP"
  | "FOCUS_COMPLETE"
  | "HABIT_COMPLETE"
  | "REJECTED";

export type GamificationCelebration =
  | "TASK_COMPLETE"
  | "LEVEL_UP"
  | "ACHIEVEMENT_UNLOCKED"
  | "STREAK_MILESTONE"
  | "RANK_UP";

export interface CompletionGamification {
  xp?: {
    awarded: number;
    previousTotal: number;
    newTotal: number;
    capped: boolean;
    reduced: boolean;
    reason: string;
  };
  progression?: {
    previousLevel: number;
    newLevel: number;
    levelUp: boolean;
    levelProgress: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
  };
  streak?: {
    changed: boolean;
    previous: number;
    current: number;
  };
  achievements?: {
    id: string;
    name: string;
    description: string;
    unlockedAt: string;
  }[];
  ranking?: {
    changed: boolean;
    previousRank: number;
    newRank: number;
  };
  feedback: {
    type: CompletionFeedbackType;
    celebration?: GamificationCelebration;
    reason?: string;
    what?: string;
    why?: string;
    remainingMs?: number;
  };
}
