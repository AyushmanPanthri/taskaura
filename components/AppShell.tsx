"use client";

// ============================================================
// Task Aura — AppShell Component
// Unified responsive layout shell with desktop sidebar,
// mobile header/navigation, TaskAura logo branding,
// live progression mini-profile, profile navigation,
// visible logout actions, and global XP toast container.
// ============================================================

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ProgressSummary } from "@/lib/services/progress-service";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/tasks", label: "Tasks", icon: "✅" },
  { href: "/habits", label: "Habits", icon: "🧘" },
  { href: "/focus", label: "Focus", icon: "🎯" },
  { href: "/leaderboard", label: "Leaderboard", icon: "🏆" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [toast, setToast] = useState<{ amount: number; label: string } | null>(null);
  const [userProfile, setUserProfile] = useState<{
    displayName: string;
    avatar: string;
    isGuest?: boolean;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // Synchronize mini-profile progress and user profile from authoritative API
  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      try {
        const res = await fetch("/api/v1/progress");
        const json = await res.json();
        if (!cancelled && json.success) {
          setProgress(json.data);
        }
      } catch {
        // Fallback
      }
    }

    async function loadProfile() {
      try {
        const res = await fetch("/api/v1/user/profile");
        const json = await res.json();
        if (!cancelled && json.success && json.data?.user) {
          setUserProfile({
            displayName: json.data.user.displayName || "Adventurer",
            avatar: json.data.user.avatar || "🧑‍💻",
            isGuest: json.data.user.isGuest,
          });
        }
      } catch {
        // Ignore if unauthenticated
      }
    }

    if (pathname !== "/login") {
      void loadProgress();
      void loadProfile();
    }

    // Listen for custom XP award events from child pages
    const onXpAwarded = (e: Event) => {
      const customEvent = e as CustomEvent<{ amount: number; label: string }>;
      if (customEvent.detail) {
        setToast(customEvent.detail);
        void loadProgress();
      }
    };

    // Listen for profile update events
    const onProfileUpdated = () => {
      void loadProfile();
    };

    window.addEventListener("taskaura:xp", onXpAwarded);
    window.addEventListener("taskaura:profile-updated", onProfileUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener("taskaura:xp", onXpAwarded);
      window.removeEventListener("taskaura:profile-updated", onProfileUpdated);
    };
  }, [pathname]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // Logout handler using existing /api/v1/auth/logout endpoint
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Proceed with redirect regardless
    } finally {
      setUserProfile(null);
      setProgress(null);
      router.push("/login");
      router.refresh();
      setLoggingOut(false);
    }
  };

  // If on login page, render children directly without app shell sidebar
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const level = progress?.level ?? 1;
  const levelPct = progress ? progress.fraction * 100 : 0;
  const streak = progress?.streak.current ?? 0;
  const currentAvatar = userProfile?.avatar || "🧑‍💻";
  const currentName = userProfile?.displayName || (userProfile?.isGuest ? "Guest" : "Adventurer");

  return (
    <div className="flex min-h-screen">
      {/* ── Desktop Sidebar ─────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 p-5 border-r border-white/5 gap-2 shrink-0 bg-black/20 backdrop-blur-xl">
        {/* TaskAura Official Branding */}
        <Link href="/" className="flex items-center gap-3 px-2 py-2 mb-4 group">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-400/20 p-1 flex items-center justify-center border border-white/10 shadow-lg group-hover:border-purple-500/40 transition-colors">
            <Image
              src="/taskaura-logo.png"
              alt="TaskAura"
              width={38}
              height={38}
              priority
              className="object-contain"
            />
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight text-white flex items-center gap-1">
              Task<span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Aura</span>
            </span>
            <p className="text-[0.65rem] text-white/40 font-mono tracking-wider uppercase">
              {progress?.title ?? "Productivity RPG"}
            </p>
          </div>
        </Link>

        {/* Navigation links */}
        <p className="section-title px-3">Navigation</p>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? "active" : ""}`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Mini Profile & Actions */}
        <div className="mt-auto flex flex-col gap-2.5">
          {/* Clickable mini-profile card linking to /profile */}
          <Link
            href="/profile"
            className="glass-card p-4 border border-white/10 hover:border-purple-500/30 transition-all group block"
            title="View and edit profile"
          >
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-400/30 flex items-center justify-center text-base shadow-md shrink-0 group-hover:scale-105 transition-transform">
                  {currentAvatar}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white/90 truncate group-hover:text-purple-300 transition-colors">
                    {currentName}
                  </p>
                  <p className="text-[0.68rem] text-purple-300/80 font-medium">
                    Level {level} {userProfile?.isGuest && "• Guest"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs font-bold text-orange-400 shrink-0">
                <span>🔥</span>
                <span>{streak}</span>
              </div>
            </div>
            <div className="xp-bar-track">
              <div className="xp-bar-fill" style={{ width: `${levelPct}%` }} />
            </div>
            <p className="text-[0.65rem] text-white/35 mt-1.5 flex justify-between">
              <span>{progress ? `${progress.xpEarnedInLevel} / ${progress.xpRequiredForLevel} XP` : "Syncing..."}</span>
              <span>{progress ? `${progress.levelProgressPercentage}%` : ""}</span>
            </p>
          </Link>

          {/* Visible Logout Button */}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            id="sidebar-logout-btn"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold text-rose-400/80 hover:text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 hover:border-rose-500/30 transition-all cursor-pointer disabled:opacity-50"
            title="Log out of TaskAura"
          >
            <span>🚪</span>
            <span>{loggingOut ? "Logging out…" : "Log Out"}</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ───────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top Navigation */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-40">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 p-1 flex items-center justify-center border border-white/10">
              <Image
                src="/taskaura-logo.png"
                alt="TaskAura"
                width={26}
                height={26}
                className="object-contain"
              />
            </div>
            <span className="text-base font-extrabold tracking-tight text-white">
              Task<span className="text-purple-400">Aura</span>
            </span>
          </Link>

          {/* Quick Nav Icons + Logout */}
          <div className="flex items-center gap-1">
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`p-2 rounded-xl text-sm transition-colors ${
                      isActive
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "text-white/40 hover:text-white/70"
                    }`}
                    title={item.label}
                  >
                    {item.icon}
                  </Link>
                );
              })}
            </nav>

            {/* Mobile Logout Icon */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              id="mobile-logout-btn"
              className="p-2 rounded-xl text-sm text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10 transition-colors ml-1"
              title="Log Out"
            >
              🚪
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* ── Global XP Toast ─────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 glass-card border border-purple-500/40 px-5 py-3.5 flex items-center gap-3 animate-fade-in-up shadow-2xl"
          style={{ boxShadow: "0 10px 35px rgba(139, 92, 246, 0.35)" }}
        >
          <span className="text-2xl animate-bounce">⚡</span>
          <div>
            <p className="text-sm font-extrabold text-purple-300">+{toast.amount} XP</p>
            <p className="text-xs text-white/60">{toast.label}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Helper function to trigger global XP notification */
export function triggerXpToast(amount: number, label: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("taskaura:xp", {
        detail: { amount, label },
      })
    );
  }
}
