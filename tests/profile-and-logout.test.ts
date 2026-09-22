// ============================================================
// TaskAura — Logout & User Profile Test Suite
// Verifies:
//   1. Logout clears session and subsequent requests are 401
//   2. Profile endpoint requires authentication
//   3. User can update their own display name & avatar
//   4. Multi-user isolation: User cannot update another user's name by passing a different userId
//   5. Guest user can access and edit their own profile
//   6. Attempting to update email, password, or isGuest via profile is strictly blocked
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { POST as registerRoute } from "../app/api/v1/auth/register/route";
import { POST as loginRoute } from "../app/api/v1/auth/login/route";
import { POST as logoutRoute } from "../app/api/v1/auth/logout/route";
import { POST as guestRoute } from "../app/api/v1/auth/guest/route";
import { GET as getProfileRoute, PATCH as patchProfileRoute } from "../app/api/v1/user/profile/route";
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

describe("TaskAura — Logout Button & User Profile Suite", () => {
  const userAEmail = "profile.user.a@taskaura.test";
  const userBEmail = "profile.user.b@taskaura.test";
  const defaultPassword = "ProfilePassword123!";

  let userACookie: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    // Clean up test users
    await prisma.user.deleteMany({
      where: { email: { in: [userAEmail, userBEmail] } },
    });

    // 1. Register User A
    const regARes = await registerRoute(
      makeReq("/api/v1/auth/register", "POST", {
        name: "User Alpha",
        email: userAEmail,
        password: defaultPassword,
        confirmPassword: defaultPassword,
      }) as unknown as import("next/server").NextRequest
    );
    const regAJson = await regARes.json();
    userAId = regAJson.data.user.id;
    userACookie = regARes.headers.get("set-cookie")!;

    // 2. Register User B
    const regBRes = await registerRoute(
      makeReq("/api/v1/auth/register", "POST", {
        name: "User Beta",
        email: userBEmail,
        password: defaultPassword,
        confirmPassword: defaultPassword,
      }) as unknown as import("next/server").NextRequest
    );
    const regBJson = await regBRes.json();
    userBId = regBJson.data.user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [userAEmail, userBEmail] } },
    });
    // Clean up created test guests
    await prisma.user.deleteMany({
      where: {
        isGuest: true,
        displayName: { in: ["Guest", "Guest Shadowblade"] },
        createdAt: { gte: new Date(Date.now() - 120_000) },
      },
    });
    await prisma.$disconnect();
  });

  // ── 1. PROFILE REQUIRES AUTH ─────────────────────────────────
  it("profile endpoints require authentication (rejects unauthenticated requests with 401)", async () => {
    const unauthGetReq = makeReq("/api/v1/user/profile", "GET");
    const unauthGetRes = await getProfileRoute(unauthGetReq as unknown as import("next/server").NextRequest);
    expect(unauthGetRes.status).toBe(401);

    const unauthPatchReq = makeReq("/api/v1/user/profile", "PATCH", { displayName: "New Name" });
    const unauthPatchRes = await patchProfileRoute(unauthPatchReq as unknown as import("next/server").NextRequest);
    expect(unauthPatchRes.status).toBe(401);
  });

  // ── 2. USER CAN VIEW OWN PROFILE ─────────────────────────────
  it("a user can view their own profile data (name, email, avatar, guest status)", async () => {
    const req = makeReq("/api/v1/user/profile", "GET", undefined, { cookie: userACookie });
    const res = await getProfileRoute(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.user.id).toBe(userAId);
    expect(json.data.user.displayName).toBe("User Alpha");
    expect(json.data.user.email).toBe(userAEmail);
    expect(json.data.user.isGuest).toBe(false);
    expect(json.data.user.avatar).toBeDefined();
  });

  // ── 3. USER CAN UPDATE OWN DISPLAY NAME & AVATAR ─────────────
  it("a user can update their own display name and preset avatar", async () => {
    const req = makeReq("/api/v1/user/profile", "PATCH", {
      displayName: "Grand Technomancer",
      avatar: "⚡",
    }, { cookie: userACookie });

    const res = await patchProfileRoute(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.user.displayName).toBe("Grand Technomancer");
    expect(json.data.user.avatar).toBe("⚡");

    // Verify persistence in PostgreSQL
    const dbUser = await prisma.user.findUnique({ where: { id: userAId } });
    expect(dbUser?.displayName).toBe("Grand Technomancer");
    expect(dbUser?.avatar).toBe("⚡");
  });

  // ── 4. MULTI-USER ISOLATION ──────────────────────────────────
  it("a user CANNOT update another user's profile by passing a different userId in body", async () => {
    // User B's name before attack
    const dbUserBBefore = await prisma.user.findUnique({ where: { id: userBId } });
    expect(dbUserBBefore?.displayName).toBe("User Beta");

    // User A attempts to update User B's name by passing userId: userBId
    const exploitReq = makeReq("/api/v1/user/profile", "PATCH", {
      userId: userBId,
      displayName: "Compromised Name",
      avatar: "👑",
    }, { cookie: userACookie });

    const exploitRes = await patchProfileRoute(exploitReq as unknown as import("next/server").NextRequest);
    expect(exploitRes.status).toBe(200);

    // Verify User A was updated (because session owns User A)
    const dbUserA = await prisma.user.findUnique({ where: { id: userAId } });
    expect(dbUserA?.displayName).toBe("Compromised Name");

    // CRITICAL SECURITY INVARIANT: User B must remain 100% UNTOUCHED!
    const dbUserBAfter = await prisma.user.findUnique({ where: { id: userBId } });
    expect(dbUserBAfter?.displayName).toBe("User Beta");
    expect(dbUserBAfter?.avatar).toBe(dbUserBBefore?.avatar);
  });

  // ── 5. GUEST USER ACCESS & EDITING ───────────────────────────
  it("guest users can access and edit their own profile", async () => {
    // 1. Create a guest session
    const guestRes = await guestRoute(makeReq("/api/v1/auth/guest", "POST") as unknown as import("next/server").NextRequest);
    expect(guestRes.status).toBe(201);
    const guestCookie = guestRes.headers.get("set-cookie")!;
    const guestJson = await guestRes.json();
    const guestId = guestJson.data.user.id;

    // 2. View guest profile
    const getReq = makeReq("/api/v1/user/profile", "GET", undefined, { cookie: guestCookie });
    const getRes = await getProfileRoute(getReq as unknown as import("next/server").NextRequest);
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.data.user.id).toBe(guestId);
    expect(getJson.data.user.displayName).toBe("Guest");
    expect(getJson.data.user.email).toBeNull();
    expect(getJson.data.user.isGuest).toBe(true);

    // 3. Edit guest profile
    const editReq = makeReq("/api/v1/user/profile", "PATCH", {
      displayName: "Guest Shadowblade",
      avatar: "⚔️",
    }, { cookie: guestCookie });
    const editRes = await patchProfileRoute(editReq as unknown as import("next/server").NextRequest);
    expect(editRes.status).toBe(200);
    const editJson = await editRes.json();
    expect(editJson.data.user.displayName).toBe("Guest Shadowblade");
    expect(editJson.data.user.avatar).toBe("⚔️");

    // 4. Verify in PostgreSQL
    const dbGuest = await prisma.user.findUnique({ where: { id: guestId } });
    expect(dbGuest?.displayName).toBe("Guest Shadowblade");
    expect(dbGuest?.avatar).toBe("⚔️");
    expect(dbGuest?.isGuest).toBe(true);
  });

  // ── 6. IMMUTABILITY OF EMAIL/PASSWORD/ISGUEST ────────────────
  it("strictly disallows updating email, password, or isGuest via the profile endpoint", async () => {
    const userABefore = await prisma.user.findUnique({ where: { id: userAId } });

    const forbiddenReq = makeReq("/api/v1/user/profile", "PATCH", {
      email: "injected.new.email@evil.com",
      password: "newHackedPassword999!",
      passwordHash: "hacked_hash",
      isGuest: true,
      displayName: "Legit Update",
    }, { cookie: userACookie });

    const forbiddenRes = await patchProfileRoute(forbiddenReq as unknown as import("next/server").NextRequest);
    expect(forbiddenRes.status).toBe(200);

    const userAAfter = await prisma.user.findUnique({ where: { id: userAId } });
    // Email, passwordHash, and isGuest must be unchanged
    expect(userAAfter?.email).toBe(userABefore?.email);
    expect(userAAfter?.passwordHash).toBe(userABefore?.passwordHash);
    expect(userAAfter?.isGuest).toBe(userABefore?.isGuest);
    expect(userAAfter?.displayName).toBe("Legit Update");
  });

  // ── 7. LOGOUT CLEARS SESSION AND RENDERS SUBSEQUENT CALLS 401
  it("logout clears session in PostgreSQL and subsequent requests to /profile are 401", async () => {
    // 1. Fresh login for User B
    const loginRes = await loginRoute(
      makeReq("/api/v1/auth/login", "POST", {
        email: userBEmail,
        password: defaultPassword,
      }) as unknown as import("next/server").NextRequest
    );
    expect(loginRes.status).toBe(200);
    const userBCookie = loginRes.headers.get("set-cookie")!;
    const token = extractTokenFromCookie(userBCookie)!;

    // Verify session exists in DB
    const dbSessionBefore = await prisma.session.findUnique({ where: { token } });
    expect(dbSessionBefore).not.toBeNull();

    // Verify User B can access /profile
    const profileResBefore = await getProfileRoute(
      makeReq("/api/v1/user/profile", "GET", undefined, { cookie: userBCookie }) as unknown as import("next/server").NextRequest
    );
    expect(profileResBefore.status).toBe(200);

    // 2. Call Logout endpoint
    const logoutRes = await logoutRoute(
      makeReq("/api/v1/auth/logout", "POST", undefined, { cookie: userBCookie }) as unknown as import("next/server").NextRequest
    );
    expect(logoutRes.status).toBe(200);

    const clearCookieHeader = logoutRes.headers.get("set-cookie")!;
    expect(clearCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(clearCookieHeader).toContain("Max-Age=0");

    // 3. Verify session was revoked from PostgreSQL
    const dbSessionAfter = await prisma.session.findUnique({ where: { token } });
    expect(dbSessionAfter).toBeNull();

    // 4. Subsequent requests using that cookie MUST now be 401
    const profileResAfter = await getProfileRoute(
      makeReq("/api/v1/user/profile", "GET", undefined, { cookie: userBCookie }) as unknown as import("next/server").NextRequest
    );
    expect(profileResAfter.status).toBe(401);
  });
});
