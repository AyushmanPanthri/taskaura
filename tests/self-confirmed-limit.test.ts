// ============================================================
// Task Aura — SELF_CONFIRMED_LIMIT: 5 paid tasks per day cap
// Phase 1 hermetic test suite.
// Creates its own users; deletes them in afterAll.
// ============================================================

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { taskRepository } from "../lib/repositories/task-repository";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { TaskStatus } from "../lib/logic/types";

// Fixed UUIDs that will not collide with any other test file
const SC_USER = "00000000-0000-0000-0001-000000000001";
const SC_USER2 = "00000000-0000-0000-0001-000000000002";

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, init);
}

/** Helper: create a task that is already IN_PROGRESS and old enough to complete. */
async function createReadyTask(userId: string, estimatedMinutes = 10) {
  const task = await taskRepository.createTask(userId, {
    title: `SC-limit task ${Math.random().toString(36).slice(2)}`,
    estimatedMinutes,
  });
  // Simulate started 15 min ago — well past the 8-min minimum for a 10-min task
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date(Date.now() - 15 * 60_000),
    },
  });
  return task;
}

/** Helper: complete a task via the real route handler */
async function completeTask(userId: string, taskId: string) {
  const req = makeReq(
    `/api/v1/tasks/${taskId}/complete`,
    "POST",
    {},
    { "x-user-id": userId }
  );
  const res = await completeTaskRoute(req, {
    params: Promise.resolve({ id: taskId }),
  });
  return res.json();
}

beforeEach(async () => {
  // Ensure test users exist and clean state
  for (const uid of [SC_USER, SC_USER2]) {
    await prisma.user.upsert({
      where: { id: uid },
      update: {},
      create: {
        id: uid,
        displayName: `SCLimit-${uid.slice(-4)}`,
        email: `sc-limit-${uid.slice(-4)}@taskaura.test`,
      },
    });
  }
  await prisma.xPTransaction.deleteMany({
    where: { userId: { in: [SC_USER, SC_USER2] } },
  });
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: [SC_USER, SC_USER2] } },
        { targetUserId: { in: [SC_USER, SC_USER2] } },
      ],
    },
  });
  await prisma.task.deleteMany({
    where: { userId: { in: [SC_USER, SC_USER2] } },
  });
});

afterAll(async () => {
  await prisma.xPTransaction.deleteMany({
    where: { userId: { in: [SC_USER, SC_USER2] } },
  });
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: [SC_USER, SC_USER2] } },
        { targetUserId: { in: [SC_USER, SC_USER2] } },
      ],
    },
  });
  await prisma.task.deleteMany({
    where: { userId: { in: [SC_USER, SC_USER2] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [SC_USER, SC_USER2] } },
  });
});

describe("SELF_CONFIRMED_LIMIT — 5 paid tasks per calendar day", () => {
  it("tasks 1-5 all earn xpAwarded > 0 and are not rejected", async () => {
    for (let i = 0; i < 5; i++) {
      const task = await createReadyTask(SC_USER);
      const json = await completeTask(SC_USER, task.id);
      expect(json.data.rejected ?? false, `task ${i + 1} rejected`).toBe(
        false
      );
      expect(json.data.xpAwarded, `task ${i + 1} xpAwarded`).toBeGreaterThan(
        0
      );
    }
  });

  it("6th self-confirmed completion returns xpAwarded === 0 and reason SELF_CONFIRMED_LIMIT", async () => {
    // Complete 5 tasks that earn XP
    for (let i = 0; i < 5; i++) {
      const task = await createReadyTask(SC_USER);
      const json = await completeTask(SC_USER, task.id);
      expect(
        json.data.xpAwarded,
        `pre-condition: task ${i + 1} must earn XP`
      ).toBeGreaterThan(0);
    }

    // 6th task — must get capped
    const task6 = await createReadyTask(SC_USER);
    const json6 = await completeTask(SC_USER, task6.id);

    expect(json6.data.xpAwarded, "6th task xpAwarded").toBe(0);
    expect(json6.data.reason, "6th task reason").toBe(
      "SELF_CONFIRMED_LIMIT"
    );

    // Task should still be COMPLETED (not rejected/in-progress)
    const dbTask = await prisma.task.findUnique({ where: { id: task6.id } });
    expect(dbTask?.status, "6th task DB status").toBe(TaskStatus.COMPLETED);

    // Exactly 5 XP transactions should exist (6th paid 0)
    const xpCount = await prisma.xPTransaction.count({
      where: { userId: SC_USER, sourceType: "TASK", rewardType: "COMPLETION" },
    });
    expect(xpCount, "XP transaction count").toBe(5);
  });

  it("limit is per-user: second user is not affected by first user's cap", async () => {
    // SC_USER hits the cap
    for (let i = 0; i < 5; i++) {
      const task = await createReadyTask(SC_USER);
      await completeTask(SC_USER, task.id);
    }

    // SC_USER2 should still earn XP on their 1st task
    const task2 = await createReadyTask(SC_USER2);
    const json2 = await completeTask(SC_USER2, task2.id);
    expect(json2.data.xpAwarded, "user2 task xpAwarded").toBeGreaterThan(0);
    expect(json2.data.reason).not.toBe("SELF_CONFIRMED_LIMIT");
  });

  it("concurrency: 8 simultaneous completions with 5 already paid must not exceed limit", async () => {
    // Complete 5 tasks sequentially first
    for (let i = 0; i < 5; i++) {
      const task = await createReadyTask(SC_USER);
      const json = await completeTask(SC_USER, task.id);
      expect(json.data.xpAwarded).toBeGreaterThan(0);
    }

    // Fire 8 more simultaneously
    const batch = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const task = await createReadyTask(SC_USER);
        return completeTask(SC_USER, task.id);
      })
    );

    // None of the concurrent batch may award XP
    const concurrentXp = batch.filter((j) => j.data.xpAwarded > 0).length;
    expect(concurrentXp, "concurrent XP-earning completions after cap").toBe(0);

    // All should have reason SELF_CONFIRMED_LIMIT
    for (const j of batch) {
      expect(j.data.reason).toBe("SELF_CONFIRMED_LIMIT");
    }

    // Total XP transaction count must still be exactly 5
    const xpCount = await prisma.xPTransaction.count({
      where: { userId: SC_USER, sourceType: "TASK", rewardType: "COMPLETION" },
    });
    expect(xpCount, "final XP tx count must not exceed 5").toBe(5);
  });
});
