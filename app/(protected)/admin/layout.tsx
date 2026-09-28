// ============================================================
// TaskAura — /admin Layout
// Strict Server Component Gate for Admin Headquarters.
// Verifies user session and role === 'ADMIN' against PostgreSQL.
// Wraps all admin routes in the dedicated AdminShell.
// ============================================================

import React from "react";
import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth/server-session";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getServerSessionUser();

  if (!sessionUser) {
    redirect("/login");
  }

  if (sessionUser.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <AdminShell
      adminUser={{
        id: sessionUser.id,
        email: sessionUser.email || "",
        displayName: sessionUser.displayName || "Administrator",
        avatar: sessionUser.avatar || "👑",
        role: sessionUser.role || "ADMIN",
      }}
    >
      {children}
    </AdminShell>
  );
}
