// ============================================================
// Task Aura — Focus-Verified Task Completion Tests
// Covers the FOCUS_VERIFIED vs SELF_CONFIRMED derivation path.
//
// Global rules:
//   - focusVerified is NEVER read from the request body.
//   - It is derived server-side only from a qualifying FocusSession.
// ============================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { taskRepository } from "../lib/repositories/task-repository";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { POST as startFocusRoute } from "../app/api/v1/focus/start/route";
import { TaskStatus, Difficulty, FocusSessionStatus } from "../lib/logic/types";

// ── Stable test-user UUIDs ────────────────────────────────────
const USER_A = "00000000-0000-0000-0000-000000000091";
const USER_B = "00000000-0000-0000-0000-000000000092";

function makeReq(
  url: string,
  method: string = "POST",
  body?: unknown,
  headers?: Record<string, string>
): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Seeds a FocusSession directly so tests control every field precisely. */
async function seedFocusSession(overrides: {
  userId: string;
  taskId?: string | null;
  status?: string;
  completedAt?: Date | null;
  consumedAt?: Date | null;
  heartbeatCount?: number;
  expectedHeartbeats?: number;
}) {
  return prisma.focusSession.create({
    data: {
      clientEventId: crypto.randomUUID(),
      userId: overrides.userId,
      taskId: overrides.taskId ?? null,
      status: overrides.status ?? FocusSessionStatus.COMPLETED,
      requiredMinutes: 25,
      actualMinutes: 25,
      startedAt: new Date(Date.now() - 30 * 60_000),
      completedAt: overrides.completedAt ?? new Date(),
      consumedAt: overrides.consumedAt ?? null,
      heartbeatCount: overrides.heartbeatCount ?? 50,
      expectedHeartbeats: overrides.expectedHeartbeats ?? 50,
      lastHeartbeatAt: new Date(),
    },
  });
}

/** Creates and starts a task (sets status IN_PROGRESS with startedAt far enough in the past). */
async function seedReadyTask(userId: string, startedMsAgo = 30 * 60_000) {
  const task = await taskRepository.createTask(userId, {
    title: "Focus-verified test task",
    difficulty: Difficulty.NORMAL,
    estimatedMinutes: 10,
  });
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date(Date.now() - startedMsAgo),
    },
  });
  return task;
}

// ── Test setup ────────────────────────────────────────────────
beforeEach(async () => {
  for (const userId of [USER_A, USER_B]) {
    await prisma.xPTransaction.deleteMany({ where: { userId } });
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [{ adminUserId: userId }, { targetUserId: userId }],
      },
    });
    await prisma.focusSession.deleteMany({ where: { userId } });
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, displayName: `FocusTest User ${userId.slice(-2)}` },
    });
  }
});

afterAll(async () => {
  for (const userId of [USER_A, USER_B]) {
    await prisma.xPTransaction.deleteMany({ where: { userId } });
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [{ adminUserId: userId }, { targetUserId: userId }],
      },
    });
    await prisma.focusSession.deleteMany({ where: { userId } });
    await prisma.task.deleteMany({ where: { userId } });
  }
  // Delete ONLY user 00000000-0000-0000-0000-000000000092 (USER_B), created specifically for this test.
  // Do NOT delete USER_A (...091) or any other user.
  await prisma.user.deleteMany({ where: { id: USER_B } });
});

