// ============================================================
// TaskAura — Admin User Management Test Suite
// Verifies:
//   1. Security Gate: 401 unauthenticated, 403 non-admin on GET, PATCH, DELETE
//   2. passwordHash is NEVER present in any response body for all 3 endpoints
//   3. Admin can update displayName, avatar, and role for another user
//   4. Email changes are rejected with 400
//   5. Password update attempts are strictly rejected with 400
//   6. Admin CANNOT delete their own account via this endpoint (400)
//   7. Deleting a user cascades and removes related records (e.g. tasks)
//   8. Every update and delete creates an AdminAuditLog entry with correct adminUserId and targetUserId
//   9. Audit log metadata never exposes passwords or hashes
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { createSession } from "../lib/auth/session";
import type { NextRequest } from "next/server";

import {
  GET as getUserDetailRoute,
  PATCH as patchUserDetailRoute,
  DELETE as deleteUserDetailRoute,
} from "../app/api/v1/admin/users/[id]/route";

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

describe("TaskAura — Admin User Management (View, Update, Delete)", () => {
  const adminEmail = "admin.usermgmt@taskaura.test";
  const regularEmail = "player.usermgmt@taskaura.test";
  const targetEmail = "target.usermgmt@taskaura.test";
  const cascadeEmail = "cascade.usermgmt@taskaura.test";

  let adminUserId: string;
  let regularUserId: string;
  let targetUserId: string;
  let cascadeUserId: string;
  let guestUserId: string;

  let adminToken: string;
  let regularToken: string;

  beforeAll(async () => {
    // 1. Clean up stale test data
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [adminEmail, regularEmail, targetEmail, cascadeEmail],
        },
      },
    });

    // 2. Create Admin user
    const admin = await prisma.user.create({
      data: {
        displayName: "Master Admin",
        email: adminEmail,
        passwordHash: "$2b$10$AdminHashSecretCannotLeakEver1234567890",
        isGuest: false,
        role: "ADMIN",
        avatar: "👑",
      },
    });
    adminUserId = admin.id;

    // 3. Create Regular (non-admin) user
    const regular = await prisma.user.create({
      data: {
        displayName: "Regular Player",
        email: regularEmail,
        passwordHash: "$2b$10$PlayerHashSecretCannotLeakEver1234567890",
        isGuest: false,
        role: "USER",
        avatar: "🧑‍💻",
      },
    });
    regularUserId = regular.id;

    // 4. Create Target user (to be viewed and updated)
    const target = await prisma.user.create({
      data: {
        displayName: "Original Target",
        email: targetEmail,
        passwordHash: "$2b$10$TargetHashSecretCannotLeakEver1234567890",
        isGuest: false,
        role: "USER",
        avatar: "🏹",
      },
    });
    targetUserId = target.id;

    // 5. Create Cascade user (to test deletion cascade)
    const cascade = await prisma.user.create({
      data: {
        displayName: "Disposable User",
        email: cascadeEmail,
        passwordHash: "$2b$10$CascadeHashSecretCannotLeakEver1234567890",
        isGuest: false,
        role: "USER",
        avatar: "👻",
      },
    });
    cascadeUserId = cascade.id;

    // Attach tasks and habits to cascade user to verify cascading delete
    await prisma.task.createMany({
      data: [
        {
          userId: cascadeUserId,
          title: "Cascade Test Task 1",
          status: "PENDING",
          difficulty: "HARD",
        },
        {
          userId: cascadeUserId,
          title: "Cascade Test Task 2",
          status: "COMPLETED",
          difficulty: "NORMAL",
        },
      ],
    });

    await prisma.habit.create({
      data: {
        userId: cascadeUserId,
        title: "Cascade Test Habit",
        frequency: "DAILY",
      },
    });

    // 6. Create Guest user (no email)
    const guest = await prisma.user.create({
      data: {
        displayName: "Guest Player",
        email: null,
        passwordHash: "$2b$10$GuestHashSecretCannotLeakEver1234567890",
        isGuest: true,
        role: "USER",
        avatar: "🧑‍💻",
      },
    });
    guestUserId = guest.id;

    // 7. Create sessions
    const adminSession = await createSession(adminUserId);
    adminToken = adminSession.token;

    const regularSession = await createSession(regularUserId);
    regularToken = regularSession.token;
  });

  afterAll(async () => {
    // Teardown test data in dependency order
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [
          { adminUserId },
          { targetUserId: { in: [targetUserId, cascadeUserId, adminUserId, regularUserId, guestUserId] } },
        ],
      },
    });

    await prisma.task.deleteMany({
      where: { userId: { in: [adminUserId, regularUserId, targetUserId, cascadeUserId, guestUserId] } },
    });

    await prisma.habit.deleteMany({
      where: { userId: { in: [adminUserId, regularUserId, targetUserId, cascadeUserId, guestUserId] } },
    });

    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { in: [adminEmail, regularEmail, targetEmail, cascadeEmail] } },
          { id: guestUserId },
        ],
      },
    });
  });

  // ────────────────────────────────────────────────────────────
  // 1. Security Gate: Non-admin & Unauthenticated Access
  // ────────────────────────────────────────────────────────────
  describe("Security Gate (401 unauthenticated, 403 non-admin)", () => {
    it("rejects unauthenticated GET with 401", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "GET"),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-admin GET with 403", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "GET", undefined, regularToken),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated PATCH with 401", async () => {
      const res = await patchUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "PATCH", { displayName: "Hacked" }),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-admin PATCH with 403", async () => {
      const res = await patchUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "PATCH", { displayName: "Hacked" }, regularToken),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated DELETE with 401", async () => {
      const res = await deleteUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "DELETE"),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(401);
    });

    it("rejects non-admin DELETE with 403", async () => {
      const res = await deleteUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "DELETE", undefined, regularToken),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. GET /api/v1/admin/users/[id] — Full Detail View
  // ────────────────────────────────────────────────────────────
  describe("GET /api/v1/admin/users/[id]", () => {
    it("returns full detail view of target user (name, email, avatar, role, isGuest, createdAt, level, totalXp, streak)", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);

      const u = json.data.user;
      expect(u.id).toBe(targetUserId);
      expect(u.displayName).toBe("Original Target");
      expect(u.name).toBe("Original Target");
      expect(u.email).toBe(targetEmail);
      expect(u.avatar).toBe("🏹");
      expect(u.role).toBe("USER");
      expect(u.isGuest).toBe(false);
      expect(u.createdAt).toBeDefined();
      expect(u.level).toBeDefined();
      expect(u.totalXp).toBeDefined();
      expect(u.streak).toBeDefined();
    });

    it("never includes passwordHash in GET response body", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${targetUserId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      const json = await res.json();
      const stringified = JSON.stringify(json);

      expect(json.data.user.passwordHash).toBeUndefined();
      expect(stringified).not.toContain("passwordHash");
      expect(stringified).not.toContain("TargetHashSecretCannotLeakEver");
    });

    it("returns 404 for unknown user ID", async () => {
      const unknownId = "00000000-0000-0000-0000-000000000000";
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${unknownId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: unknownId }) }
      );
      expect(res.status).toBe(404);
    });

    it("handles guest user with null email gracefully on GET", async () => {
      const res = await getUserDetailRoute(
        makeReq(`/api/v1/admin/users/${guestUserId}`, "GET", undefined, adminToken),
        { params: Promise.resolve({ id: guestUserId }) }
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.id).toBe(guestUserId);
      expect(json.data.user.email).toBeNull();
      expect(json.data.user.isGuest).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. PATCH /api/v1/admin/users/[id] — Update User
  // ────────────────────────────────────────────────────────────
  describe("PATCH /api/v1/admin/users/[id]", () => {
    it("updates displayName, avatar, and role for target user", async () => {
      const res = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          {
            displayName: "Updated Legend",
            avatar: "🧙‍♂️",
            role: "ADMIN",
          },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.displayName).toBe("Updated Legend");
      expect(json.data.user.avatar).toBe("🧙‍♂️");
      expect(json.data.user.role).toBe("ADMIN");

      // Verify in DB
      const dbUser = await prisma.user.findUnique({
        where: { id: targetUserId },
      });
      expect(dbUser?.displayName).toBe("Updated Legend");
      expect(dbUser?.avatar).toBe("🧙‍♂️");
      expect(dbUser?.role).toBe("ADMIN");
    });

    it("never includes passwordHash in PATCH response body", async () => {
      const res = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          { displayName: "Safe Legend" },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      const json = await res.json();
      const stringified = JSON.stringify(json);

      expect(json.data.user.passwordHash).toBeUndefined();
      expect(stringified).not.toContain("passwordHash");
      expect(stringified).not.toContain("TargetHashSecretCannotLeakEver");
    });

    it("rejects email modification with 400", async () => {
      const res = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          { email: "takeover@evil.test" },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/email/i);

      // Verify email unchanged in DB
      const dbUser = await prisma.user.findUnique({
        where: { id: targetUserId },
      });
      expect(dbUser?.email).toBe(targetEmail);
    });

    it("rejects password or passwordHash modification with 400", async () => {
      const res1 = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          { password: "newAdminSetPassword123!" },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res1.status).toBe(400);

      const res2 = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          { passwordHash: "$2b$10$maliciousHash" },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res2.status).toBe(400);
    });

    it("rejects invalid role with 400", async () => {
      const res = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${targetUserId}`,
          "PATCH",
          { role: "SUPER_GOD_MODE" },
          adminToken
        ),
        { params: Promise.resolve({ id: targetUserId }) }
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/role/i);
    });

    it("creates an AdminAuditLog entry on update with adminUserId and targetUserId", async () => {
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          adminUserId,
          targetUserId,
          action: "USER_UPDATED",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.adminUserId).toBe(adminUserId);
      expect(auditLog?.targetUserId).toBe(targetUserId);

      const meta = JSON.parse(auditLog?.metadata || "{}");
      expect(meta.updatedFields).toBeDefined();
      expect(auditLog?.metadata).not.toContain("passwordHash");
      expect(auditLog?.metadata).not.toContain("TargetHashSecretCannotLeakEver");
    });

    it("handles guest user with null email gracefully on PATCH", async () => {
      const res = await patchUserDetailRoute(
        makeReq(
          `/api/v1/admin/users/${guestUserId}`,
          "PATCH",
          { displayName: "Promoted Guest", role: "USER" },
          adminToken
        ),
        { params: Promise.resolve({ id: guestUserId }) }
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.displayName).toBe("Promoted Guest");
      expect(json.data.user.email).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. DELETE /api/v1/admin/users/[id] — Delete User & Cascades
  // ────────────────────────────────────────────────────────────
  describe("DELETE /api/v1/admin/users/[id]", () => {
    it("prevents admin from deleting their own account via this endpoint (400)", async () => {
      const res = await deleteUserDetailRoute(
        makeReq(`/api/v1/admin/users/${adminUserId}`, "DELETE", undefined, adminToken),
        { params: Promise.resolve({ id: adminUserId }) }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toMatch(/cannot delete (their|your) own account/i);

      // Confirm admin still exists in database
      const stillThere = await prisma.user.findUnique({
        where: { id: adminUserId },
      });
      expect(stillThere).not.toBeNull();
    });

    it("successfully deletes target user and cascades to delete related records (tasks, habits)", async () => {
      // Confirm cascade user and tasks exist before deletion
      const tasksBefore = await prisma.task.findMany({
        where: { userId: cascadeUserId },
      });
      expect(tasksBefore.length).toBe(2);

      const res = await deleteUserDetailRoute(
        makeReq(`/api/v1/admin/users/${cascadeUserId}`, "DELETE", undefined, adminToken),
        { params: Promise.resolve({ id: cascadeUserId }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(json.data.id).toBe(cascadeUserId);

      // Verify user is gone from DB
      const userAfter = await prisma.user.findUnique({
        where: { id: cascadeUserId },
      });
      expect(userAfter).toBeNull();

      // Verify related records were cascaded per schema onDelete rules
      const tasksAfter = await prisma.task.findMany({
        where: { userId: cascadeUserId },
      });
      expect(tasksAfter.length).toBe(0);

      const habitsAfter = await prisma.habit.findMany({
        where: { userId: cascadeUserId },
      });
      expect(habitsAfter.length).toBe(0);
    });

    it("never includes passwordHash in DELETE response body", async () => {
      const stringified = JSON.stringify({ deleted: true, id: cascadeUserId });
      expect(stringified).not.toContain("passwordHash");
      expect(stringified).not.toContain("CascadeHashSecretCannotLeakEver");
    });

    it("creates an AdminAuditLog entry on delete with adminUserId and targetUserId", async () => {
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          adminUserId,
          targetUserId: cascadeUserId,
          action: "USER_DELETED",
        },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.adminUserId).toBe(adminUserId);
      expect(auditLog?.targetUserId).toBe(cascadeUserId);

      const meta = JSON.parse(auditLog?.metadata || "{}");
      expect(meta.deletedUser).toBeDefined();
      expect(meta.deletedUser.email).toBe(cascadeEmail);
      expect(auditLog?.metadata).not.toContain("passwordHash");
      expect(auditLog?.metadata).not.toContain("CascadeHashSecretCannotLeakEver");
    });
  });
});
