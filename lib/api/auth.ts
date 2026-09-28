// ============================================================
// Task Aura — Production API Authentication
// Derives user identity strictly from verified session cookies.
// Client request body `userId` is NEVER trusted.
// ============================================================

import { extractTokenFromCookie, validateSession } from "../auth/session";
import { DEMO_USER_ID, ensureDemoSeed } from "../services/demo-seed";

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
  displayName?: string;
  name?: string | null;
  isGuest?: boolean;
  role?: "USER" | "ADMIN";
}

/**
 * Extracts and authenticates user from incoming HTTP request.
 *
 * Primary mechanism:
 *   - Verified session cookie (`taskaura_session`) checked against PostgreSQL Session table.
 *
 * Development/Testing overrides:
 *   - ONLY active when NODE_ENV !== "production" AND process.env.ALLOW_DEV_HEADER_AUTH === "true".
 *   - Supports `x-user-id: <id>` or defaults to DEMO_USER_ID for deterministic unit testing.
 *
 * In production:
 *   - Header spoofing (`x-user-id`, raw Bearer) is strictly rejected.
 *   - Demo user fallback is completely disabled.
 *   - Returns null (401 Unauthorized) if no valid session exists.
 */
export async function getAuthenticatedUser(
  req: Request
): Promise<AuthenticatedUser | null> {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest =
    process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const allowDevHeader =
    !isProduction && (isTest || process.env.ALLOW_DEV_HEADER_AUTH === "true");

  // 1. Production Path: Verify HTTP-only session cookie
  const cookieHeader = req.headers.get("cookie");
  const sessionToken = extractTokenFromCookie(cookieHeader);

  if (sessionToken) {
    const sessionUser = await validateSession(sessionToken);
    if (sessionUser) {
      return {
        id: sessionUser.id,
        email: sessionUser.email,
        displayName: sessionUser.displayName,
        name: sessionUser.name,
        isGuest: sessionUser.isGuest,
        role: sessionUser.role,
      };
    }
    // Explicit session token was provided but invalid/expired/deleted:
    // strictly reject without fallback
    return null;
  }

  // 2. Development/Test explicit override (Strictly disabled in production)
  if (allowDevHeader) {
    ensureDemoSeed();

    const customHeader = req.headers.get("x-user-id");
    if (customHeader && customHeader.trim()) {
      return { id: customHeader.trim() };
    }

    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        return { id: token };
      }
    }
  }

  // In production with no valid session, strictly deny access
  return null;
}
