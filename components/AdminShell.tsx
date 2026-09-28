"use client";

// ============================================================
// TaskAura — Admin Headquarters Shell (AdminShell)
// Dedicated Command Center layout for Administrators.
// Provides persistent sidebar navigation, mobile drawer,
// quick-action headers, and return-to-app routing.
// ============================================================

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

interface AdminShellProps {
  children: React.ReactNode;
  adminUser: {
    id: string;
    email: string;
    displayName: string;
    avatar: string;
    role: string;
  };
}

interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  badge?: string;
  exact?: boolean;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: "📊", exact: true },
  { href: "/admin/users", label: "User Directory", icon: "👥" },
  { href: "/admin/quests", label: "Quest Forge", icon: "⚔️" },
  { href: "/admin/rewards", label: "Rewards Center", icon: "🎁" },
  { href: "/admin/activity", label: "Audit Log", icon: "📜" },
];

export function AdminShell({ children, adminUser }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Proceed regardless
    } finally {
      router.push("/login");
      router.refresh();
      setLoggingOut(false);
    }
  };

  const isNavActive = (item: AdminNavItem) => {
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  return (
    <div className="flex min-h-screen bg-[#07070d] text-[#e8e8f0]">
      {/* ── Desktop Sidebar ───────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 p-5 border-r border-white/5 gap-3 shrink-0 bg-black/40 backdrop-blur-2xl sticky top-0 h-screen z-30">
        {/* Admin Brand Header */}
        <div className="flex items-center gap-3 px-2 py-2 mb-2">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500/20 via-purple-500/20 to-cyan-500/20 p-1 flex items-center justify-center border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
            <Image
              src="/taskaura-logo.png"
              alt="TaskAura"
              width={34}
              height={34}
              priority
              className="object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-extrabold tracking-tight text-white">
                Task<span className="bg-gradient-to-r from-amber-400 to-purple-400 bg-clip-text text-transparent">Aura</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62rem] font-black tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                HQ STAFF
              </span>
            </div>
          </div>
        </div>

        {/* Quick Action Button */}
        <Link
          href="/admin/quests/create"
          id="admin-quick-create-quest-btn"
          className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.25)] hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all transform active:scale-98"
        >
          <span className="text-sm">⚔️</span>
          <span>Forge New Quest</span>
        </Link>

        {/* Navigation list */}
        <p className="text-[0.68rem] font-bold text-white/30 uppercase tracking-widest px-3 mt-3">
          Command Center
        </p>
        <nav className="flex flex-col gap-1.5">
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                id={`admin-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group relative ${
                  active
                    ? "bg-gradient-to-r from-amber-500/20 to-purple-500/10 text-amber-200 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.12)] font-bold"
                    : "text-white/60 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <span className="text-base transition-transform group-hover:scale-110">
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer Area: Admin Profile & Back to App */}
        <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-white/5">
          {/* Return to Normal App */}
          <Link
            href="/"
            id="admin-return-to-app-btn"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-white/50 hover:text-white hover:bg-white/5 transition-all border border-transparent hover:border-white/10"
          >
            <span>◀️</span>
            <span>Return to TaskAura</span>
          </Link>

          {/* Admin Profile Mini Badge */}
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/30 to-purple-500/30 border border-amber-400/40 flex items-center justify-center text-base shadow-inner shrink-0">
                {adminUser.avatar || "👑"}
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-[#07070d]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {adminUser.displayName || "Administrator"}
                </p>
                <p className="text-[0.62rem] text-amber-300/80 font-mono truncate">
                  {adminUser.email}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              id="admin-sidebar-logout-btn"
              className="text-white/40 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors"
              title="Logout"
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Panel Area ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-white/10 bg-black/60 backdrop-blur-xl sticky top-0 z-40">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              id="admin-mobile-menu-toggle"
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold text-white">
                Task<span className="text-amber-400">Aura</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                HQ
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/quests/create"
              className="py-1.5 px-3 rounded-lg text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 shadow-sm"
            >
              ⚔️ Forge
            </Link>
            <Link
              href="/"
              className="p-1.5 rounded-lg text-xs text-white/60 hover:text-white bg-white/5 border border-white/10"
              title="Return to App"
            >
              ◀️
            </Link>
          </div>
        </header>

        {/* Mobile Slide-Out Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] bg-[#0c0c14] border-r border-white/10 p-5 flex flex-col gap-4 z-10 h-full overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-white">Admin HQ</span>
                  <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-bold bg-amber-500/20 text-amber-300">
                    STAFF
                  </span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-white/60 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              <Link
                href="/admin/quests/create"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300"
              >
                <span>⚔️</span>
                <span>Forge New Quest</span>
              </Link>

              <nav className="flex flex-col gap-1.5 mt-2">
                {ADMIN_NAV_ITEMS.map((item) => {
                  const active = isNavActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                        active
                          ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                          : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-white/10">
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white/60 hover:text-white"
                >
                  <span>◀️</span>
                  <span>Return to TaskAura</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300"
                >
                  <span>🚪</span>
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content View Container */}
        <main className="flex-1 p-4 md:p-8 lg:p-10 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
