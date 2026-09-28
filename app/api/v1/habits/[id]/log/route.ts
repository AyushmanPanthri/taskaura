// ============================================================
// Task Aura — POST /api/v1/habits/:id/log
// Idempotent habit logging for a specific date
//
// MIGRATION (Stage 3): Previously wrote XP only to InMemoryStore.
// Now uses habitRepository.logHabitTransaction() which atomically:
//   1. Creates habit log (PostgreSQL)
//   2. Writes XP to xp_transactions (PostgreSQL)
//   3. Updates habit streak counts (PostgreSQL)
// This fixes the P0 data-loss bug where habit XP was lost on restart.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { habitRepository } from "@/lib/repositories/habit-repository";
import { payoutKey, ECONOMY } from "@/lib/logic/economy";
import { XPSourceType, RewardType } from "@/lib/logic/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const date =
      typeof body.date === "string" && body.date.trim()
        ? body.date.trim()
        : new Date().toISOString().slice(0, 10);
    const completed =
      typeof body.completed === "boolean" ? body.completed : true;

    // Root activity key for idempotency: one habit completion per date
    const sourceId = `${id}:${date}`;
    const idempotencyKey = payoutKey({ type: "HABIT", id: sourceId });

    // Base XP for a habit completion (economy-authoritative, no store)
    const habitXp = ECONOMY.base.HABIT; // 75

    const result = await habitRepository.logHabitTransaction(
      user.id,
      id,
      date,
      completed,
      idempotencyKey,
      {
        amount: completed ? habitXp : 0,
        baseXp: habitXp,
        difficultyMultiplier: 1.0,
        streakBonus: 0,
        rewardType: RewardType.COMPLETION,
      }
    );

    return apiSuccess({
      log: result.log,
      xpAwarded: result.xpAwarded,
      isDuplicate: result.isDuplicate,
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
