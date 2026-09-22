// ============================================================
// TaskAura — Protected Route Group Layout
//
// This layout wraps ONLY the authenticated pages:
//   /          (dashboard)
//   /tasks
//   /habits
//   /focus
//   /leaderboard
//
// It does NOT wrap /login (which lives at app/login/page.tsx,
// outside this route group) or any /api/* routes.
//
// ── Why a Route Group, not the Root Layout ────────────────
//
// The root layout (app/layout.tsx) cannot perform the auth
// gate reliably because Next.js does NOT expose the URL
// pathname as a request header in Server Components. Any
// attempt to sniff the pathname from headers (x-pathname,
// x-invoke-path, etc.) always returns undefined, causing a
// fallback that applies the gate to every route including
// /login itself — producing an infinite redirect loop.
//
// Route groups solve this correctly: the (protected) segment
// only renders for pages placed INSIDE this directory. The
// /login page is outside this directory and is never touched.
//
// ── Session Validation ────────────────────────────────────
//
// getServerSessionUser() runs in the Node.js runtime (not the
// Edge runtime used by middleware.ts), so it CAN access
// PostgreSQL via Prisma and call validateSession() directly.
//
// A session is valid if and only if:
//   1. The taskaura_session cookie contains a token, AND
//   2. A Session row with that token EXISTS in PostgreSQL
//      AND has not expired.
//
// Cookie presence alone is NOT sufficient — a deleted row
// (remote logout / revocation) returns null and triggers
// the redirect just like a missing cookie.
// ============================================================

import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth/server-session";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Validate strictly against PostgreSQL — never treat cookie
  // presence alone as proof of authentication.
  const sessionUser = await getServerSessionUser();

  if (!sessionUser) {
    // No cookie, expired session, or revoked (row deleted):
    // all redirect to /login.
    redirect("/login");
  }

  // Session is valid — render the protected page.
  return <>{children}</>;
}
