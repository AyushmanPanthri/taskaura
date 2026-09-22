// ============================================================
// TaskAura — Admin Dashboard (/admin)
// READ-ONLY FOUNDATION VIEW
// Strict Role Gate: Reachable ONLY by ADMIN role.
// Non-admins are redirected to "/"
// Unauthenticated users are redirected to "/login"
// Lists all users: name, email, isGuest, createdAt, level, totalXp
// SECURITY INVARIANT: NO edit, delete, or block actions. Display only.
// ============================================================

import React from "react";
import { redirect } from "next/navigation";
import { getServerSessionUser } from "@/lib/auth/server-session";
import { prisma } from "@/lib/prisma";
import { store } from "@/lib/services/store";
import { calculateLevel } from "@/lib/logic/xp-engine";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // 1. Strict Server-Side Authentication & Role Gate
  const sessionUser = await getServerSessionUser();
  if (!sessionUser) {
    redirect("/login");
  }
  if (sessionUser.role !== "ADMIN") {
    redirect("/");
  }

  // 2. Query all users from PostgreSQL
  // SECURITY INVARIANT: passwordHash is explicitly NOT selected.
  const rawUsers = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      displayName: true,
      email: true,
      isGuest: true,
      role: true,
      avatar: true,
      createdAt: true,
    },
  });

  const users = rawUsers.map((u) => {
    const totalXp = store.getTotalXp(u.id);
    const level = calculateLevel(totalXp);
    const name = u.displayName || (u.isGuest ? "Guest" : "Adventurer");
    return {
      id: u.id,
      name,
      email: u.email,
      isGuest: u.isGuest,
      role: u.role,
      avatar: u.avatar || "🧑‍💻",
      createdAt: u.createdAt,
      level,
      totalXp,
    };
  });

  const totalUsers = users.length;
  const registeredCount = users.filter((u) => !u.isGuest).length;
  const guestCount = users.filter((u) => u.isGuest).length;
  const totalSystemXp = users.reduce((acc, u) => acc + u.totalXp, 0);

  return (
    <div style={{ padding: "1.5rem 0", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "2rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1.75rem" }}>🛡️</span>
            <h1
              style={{
                fontSize: "1.875rem",
                fontWeight: 800,
                letterSpacing: "-0.025em",
                color: "#f1f5f9",
                margin: 0,
              }}
            >
              Admin Headquarters
            </h1>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                backgroundColor: "rgba(168, 85, 247, 0.2)",
                color: "#c084fc",
                border: "1px solid rgba(168, 85, 247, 0.3)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Read-Only Foundation
            </span>
          </div>
          <p style={{ color: "#94a3b8", fontSize: "0.925rem", margin: 0 }}>
            Authoritative directory of all TaskAura adventurers and progression telemetry. Actions are restricted in this foundation view.
          </p>
        </div>

        <div
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "rgba(30, 41, 59, 0.6)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "0.75rem",
            fontSize: "0.85rem",
            color: "#94a3b8",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span>Logged in as:</span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{sessionUser.displayName}</span>
          <span
            style={{
              fontSize: "0.7rem",
              padding: "0.15rem 0.4rem",
              borderRadius: "4px",
              backgroundColor: "rgba(245, 158, 11, 0.2)",
              color: "#fbbf24",
              fontWeight: 700,
            }}
          >
            ADMIN
          </span>
        </div>
      </div>

      {/* Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div
          style={{
            backgroundColor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            Total Adventurers
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "#f8fafc", marginTop: "0.25rem" }}>
            {totalUsers}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Total accounts in PostgreSQL
          </div>
        </div>

        <div
          style={{
            backgroundColor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            Registered Users
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "#38bdf8", marginTop: "0.25rem" }}>
            {registeredCount}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Verified email accounts
          </div>
        </div>

        <div
          style={{
            backgroundColor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            Guest Accounts
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "#a855f7", marginTop: "0.25rem" }}>
            {guestCount}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Temporary guest sessions
          </div>
        </div>

        <div
          style={{
            backgroundColor: "rgba(30, 41, 59, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            Total XP Economy
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "#10b981", marginTop: "0.25rem" }}>
            {totalSystemXp.toLocaleString()} XP
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Aggregate experience minted
          </div>
        </div>
      </div>

      {/* Users List Table Container */}
      <div
        style={{
          backgroundColor: "rgba(30, 41, 59, 0.5)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "1rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
              Registered Adventurers Directory
            </h2>
            <p style={{ fontSize: "0.825rem", color: "#94a3b8", margin: "0.25rem 0 0 0" }}>
              Displaying all {users.length} accounts in descending order of registration.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.25rem 0.6rem",
              borderRadius: "6px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              color: "#94a3b8",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            Display Only
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ backgroundColor: "rgba(15, 23, 42, 0.4)", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                <th style={{ padding: "0.875rem 1.5rem", color: "#94a3b8", fontWeight: 600 }}>Adventurer</th>
                <th style={{ padding: "0.875rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Email Address</th>
                <th style={{ padding: "0.875rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Account Type</th>
                <th style={{ padding: "0.875rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Role</th>
                <th style={{ padding: "0.875rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Progression</th>
                <th style={{ padding: "0.875rem 1.5rem", color: "#94a3b8", fontWeight: 600 }}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{
                    borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                    transition: "background-color 0.15s ease",
                  }}
                >
                  {/* User Profile Info */}
                  <td style={{ padding: "1rem 1.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "50%",
                          backgroundColor: "rgba(255, 255, 255, 0.08)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1.15rem",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          flexShrink: 0,
                        }}
                      >
                        {u.avatar}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{u.name}</div>
                        <div style={{ fontSize: "0.7rem", color: "#64748b", fontFamily: "monospace" }}>
                          {u.id.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td style={{ padding: "1rem 1rem" }}>
                    {u.email ? (
                      <span style={{ color: "#cbd5e1" }}>{u.email}</span>
                    ) : (
                      <span style={{ color: "#64748b", fontStyle: "italic" }}>No email (Guest)</span>
                    )}
                  </td>

                  {/* Account Type (Guest / Registered) */}
                  <td style={{ padding: "1rem 1rem" }}>
                    {u.isGuest ? (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "9999px",
                          backgroundColor: "rgba(245, 158, 11, 0.15)",
                          color: "#fbbf24",
                          border: "1px solid rgba(245, 158, 11, 0.25)",
                          fontWeight: 500,
                        }}
                      >
                        Guest
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "9999px",
                          backgroundColor: "rgba(16, 185, 129, 0.15)",
                          color: "#34d399",
                          border: "1px solid rgba(16, 185, 129, 0.25)",
                          fontWeight: 500,
                        }}
                      >
                        Registered
                      </span>
                    )}
                  </td>

                  {/* Role Badge */}
                  <td style={{ padding: "1rem 1rem" }}>
                    {u.role === "ADMIN" ? (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.55rem",
                          borderRadius: "6px",
                          backgroundColor: "rgba(168, 85, 247, 0.2)",
                          color: "#c084fc",
                          border: "1px solid rgba(168, 85, 247, 0.35)",
                          fontWeight: 700,
                          letterSpacing: "0.025em",
                        }}
                      >
                        ADMIN
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.55rem",
                          borderRadius: "6px",
                          backgroundColor: "rgba(148, 163, 184, 0.1)",
                          color: "#94a3b8",
                          border: "1px solid rgba(148, 163, 184, 0.2)",
                          fontWeight: 500,
                        }}
                      >
                        USER
                      </span>
                    )}
                  </td>

                  {/* Progression: Level & Total XP */}
                  <td style={{ padding: "1rem 1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#38bdf8",
                          padding: "0.15rem 0.4rem",
                          borderRadius: "4px",
                          backgroundColor: "rgba(56, 189, 248, 0.15)",
                        }}
                      >
                        Lv. {u.level}
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: "0.825rem" }}>
                        {u.totalXp.toLocaleString()} XP
                      </span>
                    </div>
                  </td>

                  {/* Created At */}
                  <td style={{ padding: "1rem 1.5rem", color: "#94a3b8", fontSize: "0.8rem" }}>
                    {new Date(u.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