// ── Tests ─────────────────────────────────────────────────────
describe("Focus-Verified Task Completion", () => {
  // ── 1. Linked valid session → FOCUS_VERIFIED ─────────────
  it("1. linked valid session within 30 min gives FOCUS_VERIFIED XP", async () => {
    const task = await seedReadyTask(USER_A);

    // Seed a valid completed focus session linked to this task, completed 5 min ago
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: null,
    });

    const req = makeReq(
      `/api/v1/tasks/${task.id}/complete`,
      "POST",
      {},
      { "x-user-id": USER_A }
    );
    const res = await completeTaskRoute(req, {
      params: Promise.resolve({ id: task.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.rejected).toBe(false);
    expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
    // Exact expected XP computed from economy.ts:
    // base (150) * effort (10m/30m = 0.33 clamped to effortMin 0.4) * difficulty (1.0 NORMAL) * verification (1.0 FOCUS_VERIFIED) = 60 XP.
    // Under SELF_CONFIRMED (0.8 multiplier), identical task earns 150 * 0.4 * 1.0 * 0.8 = 48 XP.
    // Focus-verified (60 XP) is strictly greater than self-confirmed (48 XP).
    expect(json.data.xpAwarded).toBe(60);
    expect(json.data.xpAwarded).toBeGreaterThan(48);

    // Verify the session was consumed (consumedAt set)
    const session = await prisma.focusSession.findFirst({
      where: { userId: USER_A, taskId: task.id },
    });
    expect(session?.consumedAt).not.toBeNull();

    // Verify audit log records FOCUS_VERIFIED
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("FOCUS_VERIFIED");
  });

  // ── 2. No linked session → SELF_CONFIRMED ────────────────
  it("2. no linked focus session gives SELF_CONFIRMED (unchanged behaviour)", async () => {
    const task = await seedReadyTask(USER_A);
    // No focus session seeded at all

    const req = makeReq(
      `/api/v1/tasks/${task.id}/complete`,
      "POST",
      // Attempting to pass focusVerified=true in body must be ignored
      { focusVerified: true },
      { "x-user-id": USER_A }
    );
    const res = await completeTaskRoute(req, {
      params: Promise.resolve({ id: task.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.task.status).toBe(TaskStatus.COMPLETED);
    expect(json.data.xpAwarded).toBeGreaterThan(0); // normal XP

    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("SELF_CONFIRMED");
  });

  // ── 3. Another user's session doesn't count ───────────────
  it("3. a session belonging to another user does not grant FOCUS_VERIFIED", async () => {
    const task = await seedReadyTask(USER_A);

    // User B has a valid session linked to USER_A's task — cross-user isolation check
    await seedFocusSession({
      userId: USER_B,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: null,
    });

    const req = makeReq(
      `/api/v1/tasks/${task.id}/complete`,
      "POST",
      {},
      { "x-user-id": USER_A }
    );
    const res = await completeTaskRoute(req, {
      params: Promise.resolve({ id: task.id }),
    });

    expect(res.status).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("SELF_CONFIRMED");
  });

  // ── 4. Session older than 30 min doesn't count ────────────
  it("4. a focus session completed more than 30 minutes ago does not grant FOCUS_VERIFIED", async () => {
    const task = await seedReadyTask(USER_A);

    // Session completed 35 minutes ago (outside the 30-min window)
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 35 * 60_000),
      consumedAt: null,
    });

    const req = makeReq(
      `/api/v1/tasks/${task.id}/complete`,
      "POST",
      {},
      { "x-user-id": USER_A }
    );
    const res = await completeTaskRoute(req, {
      params: Promise.resolve({ id: task.id }),
    });

    expect(res.status).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("SELF_CONFIRMED");
  });

  // ── 5. Reused (consumedAt set) session doesn't count ─────
  it("5. a session already consumed (consumedAt != null) does not grant FOCUS_VERIFIED", async () => {
    const task = await seedReadyTask(USER_A);

    // Session already consumed
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: new Date(Date.now() - 1 * 60_000), // already consumed
    });

    const req = makeReq(
      `/api/v1/tasks/${task.id}/complete`,
      "POST",
      {},
      { "x-user-id": USER_A }
    );
    const res = await completeTaskRoute(req, {
      params: Promise.resolve({ id: task.id }),
    });

    expect(res.status).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("SELF_CONFIRMED");
  });

  // ── 6. taskId validation in focus/start ──────────────────
  it("6a. focus/start with a valid incomplete taskId succeeds", async () => {
    const task = await taskRepository.createTask(USER_A, {
      title: "Task to link",
      estimatedMinutes: 25,
    });

    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 25, clientEventId: crypto.randomUUID(), taskId: task.id },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.taskId).toBe(task.id);
  });

  it("6b. focus/start with another user's taskId is rejected", async () => {
    // Task belongs to USER_B
    const task = await taskRepository.createTask(USER_B, {
      title: "User B task",
      estimatedMinutes: 25,
    });

    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 25, clientEventId: crypto.randomUUID(), taskId: task.id },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });

  it("6c. focus/start with a completed task's id is rejected", async () => {
    const task = await seedReadyTask(USER_A);
    // Mark the task completed
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
    });

    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 25, clientEventId: crypto.randomUUID(), taskId: task.id },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });
});
