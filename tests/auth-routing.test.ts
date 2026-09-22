// ============================================================
// TaskAura — Auth Routing Gate Tests
//
// Tests the authentication routing invariants required by the
// spec. Because Next.js Server Component layouts cannot be
// directly invoked in vitest (they are not importable as
// route handlers), we test the invariants at two levels:
//
// Level 1 — Gate logic unit tests:
//   Direct calls to getServerSessionUser() / validateSession()
//   with mocked cookie state.
//
// Level 2 — Protected API endpoint tests:
//   Verify that each protected API returns 401 when called
//   without a valid session, and 200 with one. This confirms
//   the auth gate at the API level, which is the underlying
//   mechanism the layout gate also uses.
//
// Scenarios:
//   1. GET /login without session → login page renders (not redirected)
//      Verified by: validateSession(null/empty) returns null (gate skips /login)
//   2. GET /login with valid session → redirect /
//      Verified by: validateSession returns a user (layout.tsx redirects)
//   3. GET / without session → protected API returns 401
//   4. GET /tasks without session → tasks API returns 401
//   5. GET /habits without session → habits API returns 401
//   6. GET /focus without session → focus sessions API returns 401
//   7. GET /leaderboard without session → leaderboard API returns 401
//   8. Expired session → redirect /login (validateSession returns null)
//   9. Revoked session (DB row deleted) → redirect /login (401 on APIs)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { POST as loginRoute } from "../app/api/v1/auth/login/route";
import { GET as dashboardRoute } from "../app/api/v1/dashboard/route";
import { GET as tasksRoute } from "../app/api/v1/tasks/route";
import { GET as habitsRoute } from "../app/api/v1/habits/route";
import { GET as focusRoute } from "../app/api/v1/focus/sessions/route";
import { GET as leaderboardRoute } from "../app/api/v1/leaderboard/route";
import {
  validateSession,
  createSession,
  extractTokenFromCookie,
  SESSION_COOKIE_NAME,
} from "../lib/auth/session";
import type { NextRequest } from "next/server";

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  headers?: Record<string, string>
): NextRequest {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, init) as unknown as NextRequest;
}

