// ============================================================
// TaskAura — Admin Headquarters Overview (/admin)
// Comprehensive command center with live PostgreSQL telemetry,
// metric cards, recent audit activities, and quick actions.
// ============================================================

import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getAdminOverviewTelemetry() {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isGuest: true } }),
    prisma.xPTransaction.aggregate({ _sum: { amount: true } }),
    prisma.quest.count(),
    prisma.quest.count({ where: { status: "ACTIVE" } }),
    prisma.quest.count({ where: { status: "COMPLETED" } }),
    prisma.userAchievement.count(),
    prisma.user.count({ where: { createdAt: { gte: oneWeekAgo } } }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        displayName: true,
        email: true,
        isGuest: true,
        role: true,
        avatar: true,
        createdAt: true,
      },
    }),
  ]);
}

export default async function AdminOverviewPage() {
  // Parallel telemetry aggregations directly from PostgreSQL
  const [
    totalUsers,
    guestUsers,
    totalXpAgg,
    totalQuests,
    activeQuests,
    completedQuests,
    totalAchievements,
    newUsersThisWeek,
    recentAudits,
    recentUsers,
  ] = await getAdminOverviewTelemetry();

  const registeredUsers = totalUsers - guestUsers;
  const totalXp = totalXpAgg._sum.amount ?? 0;

  // Enrich recent audits with admin display names
  const adminIds = Array.from(new Set(recentAudits.map((a) => a.adminUserId)));
  const adminUsers = await prisma.user.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, displayName: true, email: true },
  });
  const adminMap = new Map(adminUsers.map((u) => [u.id, u.displayName || u.email]));

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚡</span>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Command Overview
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Live System
            </span>
          </div>
          <p className="text-xs md:text-sm text-white/50 mt-1">
            Real-time platform metrics, user progression, quest management, and authoritative audit feeds.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin/quests/create"
            id="overview-quick-forge-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all"
          >
            <span>⚔️</span>
            <span>Forge Quest</span>
          </Link>
          <Link
            href="/admin/rewards"
            id="overview-quick-rewards-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 transition-all"
          >
            <span>🎁</span>
            <span>Grant Rewards</span>
          </Link>
        </div>
      </div>

      {/* ── Metric Telemetry Cards Grid (8 Cards) ───────────── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
          System Vital Telemetry
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {/* 1. Total Users */}
          <div className="glass-card p-4 border border-white/10 hover:border-amber-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Total Users</span>
              <span className="text-base">👥</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-white">{totalUsers}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">
              {registeredUsers} registered · {guestUsers} guests
            </p>
          </div>

          {/* 2. New This Week */}
          <div className="glass-card p-4 border border-white/10 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">New This Week</span>
              <span className="text-base">🌱</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-cyan-300">+{newUsersThisWeek}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">Last 7 days user registrations</p>
          </div>

          {/* 3. Total XP Generated */}
          <div className="glass-card p-4 border border-white/10 hover:border-purple-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Total XP Ledger</span>
              <span className="text-base">✨</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-purple-300">
              {totalXp.toLocaleString()}
            </p>
            <p className="text-[0.65rem] text-white/40 mt-1">Authoritative append-only XP</p>
          </div>

          {/* 4. Total Quests */}
          <div className="glass-card p-4 border border-white/10 hover:border-amber-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Total Quests</span>
              <span className="text-base">⚔️</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-amber-300">{totalQuests}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">Forged & AI quests</p>
          </div>

          {/* 5. Active Quests */}
          <div className="glass-card p-4 border border-white/10 hover:border-emerald-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Active Quests</span>
              <span className="text-base">🔥</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-emerald-400">{activeQuests}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">In player mission logs</p>
          </div>

          {/* 6. Completed Quests */}
          <div className="glass-card p-4 border border-white/10 hover:border-blue-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Completed Quests</span>
              <span className="text-base">🏆</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-blue-300">{completedQuests}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">Successfully accomplished</p>
          </div>

          {/* 7. Achievements Earned */}
          <div className="glass-card p-4 border border-white/10 hover:border-pink-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Badges Unlocked</span>
              <span className="text-base">🎖️</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-pink-300">{totalAchievements}</p>
            <p className="text-[0.65rem] text-white/40 mt-1">Unlocked player achievements</p>
          </div>

          {/* 8. Active Ratio */}
          <div className="glass-card p-4 border border-white/10 hover:border-indigo-500/30 transition-colors">
            <div className="flex items-center justify-between text-white/50 mb-2">
              <span className="text-xs font-medium">Registered Ratio</span>
              <span className="text-base">📊</span>
            </div>
            <p className="text-2xl md:text-3xl font-black text-indigo-300">
              {totalUsers > 0 ? `${Math.round((registeredUsers / totalUsers) * 100)}%` : "100%"}
            </p>
            <p className="text-[0.65rem] text-white/40 mt-1">Verified user conversion</p>
          </div>
        </div>
      </div>

      {/* ── Lower Panels: Recent Audit Activity & Recent Users ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Recent Audit Trail */}
        <div className="lg:col-span-2 glass-card p-5 border border-white/10">
          <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-base">📜</span>
              <h3 className="text-sm font-bold text-white">Recent Admin Activity</h3>
            </div>
            <Link
              href="/admin/activity"
              className="text-xs text-amber-400 hover:text-amber-300 font-semibold"
            >
              View All Logs →
            </Link>
          </div>

          {recentAudits.length === 0 ? (
            <div className="p-8 text-center text-white/40 text-xs">
              No admin actions logged yet. Forging quests or granting rewards will appear here.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {recentAudits.map((item) => {
                const adminName = adminMap.get(item.adminUserId) || "Administrator";
                let metaParsed: Record<string, unknown> = {};
                try {
                  metaParsed = JSON.parse(item.metadata);
                } catch {
                  metaParsed = {};
                }

                return (
                  <div key={item.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{adminName}</span>
                        <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          {item.action.replace(/_/g, " ")}
                        </span>
                        {metaParsed.title ? (
                          <span className="text-white/80 font-medium truncate max-w-[200px]">
                            &ldquo;{String(metaParsed.title)}&rdquo;
                          </span>
                        ) : null}
                        {metaParsed.amount !== undefined ? (
                          <span className="text-purple-300 font-mono">
                            +{String(metaParsed.amount)} XP
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[0.65rem] text-white/40 mt-1">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Col: Recent Members */}
        <div className="glass-card p-5 border border-white/10">
          <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-base">👥</span>
              <h3 className="text-sm font-bold text-white">Latest Players</h3>
            </div>
            <Link
              href="/admin/users"
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
            >
              Directory →
            </Link>
          </div>

          <div className="divide-y divide-white/5">
            {recentUsers.map((u) => (
              <Link
                key={u.id}
                href={`/admin/users/${u.id}`}
                className="py-2.5 flex items-center justify-between gap-2.5 hover:bg-white/[0.02] rounded-lg px-2 transition-colors group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-sm shrink-0">
                    {u.avatar || "🧑‍💻"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors truncate">
                      {u.displayName || (u.isGuest ? "Guest" : "Adventurer")}
                    </p>
                    <p className="text-[0.62rem] text-white/40 truncate">{u.email}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase ${
                      u.role === "ADMIN"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : u.isGuest
                        ? "bg-white/5 text-white/40 border border-white/10"
                        : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                    }`}
                  >
                    {u.role === "ADMIN" ? "ADMIN" : u.isGuest ? "GUEST" : "USER"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
