import type { Task } from "@/lib/logic/types";
import type { CompletionGamification } from "@/lib/logic/completion-gamification";
import { GAMIFICATION_CELEBRATION_SLOTS } from "./CelebrationOverlay";
import { triggerCelebration, triggerXpToast } from "./AppShell";

interface TaskCompletionResponse {
  task?: Task;
  xpAwarded?: number;
  rejected?: boolean;
  isDuplicate?: boolean;
  reason?: string;
  minimumRequiredDurationMs?: number;
  serverDurationMs?: number;
  gamification?: CompletionGamification;
}

interface TaskCompletionHandlers {
  onRejected?: (response: TaskCompletionResponse) => void;
  onDuplicate?: (response: TaskCompletionResponse) => void;
  onConfirmed?: (task: Task) => void;
}

function xpExplanation(gamification?: CompletionGamification): string | null {
  const xp = gamification?.xp;
  if (!xp) return null;
  if (xp.reduced) return "New-user reward ramp applied";
  if (xp.capped) {
    return xp.reason === "DAILY_TASK_XP_CAP"
      ? "Daily task XP cap reached"
      : "XP limit reached";
  }
  if (xp.awarded === 0) return xp.reason.replaceAll("_", " ").toLowerCase();
  return null;
}

export function handleTaskCompletionResponse(
  response: TaskCompletionResponse,
  handlers: TaskCompletionHandlers = {}
): "rejected" | "duplicate" | "completed" | "ignored" {
  if (response.rejected) {
    handlers.onRejected?.(response);
    return "rejected";
  }
  if (response.isDuplicate) {
    handlers.onDuplicate?.(response);
    return "duplicate";
  }
  if (response.task?.status !== "COMPLETED") return "ignored";

  handlers.onConfirmed?.(response.task);

  const xpAwarded =
    response.gamification?.xp?.awarded ?? response.xpAwarded ?? 0;
  const explanation = xpExplanation(response.gamification);
  const label = [
    `Completed: ${response.task.title}`,
    explanation,
    response.gamification?.progression?.levelUp
      ? `LEVEL UP: Level ${response.gamification.progression.previousLevel} to Level ${response.gamification.progression.newLevel}`
      : null,
    ...(response.gamification?.achievements ?? []).map(
      (achievement) => `Achievement unlocked: ${achievement.name}`
    ),
    response.gamification?.ranking?.changed
      ? `Rank ${response.gamification.ranking.newRank < response.gamification.ranking.previousRank ? "up" : "down"}: #${response.gamification.ranking.previousRank} to #${response.gamification.ranking.newRank}`
      : null,
    response.gamification?.streak?.changed
      ? `${response.gamification.streak.current} day streak`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (response.gamification && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("taskaura:gamification-update", {
        detail: response.gamification,
      })
    );
  }
  triggerXpToast(xpAwarded, label);
  const celebration =
    response.gamification?.feedback.celebration ?? "TASK_COMPLETE";
  triggerCelebration(GAMIFICATION_CELEBRATION_SLOTS[celebration]);
  return "completed";
}
