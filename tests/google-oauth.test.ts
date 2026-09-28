// ============================================================
// TaskAura — Phase D.1: Google OAuth Authentication Tests
//
// Mocked Scenarios (no live Google account required):
//   1. New Google user creation
//   2. Existing Google account login
//   3. Duplicate callback/retry idempotency
//   4. Existing verified email linking & unverified rejection
//   5. Invalid provider identity rejection
//   6. Logout session revocation
//   7. Session expiration handling
//   8. Cross-user data isolation
//   9. Revoked session: cookie present + DB row deleted → 401
//      (simulates logout from another device / admin revocation)
//  9b. Identity persistence across login → logout → login cycles
//  10. Existing email/password authentication preservation
//  11. Demo-account isolation
// ============================================================


import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as callbackRoute } from "../app/api/v1/auth/callback/google/route";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { POST as loginRoute } from "../app/api/v1/auth/login/route";
import { POST as logoutRoute } from "../app/api/v1/auth/logout/route";
import { GET as meRoute } from "../app/api/v1/auth/me/route";
import { GET as progressRoute } from "../app/api/v1/progress/route";
import { GET as tasksRoute } from "../app/api/v1/tasks/route";
import { extractTokenFromCookie, SESSION_COOKIE_NAME } from "../lib/auth/session";
import { DEMO_USER_ID } from "../lib/services/demo-seed";
import type { NextRequest } from "next/server";

