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
  actualMinutes?: number;
  requiredMinutes?: number;
}) {
  const requiredMinutes = overrides.requiredMinutes ?? 25;
  const actualMinutes = overrides.actualMinutes ?? 25;
  return prisma.focusSession.create({
    data: {
      clientEventId: crypto.randomUUID(),
      userId: overrides.userId,
      taskId: overrides.taskId ?? null,
      status: overrides.status ?? FocusSessionStatus.COMPLETED,
      requiredMinutes,
      actualMinutes,
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
    // base (150) * effort (10m/30m = 0.33 clamped to effortMin 0.4) * difficulty (1.0 NORMAL) * verification (1.5 FOCUS_VERIFIED) = 90 XP.
    // Under SELF_CONFIRMED (0.5 multiplier), identical task earns raw 150 * 0.4 * 1.0 * 0.5 = 30 XP (and with first-5 reduction: 15 XP).
    // Focus-verified (90 XP) is strictly greater than self-confirmed (15 XP).
    expect(json.data.xpAwarded).toBe(90);
    expect(json.data.xpAwarded).toBeGreaterThan(15);

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

  // ── Phase F: bypass-prevention tests ─────────────────────

  // F-a: session with actualMinutes 0 does NOT grant FOCUS_VERIFIED
  it("F-a. session with actualMinutes 0 gives SELF_CONFIRMED", async () => {
    const task = await seedReadyTask(USER_A);
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: null,
      actualMinutes: 0,
      requiredMinutes: 25,
      heartbeatCount: 0,
      expectedHeartbeats: 50,
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

  // F-b: session where focusCreditedMinutes(actual, planned) === 0 does NOT grant FOCUS_VERIFIED
  // actualMinutes 5, requiredMinutes 25: threshold = max(10, 0.8*25=20) → 5 < 20 → credited = 0
  // Heartbeats are 10/10 (ratio 1.0, not capped) so that only creditedMinutes guards it.
  it("F-b. session where credited minutes is 0 gives SELF_CONFIRMED", async () => {
    const task = await seedReadyTask(USER_A);
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: null,
      actualMinutes: 5,
      requiredMinutes: 25,
      heartbeatCount: 10,
      expectedHeartbeats: 10,
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

  // F-c: session that shouldCapXp() would cap does NOT grant FOCUS_VERIFIED
  // actualMinutes 25, heartbeatCount 5, expectedHeartbeats 50: ratio = 5/50 = 0.1 < 0.6 → capped
  it("F-c. heartbeat-capped session gives SELF_CONFIRMED", async () => {
    const task = await seedReadyTask(USER_A);
    await seedFocusSession({
      userId: USER_A,
      taskId: task.id,
      status: FocusSessionStatus.COMPLETED,
      completedAt: new Date(Date.now() - 5 * 60_000),
      consumedAt: null,
      actualMinutes: 25,
      requiredMinutes: 25,
      heartbeatCount: 5,
      expectedHeartbeats: 50,
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

  // F-d: focus/start requiredMinutes range enforcement
  it("F-d. focus/start rejects requiredMinutes below focusPlannedMinMinutes (5)", async () => {
    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 4, clientEventId: crypto.randomUUID() },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });

  it("F-d. focus/start rejects requiredMinutes above focusPlannedMaxMinutes (180)", async () => {
    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 181, clientEventId: crypto.randomUUID() },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });

  it("F-d. focus/start rejects non-integer requiredMinutes", async () => {
    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: 25.5, clientEventId: crypto.randomUUID() },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });

  it("F-d. focus/start rejects NaN requiredMinutes", async () => {
    const req = makeReq(
      "/api/v1/focus/start",
      "POST",
      { requiredMinutes: NaN, clientEventId: crypto.randomUUID() },
      { "x-user-id": USER_A }
    );
    const res = await startFocusRoute(req);
    expect(res.status).toBe(400);
  });

  // ── Bug reproduction & Regression tests ──────────────────
  it("session->task completes with no other status change -> XP is FOCUS_VERIFIED rate, not 0", async () => {
    // 1. Create task in PENDING status (default 30 min, NORMAL difficulty)
    const task = await taskRepository.createTask(USER_A, {
      title: "Linked Session Bug Reproduction Task",
      difficulty: Difficulty.NORMAL,
      estimatedMinutes: 30,
    });
    expect(task.status).toBe(TaskStatus.PENDING);
    expect(task.startedAt).toBeNull();

    // 2. Start a focus session linked to this task
    const startRes = await startFocusRoute(
      makeReq(
        "/api/v1/focus/start",
        "POST",
        { requiredMinutes: 30, clientEventId: crypto.randomUUID(), taskId: task.id },
        { "x-user-id": USER_A }
      )
    );
    expect(startRes.status).toBe(201);
    const startJson = await startRes.json();
    const sessionId = startJson.data.id;

    // Verify task transitioned to IN_PROGRESS and has startedAt
    const inProgressTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(inProgressTask?.status).toBe(TaskStatus.IN_PROGRESS);
    expect(inProgressTask?.startedAt).not.toBeNull();

    // Fast-forward startedAt to 30 minutes ago so minimum duration check passes (30m * 0.8 = 24m)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
    await prisma.task.update({
      where: { id: task.id },
      data: { startedAt: thirtyMinAgo },
    });

    // Complete the focus session (qualifying session: 30 actual minutes, 60 heartbeats)
    await prisma.focusSession.update({
      where: { id: sessionId },
      data: {
        status: FocusSessionStatus.COMPLETED,
        startedAt: thirtyMinAgo,
        completedAt: new Date(Date.now() - 2 * 60_000), // completed 2 min ago
        actualMinutes: 30,
        heartbeatCount: 60,
        expectedHeartbeats: 60,
      },
    });

    // 3. Complete the task directly with no manual status change in between
    const completeRes = await completeTaskRoute(
      makeReq(
        `/api/v1/tasks/${task.id}/complete`,
        "POST",
        {},
        { "x-user-id": USER_A }
      ),
      { params: Promise.resolve({ id: task.id }) }
    );
    expect(completeRes.status).toBe(200);
    const completeJson = await completeRes.json();

    expect(completeJson.data.rejected).toBe(false);
    expect(completeJson.data.task.status).toBe(TaskStatus.COMPLETED);
    // Base 150 * effort 1.0 (30m/30m) * difficulty 1.0 (NORMAL) * verification 1.5 (FOCUS_VERIFIED) = 225 XP
    expect(completeJson.data.xpAwarded).toBe(225);
    expect(completeJson.data.reason).toBeUndefined();

    // Audit log should confirm FOCUS_VERIFIED
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED" },
    });
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit!.metadata);
    expect(meta.verificationType).toBe("FOCUS_VERIFIED");
  });

  it("task with no linked session, PENDING->COMPLETED directly, still pays 0, reason NEVER_STARTED", async () => {
    // Create task in PENDING status
    const task = await taskRepository.createTask(USER_A, {
      title: "Direct Unstarted Task",
      difficulty: Difficulty.NORMAL,
      estimatedMinutes: 30,
    });
    expect(task.status).toBe(TaskStatus.PENDING);
    expect(task.startedAt).toBeNull();

    // Directly attempt completion
    const completeRes = await completeTaskRoute(
      makeReq(
        `/api/v1/tasks/${task.id}/complete`,
        "POST",
        {},
        { "x-user-id": USER_A }
      ),
      { params: Promise.resolve({ id: task.id }) }
    );
    expect(completeRes.status).toBe(200);
    const completeJson = await completeRes.json();

    expect(completeJson.data.task.status).toBe(TaskStatus.COMPLETED);
    expect(completeJson.data.xpAwarded).toBe(0);
    expect(completeJson.data.reason).toBe("NEVER_STARTED");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetUserId: USER_A, action: "TASK_COMPLETED_ZERO_XP" },
    });
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit!.metadata);
    expect(meta.reason).toBe("NEVER_STARTED");
  });

  it("linking a session to an already IN_PROGRESS task does not overwrite existing startedAt", async () => {
    const existingStartedAt = new Date(Date.now() - 45 * 60_000);
    const task = await taskRepository.createTask(USER_A, {
      title: "Already Started Task",
      difficulty: Difficulty.NORMAL,
      estimatedMinutes: 30,
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: existingStartedAt,
      },
    });

    const startRes = await startFocusRoute(
      makeReq(
        "/api/v1/focus/start",
        "POST",
        { requiredMinutes: 25, clientEventId: crypto.randomUUID(), taskId: task.id },
        { "x-user-id": USER_A }
      )
    );
    expect(startRes.status).toBe(201);

    const checkTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(checkTask?.status).toBe(TaskStatus.IN_PROGRESS);
    expect(checkTask?.startedAt?.getTime()).toBe(existingStartedAt.getTime());
  });
});

