// ============================================================
// TaskAura — Login Route Group Layout
//
// This layout wraps only the /login page. Its sole purpose is
// to redirect an already-authenticated user away from /login
// to the dashboard (/), since a logged-in user landing on the
// login page would be a confusing no-op.
//
// An unauthenticated user sees the login page normally.
// ============================================================

import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth/server-session";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getServerSessionUser();

  if (sessionUser) {
    // Already authenticated: send to dashboard
    redirect("/");
  }

  // Not authenticated: render the login page
  return <>{children}</>;
}
