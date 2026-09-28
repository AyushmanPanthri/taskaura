// ============================================================
// TaskAura — Admin Rewards XP Grant Test Suite
//
// Covers the specific bug fix for: "admin grants XP but player's
// total never updates".
//
// Root Cause: progress/route.ts read totalXp from the in-memory
// store singleton (xp-service.ts → store.getTotalXp) which is
// never updated by xpRepository.recordTransaction() (Prisma direct
// write). Admin-granted XP was committed to PostgreSQL and the
// audit log was created, but getUserProgressSummary() always
// returned the stale in-memory total.
//
// Fix: progress/route.ts now calls getPgProgressSummary() which
// aggregates SUM(xp_transactions) directly from Prisma.
//
// This suite verifies:
//  1. Admin grant writes the XP ledger row to PostgreSQL
//  2. The authoritative progress endpoint reflects the new total
//  3. Multiple grants accumulate correctly
//  4. isDuplicate is false (unique sourceId per grant)
//  5. Audit log entry is created for each grant
//  6. Non-admin cannot grant XP (security gate)
//  7. Target userId used (not admin's own ID)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { createSession } from "../lib/auth/session";
import type { NextRequest } from "next/server";

import { POST as postRewardXpRoute } from "../app/api/v1/admin/rewards/xp/route";
import { GET as getProgressRoute } from "../app/api/v1/progress/route";
import { getPgProgressSummary } from "../lib/services/pg-progress-service";

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
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init) as unknown as NextRequest;
}

