// ============================================================
// Task Aura — Phase D: Production Authentication Suite (§6 & §8)
// Tests:
//   - Registration with bcrypt password hashing
//   - Login & credential verification
//   - HTTP-only session cookie generation & validation
//   - Password hash never exposed in API responses
//   - Strict rejection of header spoofing (x-user-id) in production mode
//   - Logout session invalidation
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { POST as loginRoute } from "../app/api/v1/auth/login/route";
import { POST as logoutRoute } from "../app/api/v1/auth/logout/route";
import { GET as meRoute } from "../app/api/v1/auth/me/route";
import { extractTokenFromCookie, SESSION_COOKIE_NAME } from "../lib/auth/session";

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

describe("Phase D — Production Authentication & Session Security", () => {
  const testEmail = "sirius.black@taskaura.test";
  const testPassword = "superSecretPassword123!";
  const testName = "Sirius Black";

  beforeAll(async () => {
    // Clean up test user
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
    await prisma.$disconnect();
  });

  // ── REGISTRATION & PASSWORD HASHING ──────────────────────────
  it("registers user with bcrypt hash, sets HTTP-only cookie, and NEVER returns password hash", async () => {
    const req = makeReq("/api/v1/auth/register", "POST", {
      email: testEmail,
      password: testPassword,
      displayName: testName,
      timezone: "America/New_York",
    });

    const res = await registerRoute(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.user.email).toBe(testEmail);
    expect(json.data.user.displayName).toBe(testName);
    // Security check: passwordHash MUST NOT be exposed
    expect(json.data.user.passwordHash).toBeUndefined();

    // Verify Set-Cookie header is set
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // Verify stored in PostgreSQL with bcrypt hash (starts with $2b$ or $2a$)
    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUser).toBeDefined();
    expect(dbUser?.passwordHash).toMatch(/^\$2[ab]\$/);
    expect(dbUser?.passwordHash).not.toBe(testPassword);
  });

  // ── LOGIN & CREDENTIAL VERIFICATION ──────────────────────────
  it("rejects login with incorrect password and accepts correct credentials", async () => {
    // 1. Wrong password
    const badReq = makeReq("/api/v1/auth/login", "POST", {
      email: testEmail,
      password: "wrongPassword999",
    });
    const badRes = await loginRoute(badReq as unknown as import("next/server").NextRequest);
    expect(badRes.status).toBe(401);
    const badJson = await badRes.json();
    expect(badJson.success).toBe(false);
    expect(badJson.error.code).toBe("INVALID_CREDENTIALS");

    // 2. Correct password
    const goodReq = makeReq("/api/v1/auth/login", "POST", {
      email: testEmail,
      password: testPassword,
    });
    const goodRes = await loginRoute(goodReq as unknown as import("next/server").NextRequest);
    expect(goodRes.status).toBe(200);

    const goodJson = await goodRes.json();
    expect(goodJson.success).toBe(true);
    expect(goodJson.data.user.email).toBe(testEmail);
    expect(goodJson.data.user.passwordHash).toBeUndefined();

    // Verify session was created in DB
    const setCookie = goodRes.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    const token = extractTokenFromCookie(setCookie);
    expect(token).toBeDefined();

    const dbSession = await prisma.session.findUnique({ where: { token: token! } });
    expect(dbSession).toBeDefined();
    expect(dbSession?.userId).toBe(goodJson.data.user.id);
  });

  // ── PROTECTED API ACCESS WITH SESSION COOKIE ─────────────────
  it("authenticates protected endpoints using HTTP-only session cookie", async () => {
    // Login to obtain cookie
    const loginRes = await loginRoute(
      makeReq("/api/v1/auth/login", "POST", {
        email: testEmail,
        password: testPassword,
      }) as unknown as import("next/server").NextRequest
    );
    const cookieHeader = loginRes.headers.get("set-cookie")!;

    // Call /api/v1/auth/me with cookie
    const meReq = makeReq("/api/v1/auth/me", "GET", undefined, {
      cookie: cookieHeader,
    });
    const meRes = await meRoute(meReq as unknown as import("next/server").NextRequest);
    expect(meRes.status).toBe(200);
    const meJson = await meRes.json();
    expect(meJson.success).toBe(true);
    expect(meJson.data.user.email).toBe(testEmail);
  });

  // ── STRICT PRODUCTION REJECTION OF HEADER SPOOFING ───────────
  it("strictly rejects x-user-id and raw Bearer headers in production mode", async () => {
    const originalEnv = process.env.NODE_ENV;
    const envRecord = process.env as Record<string, string | undefined>;
    try {
      // Simulate production runtime
      envRecord.NODE_ENV = "production";

      // Attempt to spoof User ID via x-user-id header
      const spoofReq = makeReq("/api/v1/auth/me", "GET", undefined, {
        "x-user-id": "user_demo_14d",
      });
      const spoofRes = await meRoute(spoofReq as unknown as import("next/server").NextRequest);
      expect(spoofRes.status).toBe(401);
      const spoofJson = await spoofRes.json();
      expect(spoofJson.success).toBe(false);
      expect(spoofJson.error.code).toBe("UNAUTHORIZED");

      // Attempt raw Bearer
      const bearerReq = makeReq("/api/v1/auth/me", "GET", undefined, {
        authorization: "Bearer user_demo_14d",
      });
      const bearerRes = await meRoute(bearerReq as unknown as import("next/server").NextRequest);
      expect(bearerRes.status).toBe(401);
    } finally {
      envRecord.NODE_ENV = originalEnv;
    }
  });

  // ── LOGOUT & SESSION INVALIDATION ────────────────────────────
  it("logs out, clears session cookie, and invalidates session token in DB", async () => {
    // Login to get token
    const loginRes = await loginRoute(
      makeReq("/api/v1/auth/login", "POST", {
        email: testEmail,
        password: testPassword,
      }) as unknown as import("next/server").NextRequest
    );
    const cookie = loginRes.headers.get("set-cookie")!;
    const token = extractTokenFromCookie(cookie)!;

    // Logout
    const logoutRes = await logoutRoute(
      makeReq("/api/v1/auth/logout", "POST", undefined, {
        cookie,
      }) as unknown as import("next/server").NextRequest
    );
    expect(logoutRes.status).toBe(200);
    const logoutCookie = logoutRes.headers.get("set-cookie");
    expect(logoutCookie).toContain("Max-Age=0");

    // Verify session token is removed from PostgreSQL
    const dbSession = await prisma.session.findUnique({ where: { token } });
    expect(dbSession).toBeNull();

    // Calling /api/v1/auth/me with old cookie must now return 401
    const meRes = await meRoute(
      makeReq("/api/v1/auth/me", "GET", undefined, {
        cookie,
      }) as unknown as import("next/server").NextRequest
    );
    expect(meRes.status).toBe(401);
  });
});
