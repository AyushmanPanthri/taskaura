// ============================================================
// TaskAura — requireAdmin Server-Side Helper
// Verifies that the current session belongs to an ADMIN user.
// Uses existing session validation strictly (no second auth system).
// Returns 403 Forbidden if not ADMIN.
// ============================================================

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/api/auth";
import { getServerSessionUser } from "@/lib/auth/server-session";
import type { SessionUser } from "@/lib/auth/session";
import { apiError } from "@/lib/api/response";

/**
 * Server-side helper that checks the authenticated session's role
 * and returns 403 if not ADMIN.
 *
 * Usage in API Routes:
 *   const admin = await requireAdmin(req);
 *   if (admin instanceof Response) return admin; // returns 401 or 403
 *
 * Usage in Server Components / Page Guards:
 *   const admin = await requireAdmin(); // redirects to /login or /
 */
export async function requireAdmin(
  req?: Request
): Promise<AuthenticatedUser | SessionUser | NextResponse> {
  if (req) {
    // API Route Context
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }
    if (authUser.role !== "ADMIN") {
      return apiError("FORBIDDEN", "Admin privileges required", 403);
    }
    return authUser;
  } else {
    // Server Component Context
    const sessionUser = await getServerSessionUser();
    if (!sessionUser) {
      redirect("/login");
    }
    if (sessionUser.role !== "ADMIN") {
      redirect("/");
    }
    return sessionUser;
  }
}