function makeJsonReq(url: string, method: string = "GET", body?: unknown, headers?: Record<string, string>): NextRequest {
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

describe("Phase D.1 — Google OAuth Authentication", () => {
  const googleUserA = {
    provider: "google" as const,
    providerAccountId: "google_sub_user_a_1001",
    email: "solana.sky@taskaura.test",
    name: "Solana Sky",
    email_verified: true,
  };

  const googleUserB = {
    provider: "google" as const,
    providerAccountId: "google_sub_user_b_2002",
    email: "orion.vale@taskaura.test",
    name: "Orion Vale",
    email_verified: true,
  };

  const passwordUser = {
    email: "password.user@taskaura.test",
    password: "securePassword2026!",
    displayName: "Standard Password User",
  };

  beforeAll(async () => {
    // Clean test accounts
    const emails = [
      googleUserA.email,
      googleUserB.email,
      passwordUser.email,
      "unverified.user@taskaura.test",
      "verified.linking@taskaura.test",
    ];
    const users = await prisma.user.findMany({ where: { email: { in: emails } } });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.task.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  afterAll(async () => {
    const emails = [
      googleUserA.email,
      googleUserB.email,
      passwordUser.email,
      "unverified.user@taskaura.test",
      "verified.linking@taskaura.test",
    ];
    const users = await prisma.user.findMany({ where: { email: { in: emails } } });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.task.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  // ── SCENARIO 1: New Google User Creation ─────────────────────────
  it("1. creates a new TaskAura user, Account mapping, clean baseline progression, and session cookie", async () => {
    const req = makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA });
    const res = await callbackRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.isNewUser).toBe(true);
    expect(json.data.linked).toBe(false);
    expect(json.data.user.email).toBe(googleUserA.email);
    expect(json.data.user.displayName).toBe(googleUserA.name);

    // Verify Session Cookie header
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");

    // Verify Account mapping exists in DB
    const dbAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: googleUserA.providerAccountId,
        },
      },
    });
    expect(dbAccount).toBeDefined();
    expect(dbAccount?.userId).toBe(json.data.user.id);

    // Verify clean slate: 0 XP, streak 0, no achievements, no usage history
    const userStreak = await prisma.streakRecord.findUnique({ where: { userId: json.data.user.id } });
    expect(userStreak?.currentStreak).toBe(0);

    const xpCount = await prisma.xPTransaction.count({ where: { userId: json.data.user.id } });
    expect(xpCount).toBe(0);

    const achievementCount = await prisma.userAchievement.count({ where: { userId: json.data.user.id } });
    expect(achievementCount).toBe(0);
  });

  // ── SCENARIO 2: Existing Google Account Login ─────────────────────
  it("2. resolves existing TaskAura user without creating another user record", async () => {
    const usersBefore = await prisma.user.count({ where: { email: googleUserA.email } });
    expect(usersBefore).toBe(1);

    const req = makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA });
    const res = await callbackRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.isNewUser).toBe(false);

    const usersAfter = await prisma.user.count({ where: { email: googleUserA.email } });
    expect(usersAfter).toBe(1);
  });

  // ── SCENARIO 3: Duplicate Callback / Retry ───────────────────────
  it("3. handles duplicate callback retries idempotently without duplicate Account rows", async () => {
    // Submit callback twice in rapid succession
    const [res1, res2] = await Promise.all([
      callbackRoute(makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })),
      callbackRoute(makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    const json2 = await res2.json();
    expect(json1.data.user.id).toBe(json2.data.user.id);

    // Exactly 1 Account row
    const accountCount = await prisma.account.count({
      where: {
        provider: "google",
        providerAccountId: googleUserA.providerAccountId,
      },
    });
    expect(accountCount).toBe(1);
  });

  // ── SCENARIO 4: Existing Verified Email Linking ──────────────────
  it("4. links Google account to existing verified email account and rejects unverified identities", async () => {
    // 1. Create standard email user
    const regRes = await registerRoute(
      makeJsonReq("/api/v1/auth/register", "POST", {
        email: "verified.linking@taskaura.test",
        password: "linkingPassword123!",
        displayName: "Verified Link User",
      })
    );
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();
    const existingUserId = regJson.data.user.id;

    // 2. Reject unverified email from Google (security check against account hijacking)
    const unverifiedReq = makeJsonReq("/api/v1/auth/callback/google", "POST", {
      profile: {
        provider: "google",
        providerAccountId: "google_unverified_9999",
        email: "verified.linking@taskaura.test",
        name: "Verified Link User",
        email_verified: false,
      },
    });
    const unverifiedRes = await callbackRoute(unverifiedReq);
    expect(unverifiedRes.status).toBe(403);
    const unverifiedJson = await unverifiedRes.json();
    expect(unverifiedJson.error.code).toBe("UNVERIFIED_EMAIL");

    // 3. Successfully link when email_verified is true
    const verifiedReq = makeJsonReq("/api/v1/auth/callback/google", "POST", {
      profile: {
        provider: "google",
        providerAccountId: "google_verified_9999",
        email: "verified.linking@taskaura.test",
        name: "Verified Link User",
        email_verified: true,
      },
    });
    const verifiedRes = await callbackRoute(verifiedReq);
    expect(verifiedRes.status).toBe(200);
    const verifiedJson = await verifiedRes.json();
    expect(verifiedJson.data.linked).toBe(true);
    expect(verifiedJson.data.user.id).toBe(existingUserId);

    // Cleanup
    await prisma.session.deleteMany({ where: { userId: existingUserId } });
    await prisma.account.deleteMany({ where: { userId: existingUserId } });
    await prisma.user.delete({ where: { id: existingUserId } });
  });

  // ── SCENARIO 5: Invalid Provider Identity Rejection ─────────────
  it("5. rejects malformed or invalid provider identities safely", async () => {
    // Missing providerAccountId
    const badReq1 = makeJsonReq("/api/v1/auth/callback/google", "POST", {
      profile: {
        provider: "google",
        providerAccountId: "",
        email: "valid@taskaura.test",
      },
    });
    const res1 = await callbackRoute(badReq1);
    expect(res1.status).toBe(400);

    // Invalid provider
    const badReq2 = makeJsonReq("/api/v1/auth/callback/google", "POST", {
      profile: {
        provider: "untrusted_oauth",
        providerAccountId: "id123",
        email: "valid@taskaura.test",
      },
    });
    const res2 = await callbackRoute(badReq2);
    expect(res2.status).toBe(400);

    // Malformed email
    const badReq3 = makeJsonReq("/api/v1/auth/callback/google", "POST", {
      profile: {
        provider: "google",
        providerAccountId: "id123",
        email: "not-an-email",
      },
    });
    const res3 = await callbackRoute(badReq3);
    expect(res3.status).toBe(400);
  });

  // ── SCENARIO 6: Logout Revocation ───────────────────────────────
  it("6. revokes session on logout, causing subsequent authenticated calls to fail", async () => {
    // 1. Authenticate with Google
    const authRes = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const cookie = authRes.headers.get("set-cookie")!;
    const token = extractTokenFromCookie(cookie)!;

    // Verify valid session can call /me
    const meBefore = await meRoute(makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie }));
    expect(meBefore.status).toBe(200);

    // 2. Logout
    const logoutRes = await logoutRoute(makeJsonReq("/api/v1/auth/logout", "POST", undefined, { cookie }));
    expect(logoutRes.status).toBe(200);

    // Verify session was removed from PostgreSQL
    const dbSession = await prisma.session.findUnique({ where: { token } });
    expect(dbSession).toBeNull();

    // 3. /me call must now fail with 401
    const meAfter = await meRoute(makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie }));
    expect(meAfter.status).toBe(401);
  });

  // ── SCENARIO 7: Session Expiration ──────────────────────────────
  it("7. rejects expired sessions upon accessing protected endpoints", async () => {
    // 1. Authenticate to get session
    const authRes = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const cookie = authRes.headers.get("set-cookie")!;
    const token = extractTokenFromCookie(cookie)!;

    // 2. Manually expire session in DB
    await prisma.session.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 60_000) }, // 1 minute in the past
    });

    // 3. Attempt protected access
    const meRes = await meRoute(makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie }));
    expect(meRes.status).toBe(401);
  });

  // ── SCENARIO 8: Cross-User Data Isolation ───────────────────────
  it("8. enforces strict multi-user isolation between Google User A and Google User B", async () => {
    // 1. Create Google User B
    const authB = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserB })
    );
    const userBId = (await authB.json()).data.user.id;

    // Create a private task for User B
    const taskB = await prisma.task.create({
      data: {
        userId: userBId,
        title: "User B Private Research Task",
        difficulty: "HARD",
        status: "PENDING",
      },
    });

    // 2. Authenticate as Google User A
    const authA = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const cookieA = authA.headers.get("set-cookie")!;

    // User A reads tasks: must NOT see User B's task
    const tasksRes = await tasksRoute(makeJsonReq("/api/v1/tasks", "GET", undefined, { cookie: cookieA }));
    expect(tasksRes.status).toBe(200);
    const tasksJson = await tasksRes.json();
    const taskIds = tasksJson.data.map((t: { id: string }) => t.id);
    expect(taskIds).not.toContain(taskB.id);

    // Cleanup task
    await prisma.task.delete({ where: { id: taskB.id } });
  });

  // ── SCENARIO 9: Revoked Session (Cookie Present, DB Row Deleted) ─
  //
  // This test is DISTINCT from the expiry test (Scenario 7).
  // Scenario 7 manipulates the `expiresAt` timestamp in DB.
  // Scenario 9 deletes the session row entirely from PostgreSQL
  // (simulating logout from another device / admin revocation)
  // while the original cookie remains valid-looking client-side.
  //
  // Invariant under test:
  //   cookie present + DB session row deleted = unauthenticated (401)
  //
  // The mere presence of the `taskaura_session` cookie MUST NOT be
  // treated as proof of authentication.
  it("9. revoked session: cookie still present + DB row deleted → unauthenticated (401)", async () => {
    // 1. Authenticate to get a session token & cookie
    const authRes = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    expect(authRes.status).toBe(200);

    const setCookieHeader = authRes.headers.get("set-cookie")!;
    const token = extractTokenFromCookie(setCookieHeader)!;
    expect(token).toBeTruthy();

    // 2. Verify the session is valid — the cookie works RIGHT NOW
    const meBefore = await meRoute(
      makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie: setCookieHeader })
    );
    expect(meBefore.status).toBe(200);

    // 3. Simulate revocation from another device:
    //    Delete the session row directly from PostgreSQL.
    //    The client cookie still exists and still contains the token —
    //    the client has no knowledge that this row was deleted.
    const deletedCount = await prisma.session.deleteMany({ where: { token } });
    expect(deletedCount.count).toBe(1); // exactly 1 row was deleted

    // Confirm the row is truly gone from the database
    const dbRow = await prisma.session.findUnique({ where: { token } });
    expect(dbRow).toBeNull(); // DB row is gone

    // 4. Attempt to access a protected endpoint using the SAME, STILL-PRESENT cookie.
    //    The session token exists in the cookie header — but the DB row is gone.
    //    This MUST be rejected as unauthenticated.
    const meAfter = await meRoute(
      makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie: setCookieHeader })
    );
    expect(meAfter.status).toBe(401);
    const meJson = await meAfter.json();
    expect(meJson.success).toBe(false);
    expect(meJson.error.code).toBe("UNAUTHORIZED");

    // 5. Also confirm the progress API rejects the stale cookie
    const progressAfter = await progressRoute(
      makeJsonReq("/api/v1/progress", "GET", undefined, { cookie: setCookieHeader })
    );
    expect(progressAfter.status).toBe(401);
  });

  // ── SCENARIO 9b: Identity Persistence Across Login/Logout Cycles ─
  it("9b. persists the same TaskAura User identity across login → logout → login cycles", async () => {
    // Cycle 1: Login
    const res1 = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const cookie1 = res1.headers.get("set-cookie")!;
    const user1Id = (await res1.json()).data.user.id;

    // Logout (deletes the session row)
    await logoutRoute(makeJsonReq("/api/v1/auth/logout", "POST", undefined, { cookie: cookie1 }));

    // Cycle 2: Login again with the same Google identity
    const res2 = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const user2Id = (await res2.json()).data.user.id;

    // The same TaskAura User row must be resolved — not a new one
    expect(user1Id).toBe(user2Id);
  });


  // ── SCENARIO 10: Existing Email/Password Authentication ─────────
  it("10. verifies email/password registration and login continue working seamlessly alongside OAuth", async () => {
    // 1. Register with email/password
    const regRes = await registerRoute(
      makeJsonReq("/api/v1/auth/register", "POST", passwordUser)
    );
    expect(regRes.status).toBe(201);
    const regJson = await regRes.json();
    expect(regJson.data.user.email).toBe(passwordUser.email);

    // 2. Login with password
    const loginRes = await loginRoute(
      makeJsonReq("/api/v1/auth/login", "POST", {
        email: passwordUser.email,
        password: passwordUser.password,
      })
    );
    expect(loginRes.status).toBe(200);
    const passwordCookie = loginRes.headers.get("set-cookie")!;

    // 3. Access protected route
    const meRes = await meRoute(
      makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie: passwordCookie })
    );
    expect(meRes.status).toBe(200);
    const meJson = await meRes.json();
    expect(meJson.data.user.email).toBe(passwordUser.email);
  });

  // ── SCENARIO 11: Demo-Account Isolation ─────────────────────────
  it("11. verifies a newly created Google account cannot access seeded demo-user data", async () => {
    const authRes = await callbackRoute(
      makeJsonReq("/api/v1/auth/callback/google", "POST", { profile: googleUserA })
    );
    const cookie = authRes.headers.get("set-cookie")!;
    const googleUserId = (await authRes.json()).data.user.id;

    // Google user ID is completely distinct from Demo User ID
    expect(googleUserId).not.toBe(DEMO_USER_ID);

    // Call /me: verify identity is the Google user, NOT the seeded demo profile
    const meRes = await meRoute(makeJsonReq("/api/v1/auth/me", "GET", undefined, { cookie }));
    const meJson = await meRes.json();
    expect(meJson.data.user.id).toBe(googleUserId);
    expect(meJson.data.user.email).toBe(googleUserA.email);
    expect(meJson.data.user.email).not.toBe("demo@taskaura.dev");
    expect(meJson.data.user.streakRecord.currentStreak).toBe(0);

    // Progression is clean: Level 1, 0 XP, streak 0 (NOT Level 18 / 20,580 XP)
    const progRes = await progressRoute(makeJsonReq("/api/v1/progress", "GET", undefined, { cookie }));
    const progJson = await progRes.json();
    expect(progJson.data.level).toBe(1);
    expect(progJson.data.totalXp).toBe(0);
    expect(progJson.data.streak.current).toBe(0);
  });
});
