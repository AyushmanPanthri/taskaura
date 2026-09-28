"use client";

// ============================================================
// TaskAura — Admin Rewards Center (/admin/rewards)
// Authoritative XP adjustments and Achievement grants.
// Routed through the idempotent append-only XP ledger and
// duplicate-safe achievement repository.
// ============================================================

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface UserOption {
  id: string;
  displayName: string;
  email: string;
}

interface AchievementOption {
  id: string;
  name: string;
  description: string;
  badgeIcon: string;
}

function RewardsCenterInner() {
  const searchParams = useSearchParams();
  const preselectedUser = searchParams.get("user") || "";

  // Available catalogs
  const [users, setUsers] = useState<UserOption[]>([]);
  const [achievements, setAchievements] = useState<AchievementOption[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  // Grant XP Form
  const [xpUserId, setXpUserId] = useState(preselectedUser);
  const [xpAmount, setXpAmount] = useState<number>(100);
  const [xpReason, setXpReason] = useState("");
  const [xpSubmitting, setXpSubmitting] = useState(false);
  const [xpSuccess, setXpSuccess] = useState<string | null>(null);
  const [xpError, setXpError] = useState<string | null>(null);

  // Grant Achievement Form
  const [achUserId, setAchUserId] = useState(preselectedUser);
  const [achId, setAchId] = useState("");
  const [achReason, setAchReason] = useState("");
  const [achSubmitting, setAchSubmitting] = useState(false);
  const [achSuccess, setAchSuccess] = useState<string | null>(null);
  const [achError, setAchError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [uRes, aRes] = await Promise.all([
          fetch("/api/v1/admin/users?limit=100").then((r) => r.json()),
          fetch("/api/v1/admin/rewards/achievement").then((r) => r.json()),
        ]);

        if (uRes.success) setUsers(uRes.data.users);
        if (aRes.success) {
          setAchievements(aRes.data.achievements);
          if (aRes.data.achievements?.length > 0) {
            setAchId(aRes.data.achievements[0].id);
          }
        }
      } catch {
        // Fallback
      } finally {
        setLoadingCatalogs(false);
      }
    }
    loadData();
  }, []);

  // Update selection if query param changes
  useEffect(() => {
    if (preselectedUser) {
      const syncUser = async () => {
        await Promise.resolve();
        setXpUserId(preselectedUser);
        setAchUserId(preselectedUser);
      };
      void syncUser();
    }
  }, [preselectedUser]);

  const handleGrantXp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!xpUserId) {
      setXpError("Please select a target player");
      return;
    }
    if (!xpAmount || xpAmount <= 0) {
      setXpError("XP amount must be greater than 0");
      return;
    }

    setXpSubmitting(true);
    setXpError(null);
    setXpSuccess(null);

    try {
      const res = await fetch("/api/v1/admin/rewards/xp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: xpUserId,
          amount: Number(xpAmount),
          reason: xpReason || "Admin manual adjustment",
        }),
      });

      const data = await res.json();
      if (data.success) {
        setXpSuccess(
          `Successfully granted ${data.data.amount} XP to ${
            users.find((u) => u.id === xpUserId)?.displayName || "player"
          }!`
        );
        setXpReason("");
      } else {
        setXpError(data.error?.message || "Failed to grant XP");
      }
    } catch {
      setXpError("Network error granting XP");
    } finally {
      setXpSubmitting(false);
    }
  };

  const handleGrantAchievement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!achUserId) {
      setAchError("Please select a target player");
      return;
    }
    if (!achId) {
      setAchError("Please select an achievement badge");
      return;
    }

    setAchSubmitting(true);
    setAchError(null);
    setAchSuccess(null);

    try {
      const res = await fetch("/api/v1/admin/rewards/achievement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: achUserId,
          achievementId: achId,
          reason: achReason || "Admin awarded achievement",
        }),
      });

      const data = await res.json();
      if (data.success) {
        setAchSuccess(data.data.message || "Achievement granted successfully!");
        setAchReason("");
      } else {
        setAchError(data.error?.message || "Failed to grant achievement");
      }
    } catch {
      setAchError("Network error granting achievement");
    } finally {
      setAchSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🎁</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Rewards Center
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Authoritative
            </span>
          </div>
          <p className="text-xs md:text-sm text-white/50 mt-1">
            Grant verified XP adjustments or unlock badges. All grants route through idempotent ledgers with audit logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin/activity"
            className="text-xs font-semibold text-amber-400 hover:text-amber-300"
          >
            Review Audit Log →
          </Link>
        </div>
      </div>

      {loadingCatalogs ? (
        <div className="p-16 text-center text-xs text-white/40 animate-pulse">
          Loading player intelligence and badge catalog...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Card 1: Grant XP ─────────────────────────────── */}
          <div className="glass-card p-6 border border-white/10 flex flex-col justify-between">
            <form onSubmit={handleGrantXp} className="space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-white/5">
                <span className="text-xl">✨</span>
                <div>
                  <h3 className="text-sm font-bold text-white">Grant Authoritative XP</h3>
                  <p className="text-[0.68rem] text-white/40">
                    Appends ADJUSTMENT transaction to player ledger
                  </p>
                </div>
              </div>

              {xpSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
                  {xpSuccess}
                </div>
              )}
              {xpError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
                  {xpError}
                </div>
              )}

              {/* Target User */}
              <div>
                <label htmlFor="xp-target-user-select" className="text-xs font-bold text-white block mb-1.5">
                  Select Player <span className="text-rose-400">*</span>
                </label>
                <select
                  id="xp-target-user-select"
                  required
                  value={xpUserId}
                  onChange={(e) => setXpUserId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500/50"
                >
                  <option value="">-- Choose player --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* XP Amount */}
              <div>
                <label htmlFor="xp-amount-input" className="text-xs font-bold text-white block mb-1.5">
                  XP Amount <span className="text-rose-400">*</span>
                </label>
                <input
                  id="xp-amount-input"
                  type="number"
                  required
                  min={1}
                  max={50000}
                  value={xpAmount}
                  onChange={(e) => setXpAmount(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500/50 font-mono"
                />
              </div>

              {/* Reason */}
              <div>
                <label htmlFor="xp-reason-input" className="text-xs font-bold text-white block mb-1.5">
                  Reason / Adjustment Note
                </label>
                <input
                  id="xp-reason-input"
                  type="text"
                  placeholder="e.g. Community challenge bounty, compensation, beta tester reward"
                  value={xpReason}
                  onChange={(e) => setXpReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              <button
                type="submit"
                disabled={xpSubmitting}
                id="rewards-grant-xp-btn"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-[0_0_15px_rgba(168,85,247,0.25)] transition-all disabled:opacity-50"
              >
                {xpSubmitting ? "Granting XP..." : "✨ Grant XP Bounty"}
              </button>
            </form>
          </div>

          {/* ── Card 2: Grant Achievement ────────────────────── */}
          <div className="glass-card p-6 border border-white/10 flex flex-col justify-between">
            <form onSubmit={handleGrantAchievement} className="space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-white/5">
                <span className="text-xl">🎖️</span>
                <div>
                  <h3 className="text-sm font-bold text-white">Award Achievement Badge</h3>
                  <p className="text-[0.68rem] text-white/40">
                    Duplicate-safe unlock with audit logging
                  </p>
                </div>
              </div>

              {achSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
                  {achSuccess}
                </div>
              )}
              {achError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
                  {achError}
                </div>
              )}

              {/* Target User */}
              <div>
                <label htmlFor="ach-target-user-select" className="text-xs font-bold text-white block mb-1.5">
                  Select Player <span className="text-rose-400">*</span>
                </label>
                <select
                  id="ach-target-user-select"
                  required
                  value={achUserId}
                  onChange={(e) => setAchUserId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50"
                >
                  <option value="">-- Choose player --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Achievement Badge */}
              <div>
                <label htmlFor="ach-badge-select" className="text-xs font-bold text-white block mb-1.5">
                  Select Achievement <span className="text-rose-400">*</span>
                </label>
                <select
                  id="ach-badge-select"
                  required
                  value={achId}
                  onChange={(e) => setAchId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50"
                >
                  {achievements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reason */}
              <div>
                <label htmlFor="ach-reason-input" className="text-xs font-bold text-white block mb-1.5">
                  Award Reason / Recognition
                </label>
                <input
                  id="ach-reason-input"
                  type="text"
                  placeholder="e.g. Special event participation, honor roll"
                  value={achReason}
                  onChange={(e) => setAchReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <button
                type="submit"
                disabled={achSubmitting}
                id="rewards-grant-achievement-btn"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all disabled:opacity-50"
              >
                {achSubmitting ? "Awarding Badge..." : "🎖️ Award Achievement"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminRewardsPage() {
  return (
    <Suspense fallback={<div className="p-16 text-center text-xs text-white/40">Loading Rewards Center...</div>}>
      <RewardsCenterInner />
    </Suspense>
  );
}
