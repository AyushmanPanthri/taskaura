// ============================================================
// Task Aura — Task Completion Integrity & Anti-XP-Farming Suite
// Validates 30-case matrix, anti-cheat attack test, and PATCH bypass prevention
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { taskRepository, GRANDFATHER_CUTOFF } from "../lib/repositories/task-repository";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { POST as startTaskRoute } from "../app/api/v1/tasks/[id]/start/route";
import { POST as postTask } from "../app/api/v1/tasks/route";
import { PATCH as patchTaskById } from "../app/api/v1/tasks/[id]/route";
import { Difficulty, TaskStatus } from "../lib/logic/types";
import {
  calculateMinimumDurationMs,
  calculateTaskRewardAuthoritative,
} from "../lib/logic/economy";

const TEST_USER_A = "00000000-0000-0000-0000-000000000071";
const TEST_USER_B = "00000000-0000-0000-0000-000000000072";

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init);
}

describe("Task Completion Integrity & Anti-XP-Farming Suite", () => {
  beforeEach(async () => {
    // Clean test state for test users
    await prisma.xPTransaction.deleteMany({
      where: { userId: { in: [TEST_USER_A, TEST_USER_B] } },
    });
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [
          { adminUserId: { in: [TEST_USER_A, TEST_USER_B] } },
          { targetUserId: { in: [TEST_USER_A, TEST_USER_B] } },
        ],
      },
    });
    await prisma.task.deleteMany({
      where: { userId: { in: [TEST_USER_A, TEST_USER_B] } },
    });
    await prisma.user.upsert({
      where: { id: TEST_USER_A },
      update: {},
      create: {
        id: TEST_USER_A,
        displayName: "Farmer Candidate",
        email: "farmer@taskaura.dev",
      },
    });
    await prisma.user.upsert({
      where: { id: TEST_USER_B },
      update: {},
      create: {
        id: TEST_USER_B,
        displayName: "Legit Player",
        email: "legit@taskaura.dev",
      },
    });
  });

  // ── 1. AUTHORITATIVE TIMING & MINIMUM DURATION ───────────────
  describe("1-5. Authoritative Timing & Minimum Duration", () => {
    it("1. creates task normally with PENDING status", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Study Chemistry",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.startedAt).toBeNull();
      expect(task.estimatedMinutes).toBe(30);
    });

    it("2. task starts and records server-authoritative startedAt", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Study Physics",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });

      const req = makeReq(`/api/v1/tasks/${task.id}/start`, "POST", {}, { "x-user-id": TEST_USER_A });
      const res = await startTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.task.status).toBe(TaskStatus.IN_PROGRESS);
      expect(json.data.task.startedAt).toBeTruthy();
    });

    it("3. completion before minimum duration -> rejected: true, no XP, task remains IN_PROGRESS, attempt recorded", async () => {
      // Create and start a 30-minute task (minimum required: 24 minutes)
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Long Essay Writing",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });
      await taskRepository.startTask(TEST_USER_A, task.id);

      // Attempt completion immediately (0 ms elapsed < 24m)
      const req = makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A });
      const res = await completeTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.rejected).toBe(true);
      expect(json.data.reason).toBe("TOO_FAST");
      expect(json.data.xpAwarded).toBe(0);
      expect(json.data.task.status).toBe(TaskStatus.IN_PROGRESS);

      // Verify DB state: task remains IN_PROGRESS and completionAttempts is 1
      const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(dbTask?.completionAttempts).toBe(1);

      // Verify no XPTransaction created
      const txCount = await prisma.xPTransaction.count({ where: { userId: TEST_USER_A } });
      expect(txCount).toBe(0);

      // Verify rejection audit log created
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: { targetUserId: TEST_USER_A, action: "TASK_COMPLETION_REJECTED" },
      });
      expect(auditLog).toBeTruthy();
      expect(JSON.parse(auditLog!.metadata).reason).toBe("TOO_FAST");
    });

    it("4 & 5. completion at or after minimum duration awards XP and completes task", async () => {
      // 10 min task -> minimum duration is 8 min (480,000 ms)
      const minDurationMs = calculateMinimumDurationMs(10);
      expect(minDurationMs).toBe(8 * 60_000);

      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Completed Read",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 10,
      });

      // Simulate started 9 minutes ago in PostgreSQL
      const nineMinutesAgo = new Date(Date.now() - 9 * 60_000);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: nineMinutesAgo },
      });

      const req = makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A });
      const res = await completeTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
      expect(json.data.xpAwarded).toBeGreaterThan(0);
      expect(json.data.rejected).toBe(false);

      // Verify XP ledger entry in PostgreSQL
      const ledgerEntry = await prisma.xPTransaction.findFirst({
        where: { userId: TEST_USER_A, sourceId: task.id },
      });
      expect(ledgerEntry).toBeTruthy();
      expect(ledgerEntry?.amount).toBe(json.data.xpAwarded);
    });
  });

  // ── 6-9. SECURITY & AUTHORITATIVENESS ─────────────────────────
  describe("6-9. Core Security: Client Spoofing Resistance", () => {
    it("6 & 7 & MANDATORY ATTACK: client cannot forge elapsed time or XP payload", async () => {
      // Attack scenario:
      // 1. User creates a 5-minute task.
      // 2. Client modifies request claiming 60 minutes elapsed & xp = 10000.
      // 3. Client attempts completion immediately.
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Cheat Attempt Task",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 5,
      });
      await taskRepository.startTask(TEST_USER_A, task.id);

      const attackReq = makeReq(
        `/api/v1/tasks/${task.id}/complete`,
        "POST",
        {
          elapsedTime: 3600,
          elapsedSeconds: 3600,
          xp: 10000,
          reward: 10000,
          totalXp: 50000,
          level: 99,
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
        { "x-user-id": TEST_USER_A }
      );

      const res = await completeTaskRoute(attackReq, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      // Server ignores forged timing & XP: rejected for speed
      expect(json.data.rejected).toBe(true);
      expect(json.data.reason).toBe("TOO_FAST");
      expect(json.data.xpAwarded).toBe(0);

      // Zero XP injected in database
      const userTxs = await prisma.xPTransaction.findMany({ where: { userId: TEST_USER_A } });
      expect(userTxs).toHaveLength(0);

      // Logged as security/rejected event
      const audit = await prisma.adminAuditLog.findFirst({
        where: { targetUserId: TEST_USER_A, action: "TASK_COMPLETION_REJECTED" },
      });
      expect(audit).toBeTruthy();
    });

    it("8 & 9. client-supplied userId in body/header cannot complete another user's task", async () => {
      // User B creates a task
      const taskB = await taskRepository.createTask(TEST_USER_B, {
        title: "User B Private Task",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });

      // User A tries to complete User B's task, claiming user B's identity in body
      const spoofReq = makeReq(
        `/api/v1/tasks/${taskB.id}/complete`,
        "POST",
        { userId: TEST_USER_B },
        { "x-user-id": TEST_USER_A }
      );

      const res = await completeTaskRoute(spoofReq, { params: Promise.resolve({ id: taskB.id }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });
  });

  // ── 10-12. IDEMPOTENCY & CONCURRENCY ─────────────────────────
  describe("10-12. Idempotency & Concurrency Invariants", () => {
    it("10 & 11. completed task cannot pay twice; duplicate calls are idempotent", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Double Pay Test",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 10,
      });

      // Simulate started 15 min ago
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 15 * 60_000) },
      });

      // First call
      const res1 = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      const json1 = await res1.json();
      expect(json1.data.isDuplicate).toBe(false);
      expect(json1.data.xpAwarded).toBeGreaterThan(0);

      // Second call (immediate retry)
      const res2 = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      const json2 = await res2.json();
      expect(json2.data.isDuplicate).toBe(true);
      expect(json2.data.xpAwarded).toBe(0);

      // Verify exactly ONE transaction exists in DB
      const count = await prisma.xPTransaction.count({
        where: { userId: TEST_USER_A, sourceId: task.id },
      });
      expect(count).toBe(1);
    });

    it("12. concurrent completion requests result in exactly ONE payout", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Concurrent Task Payout",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 10,
      });

      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 15 * 60_000) },
      });

      // Fire 10 simultaneous completion requests
      const promises = Array.from({ length: 10 }, () =>
        completeTaskRoute(
          makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
          { params: Promise.resolve({ id: task.id }) }
        ).then((r) => r.json())
      );

      const results = await Promise.all(promises);
      const primaryPayouts = results.filter((r) => r.data?.isDuplicate === false && r.data?.xpAwarded > 0);
      const duplicateReturns = results.filter((r) => r.data?.isDuplicate === true);

      expect(primaryPayouts.length).toBe(1);
      expect(duplicateReturns.length).toBe(9);

      // PostgreSQL database invariant: exactly 1 ledger row
      const txCount = await prisma.xPTransaction.count({
        where: { userId: TEST_USER_A, sourceId: task.id },
      });
      expect(txCount).toBe(1);
    });
  });

  // ── 13-14. IMMUTABILITY AFTER START ──────────────────────────
  describe("13-14. Immutability of Difficulty and Duration After Start", () => {
    it("13 & 14. rejects mutation to difficulty or estimatedMinutes once IN_PROGRESS", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Immutability Task",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });

      await taskRepository.startTask(TEST_USER_A, task.id);

      // Attempt to upgrade difficulty from NORMAL to EPIC
      const patchDiffReq = makeReq(
        `/api/v1/tasks/${task.id}`,
        "PATCH",
        { difficulty: "EPIC" },
        { "x-user-id": TEST_USER_A }
      );
      const resDiff = await patchTaskById(patchDiffReq, { params: Promise.resolve({ id: task.id }) });
      expect(resDiff.status).toBe(400);
      const jsonDiff = await resDiff.json();
      expect(jsonDiff.error.code).toBe("IMMUTABLE_FIELD");

      // Attempt to upgrade duration from 30 to 120
      const patchDurReq = makeReq(
        `/api/v1/tasks/${task.id}`,
        "PATCH",
        { estimatedMinutes: 120 },
        { "x-user-id": TEST_USER_A }
      );
      const resDur = await patchTaskById(patchDurReq, { params: Promise.resolve({ id: task.id }) });
      expect(resDur.status).toBe(400);
      const jsonDur = await resDur.json();
      expect(jsonDur.error.code).toBe("IMMUTABLE_FIELD");

      // Verify database fields were NOT modified
      const current = await prisma.task.findUnique({ where: { id: task.id } });
      expect(current?.difficulty).toBe("NORMAL");
      expect(current?.estimatedMinutes).toBe(30);
    });
  });

  // ── 15-17. DURATION CONSTRAINTS & GRANDFATHERING ─────────────
  describe("15-17. HARD/EPIC Constraints, Grandfathering, & Sub-60s Zero XP", () => {
    it("15 & 16. new HARD/EPIC below minimum are normalized per policy; pre-existing are grandfathered", async () => {
      // New task created with HARD and 30m -> normalized to NORMAL
      const newTask = await taskRepository.createTask(TEST_USER_A, {
        title: "New Under-duration HARD",
        difficulty: Difficulty.HARD,
        estimatedMinutes: 30,
      });
      expect(newTask.difficulty).toBe("NORMAL");

      // Legacy task created before cutoff is grandfathered to retain HARD calculation
      const legacyCreated = new Date(GRANDFATHER_CUTOFF.getTime() - 24 * 3600_000);
      const legacyTask = await prisma.task.create({
        data: {
          userId: TEST_USER_A,
          title: "Pre-existing Legacy Hard Task",
          difficulty: "HARD",
          estimatedMinutes: 30,
          status: "IN_PROGRESS",
          startedAt: new Date(Date.now() - 30 * 60_000),
          createdAt: legacyCreated,
        },
      });

      // Complete grandfathered task
      const req = makeReq(`/api/v1/tasks/${legacyTask.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A });
      const res = await completeTaskRoute(req, { params: Promise.resolve({ id: legacyTask.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
      expect(json.data.xpAwarded).toBeGreaterThan(0);
    });

    it("17. tasks below 60 seconds estimated duration earn zero XP", async () => {
      const shortTask = await prisma.task.create({
        data: {
          userId: TEST_USER_A,
          title: "Micro Task",
          difficulty: "NORMAL",
          estimatedMinutes: 0, // < 1 min
          status: "IN_PROGRESS",
          startedAt: new Date(Date.now() - 70_000), // > 60s elapsed
        },
      });

      const req = makeReq(`/api/v1/tasks/${shortTask.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A });
      const res = await completeTaskRoute(req, { params: Promise.resolve({ id: shortTask.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
      expect(json.data.xpAwarded).toBe(0);
      expect(json.data.reason).toBe("SUB_60_SECONDS");

      // Verify no positive XP transaction in ledger
      const tx = await prisma.xPTransaction.findFirst({ where: { sourceId: shortTask.id } });
      expect(tx).toBeNull();
    });
  });

  // ── 18-21. DAILY LIMITS & CAPS ───────────────────────────────
  describe("18-21. Daily Activity Limits & Daily XP Cap", () => {
    it("18. daily task creation limit enforces maximum 20 tasks per day", async () => {
      // Seed 20 tasks created today
      const today = new Date();
      for (let i = 0; i < 20; i++) {
        await prisma.task.create({
          data: {
            userId: TEST_USER_A,
            title: `Batch task ${i}`,
            difficulty: "NORMAL",
            createdAt: today,
          },
        });
      }

      // Attempt 21st task creation via API
      const req = makeReq(
        "/api/v1/tasks",
        "POST",
        { title: "21st Task" },
        { "x-user-id": TEST_USER_A }
      );
      const res = await postTask(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Daily task creation limit");
    });

    it("19. daily completion limit (15) caps successful payouts", async () => {
      // Seed 15 completed tasks today
      const today = new Date();
      for (let i = 0; i < 15; i++) {
        await prisma.task.create({
          data: {
            userId: TEST_USER_A,
            title: `Completed task ${i}`,
            status: TaskStatus.COMPLETED,
            completedAt: today,
          },
        });
      }

      // 16th task completion earns 0 XP
      const task16 = await taskRepository.createTask(TEST_USER_A, {
        title: "16th Task",
        estimatedMinutes: 5,
      });
      await prisma.task.update({
        where: { id: task16.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 10 * 60_000) },
      });

      const res = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task16.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task16.id }) }
      );
      const json = await res.json();
      expect(json.data.xpAwarded).toBe(0);
      expect(json.data.reason).toBe("DAILY_COMPLETION_LIMIT");
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
    });

    it("20. daily completion-attempt limit (30) blocks further attempts", async () => {
      // Seed 30 audit log attempts today
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        await prisma.adminAuditLog.create({
          data: {
            adminUserId: TEST_USER_A,
            targetUserId: TEST_USER_A,
            action: "TASK_COMPLETION_REJECTED",
            createdAt: today,
          },
        });
      }

      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Attempt 31 Task",
        estimatedMinutes: 5,
      });

      const res = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("21. daily XP cap (1000) limits total earned XP", async () => {
      // Seed 950 XP already earned today
      await prisma.xPTransaction.create({
        data: {
          userId: TEST_USER_A,
          amount: 950,
          sourceType: "TASK",
          sourceId: "prior-task-id",
          rewardType: "COMPLETION",
          idempotencyKey: "payout:prior:1",
          baseXp: 950,
          difficultyMultiplier: 1.0,
          streakBonus: 0,
        },
      });

      // Complete a 45m task (normally 113 raw XP, ramp-up 56 XP, but only 50 room left in 1000 cap)
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Capped Task",
        estimatedMinutes: 45,
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 45 * 60_000) },
      });

      const res = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      const json = await res.json();
      expect(json.data.xpAwarded).toBe(50); // Clamped to remaining 50 XP
    });
  });

  // ── 22. FIRST-FIVE SELF-CONFIRMED TASK RULE ──────────────────
  describe("22. First-Five Lifetime SELF_CONFIRMED Rule", () => {
    it("pays 50% XP (floor 1) for first 5 self-confirmed completions, full XP for 6th+", () => {
      // 30 min NORMAL self-confirmed = 75 raw XP
      const first = calculateTaskRewardAuthoritative({
        minutes: 30,
        difficulty: "NORMAL",
        verification: "SELF_CONFIRMED",
        lifetimeSelfConfirmedCount: 0, // 1st completion
      });
      expect(first.isReducedNewUser).toBe(true);
      expect(first.finalXp).toBe(37); // 50% of 75

      const fifth = calculateTaskRewardAuthoritative({
        minutes: 30,
        difficulty: "NORMAL",
        verification: "SELF_CONFIRMED",
        lifetimeSelfConfirmedCount: 4, // 5th completion
      });
      expect(fifth.isReducedNewUser).toBe(true);
      expect(fifth.finalXp).toBe(37);

      const sixth = calculateTaskRewardAuthoritative({
        minutes: 30,
        difficulty: "NORMAL",
        verification: "SELF_CONFIRMED",
        lifetimeSelfConfirmedCount: 5, // 6th completion
      });
      expect(sixth.isReducedNewUser).toBe(false);
      expect(sixth.finalXp).toBe(75); // Full 75 XP
    });

    it("FOCUS_VERIFIED completions are exempt from the 50% reduction", () => {
      const verified = calculateTaskRewardAuthoritative({
        minutes: 30,
        difficulty: "NORMAL",
        verification: "FOCUS_VERIFIED",
        lifetimeSelfConfirmedCount: 0, // Brand new user
      });
      expect(verified.isReducedNewUser).toBe(false);
      expect(verified.finalXp).toBe(225); // Full 225 XP for verified
    });
  });

  // ── 23-24. SUSPICIOUS PATTERN DETECTOR ───────────────────────
  describe("23-24. Suspicious Pattern Classifications", () => {
    it("23. suspicious rapid-completion pattern -> SUSPICIOUS: XP paid, flagged audit event created", async () => {
      // Seed 3 completions in past 5 minutes
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
      for (let i = 0; i < 3; i++) {
        await prisma.task.create({
          data: {
            userId: TEST_USER_A,
            title: `Pre-task ${i}`,
            status: TaskStatus.COMPLETED,
            completedAt: fiveMinAgo,
            createdAt: new Date(Date.now() - 30 * 60_000),
          },
        });
      }

      // Complete 4th task
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Speedy Task 4",
        estimatedMinutes: 5,
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 10 * 60_000) },
      });

      const res = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      const json = await res.json();

      expect(json.data.classification).toBe("SUSPICIOUS");
      expect(json.data.xpAwarded).toBeGreaterThan(0); // XP is still paid

      // Audit event created
      const audit = await prisma.adminAuditLog.findFirst({
        where: { targetUserId: TEST_USER_A, action: "TASK_SUSPICIOUS_PATTERN" },
      });
      expect(audit).toBeTruthy();
    });

    it("24. severe pattern (>=5 in 10 min burst) -> BLOCKED_REWARD: XP = 0, audit event created, task completes", async () => {
      // Seed 5 completions in past 5 minutes
      const threeMinAgo = new Date(Date.now() - 3 * 60_000);
      for (let i = 0; i < 5; i++) {
        await prisma.task.create({
          data: {
            userId: TEST_USER_A,
            title: `Burst ${i}`,
            status: TaskStatus.COMPLETED,
            completedAt: threeMinAgo,
          },
        });
      }

      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "6th Burst Task",
        estimatedMinutes: 5,
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS, startedAt: new Date(Date.now() - 10 * 60_000) },
      });

      const res = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A }),
        { params: Promise.resolve({ id: task.id }) }
      );
      const json = await res.json();

      expect(json.data.classification).toBe("BLOCKED_REWARD");
      expect(json.data.xpAwarded).toBe(0); // Reward blocked
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED); // Task still completes

      const audit = await prisma.adminAuditLog.findFirst({
        where: { targetUserId: TEST_USER_A, action: "TASK_BLOCKED_REWARD" },
      });
      expect(audit).toBeTruthy();
    });
  });

  // ── 32. CONDITION 2: PATCH STATUS BYPASS TEST ────────────────
  describe("32. Condition 2: Generic PATCH /api/v1/tasks/[id] Bypass Prevention", () => {
    it("setting status to COMPLETED via generic PATCH on PENDING task awards 0 XP and creates no XPTransaction", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Bypass Attempt Task",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });

      // Attempt to bypass /complete by calling generic PATCH with status: "COMPLETED"
      const patchReq = makeReq(
        `/api/v1/tasks/${task.id}`,
        "PATCH",
        { status: "COMPLETED" },
        { "x-user-id": TEST_USER_A }
      );
      const res = await patchTaskById(patchReq, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.status).toBe(TaskStatus.COMPLETED);

      // Verify ZERO XP transactions exist in the PostgreSQL ledger
      const txCount = await prisma.xPTransaction.count({
        where: { userId: TEST_USER_A, sourceId: task.id },
      });
      expect(txCount).toBe(0);

      // Subsequent call to /complete sees it already completed and pays 0 XP
      const retryReq = makeReq(`/api/v1/tasks/${task.id}/complete`, "POST", {}, { "x-user-id": TEST_USER_A });
      const retryRes = await completeTaskRoute(retryReq, { params: Promise.resolve({ id: task.id }) });
      const retryJson = await retryRes.json();

      expect(retryJson.data.isDuplicate).toBe(true);
      expect(retryJson.data.xpAwarded).toBe(0);
    });
  });

  // ── 33. MARK DONE WITHOUT REWARD ACCOUNTING ─────────────────
  describe("33. markDoneWithoutReward Accounting", () => {
    it("markDoneWithoutReward: true increments attempts, writes NEVER_STARTED audit event, and skips XP reward", async () => {
      const task = await taskRepository.createTask(TEST_USER_A, {
        title: "Checklist Item",
        difficulty: Difficulty.NORMAL,
        estimatedMinutes: 30,
      });

      const req = makeReq(
        `/api/v1/tasks/${task.id}/complete`,
        "POST",
        { markDoneWithoutReward: true },
        { "x-user-id": TEST_USER_A }
      );
      const res = await completeTaskRoute(req, { params: Promise.resolve({ id: task.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.xpAwarded).toBe(0);
      expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
      expect(json.data.task.completionAttempts).toBe(1);

      // Verify DB state
      const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(dbTask?.status).toBe(TaskStatus.COMPLETED);
      expect(dbTask?.completionAttempts).toBe(1);

      // Verify no XP written
      const txCount = await prisma.xPTransaction.count({ where: { userId: TEST_USER_A } });
      expect(txCount).toBe(0);

      // Verify NEVER_STARTED audit event logged
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          targetUserId: TEST_USER_A,
          action: "TASK_COMPLETED_ZERO_XP",
        },
      });
      expect(auditLog).toBeTruthy();
      const metadata = JSON.parse(auditLog!.metadata);
      expect(metadata.reason).toBe("NEVER_STARTED");
    });
  });
});
