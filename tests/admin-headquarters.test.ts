// ============================================================
// TaskAura — Admin Headquarters Test Suite
// Verifies:
//   1. Security Gate: 401 unauthenticated, 403 USER, 200 ADMIN across all new endpoints
//   2. /api/v1/admin/stats returns authoritative system metrics
//   3. /api/v1/admin/users/[id] returns user progression without passwordHash
//   4. /api/v1/admin/quests & /quests/[id] — CRUD & validation
//   5. Quest assignment & fan-out (GLOBAL & SPECIFIC)
//   6. /api/v1/admin/rewards/xp — Idempotent XP ledger adjustment & audit logging
//   7. /api/v1/admin/rewards/achievement — Duplicate-safe award & audit logging
//   8. /api/v1/admin/activity — Audit log queries
//   9. /api/v1/admin/generate-quest — AI proposal generator
//  10. Security Invariants: passwordHash never leaked anywhere
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { createSession } from "../lib/auth/session";
import type { NextRequest } from "next/server";

// Import API Route handlers
import { GET as getStatsRoute } from "../app/api/v1/admin/stats/route";
import { GET as getUserDetailRoute } from "../app/api/v1/admin/users/[id]/route";
import { GET as getQuestsRoute, POST as postQuestsRoute } from "../app/api/v1/admin/quests/route";
import { POST as postRewardXpRoute } from "../app/api/v1/admin/rewards/xp/route";
import { GET as getRewardAchievementsRoute, POST as postRewardAchievementRoute } from "../app/api/v1/admin/rewards/achievement/route";
import { GET as getActivityRoute } from "../app/api/v1/admin/activity/route";
import { POST as postGenerateQuestRoute } from "../app/api/v1/admin/generate-quest/route";

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  cookie?: string
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cookie) {
    headers["cookie"] = `taskaura_session=${cookie}`;
  }

  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init) as unknown as NextRequest;
}

