// ============================================================
// TaskAura — Extension API + Anti-Farming Integration Tests
//
// Covers:
//   Phase 0 gap tests:
//     P0-A. selfConfirmedTasksPerDay constant value is 5 (already existed)
//     P0-B. Focus session heartbeat cap is now applied at completion
//   Phase 1 extension tests (test matrix items 6-11):
//     T6.  Extension status API returns RUNNING session for active user
//     T7.  Extension status API returns no session after session ends
//     T8.  User isolation — blocklist scoped to authenticated user only
//     T9.  No-extension user can complete focus session + earn XP normally
//     T10. Server-side session record is unaffected by extension absence
//     T11. Blocklist changes propagate immediately to status API
//
//   Additional blocklist API tests:
//     B1.  GET /extension/blocklist returns empty list for new user
//     B2.  POST /extension/blocklist adds a domain
//     B3.  Domain normalization (strips scheme, www, path)
//     B4.  Duplicate domain rejected with 409
//     B5.  Invalid domain rejected with 400
//     B6.  DELETE /extension/blocklist/:domain removes entry
//     B7.  DELETE on non-existent domain returns 404
//     B8.  Domain cap (50) enforced server-side
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/prisma";
import {
  blocklistRepository,
  normalizeDomain,
  BLOCKLIST_DOMAIN_CAP,
} from "../lib/repositories/blocklist-repository";
import { focusRepository } from "../lib/repositories/focus-repository";
import {
  GET as getExtensionStatus,
  OPTIONS as optionsExtensionStatus,
} from "../app/api/v1/extension/status/route";
import {
  GET as getBlocklist,
  POST as postBlocklist,
} from "../app/api/v1/extension/blocklist/route";
import { DELETE as deleteBlocklistDomain } from "../app/api/v1/extension/blocklist/[domain]/route";
import { POST as completeFocusRoute } from "../app/api/v1/focus/[id]/complete/route";
import { ECONOMY } from "../lib/logic/economy";
import { FocusSessionStatus } from "../lib/logic/types";

// Test users
const EXT_USER_A = "00000000-0000-0000-0000-000000000081";
const EXT_USER_B = "00000000-0000-0000-0000-000000000082";
const NO_EXT_USER = "00000000-0000-0000-0000-000000000083"; // "never installed extension"

function makeReq(
  url: string,
  method: string = "GET",
  body?: unknown,
  userId?: string,
  origin?: string
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-user-id"] = userId;
  if (origin) headers["origin"] = origin;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, init);
}

