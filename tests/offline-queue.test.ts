// ============================================================
// Task Aura — Phase D: Offline Mutation Queue Tests (§12)
// Tests:
//   - Idempotent clientEventId generation
//   - Queue persistence & retrieval
//   - Reconnect replay with server acknowledgement
//   - Deduplication handling (zero duplicate XP on replay)
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { OfflineMutationQueue } from "../lib/logic/offline-queue";

describe("Phase D — Offline Mutation Queue", () => {
  let queue: OfflineMutationQueue;

  beforeEach(() => {
    queue = new OfflineMutationQueue("test_offline_queue");
    queue.clear();
  });

  it("enqueues mutation with clientEventId and pending status", () => {
    const mut = queue.enqueue("TASK_COMPLETE", "/api/v1/tasks/task_1/complete", {
      taskId: "task_1",
    });

    expect(mut.clientEventId).toBeDefined();
    expect(mut.clientEventId).toMatch(/^evt_/);
    expect(mut.status).toBe("PENDING");
    expect(queue.getPending().length).toBe(1);
  });

  it("replays queue and removes acknowledged items upon successful server sync", async () => {
    queue.enqueue("TASK_COMPLETE", "/api/v1/tasks/task_1/complete", {
      taskId: "task_1",
    });
    queue.enqueue("HABIT_LOG", "/api/v1/habits/habit_1/log", {
      habitId: "habit_1",
      date: "2026-09-22",
    });

    expect(queue.getPending().length).toBe(2);

    // Mock successful dispatcher
    const dispatcher = async () => {
      return { success: true, isDuplicate: false, data: { status: "COMPLETED" } };
    };

    const result = await queue.processQueue(dispatcher);
    expect(result.processed).toBe(2);
    expect(result.acknowledged).toBe(2);
    expect(result.failed).toBe(0);

    // All acknowledged items removed from queue
    expect(queue.getPending().length).toBe(0);
  });

  it("safely handles duplicate acknowledgement on server deduplication without double counting", async () => {
    queue.enqueue("HABIT_LOG", "/api/v1/habits/habit_dup/log", {
      habitId: "habit_dup",
      clientEventId: "evt_fixed_duplicate_1",
    });

    // Mock server returning isDuplicate: true (server already processed this event)
    const dispatcher = async () => {
      return { success: true, isDuplicate: true, data: { xpAwarded: 0 } };
    };

    const result = await queue.processQueue(dispatcher);
    expect(result.acknowledged).toBe(1);
    expect(queue.getPending().length).toBe(0);
  });

  it("preserves failed mutations in queue with incremented retry count on network failure", async () => {
    queue.enqueue("FOCUS_COMPLETE", "/api/v1/focus/session_fail/complete", {
      sessionId: "session_fail",
    });

    // Mock network failure
    const failingDispatcher = async () => {
      throw new Error("Network offline: ECONNREFUSED");
    };

    const result = await queue.processQueue(failingDispatcher);
    expect(result.failed).toBe(1);
    expect(result.acknowledged).toBe(0);

    const pending = queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe("FAILED");
    expect(pending[0].retries).toBe(1);
    expect(pending[0].lastError).toContain("ECONNREFUSED");
  });
});