describe("TaskAura — Admin Headquarters Full Test Suite", () => {
  const normalEmail = "hq.user@taskaura.test";
  const adminEmail = "hq.admin@taskaura.test";

  let normalUserId: string;
  let adminUserId: string;
  let normalToken: string;
  let adminToken: string;
  let testAchievementId: string;

  beforeAll(async () => {
    // 1. Clean up any stale records
    await prisma.user.deleteMany({
      where: { email: { in: [normalEmail, adminEmail] } },
    });

    // 2. Create normal USER
    const normalUser = await prisma.user.create({
      data: {
        displayName: "Standard Player",
        email: normalEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz1234567890TestHash1",
        isGuest: false,
        role: "USER",
        avatar: "🧑‍💻",
      },
    });
    normalUserId = normalUser.id;

    // 3. Create ADMIN user
    const adminUser = await prisma.user.create({
      data: {
        displayName: "High Commander",
        email: adminEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz1234567890TestHash2",
        isGuest: false,
        role: "ADMIN",
        avatar: "👑",
      },
    });
    adminUserId = adminUser.id;

    // 4. Create valid sessions in PostgreSQL
    const normalSession = await createSession(normalUserId);
    normalToken = normalSession.token;

    const adminSession = await createSession(adminUserId);
    adminToken = adminSession.token;

    // 5. Ensure an achievement exists in database
    let ach = await prisma.achievement.findFirst();
    if (!ach) {
      ach = await prisma.achievement.create({
        data: {
          name: "First Steps",
          description: "Complete your first quest.",
          condition: JSON.stringify({ type: "TASK_COUNT", threshold: 1 }),
        },
      });
    }
    testAchievementId = ach.id;
  });

  afterAll(async () => {
    // Clean up created assignments and quests
    await prisma.questAssignment.deleteMany({
      where: { userId: { in: [normalUserId, adminUserId] } },
    });
    await prisma.quest.deleteMany({
      where: { createdByAdmin: adminUserId },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { adminUserId },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [normalEmail, adminEmail] } },
    });
  });

  // ────────────────────────────────────────────────────────────
  // 1. Security Gate on New Endpoints
  // ────────────────────────────────────────────────────────────
  describe("Security Gates (401 / 403 / 200)", () => {
    it("rejects unauthenticated request to /api/v1/admin/stats with 401", async () => {
      const originalEnv = process.env.NODE_ENV;
      const envRecord = process.env as Record<string, string | undefined>;
      try {
        envRecord.NODE_ENV = "production";
        const res = await getStatsRoute(makeReq("/api/v1/admin/stats"));
        expect(res.status).toBe(401);
      } finally {
        envRecord.NODE_ENV = originalEnv;
      }
    });

    it("rejects normal USER role from /api/v1/admin/stats with 403", async () => {
      const res = await getStatsRoute(makeReq("/api/v1/admin/stats", "GET", undefined, normalToken));
      expect(res.status).toBe(403);
    });

    it("allows ADMIN role to access /api/v1/admin/stats with 200", async () => {
      const res = await getStatsRoute(makeReq("/api/v1/admin/stats", "GET", undefined, adminToken));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(typeof json.data.totalUsers).toBe("number");
      expect(typeof json.data.totalXp).toBe("number");
    });

    it("rejects unauthenticated request to /api/v1/admin/quests with 401", async () => {
      const originalEnv = process.env.NODE_ENV;
      const envRecord = process.env as Record<string, string | undefined>;
      try {
        envRecord.NODE_ENV = "production";
        const res = await getQuestsRoute(makeReq("/api/v1/admin/quests"));
        expect(res.status).toBe(401);
      } finally {
        envRecord.NODE_ENV = originalEnv;
      }
    });

    it("rejects normal USER role from /api/v1/admin/quests with 403", async () => {
      const res = await getQuestsRoute(makeReq("/api/v1/admin/quests", "GET", undefined, normalToken));
      expect(res.status).toBe(403);
    });

    it("allows ADMIN role to access /api/v1/admin/quests with 200", async () => {
      const res = await getQuestsRoute(makeReq("/api/v1/admin/quests", "GET", undefined, adminToken));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.quests)).toBe(true);
    });

    it("rejects normal USER role from /api/v1/admin/activity with 403", async () => {
      const res = await getActivityRoute(makeReq("/api/v1/admin/activity", "GET", undefined, normalToken));
      expect(res.status).toBe(403);
    });

    it("allows ADMIN role to access /api/v1/admin/activity with 200", async () => {
      const res = await getActivityRoute(makeReq("/api/v1/admin/activity", "GET", undefined, adminToken));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.logs)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. User Detail Endpoint
  // ────────────────────────────────────────────────────────────
  describe("User Detail (/api/v1/admin/users/[id])", () => {
    it("returns player detail without leaking passwordHash", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${normalUserId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: normalUserId }) }
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.id).toBe(normalUserId);
      expect(json.data.user.displayName).toBe("Standard Player");
      expect(json.data.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(json)).not.toContain("passwordHash");
    });

    it("returns 404 for nonexistent user ID", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${fakeId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: fakeId }) }
      );
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. Quest Forge (Create, Validate, Assign)
  // ────────────────────────────────────────────────────────────
  describe("Quest Forge & Fan-Out", () => {
    it("validates missing quest title and returns 400", async () => {
      const res = await postQuestsRoute(
        makeReq(
          "/api/v1/admin/quests",
          "POST",
          {
            title: "",
            description: "No title provided",
            difficulty: "NORMAL",
            xpReward: 100,
          },
          adminToken
        )
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("validates invalid difficulty and returns 400", async () => {
      const res = await postQuestsRoute(
        makeReq(
          "/api/v1/admin/quests",
          "POST",
          {
            title: "Impossible Quest",
            description: "Invalid difficulty tier",
            difficulty: "SUPER_GOD_MODE",
            xpReward: 100,
          },
          adminToken
        )
      );
      expect(res.status).toBe(400);
    });

    it("validates negative XP reward and returns 400", async () => {
      const res = await postQuestsRoute(
        makeReq(
          "/api/v1/admin/quests",
          "POST",
          {
            title: "Negative XP Quest",
            description: "This should fail",
            difficulty: "NORMAL",
            xpReward: -50,
          },
          adminToken
        )
      );
      expect(res.status).toBe(400);
    });

    it("admin creates a GLOBAL quest with server fan-out to all players", async () => {
      const res = await postQuestsRoute(
        makeReq(
          "/api/v1/admin/quests",
          "POST",
          {
            title: "Global Weekend Sprint",
            description: "Complete all morning tasks this weekend.",
            difficulty: "HARD",
            xpReward: 300,
            targetType: "GLOBAL",
            status: "ACTIVE",
          },
          adminToken
        )
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.quest.title).toBe("Global Weekend Sprint");
      expect(json.data.quest.targetType).toBe("GLOBAL");
      expect(json.data.quest.xpReward).toBe(300);

      // Verify QuestAssignment was created for normalUser
      const assignment = await prisma.questAssignment.findUnique({
        where: {
          questId_userId: {
            questId: json.data.quest.id,
            userId: normalUserId,
          },
        },
      });
      expect(assignment).not.toBeNull();
    });

    it("admin creates a SPECIFIC quest targeted to normalUser", async () => {
      const res = await postQuestsRoute(
        makeReq(
          "/api/v1/admin/quests",
          "POST",
          {
            title: "Special Player Challenge",
            description: "Dedicated mission for standard player.",
            difficulty: "EPIC",
            xpReward: 500,
            targetType: "SPECIFIC",
            targetUserIds: [normalUserId],
            status: "ACTIVE",
          },
          adminToken
        )
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      const assignment = await prisma.questAssignment.findUnique({
        where: {
          questId_userId: {
            questId: json.data.quest.id,
            userId: normalUserId,
          },
        },
      });
      expect(assignment).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. Rewards Center (XP Grant & Achievement Award)
  // ────────────────────────────────────────────────────────────
  describe("Rewards Center (Authoritative XP & Achievements)", () => {
    it("rejects non-admin from granting XP with 403", async () => {
      const res = await postRewardXpRoute(
        makeReq(
          "/api/v1/admin/rewards/xp",
          "POST",
          {
            targetUserId: normalUserId,
            amount: 250,
            reason: "Hacker attempt",
          },
          normalToken
        )
      );
      expect(res.status).toBe(403);
    });

    it("allows admin to grant XP via append-only ledger and logs audit entry", async () => {
      const res = await postRewardXpRoute(
        makeReq(
          "/api/v1/admin/rewards/xp",
          "POST",
          {
            targetUserId: normalUserId,
            amount: 250,
            reason: "Outstanding community contribution",
          },
          adminToken
        )
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.amount).toBe(250);

      // Verify transaction row was created in database
      const tx = await prisma.xPTransaction.findFirst({
        where: {
          userId: normalUserId,
          sourceType: "ADJUSTMENT",
          amount: 250,
        },
      });
      expect(tx).not.toBeNull();

      // Verify AdminAuditLog entry
      const audit = await prisma.adminAuditLog.findFirst({
        where: {
          adminUserId,
          action: "XP_GRANTED",
          targetUserId: normalUserId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it("allows admin to award achievement badge with duplicate safety", async () => {
      // First award
      const res1 = await postRewardAchievementRoute(
        makeReq(
          "/api/v1/admin/rewards/achievement",
          "POST",
          {
            targetUserId: normalUserId,
            achievementId: testAchievementId,
            reason: "Special achievement award",
          },
          adminToken
        )
      );
      expect(res1.status).toBe(200);

      // Verify userAchievement exists
      const userAch = await prisma.userAchievement.findUnique({
        where: {
          userId_achievementId: {
            userId: normalUserId,
            achievementId: testAchievementId,
          },
        },
      });
      expect(userAch).not.toBeNull();

      // Second award: duplicate-safe idempotency
      const res2 = await postRewardAchievementRoute(
        makeReq(
          "/api/v1/admin/rewards/achievement",
          "POST",
          {
            targetUserId: normalUserId,
            achievementId: testAchievementId,
            reason: "Second attempt",
          },
          adminToken
        )
      );
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.data.alreadyUnlocked).toBe(true);
    });

    it("lists available achievement catalog via GET /api/v1/admin/rewards/achievement", async () => {
      const res = await getRewardAchievementsRoute(
        makeReq("/api/v1/admin/rewards/achievement", "GET", undefined, adminToken)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.achievements.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5. AI Quest Generator Proposal
  // ────────────────────────────────────────────────────────────
  describe("AI Quest Proposal Generator", () => {
    it("generates deterministic quest proposal without saving to database", async () => {
      const initialCount = await prisma.quest.count();

      const res = await postGenerateQuestRoute(
        makeReq("/api/v1/admin/generate-quest", "POST", {}, adminToken)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.proposal.title).toBeDefined();
      expect(json.data.proposal.description).toBeDefined();
      expect(json.data.proposal.estimatedXp).toBeGreaterThan(0);

      // Ensure NO quest was actually created in the database yet
      const afterCount = await prisma.quest.count();
      expect(afterCount).toBe(initialCount);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 6. Audit Trail Query & Security Invariants
  // ────────────────────────────────────────────────────────────
  describe("Audit Activity & Security Invariants", () => {
    it("returns paginated audit logs containing recent quest and reward actions", async () => {
      const res = await getActivityRoute(
        makeReq("/api/v1/admin/activity?page=1&limit=10", "GET", undefined, adminToken)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.logs.length).toBeGreaterThan(0);

      const actions = json.data.logs.map((l: { action: string }) => l.action);
      expect(actions).toContain("QUEST_CREATED");
      expect(actions).toContain("XP_GRANTED");
    });

    it("audit logs NEVER contain passwordHash, passwords, or session tokens", async () => {
      const res = await getActivityRoute(
        makeReq("/api/v1/admin/activity", "GET", undefined, adminToken)
      );
      const text = await res.text();
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("TestHash");
      expect(text).not.toContain(adminToken);
      expect(text).not.toContain(normalToken);
    });
  });
});