describe("Admin Rewards — XP Grant Bug Fix (admin grant → DB → progress visible)", () => {
  const playerEmail = "rewards.test.player@taskaura.test";
  const adminEmail = "rewards.test.admin@taskaura.test";

  let playerId: string;
  let adminId: string;
  let playerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // 1. Clean up stale data
    await prisma.user.deleteMany({
      where: { email: { in: [playerEmail, adminEmail] } },
    });

    // 2. Create player and admin
    const player = await prisma.user.create({
      data: {
        displayName: "Test Player",
        email: playerEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456TestPlayerHash",
        isGuest: false,
        role: "USER",
        avatar: "🧑‍💻",
      },
    });
    playerId = player.id;

    const admin = await prisma.user.create({
      data: {
        displayName: "Test Admin",
        email: adminEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456TestAdminHash0",
        isGuest: false,
        role: "ADMIN",
        avatar: "👑",
      },
    });
    adminId = admin.id;

    // 3. Create sessions
    const playerSession = await createSession(playerId);
    playerToken = playerSession.token;

    const adminSession = await createSession(adminId);
    adminToken = adminSession.token;
  });

  afterAll(async () => {
    // Clean up in dependency order
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: adminId } });
    await prisma.xPTransaction.deleteMany({ where: { userId: { in: [playerId, adminId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: [playerEmail, adminEmail] } },
    });
  });

  // ── 1. Security Gate ─────────────────────────────────────────
  it("non-admin player cannot grant XP (403)", async () => {
    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 500,
        reason: "Hacker attempt",
      }, playerToken)
    );
    expect(res.status).toBe(403);
  });

  // ── 2. Admin grant writes a PostgreSQL row ───────────────────
  it("admin grant creates an XP transaction row in PostgreSQL", async () => {
    const before = await prisma.xPTransaction.count({ where: { userId: playerId } });

    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 300,
        reason: "Community event prize",
      }, adminToken)
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.amount).toBe(300);
    expect(json.data.granted).toBe(true); // not a duplicate

    const after = await prisma.xPTransaction.count({ where: { userId: playerId } });
    expect(after).toBe(before + 1);
  });

  // ── 3. THE CORE BUG FIX: progress reflects the grant ────────
  it("getPgProgressSummary returns the updated XP total after admin grant", async () => {
    // Grant 400 XP
    const grantRes = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 400,
        reason: "Beta tester compensation",
      }, adminToken)
    );
    expect(grantRes.status).toBe(200);

    // Read directly from the authoritative service
    const summary = await getPgProgressSummary(playerId);
    
    // The total must include all grants so far (300 from prev test + 400 from this one)
    expect(summary.totalXp).toBeGreaterThanOrEqual(700);
    expect(summary.userId).toBe(playerId);
    expect(typeof summary.level).toBe("number");
    expect(summary.level).toBeGreaterThanOrEqual(1);
  });

  // ── 4. Progress API endpoint reflects the grant ──────────────
  it("GET /api/v1/progress reflects admin-granted XP immediately (the fixed endpoint)", async () => {
    // Snapshot XP before grant
    const beforeSummary = await getPgProgressSummary(playerId);

    // Grant 250 XP
    await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 250,
        reason: "Moderator recognition",
      }, adminToken)
    );

    // Call the fixed progress endpoint
    const progressRes = await getProgressRoute(
      makeReq("/api/v1/progress", "GET", undefined, playerToken)
    );
    expect(progressRes.status).toBe(200);

    const progressJson = await progressRes.json();
    expect(progressJson.success).toBe(true);
    
    // THE KEY ASSERTION: after fix, totalXp must be 250 more than before
    expect(progressJson.data.totalXp).toBe(beforeSummary.totalXp + 250);
  });

  // ── 5. Grants accumulate correctly (multiple sequential) ─────
  it("multiple admin grants accumulate in the ledger total", async () => {
    const beforeSummary = await getPgProgressSummary(playerId);

    // Grant 100, then 200, then 50
    for (const amount of [100, 200, 50]) {
      const res = await postRewardXpRoute(
        makeReq("/api/v1/admin/rewards/xp", "POST", {
          targetUserId: playerId,
          amount,
          reason: `Batch grant ${amount}`,
        }, adminToken)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      // Each grant must be a NEW transaction (not a duplicate)
      expect(json.data.granted).toBe(true);
    }

    const afterSummary = await getPgProgressSummary(playerId);
    expect(afterSummary.totalXp).toBe(beforeSummary.totalXp + 100 + 200 + 50);
  });

  // ── 6. Grant targets the player — not the admin ──────────────
  it("grant uses targetUserId (player), not the admin's own ID", async () => {
    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 99,
        reason: "Ownership identity check",
      }, adminToken)
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.targetUser.id).toBe(playerId);
    expect(json.data.targetUser.id).not.toBe(adminId);

    // Verify the DB row has the correct userId
    const tx = await prisma.xPTransaction.findFirst({
      where: { userId: playerId, amount: 99, sourceType: "ADJUSTMENT" },
      orderBy: { createdAt: "desc" },
    });
    expect(tx).not.toBeNull();
    expect(tx!.userId).toBe(playerId);

    // Admin's ledger must NOT be affected
    const adminTxCount = await prisma.xPTransaction.count({ where: { userId: adminId } });
    expect(adminTxCount).toBe(0);
  });

  // ── 7. Audit log is created for every grant ──────────────────
  it("each admin XP grant creates an AdminAuditLog entry", async () => {
    const auditBefore = await prisma.adminAuditLog.count({
      where: { adminUserId: adminId, action: "XP_GRANTED", targetUserId: playerId },
    });

    await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 111,
        reason: "Audit log verification",
      }, adminToken)
    );

    const auditAfter = await prisma.adminAuditLog.count({
      where: { adminUserId: adminId, action: "XP_GRANTED", targetUserId: playerId },
    });
    expect(auditAfter).toBe(auditBefore + 1);
  });

  // ── 8. Idempotency: each grant has a unique key ───────────────
  it("each grant generates a unique idempotency key (timestamp-based sourceId)", async () => {
    const res1 = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 50,
        reason: "Idempotency test grant 1",
      }, adminToken)
    );
    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));
    const res2 = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 50,
        reason: "Idempotency test grant 2",
      }, adminToken)
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    const json2 = await res2.json();

    // Both must succeed as NEW grants (not duplicates) because the
    // sourceId includes Date.now() which differs between calls
    expect(json1.data.granted).toBe(true);
    expect(json2.data.granted).toBe(true);

    // Transaction IDs must be different
    expect(json1.data.transaction.id).not.toBe(json2.data.transaction.id);
  });

  // ── 9. Validation guards ──────────────────────────────────────
  it("rejects XP grant with zero or negative amount", async () => {
    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 0,
        reason: "Zero XP test",
      }, adminToken)
    );
    expect(res.status).toBe(400);
  });

  it("rejects XP grant with missing reason", async () => {
    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: playerId,
        amount: 100,
        reason: "",
      }, adminToken)
    );
    expect(res.status).toBe(400);
  });

  it("rejects XP grant for non-existent user with 404", async () => {
    const fakeId = "00000000-dead-beef-cafe-000000000000";
    const res = await postRewardXpRoute(
      makeReq("/api/v1/admin/rewards/xp", "POST", {
        targetUserId: fakeId,
        amount: 100,
        reason: "Ghost user test",
      }, adminToken)
    );
    expect(res.status).toBe(404);
  });
});
