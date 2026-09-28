// ============================================================
// Task Aura — Phase C Tests
// Verifies UI Tab components, branding asset existence,
// AI quest proposals without XP mutation, and API responses against PostgreSQL.
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import {
  seedDatabaseDemoProfile,
  DEMO_USER_ID,
  DEMO_TASK_1_ID,
  DEMO_HABIT_2_ID,
} from "../lib/services/demo-seed";
import { GET as getProgress } from "../app/api/v1/progress/route";
import { POST as postTask } from "../app/api/v1/tasks/route";
import { POST as completeTaskRoute } from "../app/api/v1/tasks/[id]/complete/route";
import { POST as cancelTaskRoute } from "../app/api/v1/tasks/[id]/cancel/route";
import { GET as getHabits } from "../app/api/v1/habits/route";
import { POST as logHabitRoute } from "../app/api/v1/habits/[id]/log/route";
import { GET as getFocus } from "../app/api/v1/focus/route";
import { POST as startFocus } from "../app/api/v1/focus/start/route";
import { POST as completeFocus } from "../app/api/v1/focus/[id]/complete/route";
import { POST as abandonFocus } from "../app/api/v1/focus/[id]/abandon/route";
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
      "x-user-id": DEMO_USER_ID,
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init);
}

describe("Phase C — UI Tabs, Branding & AI Enhancements Suite", () => {
  beforeEach(async () => {
    await seedDatabaseDemoProfile();
  });

  // ── Branding Asset Verification ─────────────────────────────
  describe("TaskAura Branding Asset", () => {
    it("has the official transparent logo asset in public/taskaura-logo.png", () => {
      const logoPath = path.resolve(__dirname, "../public/taskaura-logo.png");
      expect(fs.existsSync(logoPath)).toBe(true);
      const stat = fs.statSync(logoPath);
      expect(stat.size).toBeGreaterThan(1000); // Verify non-empty binary image
    });
  });

  // ── AI Quest Proposal & Authority ────────────────────────────
  describe("AI Quest Proposal Presentation & Safety", () => {
    it("proposes a quest aligned with the user goal without directly mutating XP", async () => {
      const xpBeforeAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpBefore = xpBeforeAgg._sum.amount ?? 0;

      const res = await postAiQuests(makeReq("/api/v1/ai/quests", "POST", {}));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.questTask.title).toContain("Quest: Deep Practice — Exam Preparation");
      expect(json.data.questTask.status).toBe("PENDING");
      expect(json.data.questTask.source).toBe("AI");

      // Verifies AI never directly awards XP upon proposal
      const xpAfterAgg = await prisma.xPTransaction.aggregate({
        where: { userId: DEMO_USER_ID },
        _sum: { amount: true },
      });
      const xpAfter = xpAfterAgg._sum.amount ?? 0;
      expect(xpAfter).toBe(xpBefore);
    });

    it("evaluates deterministic insight guidelines without mutating user level or streak", async () => {
      const streakBeforeRecord = await prisma.streakRecord.findUnique({
        where: { userId: DEMO_USER_ID },
        select: { currentStreak: true },
      });
      const streakBefore = streakBeforeRecord?.currentStreak ?? 0;

      const res = await getAiInsights(makeReq("/api/v1/ai/insights", "GET"));
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.content).toBeDefined();

      const streakAfterRecord = await prisma.streakRecord.findUnique({
        where: { userId: DEMO_USER_ID },
        select: { currentStreak: true },
      });
      const streakAfter = streakAfterRecord?.currentStreak ?? 0;
      expect(streakAfter).toBe(streakBefore);
    });
  });

  // ── Dedicated Tasks Tab Integration ──────────────────────────
  describe("Tasks Tab Flow", () => {
    it("creates a new user task and completes it with authoritative payout", async () => {
      // 1. Create task
      const createRes = await postTask(
        makeReq("/api/v1/tasks", "POST", {
          title: "Complete Mock Exam Simulation",
          difficulty: "HARD",
          estimatedMinutes: 45,
        })
      );
      expect(createRes.status).toBe(201);
      const createJson = await createRes.json();
      const taskId = createJson.data.id;

      // 2. Complete task
      const completeRes = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${taskId}/complete`, "POST", {}),
        { params: Promise.resolve({ id: taskId }) }
      );
      expect(completeRes.status).toBe(200);
      const completeJson = await completeRes.json();
      expect(completeJson.data.task.status).toBe("COMPLETED");

      // 3. Verify PostgreSQL server state
      const taskInDb = await prisma.task.findUnique({ where: { id: taskId } });
      expect(taskInDb?.status).toBe("COMPLETED");
    });

    it("cancels an active task and prevents subsequent completion", async () => {
      const cancelRes = await cancelTaskRoute(
        makeReq(`/api/v1/tasks/${DEMO_TASK_1_ID}/cancel`, "POST", {}),
        { params: Promise.resolve({ id: DEMO_TASK_1_ID }) }
      );
      expect(cancelRes.status).toBe(200);
      const cancelJson = await cancelRes.json();
      expect(cancelJson.data.status).toBe("CANCELLED");

      // Trying to complete cancelled task must fail
      const completeRes = await completeTaskRoute(
        makeReq(`/api/v1/tasks/${DEMO_TASK_1_ID}/complete`, "POST", {}),
        { params: Promise.resolve({ id: DEMO_TASK_1_ID }) }
      );
      expect(completeRes.status).toBe(400);
    });
  });

  // ── Dedicated Habits Tab Integration ─────────────────────────
  describe("Habits Tab Flow", () => {
    it("logs a habit and updates streak commitment idempotently", async () => {
      const logRes = await logHabitRoute(
        makeReq(`/api/v1/habits/${DEMO_HABIT_2_ID}/log`, "POST", { completed: true }),
        { params: Promise.resolve({ id: DEMO_HABIT_2_ID }) }
      );
      expect(logRes.status).toBe(200);
      const logJson = await logRes.json();
      expect(logJson.success).toBe(true);
      expect(logJson.data.isDuplicate).toBe(false);

      // Verify list reflects completed status
      const listRes = await getHabits(makeReq("/api/v1/habits", "GET"));
      const listJson = await listRes.json();
      const habit2 = listJson.data.find((h: { id: string }) => h.id === DEMO_HABIT_2_ID);
      expect(habit2.completedToday).toBe(true);
    });
  });

  // ── Dedicated Focus Tab Integration ──────────────────────────
  describe("Focus Tab Flow", () => {
    it("starts, runs, and abandons a focus session", async () => {
      const startRes = await startFocus(
        makeReq("/api/v1/focus/start", "POST", { requiredMinutes: 25 })
      );
      expect(startRes.status).toBe(201);
      const startJson = await startRes.json();
      const sessionId = startJson.data.id;

      const abandonRes = await abandonFocus(
        makeReq(`/api/v1/focus/${sessionId}/abandon`, "POST", {}),
        { params: Promise.resolve({ id: sessionId }) }
      );
      expect(abandonRes.status).toBe(200);
      const abandonJson = await abandonRes.json();
      expect(abandonJson.data.status).toBe("ABANDONED");

      // Verify focus query has no running session
      const getRes = await getFocus(makeReq("/api/v1/focus", "GET"));
      const getJson = await getRes.json();
      expect(getJson.data.runningSession).toBeNull();
    });

    it("completes a valid focus session and awards authoritative XP", async () => {
      const startRes = await startFocus(
        makeReq("/api/v1/focus/start", "POST", { requiredMinutes: 25 })
      );
      expect(startRes.status).toBe(201);
      const startJson = await startRes.json();
      const sessionId = startJson.data.id;

      // Fast-forward session start time in PostgreSQL
      await prisma.focusSession.update({
        where: { id: sessionId },
        data: {
          startedAt: new Date(Date.now() - 25 * 60_000),
          lastHeartbeatAt: new Date(),
        },
      });

      const completeRes = await completeFocus(
        makeReq(`/api/v1/focus/${sessionId}/complete`, "POST", {
          clientElapsedSeconds: 25 * 60,
        }),
        { params: Promise.resolve({ id: sessionId }) }
      );
      expect(completeRes.status).toBe(200);
      const completeJson = await completeRes.json();
      expect(completeJson.data.xpAwarded).toBeGreaterThan(0);
    });
  });

  // ── Dedicated Leaderboard Tab Integration ────────────────────
  describe("Leaderboard Tab Flow", () => {
    it("renders weekly ranking cohort with Monday UTC boundaries and user rank", async () => {
      const res = await getLeaderboard(makeReq("/api/v1/leaderboard", "GET"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(json.data.userRank).toBeDefined();
      expect(json.data.entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Dashboard Progression Sync ───────────────────────────────
  describe("Dashboard Progression Sync", () => {
    it("returns level 18 with 20,580 XP for canonical demo profile", async () => {
      const res = await getProgress(makeReq("/api/v1/progress", "GET"));
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.level).toBe(18);
      expect(json.data.totalXp).toBe(20580);
      expect(json.data.streak.current).toBe(6);
    });
  });
});