describe("Phase 0 Gap Verification", () => {
  describe("P0-A. selfConfirmedTasksPerDay constant", () => {
    it("ECONOMY.selfConfirmedTasksPerDay is 5 (documented gap — constant defined but not enforced as per-day sub-cap)", () => {
      // This test documents the spec-drift gap.
      // The actual enforced cap is ANTI_FARMING_CONFIG.dailyTasksCompletedLimit = 15.
      // This constant exists but is not read by any repository.
      expect(ECONOMY.selfConfirmedTasksPerDay).toBe(5);
    });
  });

  describe("P0-B. Focus heartbeat cap wired into completion", () => {
    it("should import shouldCapXp and calculateExpectedHeartbeats (gap fix functions are now in scope)", async () => {
      // Verify the imports added in the Phase 0 fix resolve correctly
      const { shouldCapXp, calculateExpectedHeartbeats } = await import(
        "../lib/logic/focus-engine"
      );
      expect(typeof shouldCapXp).toBe("function");
      expect(typeof calculateExpectedHeartbeats).toBe("function");

      // A session with 0 heartbeats for 30 minutes should flag as suspicious
      const expected = calculateExpectedHeartbeats(30);
      expect(expected).toBeGreaterThan(0);
      expect(shouldCapXp(0, expected, 30)).toBe(true);

      // A session with enough heartbeats should not be flagged
      expect(shouldCapXp(expected, expected, 30)).toBe(false);
    });

    it("focus session with suspicious heartbeat count has XP capped at requiredMinutes, not actualMinutes", async () => {
      // Setup: user with a focus session that claimed 60 minutes but has 0 heartbeats
      await prisma.user.upsert({
        where: { id: EXT_USER_A },
        update: {},
        create: { id: EXT_USER_A, displayName: "ExtUserA", email: "ext-a@test.dev" },
      });
      await prisma.focusSession.deleteMany({ where: { userId: EXT_USER_A } });
      await prisma.xPTransaction.deleteMany({ where: { userId: EXT_USER_A } });

      // Create a session started 62 minutes ago, requiredMinutes=25, heartbeatCount=0
      const sixtyTwoMinAgo = new Date(Date.now() - 62 * 60_000);
      const session = await prisma.focusSession.create({
        data: {
          userId: EXT_USER_A,
          clientEventId: `hb-cap-test-${Date.now()}`,
          status: FocusSessionStatus.RUNNING,
          startedAt: sixtyTwoMinAgo,
          requiredMinutes: 25,
          expectedHeartbeats: 50, // expected 50 heartbeats for ~25 min
          heartbeatCount: 0,       // zero heartbeats → suspicious
          lastHeartbeatAt: sixtyTwoMinAgo,
        },
      });

      const req = makeReq(`/api/v1/focus/${session.id}/complete`, "POST", {}, EXT_USER_A);
      const res = await completeFocusRoute(req, { params: Promise.resolve({ id: session.id }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      // XP should be awarded (session met the 25-min requirement)
      // But it should be capped to ~25 min worth of XP, not 62 min worth
      const xp = json.data.xpAwarded;
      expect(xp).toBeGreaterThanOrEqual(0);

      // A fully-credited 62-minute session would pay ~117 XP
      // A capped 25-minute session pays ~89 XP — verify we're not at the inflated value
      // (The exact cap depends on focusCreditedMinutes(25,25) = 25, computeRawXp(25) ≈ 89)
      expect(xp).toBeLessThan(117); // not full 62-minute XP
    });
  });
});

// --- Test suite setup ---
// Use fixed UUIDs that are clearly outside the demo/seed data range.
// Display names use 'Firstname L.' format to avoid contaminating the
// leaderboard privacy test that checks peer names match /^[A-Za-z]+ [A-Z]\.$/
const EXT_USERS = [EXT_USER_A, EXT_USER_B, NO_EXT_USER];

beforeEach(async () => {
  for (const userId of EXT_USERS) {
    await prisma.user.upsert({
      where: { id: userId },
      update: { displayName: "TestUser E." },
      create: { id: userId, displayName: "TestUser E.", email: `ext-test-${userId.slice(-2)}@ext-test-domain.invalid` },
    });
    await prisma.blocklistedDomain.deleteMany({ where: { userId } });
    await prisma.focusSession.deleteMany({ where: { userId } });
    await prisma.xPTransaction.deleteMany({ where: { userId } });
  }
});

afterEach(async () => {
  // Clean up test users after each test so they don't bleed into other test files
  // (especially the leaderboard privacy test in api.test.ts which checks all peer names)
  for (const userId of EXT_USERS) {
    await prisma.blocklistedDomain.deleteMany({ where: { userId } });
    await prisma.focusSession.deleteMany({ where: { userId } });
    await prisma.xPTransaction.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});

// ============================================================
// Domain Normalization Unit Tests
// ============================================================

describe("normalizeDomain()", () => {
  it("strips https:// scheme", () => expect(normalizeDomain("https://reddit.com")).toBe("reddit.com"));
  it("strips http:// scheme", () => expect(normalizeDomain("http://reddit.com")).toBe("reddit.com"));
  it("strips www. prefix", () => expect(normalizeDomain("www.reddit.com")).toBe("reddit.com"));
  it("strips scheme + www", () => expect(normalizeDomain("https://www.youtube.com")).toBe("youtube.com"));
  it("strips path", () => expect(normalizeDomain("reddit.com/r/all")).toBe("reddit.com"));
  it("strips query string", () => expect(normalizeDomain("reddit.com?q=hello")).toBe("reddit.com"));
  it("strips port -- localhost has no dot so returns null (not a blocklistable internet domain)", () => expect(normalizeDomain("localhost:3000")).toBeNull());
  it("lowercases input", () => expect(normalizeDomain("REDDIT.COM")).toBe("reddit.com"));
  it("passes bare hostname", () => expect(normalizeDomain("reddit.com")).toBe("reddit.com"));
  it("returns null for no-dot domain", () => expect(normalizeDomain("localhost")).toBeNull());
  it("returns null for empty string", () => expect(normalizeDomain("")).toBeNull());
  it("returns null for domain with spaces", () => expect(normalizeDomain("red dit.com")).toBeNull());
});

// ============================================================
// Blocklist Repository Tests
// ============================================================

describe("blocklistRepository", () => {
  it("B1. listDomains returns empty array for new user", async () => {
    const domains = await blocklistRepository.listDomains(EXT_USER_A);
    expect(domains).toHaveLength(0);
  });

  it("B2. addDomain stores normalized domain", async () => {
    const result = await blocklistRepository.addDomain(EXT_USER_A, "https://www.Reddit.COM/r/all");
    expect(result.added).toBe(true);
    if (result.added) expect(result.domain).toBe("reddit.com");

    const domains = await blocklistRepository.listDomainStrings(EXT_USER_A);
    expect(domains).toContain("reddit.com");
  });

  it("B3. duplicate domain returns ALREADY_EXISTS", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    const result = await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    expect(result.added).toBe(false);
    if (!result.added) expect(result.reason).toBe("ALREADY_EXISTS");
  });

  it("B4. invalid domain returns INVALID_DOMAIN", async () => {
    const result = await blocklistRepository.addDomain(EXT_USER_A, "not-a-domain");
    expect(result.added).toBe(false);
    if (!result.added) expect(result.reason).toBe("INVALID_DOMAIN");
  });

  it("B5. removeDomain removes existing domain", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "twitter.com");
    const result = await blocklistRepository.removeDomain(EXT_USER_A, "twitter.com");
    expect(result.removed).toBe(true);
    const domains = await blocklistRepository.listDomainStrings(EXT_USER_A);
    expect(domains).not.toContain("twitter.com");
  });

  it("B6. removeDomain returns removed: false for non-existent domain", async () => {
    const result = await blocklistRepository.removeDomain(EXT_USER_A, "nonexistent.com");
    expect(result.removed).toBe(false);
  });

  it("B7. domain cap enforced at BLOCKLIST_DOMAIN_CAP domains", async () => {
    // Add BLOCKLIST_DOMAIN_CAP domains
    for (let i = 0; i < BLOCKLIST_DOMAIN_CAP; i++) {
      await prisma.blocklistedDomain.create({
        data: { userId: EXT_USER_A, domain: `test-${i}.com` },
      });
    }
    const result = await blocklistRepository.addDomain(EXT_USER_A, "overflow.com");
    expect(result.added).toBe(false);
    if (!result.added) expect(result.reason).toContain("DOMAIN_CAP_EXCEEDED");
  });
});

// ============================================================
// Extension API Tests (Test Matrix Items 6-11)
// ============================================================

describe("T6. Extension status returns RUNNING session for active user", async () => {
  it("returns authenticated=true + activeSession when focus session is RUNNING", async () => {
    // Start a session for User A
    await focusRepository.startSession(EXT_USER_A, {
      clientEventId: `t6-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    const req = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const res = await getExtensionStatus(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.authenticated).toBe(true);
    expect(json.data.activeSession).not.toBeNull();
    expect(json.data.activeSession.isRunning).toBe(true);
    expect(json.data.activeSession.status).toBe(FocusSessionStatus.RUNNING);
    expect(json.data.activeSession.requiredMinutes).toBe(25);
    expect(json.data.activeSession.remainingMinutes).toBeGreaterThan(0);
  });

  it("returns the blocklist alongside session state in same response", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    await blocklistRepository.addDomain(EXT_USER_A, "twitter.com");
    await focusRepository.startSession(EXT_USER_A, {
      clientEventId: `t6b-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    const req = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const res = await getExtensionStatus(req);
    const json = await res.json();

    expect(json.data.blocklist).toContain("reddit.com");
    expect(json.data.blocklist).toContain("twitter.com");
  });
});

describe("T7. Extension unblocks once session ends", () => {
  it("returns activeSession=null after session is abandoned", async () => {
    const session = await focusRepository.startSession(EXT_USER_A, {
      clientEventId: `t7-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    // Abandon the session
    await focusRepository.abandonSession(EXT_USER_A, session.id);

    const req = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const res = await getExtensionStatus(req);
    const json = await res.json();

    expect(json.data.authenticated).toBe(true);
    expect(json.data.activeSession).toBeNull();
  });

  it("returns activeSession=null when no session exists at all", async () => {
    const req = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const res = await getExtensionStatus(req);
    const json = await res.json();

    expect(json.data.activeSession).toBeNull();
  });
});

describe("T8. User isolation — blocklist scoped to authenticated user only", () => {
  it("User A's blocklist is NOT visible when authenticated as User B", async () => {
    // Add domains for User A
    await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    await blocklistRepository.addDomain(EXT_USER_A, "twitter.com");

    // Query status as User B
    const reqB = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_B);
    const resB = await getExtensionStatus(reqB);
    const jsonB = await resB.json();

    expect(jsonB.data.authenticated).toBe(true);
    expect(jsonB.data.blocklist).toHaveLength(0);
    expect(jsonB.data.blocklist).not.toContain("reddit.com");
  });

  it("User A's active session is NOT visible when authenticated as User B", async () => {
    await focusRepository.startSession(EXT_USER_A, {
      clientEventId: `t8-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    const reqB = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_B);
    const resB = await getExtensionStatus(reqB);
    const jsonB = await resB.json();

    expect(jsonB.data.activeSession).toBeNull();
  });

  it("GET /extension/blocklist as User B returns only User B's domains", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    await blocklistRepository.addDomain(EXT_USER_B, "facebook.com");

    const reqB = makeReq("/api/v1/extension/blocklist", "GET", undefined, EXT_USER_B);
    const resB = await getBlocklist(reqB);
    const jsonB = await resB.json();

    expect(jsonB.data.domains.map((d: { domain: string }) => d.domain)).toContain("facebook.com");
    expect(jsonB.data.domains.map((d: { domain: string }) => d.domain)).not.toContain("reddit.com");
  });
});

describe("T9. No-extension user can complete focus session and earn XP normally", () => {
  it("focus session completion works and awards XP with zero extension involvement", async () => {
    // This test confirms the extension is NOT load-bearing for XP.
    // NO_EXT_USER has never interacted with extension APIs — only the standard focus flow.
    await prisma.user.upsert({
      where: { id: NO_EXT_USER },
      update: {},
      create: { id: NO_EXT_USER, displayName: "NoExtUser", email: "noext@test.dev" },
    });

    const session = await focusRepository.startSession(NO_EXT_USER, {
      clientEventId: `noext-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    // Simulate 27 minutes elapsed by backdating startedAt
    const twentySevenMinAgo = new Date(Date.now() - 27 * 60_000);
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: twentySevenMinAgo, heartbeatCount: 35 }, // enough heartbeats
    });

    const req = makeReq(`/api/v1/focus/${session.id}/complete`, "POST", {}, NO_EXT_USER);
    const res = await completeFocusRoute(req, { params: Promise.resolve({ id: session.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.xpAwarded).toBeGreaterThan(0);

    // Verify XP was written to ledger
    const tx = await prisma.xPTransaction.findFirst({
      where: { userId: NO_EXT_USER, sourceId: session.id },
    });
    expect(tx).not.toBeNull();
    expect(tx?.amount).toBeGreaterThan(0);
  });
});

describe("T10. Uninstalling extension mid-session does not affect server-side XP outcome", () => {
  it("server-side session record is unchanged regardless of extension state", async () => {
    // Demonstrates that XP is calculated purely from server-stored timestamps.
    // Extension install/uninstall has no API call that could change this.
    const session = await focusRepository.startSession(EXT_USER_A, {
      clientEventId: `t10-${Date.now()}`,
      requiredMinutes: 25,
      expectedHeartbeats: 50,
    });

    // Extension "uninstalls" — in our architecture this means no more polls.
    // The server record is unchanged. Simulate 28 minutes elapsed + heartbeats.
    const twentyEightMinAgo = new Date(Date.now() - 28 * 60_000);
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: twentyEightMinAgo, heartbeatCount: 37 },
    });

    // User still completes via the web app normally
    const req = makeReq(`/api/v1/focus/${session.id}/complete`, "POST", {}, EXT_USER_A);
    const res = await completeFocusRoute(req, { params: Promise.resolve({ id: session.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    // XP is awarded based on server-stored startedAt, not extension state
    expect(json.data.xpAwarded).toBeGreaterThan(0);

    // Confirm session record is complete server-side
    const dbSession = await prisma.focusSession.findUnique({ where: { id: session.id } });
    expect(dbSession?.status).toBe(FocusSessionStatus.COMPLETED);
  });
});

describe("T11. Blocklist changes propagate to extension status endpoint", () => {
  it("newly added domain appears in /extension/status response within same request", async () => {
    // Add domain via blocklist API
    const addReq = makeReq(
      "/api/v1/extension/blocklist",
      "POST",
      { domain: "tiktok.com" },
      EXT_USER_A
    );
    const addRes = await postBlocklist(addReq);
    expect(addRes.status).toBe(201);

    // Status endpoint returns the updated blocklist immediately (no cache lag server-side)
    const statusReq = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const statusRes = await getExtensionStatus(statusReq);
    const statusJson = await statusRes.json();

    expect(statusJson.data.blocklist).toContain("tiktok.com");
  });

  it("removed domain disappears from /extension/status response", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "instagram.com");

    // Delete via API
    const delReq = makeReq(
      "/api/v1/extension/blocklist/instagram.com",
      "DELETE",
      undefined,
      EXT_USER_A
    );
    const delRes = await deleteBlocklistDomain(delReq, {
      params: Promise.resolve({ domain: "instagram.com" }),
    });
    expect(delRes.status).toBe(200);

    // Verify gone from status
    const statusReq = makeReq("/api/v1/extension/status", "GET", undefined, EXT_USER_A);
    const statusRes = await getExtensionStatus(statusReq);
    const statusJson = await statusRes.json();
    expect(statusJson.data.blocklist).not.toContain("instagram.com");
  });
});

describe("Blocklist API Route Tests", () => {
  it("GET /extension/blocklist returns 401 without auth", async () => {
    const req = new Request("http://localhost:3000/api/v1/extension/blocklist", { method: "GET" });
    const res = await getBlocklist(req);
    expect(res.status).toBe(401);
  });

  it("POST /extension/blocklist returns 401 without auth", async () => {
    const req = new Request("http://localhost:3000/api/v1/extension/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "reddit.com" }),
    });
    const res = await postBlocklist(req);
    expect(res.status).toBe(401);
  });

  it("POST /extension/blocklist with invalid domain returns 400", async () => {
    const req = makeReq("/api/v1/extension/blocklist", "POST", { domain: "not-valid" }, EXT_USER_A);
    const res = await postBlocklist(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_DOMAIN");
  });

  it("POST /extension/blocklist with duplicate domain returns 409", async () => {
    await blocklistRepository.addDomain(EXT_USER_A, "reddit.com");
    const req = makeReq("/api/v1/extension/blocklist", "POST", { domain: "reddit.com" }, EXT_USER_A);
    const res = await postBlocklist(req);
    expect(res.status).toBe(409);
  });

  it("DELETE /extension/blocklist/:domain with non-existent domain returns 404", async () => {
    const req = makeReq(
      "/api/v1/extension/blocklist/doesnotexist.com",
      "DELETE",
      undefined,
      EXT_USER_A
    );
    const res = await deleteBlocklistDomain(req, {
      params: Promise.resolve({ domain: "doesnotexist.com" }),
    });
    expect(res.status).toBe(404);
  });

  it("OPTIONS /extension/status returns CORS headers for chrome-extension:// origin", async () => {
    const req = makeReq(
      "/api/v1/extension/status",
      "OPTIONS",
      undefined,
      undefined,
      "chrome-extension://abcdefg"
    );
    const res = await optionsExtensionStatus(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefg");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("CORS headers NOT set for non-extension origin", async () => {
    const req = makeReq(
      "/api/v1/extension/status",
      "OPTIONS",
      undefined,
      undefined,
      "https://evil-site.com"
    );
    const res = await optionsExtensionStatus(req);
    // Header should not reflect non-extension origin
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao).not.toBe("https://evil-site.com");
  });
});
