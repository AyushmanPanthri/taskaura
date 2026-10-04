"use client";

// ============================================================
// Task Aura — AppShell Component
// Unified responsive layout shell with desktop sidebar,
// mobile header/navigation, TaskAura logo branding,
// live progression mini-profile, profile navigation,
// visible logout actions, and global XP toast container.
// ============================================================

import React, { useEffect, useRef, useState } from "react";
import {
  CelebrationOverlay,
  type CelebrationKind,
} from "./CelebrationOverlay";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ProgressSummary } from "@/lib/services/progress-service";
import type { CompletionGamification } from "@/lib/logic/completion-gamification";

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
  const [gamificationToast, setGamificationToast] =
    useState<CompletionGamification | null>(null);
  const [animatedXp, setAnimatedXp] = useState(0);
  const [streakPulse, setStreakPulse] = useState(false);
  const [userProfile, setUserProfile] = useState<{
    displayName: string;
    avatar: string;
    isGuest?: boolean;
    role?: string;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);
  // Track the last known level so we can detect when the server confirms a level-up.
  const prevLevelRef = useRef<number | null>(null);
  const progressRef = useRef<ProgressSummary | null>(null);
  const serverUpdateBeforeToastRef = useRef(false);

  // Synchronize mini-profile progress and user profile from authoritative API
  useEffect(() => {
    let cancelled = false;
    async function loadProgress(checkLevelUp = false) {
      try {
        const res = await fetch("/api/v1/progress");
        const json = await res.json();
        if (!cancelled && json.success) {
          const newLevel: number = json.data.level;
          if (
            checkLevelUp &&
            prevLevelRef.current !== null &&
            newLevel > prevLevelRef.current
          ) {
            window.dispatchEvent(new CustomEvent("taskaura:level-up"));
          }
          prevLevelRef.current = newLevel;
          progressRef.current = json.data;
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
            role: json.data.user.role,
          });
        }
      } catch {
        // Ignore if unauthenticated
      }
    }

    if (pathname !== "/login" && !pathname?.startsWith("/admin")) {
      void loadProgress();
      void loadProfile();
    }

    // Listen for custom XP award events from child pages
    const onXpAwarded = (e: Event) => {
      const customEvent = e as CustomEvent<{ amount: number; label: string }>;
      if (customEvent.detail) {
        setToast(customEvent.detail);
        if (serverUpdateBeforeToastRef.current) {
          serverUpdateBeforeToastRef.current = false;
        } else {
          void loadProgress(true);
        }
      }
    };

    const onGamificationUpdate = (e: Event) => {
      const detail = (e as CustomEvent<CompletionGamification>).detail;
      if (!detail?.xp || !detail.progression) return;

      serverUpdateBeforeToastRef.current = true;
      setGamificationToast(detail);
      const current = progressRef.current;
      if (current) {
        const updated: ProgressSummary = {
          ...current,
          totalXp: detail.xp.newTotal,
          level: detail.progression.newLevel,
          fraction: detail.progression.levelProgress,
          xpEarnedInLevel: detail.progression.xpIntoLevel,
          xpRequiredForLevel: detail.progression.xpForNextLevel,
          xpRemaining: Math.max(
            0,
            detail.progression.xpForNextLevel -
              detail.progression.xpIntoLevel
          ),
          levelProgressPercentage: detail.progression.levelProgress * 100,
          streak: detail.streak
            ? { ...current.streak, current: detail.streak.current }
            : current.streak,
          achievements: current.achievements.map((achievement) => {
            const unlocked = detail.achievements?.find(
              (item) => item.id === achievement.id
            );
            return unlocked
              ? {
                  ...achievement,
                  unlocked: true,
                  unlockedAt: unlocked.unlockedAt,
                }
              : achievement;
          }),
        };
        progressRef.current = updated;
        prevLevelRef.current = updated.level;
        setProgress(updated);
      } else {
        void loadProgress();
      }

      if (
        detail.streak?.changed &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setStreakPulse(true);
      }
    };

    // prefers-reduced-motion guard: skip video if the OS requests reduced motion.
    const motionOk = () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Level-up celebration
    const onLevelUp = () => {
      if (motionOk()) setCelebration("level-up");
    };

    // Quest-complete celebration
    const onQuestComplete = () => {
      if (motionOk()) setCelebration("quest-complete");
    };

    // Task-complete celebration
    const onTaskComplete = () => {
      if (motionOk()) setCelebration("task-complete");
    };

    // Habit-complete celebration
    const onHabitComplete = () => {
      if (motionOk()) setCelebration("habit-complete");
    };

    // Listen for profile update events
    const onProfileUpdated = () => {
      void loadProfile();
    };

    window.addEventListener("taskaura:xp", onXpAwarded);
    window.addEventListener("taskaura:gamification-update", onGamificationUpdate);
    window.addEventListener("taskaura:profile-updated", onProfileUpdated);
    window.addEventListener("taskaura:level-up", onLevelUp);
    window.addEventListener("taskaura:quest-complete", onQuestComplete);
    window.addEventListener("taskaura:task-complete", onTaskComplete);
    window.addEventListener("taskaura:habit-complete", onHabitComplete);

    return () => {
      cancelled = true;
      window.removeEventListener("taskaura:xp", onXpAwarded);
      window.removeEventListener("taskaura:gamification-update", onGamificationUpdate);
      window.removeEventListener("taskaura:profile-updated", onProfileUpdated);
      window.removeEventListener("taskaura:level-up", onLevelUp);
      window.removeEventListener("taskaura:quest-complete", onQuestComplete);
      window.removeEventListener("taskaura:task-complete", onTaskComplete);
      window.removeEventListener("taskaura:habit-complete", onHabitComplete);
    };
  }, [pathname]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!gamificationToast) return;
    const timer = setTimeout(() => setGamificationToast(null), 4200);
    return () => clearTimeout(timer);
  }, [gamificationToast]);

  useEffect(() => {
    const target = gamificationToast?.xp?.awarded;
    if (target === undefined) return;
    if (
      target === 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setAnimatedXp(target);
      return;
    }

    setAnimatedXp(0);
    const startedAt = Date.now();
    const durationMs = 650;
    const timer = setInterval(() => {
      const fraction = Math.min(1, (Date.now() - startedAt) / durationMs);
      setAnimatedXp(Math.round(target * fraction));
      if (fraction >= 1) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [gamificationToast]);

  useEffect(() => {
    if (!streakPulse) return;
    const timer = setTimeout(() => setStreakPulse(false), 900);
    return () => clearTimeout(timer);
  }, [streakPulse]);

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
      progressRef.current = null;
      router.push("/login");
      router.refresh();
      setLoggingOut(false);
    }
  };

  // If on login page or admin portal, render children directly without normal app shell sidebar.
  // CelebrationOverlay is still mounted so it can show if the user navigates.
  if (pathname === "/login" || pathname?.startsWith("/admin")) {
    return (
      <>
        {children}
        <CelebrationOverlay
          kind={celebration}
          onDismiss={() => setCelebration(null)}
        />
      </>
    );
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

          {userProfile?.role === "ADMIN" && (
            <Link
              href="/admin"
              className={`nav-item text-amber-300 hover:text-amber-200 border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 mt-2 ${
                pathname?.startsWith("/admin") ? "active" : ""
              }`}
            >
              <span className="text-base">🛡️</span>
              <span className="font-bold flex items-center gap-1.5">
                Admin HQ
                <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200 border border-amber-400/30 uppercase tracking-wider font-mono">
                  STAFF
                </span>
              </span>
            </Link>
          )}
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
                <span className={streakPulse ? "animate-pulse" : ""}>🔥</span>
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

      {/* ── Celebration Video Overlay ─────────────────────── */}
      <CelebrationOverlay
        kind={celebration}
        onDismiss={() => setCelebration(null)}
      />

      {/* ── Global XP Toast ─────────────────────────────────── */}
      {gamificationToast ? (
        <div
          className="fixed bottom-6 right-6 z-50 glass-card border border-purple-500/40 px-5 py-3.5 flex items-center gap-3 animate-fade-in-up shadow-2xl"
          role="status"
          aria-live="polite"
          style={{ boxShadow: "0 10px 35px rgba(139, 92, 246, 0.35)" }}
        >
          <span className="text-2xl">⚡</span>
          <div>
            {gamificationToast.progression?.levelUp && (
              <p className="text-sm font-extrabold text-amber-300">
                LEVEL UP: Level {gamificationToast.progression.previousLevel} to Level {gamificationToast.progression.newLevel}
              </p>
            )}
            <p className="text-sm font-extrabold text-purple-300">
              +{animatedXp} XP
            </p>
            {gamificationToast.xp?.reduced && (
              <p className="text-xs text-white/60">New-user reward ramp applied</p>
            )}
            {gamificationToast.xp?.capped && (
              <p className="text-xs text-white/60">
                {gamificationToast.xp.reason.replaceAll("_", " ").toLowerCase()}
              </p>
            )}
            {gamificationToast.streak?.changed && (
              <span className="badge badge-orange">
                {gamificationToast.streak.current} day streak
              </span>
            )}
            {gamificationToast.achievements?.map((achievement) => (
              <p key={achievement.id} className="text-xs text-amber-200">
                Achievement unlocked: {achievement.name}
              </p>
            ))}
            {gamificationToast.ranking?.changed && (
              <span className="badge badge-cyan">
                Rank {gamificationToast.ranking.newRank < gamificationToast.ranking.previousRank ? "up" : "down"}: #{gamificationToast.ranking.previousRank} to #{gamificationToast.ranking.newRank}
              </span>
            )}
          </div>
        </div>
      ) : toast && (
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

export function triggerGamificationUpdate(
  gamification: CompletionGamification | undefined
) {
  if (typeof window !== "undefined" && gamification) {
    window.dispatchEvent(
      new CustomEvent("taskaura:gamification-update", {
        detail: gamification,
      })
    );
  }
}

/**
 * Helper function called by task-completion handlers when the server
 * confirms that the completed task belonged to a quest (questId != null).
 * The overlay plays ONLY after the server confirms — this helper must
 * only be called with a server-confirmed quest completion result.
 */
export function triggerQuestCelebration() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("taskaura:quest-complete"));
  }
}

/**
 * Generic celebration trigger — fires a named video-slot celebration.
 * The slot name must match a key in VIDEO_SLOTS (CelebrationOverlay).
 * Callers pass the slot name; AppShell picks up the event and shows
 * the corresponding video.
 */
export function triggerCelebration(slot: CelebrationKind) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(`taskaura:${slot}`));
  }
}
