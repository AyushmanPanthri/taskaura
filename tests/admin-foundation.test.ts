// ============================================================
// TaskAura — Admin Role Foundation Test Suite
// Verifies:
//   1. Unauthenticated requests to /api/v1/admin/users return 401
//   2. Non-admin users (USER role) receive 403 Forbidden
//   3. Admin users (ADMIN role) receive 200 and can view the user list
//   4. List includes: name, email, isGuest, createdAt, level, totalXp
//   5. SECURITY: List NEVER exposes passwordHash
//   6. requireAdmin() server helper enforce 401/403 on API and redirects on page
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../lib/prisma";
import { createSession } from "../lib/auth/session";
import { GET as adminUsersRoute } from "../app/api/v1/admin/users/route";
import { requireAdmin } from "../lib/auth/require-admin";
import * as serverSessionModule from "../lib/auth/server-session";
import type { NextRequest } from "next/server";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>
): NextRequest {
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
  return new Request(`http://localhost:3000${url}`, init) as unknown as NextRequest;
}

describe("TaskAura — Admin Role Foundation Suite", () => {
  const normalEmail = "regular.user@taskaura.test";
  const adminEmail = "commander.admin@taskaura.test";

  let normalUserId: string;
  let adminUserId: string;
  let normalCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    // Clean up any stale test accounts
    await prisma.user.deleteMany({
      where: { email: { in: [normalEmail, adminEmail] } },
    });

    // 1. Create standard USER account
    const normalUser = await prisma.user.create({
      data: {
        displayName: "Regular Adventurer",
        email: normalEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz1234567890TestHash1",
        isGuest: false,
        role: "USER",
        avatar: "🧑‍💻",
      },
    });
    normalUserId = normalUser.id;
    const normalSession = await createSession(normalUserId);
    normalCookie = `taskaura_session=${normalSession.token}`;

    // 2. Create ADMIN account
    const adminUser = await prisma.user.create({
      data: {
        displayName: "High Admin",
        email: adminEmail,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz1234567890TestHash2",
        isGuest: false,
        role: "ADMIN",
        avatar: "👑",
      },
    });
    adminUserId = adminUser.id;
    const adminSession = await createSession(adminUserId);
    adminCookie = `taskaura_session=${adminSession.token}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [normalEmail, adminEmail] } },
    });
    await prisma.$disconnect();
  });

  // ── 1. UNAUTHENTICATED REQUESTS ARE REJECTED (401) ───────────
  it("unauthenticated requests to admin API return 401 Unauthorized", async () => {
    const originalEnv = process.env.NODE_ENV;
    const envRecord = process.env as Record<string, string | undefined>;
    try {
      envRecord.NODE_ENV = "production";
      const req = makeReq("/api/v1/admin/users", "GET");
      const res = await adminUsersRoute(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    } finally {
      envRecord.NODE_ENV = originalEnv;
    }
  });

  // ── 2. NON-ADMIN REQUESTS ARE REJECTED (403) ──────────────────
  it("non-admin users (USER role) receive 403 Forbidden", async () => {
    const req = makeReq("/api/v1/admin/users", "GET", undefined, {
      cookie: normalCookie,
    });
    const res = await adminUsersRoute(req);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.message).toContain("Admin");
  });

  // ── 3. ADMIN USERS CAN VIEW THE LIST (200) ───────────────────
  it("admin user can access and view the users list", async () => {
    const req = makeReq("/api/v1/admin/users", "GET", undefined, {
      cookie: adminCookie,
    });
    const res = await adminUsersRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.users)).toBe(true);
    expect(json.data.users.length).toBeGreaterThanOrEqual(2);
  });

  // ── 4. LIST INCLUDES REQUIRED USER PROPERTIES ────────────────
  it("user list contains name, email, isGuest, createdAt, level, and totalXp", async () => {
    const req = makeReq("/api/v1/admin/users", "GET", undefined, {
      cookie: adminCookie,
    });
    const res = await adminUsersRoute(req);
    const json = await res.json();

    const normalInList = json.data.users.find((u: { id: string }) => u.id === normalUserId);
    expect(normalInList).toBeDefined();
    expect(normalInList.name).toBe("Regular Adventurer");
    expect(normalInList.email).toBe(normalEmail);
    expect(normalInList.isGuest).toBe(false);
    expect(normalInList.role).toBe("USER");
    expect(normalInList.createdAt).toBeDefined();
    expect(typeof normalInList.level).toBe("number");
    expect(typeof normalInList.totalXp).toBe("number");

    const adminInList = json.data.users.find((u: { id: string }) => u.id === adminUserId);
    expect(adminInList).toBeDefined();
    expect(adminInList.role).toBe("ADMIN");
  });

  // ── 5. SECURITY: NEVER EXPOSES PASSWORD HASH ─────────────────
  it("SECURITY INVARIANT: user list NEVER exposes passwordHash or password_hash", async () => {
    const req = makeReq("/api/v1/admin/users", "GET", undefined, {
      cookie: adminCookie,
    });
    const res = await adminUsersRoute(req);
    const json = await res.json();

    for (const user of json.data.users) {
      expect(user.passwordHash).toBeUndefined();
      expect(user.password_hash).toBeUndefined();
      expect(user.password).toBeUndefined();
    }
  });

  // ── 6. requireAdmin() HELPER INVARIANTS ───────────────────────
  describe("requireAdmin() server-side helper", () => {
    it("returns 401 when unauthenticated in API mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      const envRecord = process.env as Record<string, string | undefined>;
      try {
        envRecord.NODE_ENV = "production";
        const req = makeReq("/api/test", "GET");
        const result = await requireAdmin(req);
        expect(result instanceof Response).toBe(true);
        if (result instanceof Response) {
          expect(result.status).toBe(401);
        }
      } finally {
        envRecord.NODE_ENV = originalEnv;
      }
    });

    it("returns 403 when authenticated as USER in API mode", async () => {
      const req = makeReq("/api/test", "GET", undefined, { cookie: normalCookie });
      const result = await requireAdmin(req);
      expect(result instanceof Response).toBe(true);
      if (result instanceof Response) {
        expect(result.status).toBe(403);
      }
    });

    it("returns authenticated user when authenticated as ADMIN in API mode", async () => {
      const req = makeReq("/api/test", "GET", undefined, { cookie: adminCookie });
      const result = await requireAdmin(req);
      expect(result instanceof Response).toBe(false);
      const user = result as { id: string; role?: string };
      expect(user.id).toBe(adminUserId);
      expect(user.role).toBe("ADMIN");
    });

    it("redirects unauthenticated users to /login in Server Component mode", async () => {
      mockRedirect.mockClear();
      vi.spyOn(serverSessionModule, "getServerSessionUser").mockResolvedValueOnce(null);

      await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
      vi.restoreAllMocks();
    });

    it("redirects non-admin users to / in Server Component mode", async () => {
      mockRedirect.mockClear();
      vi.spyOn(serverSessionModule, "getServerSessionUser").mockResolvedValueOnce({
        id: normalUserId,
        email: normalEmail,
        displayName: "Regular Adventurer",
        role: "USER",
      });

      await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/");
      expect(mockRedirect).toHaveBeenCalledWith("/");
      vi.restoreAllMocks();
    });

    it("allows ADMIN users in Server Component mode without redirect", async () => {
      mockRedirect.mockClear();
      vi.spyOn(serverSessionModule, "getServerSessionUser").mockResolvedValueOnce({
        id: adminUserId,
        email: adminEmail,
        displayName: "High Admin",
        role: "ADMIN",
      });

      const session = await requireAdmin();
      expect(mockRedirect).not.toHaveBeenCalled();
      const user = session as { id: string; role?: string };
      expect(user.id).toBe(adminUserId);
      expect(user.role).toBe("ADMIN");
      vi.restoreAllMocks();
    });
  });
});
