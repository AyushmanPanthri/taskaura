// ============================================================
// TaskAura — Server-Side Authentication Gate
//
// This helper is called from Server Components (app/layout.tsx).
// It runs in the Node.js runtime — NOT the Edge runtime — so
// it can reach PostgreSQL via Prisma directly.
//
// Approach: Server Component PostgreSQL session validation
// ─────────────────────────────────────────────────────────
// We do NOT use Next.js middleware (middleware.ts) for the
// authentication gate because:
//
//   1. Next.js middleware runs on the V8 Edge runtime which
//      cannot load Node.js native modules (pg, bcrypt, etc.)
//      or Prisma's native driver adapter (@prisma/adapter-pg).
//
//   2. The Edge runtime has no access to the pg connection pool
//      that backs the entire TaskAura session store.
//
//   3. A middleware forced to work without PostgreSQL access
//      would be reduced to checking cookie *presence* alone —
//      which violates the explicit requirement that "the mere
//      presence of the taskaura_session cookie is NOT proof
//      of authentication."
//
// The correct and only safe place to perform this check is
// the root Server Component layout (app/layout.tsx), which:
//   - Runs in the standard Node.js runtime
//   - CAN call validateSession() against the PostgreSQL Session table
//   - Returns null for:
//       • No cookie
//       • Cookie present but token row not found in DB (revoked)
//       • Cookie present but token row is expired (expiry check)
//   - Is called on every navigation because Next.js re-evaluates
//     the layout server side on each request when cookies change.
// ============================================================

import { cookies } from "next/headers";
import { extractTokenFromCookie, validateSession, type SessionUser } from "./session";

/**
 * Validates the current request's session strictly against PostgreSQL.
 *
 * Returns the authenticated user if the session token:
 *   1. Exists in the cookie header, AND
 *   2. Exists as a live (non-deleted, non-expired) row in the PostgreSQL Session table.
 *
 * Returns null for ANY failure condition — no fallback, no cookie-presence shortcut.
 */
export async function getServerSessionUser(): Promise<SessionUser | null> {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
  } catch {
    // cookies() throws outside of a request context (e.g. during static build)
    return null;
  }

  // Build a cookie header string from the server cookies store
  const allCookies = cookieStore.getAll();
  const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const token = extractTokenFromCookie(cookieHeader);
  if (!token) {
    // No cookie at all — unauthenticated
    return null;
  }

  // Strictly validate against PostgreSQL:
  // This call queries the Session table by token. If the session row
  // was deleted (logout from another device, admin revocation, etc.)
  // it returns null — cookie presence is NOT sufficient.
  const sessionUser = await validateSession(token);
  return sessionUser;
}

/**
 * Reusable server-side function to retrieve current authenticated user.
 * Requirement 7: getCurrentUser()
 */
export async function getCurrentUser() {
  return getServerSessionUser();
}
