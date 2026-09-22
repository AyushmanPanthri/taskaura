// ============================================================
// TaskAura — Local PostgreSQL (port 5432) Complete Auth Verification
// Validates:
//   1. REGISTER (valid, duplicate, invalid email, weak password, mismatch)
//   2. LOGIN (correct, incorrect password, nonexistent email, empty fields)
//   3. GUEST (account creation, session creation, unique per guest)
//   4. SESSION (auth/unauth request, expiry, logout, HttpOnly cookie)
//   5. DATABASE (connection, users table, sessions table, FK cascade)
//   6. SECURITY (no plaintext in DB, hash not leaked, no SQL injection)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { POST as loginRoute } from "../app/api/v1/auth/login/route";
import { POST as guestRoute } from "../app/api/v1/auth/guest/route";
import { POST as logoutRoute } from "../app/api/v1/auth/logout/route";
import { GET as meRoute } from "../app/api/v1/auth/me/route";
import { GET as sessionRoute } from "../app/api/auth/session/route";
import { GET as dbHealthRoute } from "../app/api/health/db/route";
import { extractTokenFromCookie, SESSION_COOKIE_NAME, validateSession } from "../lib/auth/session";

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

describe("TaskAura — PostgreSQL (port 5432) Authentication & Security Suite", () => {
  const testEmail = "hero.auth.test@taskaura.local";
  const testPassword = "ValidPassword2026!";
  const testName = "Hero Tester";

  beforeAll(async () => {
    // Clean up test user if previously left over
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
    }
    // Clean up created test guests
    await prisma.user.deleteMany({
      where: {
        isGuest: true,
        displayName: "Guest",
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    await prisma.$disconnect();
  });

  // ════════════════════════════════════════════════════════════
  // 1. DATABASE CONNECTIVITY & HEALTH
  // ════════════════════════════════════════════════════════════
  describe("1. Database Connection & Schema", () => {
    it("connects to local PostgreSQL on port 5432 and passes health check", async () => {
      const res = await dbHealthRoute();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("connected");
      expect(json.database).toBe("PostgreSQL");
    });

    it("verifies users and sessions table presence and FK cascade relationship", async () => {
      // Create a temporary user with a session
      const tempUser = await prisma.user.create({
        data: {
          email: "temp.fk.cascade@taskaura.local",
          displayName: "Temp FK",
          isGuest: false,
        },
      });

      const tempSession = await prisma.session.create({
        data: {
          userId: tempUser.id,
          token: "temp_fk_token_" + Date.now(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      // Verify session exists
      const foundSession = await prisma.session.findUnique({
        where: { id: tempSession.id },
      });
      expect(foundSession).not.toBeNull();
      expect(foundSession?.userId).toBe(tempUser.id);

      // Delete user -> ON DELETE CASCADE should delete session
      await prisma.user.delete({ where: { id: tempUser.id } });

      const sessionAfterUserDeleted = await prisma.session.findUnique({
        where: { id: tempSession.id },
      });
      expect(sessionAfterUserDeleted).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════
  // 2. REGISTRATION
  // ════════════════════════════════════════════════════════════
  describe("2. Register Flow", () => {
    it("valid registration: hashes password, stores in users table, sets session cookie", async () => {
      const req = makeReq("/api/v1/auth/register", "POST", {
        name: testName,
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
      });

      const res = await registerRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe(testEmail);
      expect(json.data.user.name).toBe(testName);
      expect(json.data.user.displayName).toBe(testName);
      expect(json.data.user.isGuest).toBe(false);
      // Security: never return passwordHash
      expect(json.data.user.passwordHash).toBeUndefined();

      // Cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");

      // Verify DB row
      const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.passwordHash).toMatch(/^\$2[ab]\$/);
      expect(dbUser?.passwordHash).not.toBe(testPassword);
    });

    it("duplicate email: returns 409 CONFLICT", async () => {
      const req = makeReq("/api/v1/auth/register", "POST", {
        name: testName,
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
      });

      const res = await registerRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("CONFLICT");
    });

    it("invalid email: returns 400 INVALID_INPUT", async () => {
      const req = makeReq("/api/v1/auth/register", "POST", {
        name: "Test",
        email: "not-an-email",
        password: testPassword,
        confirmPassword: testPassword,
      });

      const res = await registerRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_INPUT");
    });

    it("weak password (< 6 chars): returns 400 INVALID_INPUT", async () => {
      const req = makeReq("/api/v1/auth/register", "POST", {
        name: "Test",
        email: "weakpass@test.com",
        password: "123",
        confirmPassword: "123",
      });

      const res = await registerRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain("6 characters");
    });

    it("password mismatch: returns 400 INVALID_INPUT", async () => {
      const req = makeReq("/api/v1/auth/register", "POST", {
        name: "Test",
        email: "mismatch@test.com",
        password: "Password123!",
        confirmPassword: "DifferentPassword123!",
      });

      const res = await registerRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain("Passwords do not match");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 3. LOGIN
  // ════════════════════════════════════════════════════════════
  describe("3. Login Flow", () => {
    it("correct credentials: creates session, sets HTTP-only cookie, returns safe user", async () => {
      const req = makeReq("/api/v1/auth/login", "POST", {
        email: testEmail,
        password: testPassword,
      });

      const res = await loginRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe(testEmail);
      expect(json.data.user.displayName).toBe(testName);
      expect(json.data.user.passwordHash).toBeUndefined();

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain("HttpOnly");

      const token = extractTokenFromCookie(setCookie);
      const session = await prisma.session.findUnique({ where: { token: token! } });
      expect(session).not.toBeNull();
      expect(session?.userId).toBe(json.data.user.id);
    });

    it("incorrect password: returns generic 401 INVALID_CREDENTIALS", async () => {
      const req = makeReq("/api/v1/auth/login", "POST", {
        email: testEmail,
        password: "wrongPassword!",
      });

      const res = await loginRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("nonexistent email: returns generic 401 and does NOT leak existence", async () => {
      const req = makeReq("/api/v1/auth/login", "POST", {
        email: "nonexistent.random.user.999@test.com",
        password: "somePassword123!",
      });

      const res = await loginRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      // Same generic message as wrong password
      expect(json.error.code).toBe("INVALID_CREDENTIALS");
      expect(json.error.message).toBe("Invalid email or password");
    });

    it("empty fields: returns 400 INVALID_INPUT", async () => {
      const req = makeReq("/api/v1/auth/login", "POST", {
        email: "",
        password: "",
      });

      const res = await loginRoute(req as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_INPUT");
    });
  });

  // ════════════════════════════════════════════════════════════
  // 4. GUEST LOGIN
  // ════════════════════════════════════════════════════════════
  describe("4. Guest Login Flow", () => {
    it("creates unique guest user in PostgreSQL with name='Guest', email=null, is_guest=true", async () => {
      // Guest 1
      const req1 = makeReq("/api/v1/auth/guest", "POST");
      const res1 = await guestRoute(req1 as unknown as import("next/server").NextRequest);
      expect(res1.status).toBe(201);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.data.user.displayName).toBe("Guest");
      expect(json1.data.user.email).toBeNull();
      expect(json1.data.user.isGuest).toBe(true);
      expect(json1.data.user.id).toBeDefined();

      // Guest 2 (must be distinct, NOT shared account)
      const req2 = makeReq("/api/v1/auth/guest", "POST");
      const res2 = await guestRoute(req2 as unknown as import("next/server").NextRequest);
      expect(res2.status).toBe(201);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.data.user.id).not.toBe(json1.data.user.id);

      // Verify guest 1 session in DB
      const cookie1 = res1.headers.get("set-cookie")!;
      const token1 = extractTokenFromCookie(cookie1)!;
      const dbSession = await prisma.session.findUnique({ where: { token: token1 } });
      expect(dbSession?.userId).toBe(json1.data.user.id);

      // Verify guest user can authenticate /api/auth/session
      const sessionReq = makeReq("/api/auth/session", "GET", undefined, { cookie: cookie1 });
      const sessionRes = await sessionRoute(sessionReq as unknown as import("next/server").NextRequest);
      const sessionJson = await sessionRes.json();
      expect(sessionJson.data.authenticated).toBe(true);
      expect(sessionJson.data.user.id).toBe(json1.data.user.id);
      expect(sessionJson.data.user.isGuest).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 5. SESSION MANAGEMENT & LOGOUT
  // ════════════════════════════════════════════════════════════
  describe("5. Session Management & Expiration", () => {
    it("authenticates requests with valid session cookie", async () => {
      const loginRes = await loginRoute(
        makeReq("/api/v1/auth/login", "POST", {
          email: testEmail,
          password: testPassword,
        }) as unknown as import("next/server").NextRequest
      );
      const cookie = loginRes.headers.get("set-cookie")!;

      const meReq = makeReq("/api/v1/auth/me", "GET", undefined, { cookie });
      const meRes = await meRoute(meReq as unknown as import("next/server").NextRequest);
      expect(meRes.status).toBe(200);
      const meJson = await meRes.json();
      expect(meJson.data.user.email).toBe(testEmail);
    });

    it("unauthenticated request: returns 401 without cookie", async () => {
      const meReq = makeReq("/api/v1/auth/me", "GET");
      const meRes = await meRoute(meReq as unknown as import("next/server").NextRequest);
      expect(meRes.status).toBe(401);
    });

    it("expired session: automatically cleans up and returns null", async () => {
      // Create a user and an already expired session directly in PostgreSQL
      const user = await prisma.user.findUnique({ where: { email: testEmail } });
      const expiredToken = "expired_token_test_" + Date.now();
      await prisma.session.create({
        data: {
          userId: user!.id,
          token: expiredToken,
          expiresAt: new Date(Date.now() - 10_000), // 10 seconds ago
        },
      });

      // validateSession on expired token
      const sessionUser = await validateSession(expiredToken);
      expect(sessionUser).toBeNull();

      // Session row should have been deleted from DB
      const dbRow = await prisma.session.findUnique({ where: { token: expiredToken } });
      expect(dbRow).toBeNull();
    });

    it("logout: deletes session row and clears cookie", async () => {
      const loginRes = await loginRoute(
        makeReq("/api/v1/auth/login", "POST", {
          email: testEmail,
          password: testPassword,
        }) as unknown as import("next/server").NextRequest
      );
      const cookie = loginRes.headers.get("set-cookie")!;
      const token = extractTokenFromCookie(cookie)!;

      // Verify session exists in DB
      let dbSession = await prisma.session.findUnique({ where: { token } });
      expect(dbSession).not.toBeNull();

      // Perform logout
      const logoutRes = await logoutRoute(
        makeReq("/api/v1/auth/logout", "POST", undefined, { cookie }) as unknown as import("next/server").NextRequest
      );
      expect(logoutRes.status).toBe(200);
      const clearCookie = logoutRes.headers.get("set-cookie")!;
      expect(clearCookie).toContain("Max-Age=0");

      // Verify deleted from PostgreSQL
      dbSession = await prisma.session.findUnique({ where: { token } });
      expect(dbSession).toBeNull();

      // Accessing /api/v1/auth/me with revoked token returns 401
      const meRes = await meRoute(
        makeReq("/api/v1/auth/me", "GET", undefined, { cookie }) as unknown as import("next/server").NextRequest
      );
      expect(meRes.status).toBe(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // 6. SECURITY & INVARIANTS
  // ════════════════════════════════════════════════════════════
  describe("6. Security Invariants", () => {
    it("SQL injection strings are safely handled and fail gracefully", async () => {
      const sqlInjectionInputs = [
        "' OR '1'='1",
        "admin'--",
        "'; DROP TABLE users; --",
      ];

      for (const payload of sqlInjectionInputs) {
        const req = makeReq("/api/v1/auth/login", "POST", {
          email: payload,
          password: "password",
        });
        const res = await loginRoute(req as unknown as import("next/server").NextRequest);
        expect(res.status).toBe(401);
      }

      // Verify users table is completely intact
      const count = await prisma.user.count();
      expect(count).toBeGreaterThan(0);
    });

    it("password_hash is never exposed in login, register, me, or session APIs", async () => {
      // Login
      const loginRes = await loginRoute(
        makeReq("/api/v1/auth/login", "POST", {
          email: testEmail,
          password: testPassword,
        }) as unknown as import("next/server").NextRequest
      );
      const loginJson = await loginRes.json();
      expect(loginJson.data.user.passwordHash).toBeUndefined();
      expect(loginJson.data.user.password_hash).toBeUndefined();

      const cookie = loginRes.headers.get("set-cookie")!;

      // Me
      const meRes = await meRoute(
        makeReq("/api/v1/auth/me", "GET", undefined, { cookie }) as unknown as import("next/server").NextRequest
      );
      const meJson = await meRes.json();
      expect(meJson.data.user.passwordHash).toBeUndefined();
      expect(meJson.data.user.password_hash).toBeUndefined();

      // Session
      const sessionRes = await sessionRoute(
        makeReq("/api/auth/session", "GET", undefined, { cookie }) as unknown as import("next/server").NextRequest
      );
      const sessionJson = await sessionRes.json();
      expect(sessionJson.data.user.passwordHash).toBeUndefined();
      expect(sessionJson.data.user.password_hash).toBeUndefined();
    });
  });
});
