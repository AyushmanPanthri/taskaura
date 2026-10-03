# TaskAura — Ralph Loop PRD

> **Branch:** `wip/pre-master-snapshot`
> **HEAD:** `401f46c` — temp: celebration video on every completion + video-slot map
> **Date authored:** 2026-10-03
> **Revised:** 2026-10-03 — removed P1/P2/P3/P5/P8 (celebration-video tasks).
> The unconditional celebration trigger on every task/habit completion is a
> deliberate demo-reliability decision (commit 401f46c). Those tasks are not
> in scope.

All tasks are derived from the actual repository state: code, tests, TODOs, and
git history. No new features are invented. Tasks are ordered by dependency.

---

## How to read this document

| Field | Meaning |
|---|---|
| **Depends on** | Task IDs that must be complete before this task starts |
| **Acceptance criteria** | Specific, verifiable conditions that define "done" |
| **Tests / validation** | Commands to run or assertions to verify |

All test commands: `npx vitest run <path>` or `npm test`.
Never modify `prisma/schema.prisma`, migrations, or `.env` files.

---

## Task P4 — Resolve the `SELF_CONFIRMED_LIMIT` spec-drift gap documented in extension-api tests

**Depends on:** none

### Context

Test `P0-A` in `tests/extension-api.test.ts` (line 70) explicitly documents a gap:

> `ECONOMY.selfConfirmedTasksPerDay` is 5 but is not read by any repository.
> The actual enforced cap is `ANTI_FARMING_CONFIG.dailyTasksCompletedLimit = 15`.

`lib/logic/economy.ts` line 35 defines `selfConfirmedTasksPerDay: 5`. The
`tests/self-confirmed-limit.test.ts` suite tests a 5-task cap and passes —
meaning the enforcement uses a separate numeric literal somewhere inside
`lib/repositories/task-repository.ts`. `ECONOMY.selfConfirmedTasksPerDay` is
currently dead code.

### Work

1. Read `lib/repositories/task-repository.ts` to find where the 5-task
   self-confirmed daily limit is enforced as a hardcoded literal.
2. Replace that literal with `ECONOMY.selfConfirmedTasksPerDay` imported from
   `lib/logic/economy`.
3. Update the P0-A test description in `tests/extension-api.test.ts` to remove
   the "constant defined but not enforced" language, since it will now be the
   authoritative source.

### Acceptance criteria

- `ECONOMY.selfConfirmedTasksPerDay` is the single constant read by
  `task-repository.ts` for the per-day XP-earning task cap.
- No other location in `lib/repositories/` or `app/api/` contains a bare
  numeric literal `5` used for the self-confirmed cap.
- The P0-A test description no longer says "not enforced".

### Tests / validation

```bash
npx vitest run tests/self-confirmed-limit.test.ts
npx vitest run tests/extension-api.test.ts
```

Both suites must pass with exit code 0. No new test files are required.

---

## Task P6 — Document and test the `x-user-id` test bypass contract

**Depends on:** none

### Context

Multiple test files pass an `x-user-id` header to bypass real session
authentication (e.g. `phase-c.test.ts`, `extension-api.test.ts`,
`hardening.test.ts`). The README states that `x-user-id` headers are
"strictly rejected in production." The behaviour and conditions of this bypass
are not documented in the source, making it ambiguous whether production routes
actually enforce the rejection.

### Work

1. In `lib/api/auth.ts`, locate where the `x-user-id` header is accepted as a
   test shortcut.
2. Add an inline comment that states explicitly when the bypass is active:
   ```ts
   // TEST BYPASS: x-user-id header accepted only when NODE_ENV !== 'production'.
   // This header is rejected in all deployed environments. See README Auth table.
   ```
3. Add one test to `tests/auth-production.test.ts` asserting that a request to
   a protected route (e.g. `/api/v1/progress`) carrying only an `x-user-id`
   header and no valid session cookie returns HTTP `401` when production auth
   semantics apply.

### Acceptance criteria

- `lib/api/auth.ts` contains the comment above (or equivalent wording).
- `tests/auth-production.test.ts` has a new test that passes, confirming the
  header-only path is rejected.
- No existing tests are broken.

### Tests / validation

```bash
npx vitest run tests/auth-production.test.ts
```

---

## Task P9 — Keep AGENTS.md committed after every `next dev` invocation

**Depends on:** none

### Context

`AGENTS.md` documents its own behaviour:
> "This block is written and re-added by `next dev` — Removing it from a diff
> only re-creates the uncommitted change; committing it with your work keeps
> the tree clean."

After any task that involves running `npm run dev` for manual verification,
`AGENTS.md` may reappear as a modified file.

### Work

After any task that runs `next dev`, check `git status`. If `AGENTS.md`
appears as modified, stage it and include it in that task's commit.

### Acceptance criteria

- `git status --short` is empty (clean tree) after every committed task.
- `AGENTS.md` is never left as an uncommitted modification.

### Tests / validation

```bash
git status --short
# Expected: (empty output — no modified or untracked files)
```

---

## Tasks awaiting separate approval

The following tasks from the original PRD are parked; do not execute them
without explicit approval:

| Task | Summary |
|---|---|
| P7 | Wire `OfflineMutationQueue` to the Focus page client |
| P10 | Full test suite green across all 26 files |
| P11 | Final build + lint + test verification snapshot |

---

## Explicitly out of scope

- Celebration video trigger logic — the unconditional trigger on every
  task/habit completion is intentional demo scaffolding (commit `401f46c`).
  Do not revert or condition-gate it.
- `UsageSession`, `Goal`, `SyncLog`, `DailyMetrics`, `TaskTypeConfig` models —
  schema only, no routes or UI reference them.
- Google OAuth sign-in button on the login page — absence is intentional.
- `UserSettings` model — no settings UI page (by design).
- Admin role self-service UI — manual SQL only, per README.
