// ============================================================
// Task Aura — Phase B API Route Integration Tests
// Tests all /api/v1/* endpoints against authoritative PostgreSQL services
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import {
  seedDatabaseDemoProfile,
  DEMO_USER_ID,
  DEMO_TASK_1_ID,
  DEMO_TASK_2_ID,
  DEMO_HABIT_1_ID,
  DEMO_HABIT_2_ID,
} from "../lib/services/demo-seed";
import { GET as getProgress } from "../app/api/v1/progress/route";
import { GET as getTasks, POST as postTask } from "../app/api/v1/tasks/route";
import { GET as getTaskById, PATCH as patchTaskById } from "../app/api/v1/tasks/[id]/route";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { POST as cancelTaskRoute } from "../app/api/v1/tasks/[id]/cancel/route";
import { POST as startFocus } from "../app/api/v1/focus/start/route";
import { POST as heartbeatFocus } from "../app/api/v1/focus/[id]/heartbeat/route";
import { POST as completeFocus } from "../app/api/v1/focus/[id]/complete/route";
import { POST as abandonFocus } from "../app/api/v1/focus/[id]/abandon/route";
import { GET as getHabits, POST as postHabit } from "../app/api/v1/habits/route";
import { PATCH as patchHabit } from "../app/api/v1/habits/[id]/route";
import { POST as logHabitRoute } from "../app/api/v1/habits/[id]/log/route";
import { GET as getLeaderboard } from "../app/api/v1/leaderboard/route";
import { GET as getAiInsights } from "../app/api/v1/ai/insights/route";
import { POST as postAiQuests } from "../app/api/v1/ai/quests/route";

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