describe("Auth Routing Gate — redirect invariants", () => {
  const testEmail = "routing.gate@taskaura.test";
  const testPassword = "RoutingGate2026!";
  const testName = "Routing Tester";
  let testUserId: string;
  let validCookie: string;
  let validToken: string;

  beforeAll(async () => {
    // Clean up any leftover state
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }

    // Register a fresh test user
    const regRes = await registerRoute(
      makeReq("/api/v1/auth/register", "POST", {
        email: testEmail,
        password: testPassword,
        displayName: testName,
        timezone: "UTC",
      })
    );
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();
    testUserId = regJson.data.user.id;
    validCookie = regRes.headers.get("set-cookie")!;
    validToken = extractTokenFromCookie(validCookie)!;
  });

  afterAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email: testEmail } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
    await prisma.$disconnect();
  });

  // ── SCENARIO 1: /login without session renders (not redirected) ──
  //
  // The layout at app/login/layout.tsx calls getServerSessionUser().
  // With no cookie, validateSession(token) returns null → no redirect.
  // We verify this by calling validateSession with no/empty token.
  it("1. /login without session: validateSession returns null → login renders", async () => {
    // No cookie at all
    const resultNoCookie = await validateSession("");
    expect(resultNoCookie).toBeNull();

    // A random token that does not exist in the DB
    const resultFakeToken = await validateSession("deadbeefdeadbeef");
    expect(resultFakeToken).toBeNull();

    // Confirms: the (protected) gate would NOT run for /login (it's
    // outside the route group), and login/layout.tsx sees null →
    // does NOT redirect → login page renders.
  });

  // ── SCENARIO 2: /login with valid session → redirect / ──────────
  //
  // app/login/layout.tsx: if sessionUser is truthy → redirect("/").
  // We verify by confirming validateSession returns a user for the
  // valid token created in beforeAll.
  it("2. /login with valid session: validateSession returns user → layout redirects to /", async () => {
    const sessionUser = await validateSession(validToken);
    expect(sessionUser).not.toBeNull();
    expect(sessionUser!.id).toBe(testUserId);
    expect(sessionUser!.email).toBe(testEmail);
    // Confirms: login/layout.tsx would call redirect("/") for this user.
  });

  // ── SCENARIOS 3–7: Protected routes reject unauthenticated requests ──
  //
  // In test mode, getAuthenticatedUser() falls back to the demo user
  // when no cookie is provided (allowDevHeader is true). To verify the
  // production rejection behaviour we must simulate production mode,
  // exactly as the existing spoofing test does.
  //
  // In production (NODE_ENV=production, allowDevHeader=false):
  //   no cookie → no session token → validateSession skipped → return null → 401
  //
  // The (protected) layout does the same check (getServerSessionUser →
  // validateSession → null → redirect("/login")). The API 401 is the
  // testable proxy for that redirect.

  it("3. GET /api/v1/dashboard (backs /) without session → 401", async () => {
    const env = process.env as Record<string, string | undefined>;
    const orig = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const res = await dashboardRoute(makeReq("/api/v1/dashboard", "GET"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    } finally {
      env.NODE_ENV = orig;
    }
  });

  it("4. GET /api/v1/tasks (backs /tasks) without session → 401", async () => {
    const env = process.env as Record<string, string | undefined>;
    const orig = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const res = await tasksRoute(makeReq("/api/v1/tasks", "GET"));
      expect(res.status).toBe(401);
    } finally {
      env.NODE_ENV = orig;
    }
  });

  it("5. GET /api/v1/habits (backs /habits) without session → 401", async () => {
    const env = process.env as Record<string, string | undefined>;
    const orig = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const res = await habitsRoute(makeReq("/api/v1/habits", "GET"));
      expect(res.status).toBe(401);
    } finally {
      env.NODE_ENV = orig;
    }
  });

  it("6. GET /api/v1/focus/sessions (backs /focus) without session → 401", async () => {
    const env = process.env as Record<string, string | undefined>;
    const orig = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const res = await focusRoute(makeReq("/api/v1/focus/sessions", "GET"));
      expect(res.status).toBe(401);
    } finally {
      env.NODE_ENV = orig;
    }
  });

  it("7. GET /api/v1/leaderboard (backs /leaderboard) without session → 401", async () => {
    const env = process.env as Record<string, string | undefined>;
    const orig = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const res = await leaderboardRoute(makeReq("/api/v1/leaderboard", "GET"));
      expect(res.status).toBe(401);
    } finally {
      env.NODE_ENV = orig;
    }
  });

  // ── SCENARIO 8: Expired session → validateSession returns null ───
  //
  // Create a session with expiresAt in the past, then call
  // validateSession. It must return null (expired row is deleted).
  it("8. Expired session: validateSession returns null → protected layout redirects to /login", async () => {
    // Create a session that is already expired
    const expiredToken = await prisma.session.create({
      data: {
        userId: testUserId,
        token: "expired-test-token-routing-" + Date.now(),
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      },
    });

    const result = await validateSession(expiredToken.token);
    expect(result).toBeNull(); // expired → null → redirect to /login

    // The row should have been cleaned up by validateSession
    const dbRow = await prisma.session.findUnique({ where: { token: expiredToken.token } });
    expect(dbRow).toBeNull();
  });

  // ── SCENARIO 9: Revoked session (DB row deleted) → null ─────────
  //
  // Create a valid session, confirm it validates, then delete the row
  // from PostgreSQL (simulating logout-from-another-device). The same
  // token must then return null — cookie presence alone is not enough.
  it("9. Revoked session (DB row deleted while cookie persists): validateSession returns null → redirect to /login", async () => {
    // Create a fresh session for this user
    const { token } = await createSession(testUserId);

    // 1. Confirm it validates right now
    const before = await validateSession(token);
    expect(before).not.toBeNull();
    expect(before!.id).toBe(testUserId);

    // 2. Delete the session row (simulates remote logout / admin revoke)
    const deleted = await prisma.session.deleteMany({ where: { token } });
    expect(deleted.count).toBe(1);

    // 3. Confirm the row is gone
    const dbRow = await prisma.session.findUnique({ where: { token } });
    expect(dbRow).toBeNull();

    // 4. validateSession with the same token → null (row is gone)
    const after = await validateSession(token);
    expect(after).toBeNull();
    // Confirms: (protected)/layout.tsx would redirect to /login

    // 5. Also verify the API-level rejection with a stale cookie header
    const staleCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly`;
    const apiRes = await dashboardRoute(
      makeReq("/api/v1/dashboard", "GET", undefined, { cookie: staleCookie })
    );
    expect(apiRes.status).toBe(401);
  });

  // ── BONUS: Authenticated access to protected endpoints succeeds ──
  it("authenticated requests to all protected APIs succeed (200)", async () => {
    // Re-login to get a fresh session (beforeAll cookie may have been
    // consumed by logout in other tests)
    const loginRes = await loginRoute(
      makeReq("/api/v1/auth/login", "POST", {
        email: testEmail,
        password: testPassword,
      })
    );
    expect(loginRes.status).toBe(200);
    const freshCookie = loginRes.headers.get("set-cookie")!;

    const [dash, tasks, habits, focus, lb] = await Promise.all([
      dashboardRoute(makeReq("/api/v1/dashboard", "GET", undefined, { cookie: freshCookie })),
      tasksRoute(makeReq("/api/v1/tasks", "GET", undefined, { cookie: freshCookie })),
      habitsRoute(makeReq("/api/v1/habits", "GET", undefined, { cookie: freshCookie })),
      focusRoute(makeReq("/api/v1/focus/sessions", "GET", undefined, { cookie: freshCookie })),
      leaderboardRoute(makeReq("/api/v1/leaderboard", "GET", undefined, { cookie: freshCookie })),
    ]);

    expect(dash.status).toBe(200);
    expect(tasks.status).toBe(200);
    expect(habits.status).toBe(200);
    expect(focus.status).toBe(200);
    expect(lb.status).toBe(200);
  });
});
