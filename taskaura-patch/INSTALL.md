# Task Aura — XP economy patch

Fixes the four demo-breaking bugs: level formula, double payout, streak bonus per payout, XP farming.

## 1. Copy files

| File | Action |
| --- | --- |
| `lib/logic/economy.ts` | **new** (pure, no imports) |
| `lib/services/store.ts` | replace (per-user idempotency index + `getXpTransactionByKey`) |
| `lib/services/xp-service.ts` | replace |
| `lib/services/task-service.ts` | replace |
| `lib/services/focus-service.ts` | replace |
| `tests/economy.test.ts`, `tests/services.test.ts` | **new** |

`sync-service.ts`, `leaderboard-service.ts`, `aggregation-service.ts`, `index.ts` are unchanged
(only their header comment still says LifeXP: `grep -rl LifeXP lib app`).

## 2. Additive edits to `lib/logic/types.ts`

All optional or new enum members, so nothing existing breaks:

```ts
// XPTransaction
breakdown?: import("./economy").XpBreakdown;

// Task
estimatedMinutes?: number | null;

// FocusSession
taskId?: string | null;

// enum XPSourceType  (add if missing)
DAILY_GOAL = "DAILY_GOAL",
STREAK_BONUS = "STREAK_BONUS",
```

## 3. Make the old level formula impossible to use

In `lib/logic/xp-engine.ts`, delete the bodies of `calculateLevel` and `levelProgress` and replace with:

```ts
import { levelFor, levelProgress as levelProgressDetail } from "./economy";
export const calculateLevel = (totalXp: number): number => levelFor(totalXp);
export const levelProgress = (totalXp: number): number => levelProgressDetail(totalXp).fraction;
```

Then find every other user of the old pieces:

```bash
grep -rn "calculateLevel\|levelProgress\|calculateFinalXp\|generateIdempotencyKey\|awardXp(" app lib
```

`awardXp` still exists (deprecated wrapper) and now routes through the same one-payout-per-root logic.
It ignores `streakDays`; the streak bonus is a separate once-per-day ledger entry.

## 4. Run the tests

```bash
npm i -D vitest
# package.json -> "scripts": { "test": "vitest run" }
npm test
```

## 5. What changed for callers

- `completeTask` / `completeFocusSession` return extra fields: `bonusXp`, plus `reason` (tasks) and `evidenceOnly` (sessions). Existing fields are unchanged.
- `startFocusSession` accepts `taskId`, returns the existing session for a repeated `clientEventId`, and throws if another session is running.
- `createTask` accepts `estimatedMinutes` (default 30), clamps HARD/EPIC for short tasks, and throws after 20 user tasks in a local day.
- New: `awardPayout`, `grantDailyBonuses`, `maybeGrantDailyBonuses`, `reverseTransaction`, `getUserProgress`.
- To pay a quest through the demo flow: create the AI task (`source: AI`, `questId`, `estimatedMinutes: 45`), start a focus session with its `taskId`, complete the session. The quest pays once (+150).

## 6. Assumptions I could not check (files not provided)

`types.ts`, `xp-engine.ts`, `constants.ts`, `focus-engine.ts`, `task-engine.ts` were not uploaded. Tests ran against stand-ins, so if something fails in your repo look here first:

1. `validateFocusSession` may need more heartbeats than the tests send (every 30 s).
2. `TaskStatus.CANCELLED` and the enum names `XPSourceType.AI_QUEST / FOCUS_SESSION / TASK / ADJUSTMENT`.
3. `validateTaskTransition(PENDING, COMPLETED)` must be allowed (the old `completeTask` already relied on it).
4. Timezone comes from `store.users.get(id)?.timezone`, else UTC.