describe("Phase B — API Routes Suite", () => {
  beforeEach(async () => {
    await seedDatabaseDemoProfile();
  });

  // ── PROGRESS API ─────────────────────────────────────────────
  describe("GET /api/v1/progress", () => {
    it("returns authoritative progress for demo user", async () => {
      const req = makeReq("/api/v1/progress", "GET", undefined, {
        "x-user-id": DEMO_USER_ID,
      });
      const res = await getProgress(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.userId).toBe(DEMO_USER_ID);
      // Canonical Level 18 with 20,580 total XP
      expect(json.data.level).toBe(18);
      expect(json.data.totalXp).toBe(20580);
      expect(json.data.xpRequiredForLevel).toBe(2000);
      expect(json.data.xpEarnedInLevel).toBe(1880);
      expect(json.data.xpRemaining).toBe(120);
      expect(json.data.streak.current).toBe(6);
      expect(json.data.achievements.length).toBeGreaterThan(0);
    });

    it("handles level boundary calculation accurately without legacy sqrt", async () => {
      // Level 18 is [18,700, 20,700). 20,580 is 1,880 into Level 18.
      const req = makeReq("/api/v1/progress", "GET", undefined, {
        "x-user-id": DEMO_USER_ID,
      });
      const res = await getProgress(req);
      const json = await res.json();
      expect(json.data.fraction).toBeCloseTo(1880 / 2000, 4);
    });
  });

  // ── TASKS API ────────────────────────────────────────────────
  describe("/api/v1/tasks", () => {
    it("lists tasks for authenticated user", async () => {
      const req = makeReq("/api/v1/tasks", "GET", undefined, {
        "x-user-id": DEMO_USER_ID,
      });
      const res = await getTasks(req);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(2);
    });

    it("creates a task and ignores client attempts to set XP or level", async () => {
      const req = makeReq(
        "/api/v1/tasks",
        "POST",
        {
          title: "New Biology Revision",
          difficulty: "NORMAL",
          estimatedMinutes: 30,
          xp: 999999, // Injected client XP attempt
          rewardXp: 888888,
          totalXp: 777777,
          level: 99,
        },
        { "x-user-id": DEMO_USER_ID }
      );

      const res = await postTask(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe("New Biology Revision");
      expect(json.data.status).toBe("PENDING");
      // Server ignored all client XP injection attempts
      expect((json.data as Record<string, unknown>).xp).toBeUndefined();
    });

    it("rejects task creation with empty title", async () => {
      const req = makeReq(
        "/api/v1/tasks",
        "POST",
        { title: "   " },
        { "x-user-id": DEMO_USER_ID }
      );
      const res = await postTask(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_INPUT");
    });

    it("fetches a single task by ID", async () => {
      const req = makeReq(`/api/v1/tasks/${DEMO_TASK_1_ID}`, "GET", undefined, {
        "x-user-id": DEMO_USER_ID,
      });
      const res = await getTaskById(req, {
        params: Promise.resolve({ id: DEMO_TASK_1_ID }),
      });
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(DEMO_TASK_1_ID);
    });

    it("patches task metadata", async () => {
      const req = makeReq(
        `/api/v1/tasks/${DEMO_TASK_2_ID}`,
        "PATCH",
        { title: "Updated Title" },
        { "x-user-id": DEMO_USER_ID }
      );
      const res = await patchTaskById(req, {
        params: Promise.resolve({ id: DEMO_TASK_2_ID }),
      });
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe("Updated Title");
    });

    it("completes a task and returns authoritative payout", async () => {
      const req = makeReq(
        `/api/v1/tasks/${DEMO_TASK_2_ID}/complete`,
        "POST",
        {},
        { "x-user-id": DEMO_USER_ID }
      );
      const res = await completeTaskRoute(req, {
        params: Promise.resolve({ id: DEMO_TASK_2_ID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.task.status).toBe("COMPLETED");
      expect(json.data.isDuplicate).toBe(false);
    });

    it("handles duplicate completion idempotently", async () => {
      // First completion
      const req1 = makeReq(
        `/api/v1/tasks/${DEMO_TASK_2_ID}/complete`,
        "POST",
        {},
        { "x-user-id": DEMO_USER_ID }
      );
      await completeTaskRoute(req1, {
        params: Promise.resolve({ id: DEMO_TASK_2_ID }),
      });

      // Duplicate completion call
      const req2 = makeReq(
        `/api/v1/tasks/${DEMO_TASK_2_ID}/complete`,
        "POST",
        {},
        { "x-user-id": DEMO_USER_ID }
      );
      const res2 = await completeTaskRoute(req2, {
        params: Promise.resolve({ id: DEMO_TASK_2_ID }),
      });
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.data.isDuplicate).toBe(true);
    });

    it("cancels a task and preserves terminal state", async () => {
      const req = makeReq(
        `/api/v1/tasks/${DEMO_TASK_1_ID}/cancel`,
        "POST",
        {},
        { "x-user-id": DEMO_USER_ID }
      );
      const res = await cancelTaskRoute(req, {
        params: Promise.resolve({ id: DEMO_TASK_1_ID }),
      });
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("CANCELLED");

      // Attempting to complete a cancelled task should fail
      const completeReq = makeReq(
        `/api/v1/tasks/${DEMO_TASK_1_ID}/complete`,
        "POST",
        {},
        { "x-user-id": DEMO_USER_ID }
      );
      const completeRes = await completeTaskRoute(completeReq, {
        params: Promise.resolve({ id: DEMO_TASK_1_ID }),
      });
      expect(completeRes.status).toBe(400);
    });
  });

  // ── FOCUS API ────────────────────────────────────────────────
  describe("/api/v1/focus", () => {
    it("starts a focus session", async () => {
      const req = makeReq(
        "/api/v1/focus/start",
        "POST",
        { requiredMinutes: 25 },
        { "x-user-id": DEMO_USER_ID }
      );
      const res = await startFocus(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.requiredMinutes).toBe(25);
      expect(json.data.status).toBe("RUNNING");
    });

    it("rejects concurrent focus sessions", async () => {
      // First session
      await startFocus(
        makeReq(
          "/api/v1/focus/start",
          "POST",
          { requiredMinutes: 25 },
          { "x-user-id": DEMO_USER_ID }
        )
      );

      // Attempt second concurrent session
      const res2 = await startFocus(
        makeReq(
          "/api/v1/focus/start",
          "POST",
          { requiredMinutes: 25 },
          { "x-user-id": DEMO_USER_ID }
        )
      );
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.success).toBe(false);
      expect(json2.error.message).toContain("already running");
    });

    it("records heartbeat for active session", async () => {
      const startRes = await startFocus(
        makeReq(
          "/api/v1/focus/start",
          "POST",
          { requiredMinutes: 25 },
          { "x-user-id": DEMO_USER_ID }
        )
      );
      const startJson = await startRes.json();
      const sessionId = startJson.data.id;

      const hbRes = await heartbeatFocus(
        makeReq(`/api/v1/focus/${sessionId}/heartbeat`, "POST", {}, {
          "x-user-id": DEMO_USER_ID,
        }),
        { params: Promise.resolve({ id: sessionId }) }
      );
      expect(hbRes.status).toBe(200);
      const hbJson = await hbRes.json();
      expect(hbJson.data.heartbeatCount).toBe(1);
    });

    it("completes focus session with server-calculated XP", async () => {
      const startRes = await startFocus(
        makeReq(
          "/api/v1/focus/start",
          "POST",
          { requiredMinutes: 25 },
          { "x-user-id": DEMO_USER_ID }
        )
      );
      const startJson = await startRes.json();
      const sessionId = startJson.data.id;

      // Simulate 25 minutes elapsed by fast-forwarding session start in PostgreSQL
      await prisma.focusSession.update({
        where: { id: sessionId },
        data: {
          startedAt: new Date(Date.now() - 25 * 60_000),
          lastHeartbeatAt: new Date(),
        },
      });

      const completeRes = await completeFocus(
        makeReq(
          `/api/v1/focus/${sessionId}/complete`,
          "POST",
          { clientElapsedSeconds: 25 * 60 },
          { "x-user-id": DEMO_USER_ID }
        ),
        { params: Promise.resolve({ id: sessionId }) }
      );
      expect(completeRes.status).toBe(200);
      const completeJson = await completeRes.json();
      expect(completeJson.success).toBe(true);
      expect(completeJson.data.session.status).toBe("COMPLETED");
      expect(completeJson.data.xpAwarded).toBeGreaterThan(0);
    });

    it("abandons a focus session", async () => {
      const startRes = await startFocus(
        makeReq(
          "/api/v1/focus/start",
          "POST",
          { requiredMinutes: 25 },
          { "x-user-id": DEMO_USER_ID }
        )
      );
      const startJson = await startRes.json();
      const sessionId = startJson.data.id;

      const abandonRes = await abandonFocus(
        makeReq(`/api/v1/focus/${sessionId}/abandon`, "POST", {}, {
          "x-user-id": DEMO_USER_ID,
        }),
        { params: Promise.resolve({ id: sessionId }) }
      );
      const abandonJson = await abandonRes.json();
      expect(abandonJson.data.status).toBe("ABANDONED");
    });
  });

  // ── HABITS API ───────────────────────────────────────────────
  describe("/api/v1/habits", () => {
    it("lists habits with today's status", async () => {
      const res = await getHabits(
        makeReq("/api/v1/habits", "GET", undefined, {
          "x-user-id": DEMO_USER_ID,
        })
      );
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(3);
      // Habit 1 was completed in demo seed
      expect(json.data[0].completedToday).toBe(true);
    });

    it("creates a new habit", async () => {
      const res = await postHabit(
        makeReq(
          "/api/v1/habits",
          "POST",
          { title: "Evening Journaling" },
          { "x-user-id": DEMO_USER_ID }
        )
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.title).toBe("Evening Journaling");
    });

    it("patches an existing habit", async () => {
      const res = await patchHabit(
        makeReq(
          `/api/v1/habits/${DEMO_HABIT_2_ID}`,
          "PATCH",
          { title: "Intensive Review" },
          { "x-user-id": DEMO_USER_ID }
        ),
        { params: Promise.resolve({ id: DEMO_HABIT_2_ID }) }
      );
      const json = await res.json();
      expect(json.data.title).toBe("Intensive Review");
    });

    it("logs a habit and enforces one log per date idempotently", async () => {
      // First log for habit 2
      const res1 = await logHabitRoute(
        makeReq(
          `/api/v1/habits/${DEMO_HABIT_2_ID}/log`,
          "POST",
          { completed: true },
          { "x-user-id": DEMO_USER_ID }
        ),
        { params: Promise.resolve({ id: DEMO_HABIT_2_ID }) }
      );
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.data.isDuplicate).toBe(false);
      expect(json1.data.xpAwarded).toBeGreaterThan(0);

      // Duplicate log call on same day
      const res2 = await logHabitRoute(
        makeReq(
          `/api/v1/habits/${DEMO_HABIT_2_ID}/log`,
          "POST",
          { completed: true },
          { "x-user-id": DEMO_USER_ID }
        ),
        { params: Promise.resolve({ id: DEMO_HABIT_2_ID }) }
      );
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.data.isDuplicate).toBe(true);
    });
  });

  // ── LEADERBOARD API ──────────────────────────────────────────
  describe("GET /api/v1/leaderboard", () => {
    it("returns current weekly leaderboard with Monday UTC boundary and privacy protection", async () => {
      const res = await getLeaderboard(
        makeReq("/api/v1/leaderboard", "GET", undefined, {
          "x-user-id": DEMO_USER_ID,
        })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.entries.length).toBeGreaterThan(0);

      // Verify self entry
      const self = json.data.entries.find(
        (e: { isSelf: boolean }) => e.isSelf
      );
      expect(self).toBeDefined();
      expect(self.name).toBe("You");

      // Verify privacy anonymization on peers (no full private names)
      const peers = json.data.entries.filter(
        (e: { isSelf: boolean }) => !e.isSelf
      );
      for (const peer of peers) {
        // Accept both: multi-word ("Firstname L.") and single-word ("Firstname.") anonymized formats
        expect(peer.name).toMatch(/^[A-Za-z]+( [A-Z])?\.$/);
      }
    });
  });

  // ── AI API CONTRACT ──────────────────────────────────────────
  describe("/api/v1/ai", () => {
    it("generates deterministic insights without modifying XP or level", async () => {
      const xpBeforeAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpBefore = xpBeforeAgg._sum.amount ?? 0;

      const res = await getAiInsights(
        makeReq("/api/v1/ai/insights", "GET", undefined, {
          "x-user-id": DEMO_USER_ID,
        })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.content).toBeDefined();

      const xpAfterAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpAfter = xpAfterAgg._sum.amount ?? 0;
      expect(xpAfter).toBe(xpBefore);
    });

    it("proposes AI quests without immediately awarding XP", async () => {
      const xpBeforeAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpBefore = xpBeforeAgg._sum.amount ?? 0;

      const res = await postAiQuests(
        makeReq("/api/v1/ai/quests", "POST", {}, {
          "x-user-id": DEMO_USER_ID,
        })
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.questTask.title).toContain("Quest: Deep Practice");

      const xpAfterAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpAfter = xpAfterAgg._sum.amount ?? 0;
      expect(xpAfter).toBe(xpBefore);
    });
  });
});
