"use client";

// ============================================================
// TaskAura — Admin User Detail View (/admin/users/[id])
// Comprehensive inspection of player progression, tasks,
// habits, quest mission logs, and XP transactions.
// ============================================================

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface UserDetailResponse {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  role: "USER" | "ADMIN";
  avatar: string;
  createdAt: string;
  updatedAt: string;
  level: number;
  totalXp: number;
  streak: {
    currentStreak: number;
    bestStreak: number;
    lastEligibleDate?: string | null;
  };
  recentXp: Array<{
    amount: number;
    sourceType: string;
    createdAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    difficulty: string;
    createdAt: string;
  }>;
  habits: Array<{
    id: string;
    title: string;
    frequency: string;
    streakCurrent: number;
    streakBest: number;
  }>;
  achievements: Array<{
    unlockedAt: string;
    achievement: {
      name: string;
      description: string;
    };
  }>;
  quests: Array<{
    id: string;
    title: string;
    difficulty: string;
    status: string;
    createdAt: string;
  }>;
}

const AVATAR_PRESETS = ["🧑‍💻", "👑", "🧙‍♂️", "⚔️", "🛡️", "🏹", "🥷", "⚡", "🌟", "🔥"];

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [user, setUser] = useState<UserDetailResponse | null>(null);
  const [activeTab, setActiveTab] = useState<
    "progression" | "quests" | "tasks" | "habits" | "achievements"
  >("progression");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  // Edit Modal State
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Modal State
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Feedback Toast
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    async function loadCurrentAdmin() {
      try {
        const res = await fetch("/api/v1/auth/me");
        const data = await res.json();
        if (data.success && data.data?.user?.id) {
          setCurrentAdminId(data.data.user.id);
        }
      } catch {
        // Non-critical
      }
    }
    loadCurrentAdmin();
  }, []);

  const handleOpenEdit = () => {
    if (!user) return;
    setEditDisplayName(user.displayName);
    setEditAvatar(user.avatar || "🧑‍💻");
    setEditRole(user.role);
    setEditError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!editDisplayName.trim()) {
      setEditError("Display name cannot be empty");
      return;
    }

    setEditSubmitting(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editDisplayName.trim(),
          avatar: editAvatar.trim() || "🧑‍💻",
          role: editRole,
        }),
      });

      const data = await res.json();
      if (data.success && data.data?.user) {
        const updated = data.data.user;
        setUser((prev) =>
          prev
            ? {
                ...prev,
                displayName: updated.displayName,
                avatar: updated.avatar,
                role: updated.role,
                level: updated.level ?? prev.level,
                totalXp: updated.totalXp ?? prev.totalXp,
              }
            : null
        );
        setIsEditing(false);
        setFeedback("User profile updated successfully.");
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setEditError(data.error?.message || "Failed to update user");
      }
    } catch {
      setEditError("Network error updating user");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleOpenDelete = () => {
    setDeleteConfirmText("");
    setDeleteError(null);
    setIsDeleting(true);
  };

  const handleConfirmDelete = async () => {
    if (!user) return;

    if (currentAdminId && user.id === currentAdminId) {
      setDeleteError("Cannot delete your own admin account.");
      return;
    }

    if (deleteConfirmText.trim() !== "DELETE") {
      setDeleteError('Please type "DELETE" exactly to confirm.');
      return;
    }

    setDeleteSubmitting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        router.push("/admin/users");
      } else {
        setDeleteError(data.error?.message || "Failed to delete user");
      }
    } catch {
      setDeleteError("Network error deleting user");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  useEffect(() => {
    async function loadUser() {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/admin/users/${id}`);
        const data = await res.json();
        if (data.success && data.data?.user) {
          setUser(data.data.user);
          setError(null);
        } else {
          setError(data.error?.message || "Player not found");
        }
      } catch {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [id]);

  if (loading) {
    return (
      <div className="p-16 text-center">
        <div className="inline-block px-6 py-2 rounded-xl text-xs text-white/40 animate-shimmer">Loading player intelligence...</div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="glass-card p-8 border border-white/10 text-center space-y-4">
        <p className="text-sm text-rose-400 font-semibold">{error || "Player not found"}</p>
        <Link
          href="/admin/users"
          className="inline-block px-4 py-2 rounded-xl text-xs font-bold text-white bg-white/10 hover:bg-white/15"
        >
          ← Back to User Directory
        </Link>
      </div>
    );
  }

  const isCurrentAdmin = currentAdminId === user.id;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Feedback Banner ─────────────────────────────────── */}
      {feedback && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between">
          <span>✅ {feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Breadcrumb & Navigation ─────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/50 hover:text-white transition-colors"
        >
          <span>←</span>
          <span>Back to User Directory</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-all"
          >
            <span>✏️</span>
            <span>Edit Profile</span>
          </button>

          <button
            onClick={handleOpenDelete}
            disabled={isCurrentAdmin}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isCurrentAdmin
                ? "opacity-30 cursor-not-allowed bg-white/5 text-white/40 border border-white/10"
                : "text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20"
            }`}
            title={isCurrentAdmin ? "Cannot delete self" : "Delete User"}
          >
            <span>🗑️</span>
            <span>Delete User</span>
          </button>

          <Link
            href={`/admin/rewards?user=${user.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 transition-all shadow-sm"
          >
            <span>🎁</span>
            <span>Grant XP / Badge</span>
          </Link>
        </div>
      </div>

      {/* ── Player Header Profile Banner ───────────────────── */}
      <div className="glass-card p-6 border border-white/10 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 via-purple-500/20 to-cyan-500/20 border border-white/15 flex items-center justify-center text-3xl shadow-xl shrink-0">
              {user.avatar || "🧑‍💻"}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
                  {user.displayName}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wider ${
                    user.role === "ADMIN"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : user.isGuest
                      ? "bg-white/5 text-white/40 border border-white/10"
                      : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                  }`}
                >
                  {user.role === "ADMIN" ? "🛡️ ADMIN" : user.isGuest ? "GUEST" : "PLAYER"}
                </span>
              </div>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                {user.email || "(no email — guest account)"}
              </p>
              <p className="text-[0.68rem] text-white/30 font-mono mt-1">
                ID: {user.id} · Member since {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Player Quick Stats */}
          <div className="flex items-center gap-4 divide-x divide-white/10 bg-black/30 p-3.5 rounded-2xl border border-white/5 shrink-0">
            <div className="px-3 text-center">
              <p className="text-xs text-white/40 font-medium">Level</p>
              <p className="text-xl font-black text-amber-300">{user.level}</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-xs text-white/40 font-medium">Total XP</p>
              <p className="text-xl font-black text-purple-300">{user.totalXp.toLocaleString()}</p>
            </div>
            <div className="px-3 text-center">
              <p className="text-xs text-white/40 font-medium">Streak</p>
              <p className="text-xl font-black text-orange-400">🔥 {user.streak.currentStreak}d</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab("progression")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "progression"
              ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          ✨ XP Ledger ({user.recentXp.length})
        </button>
        <button
          onClick={() => setActiveTab("quests")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "quests"
              ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          ⚔️ Quests ({user.quests.length})
        </button>
        <button
          onClick={() => setActiveTab("tasks")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "tasks"
              ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          ✅ Tasks ({user.tasks.length})
        </button>
        <button
          onClick={() => setActiveTab("habits")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "habits"
              ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          🧘 Habits ({user.habits.length})
        </button>
        <button
          onClick={() => setActiveTab("achievements")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "achievements"
              ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
              : "text-white/50 hover:text-white"
          }`}
        >
          🎖️ Achievements ({user.achievements.length})
        </button>
      </div>

      {/* ── Tab Content ────────────────────────────────────── */}
      <div className="glass-card p-5 border border-white/10">
        {activeTab === "progression" && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-4">
              Recent XP Transactions (Authoritative Append-Only Ledger)
            </h3>
            {user.recentXp.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No XP transactions recorded.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {user.recentXp.map((tx, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center text-xs font-bold">
                        XP
                      </span>
                      <div>
                        <p className="font-semibold text-white">Source: {tx.sourceType}</p>
                        <p className="text-[0.65rem] text-white/40 font-mono">
                          {new Date(tx.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-purple-300">
                      +{tx.amount.toLocaleString()} XP
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "quests" && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-4">
              Assigned & AI Quests
            </h3>
            {user.quests.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No quests assigned yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {user.quests.map((q) => (
                  <div key={q.id} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{q.title}</span>
                      <span className="px-1.5 py-0.5 rounded text-[0.62rem] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {q.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[0.68rem] text-white/40">
                      <span>Difficulty: {q.difficulty}</span>
                      <span>{new Date(q.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-4">
              Player Task List
            </h3>
            {user.tasks.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No tasks recorded.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {user.tasks.map((t) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-white">{t.title}</p>
                      <p className="text-[0.65rem] text-white/40">
                        Difficulty: {t.difficulty} · Created: {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[0.62rem] font-bold uppercase ${
                        t.status === "COMPLETED"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-white/5 text-white/50"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "habits" && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-4">
              Habits & Rituals
            </h3>
            {user.habits.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No habits configured.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {user.habits.map((h) => (
                  <div key={h.id} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-white text-xs">{h.title}</p>
                      <p className="text-[0.68rem] text-white/40">Frequency: {h.frequency}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-orange-400 text-xs">🔥 {h.streakCurrent}d streak</p>
                      <p className="text-[0.65rem] text-white/40">Best: {h.streakBest}d</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "achievements" && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-4">
              Unlocked Achievements
            </h3>
            {user.achievements.length === 0 ? (
              <p className="text-xs text-white/40 py-6 text-center">No badges unlocked yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {user.achievements.map((a, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/20 flex items-start gap-3">
                    <span className="text-2xl">🎖️</span>
                    <div>
                      <p className="font-bold text-white text-xs">{a.achievement.name}</p>
                      <p className="text-[0.68rem] text-white/60">{a.achievement.description}</p>
                      <p className="text-[0.62rem] text-purple-300 font-mono mt-1">
                        Unlocked {new Date(a.unlockedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit User Modal ─────────────────────────────────── */}
      {isEditing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => !editSubmitting && setIsEditing(false)}
        >
          <div
            className="glass-card border border-white/20 p-6 max-w-md w-full shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">✏️</span>
                <h3 id="edit-user-detail-title" className="text-base font-bold text-white">
                  Edit Player Profile
                </h3>
              </div>
              <button
                onClick={() => !editSubmitting && setIsEditing(false)}
                className="text-white/40 hover:text-white transition-colors"
                disabled={editSubmitting}
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/60 mb-1">
                  Email (Read-Only)
                </label>
                <input
                  type="text"
                  value={user.email ?? ""}
                  placeholder={!user.email ? "(no email — guest account)" : undefined}
                  disabled
                  className="w-full px-3.5 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white/50 font-mono cursor-not-allowed"
                />
                <span className="text-[0.62rem] text-white/30 mt-1 block">
                  Email changes are restricted to avoid account takeover.
                </span>
              </div>

              <div>
                <label
                  htmlFor="detail-edit-display-name"
                  className="block text-xs font-semibold text-white/80 mb-1"
                >
                  Display Name
                </label>
                <input
                  id="detail-edit-display-name"
                  type="text"
                  maxLength={100}
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 bg-black/40 border border-white/15 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-1">
                  Avatar
                </label>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditAvatar(preset)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm border transition-all ${
                        editAvatar === preset
                          ? "bg-amber-500/20 border-amber-400 scale-110"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  id="detail-edit-avatar-input"
                  type="text"
                  maxLength={50}
                  placeholder="Or enter custom emoji / text..."
                  value={editAvatar}
                  onChange={(e) => setEditAvatar(e.target.value)}
                  className="w-full px-3.5 py-2 bg-black/40 border border-white/15 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="detail-edit-role-select"
                  className="block text-xs font-semibold text-white/80 mb-1"
                >
                  Role
                </label>
                <select
                  id="detail-edit-role-select"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as "USER" | "ADMIN")}
                  className="appearance-none w-full px-3.5 py-2 pr-8 bg-black/40 border border-white/15 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 transition-colors"
                >
                  <option value="USER">USER (Standard Player)</option>
                  <option value="ADMIN">ADMIN (Full Administrative Privileges)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={editSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 disabled:opacity-50 transition-colors"
                >
                  {editSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ───────────────────────── */}
      {isDeleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-delete-user-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => !deleteSubmitting && setIsDeleting(false)}
        >
          <div
            className="glass-card border border-rose-500/30 p-6 max-w-md w-full shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-rose-500/20 pb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 id="detail-delete-user-title" className="text-base font-black text-rose-400">
                  Delete User Account
                </h3>
                <p className="text-xs text-white/50">This action cannot be undone.</p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {deleteError}
              </div>
            )}

            {isCurrentAdmin ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                <p className="font-bold">Cannot Delete Your Own Account</p>
                <p className="text-white/70">
                  Admins are protected from deleting their own active session via this endpoint.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setIsDeleting(false)}
                    className="w-full px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5 text-xs">
                  <p className="text-white/60">
                    Target Player:{" "}
                    <span className="font-bold text-white">
                      {user.displayName}
                    </span>
                  </p>
                  <p className="text-white/60 font-mono text-[0.68rem]">
                    Email: {user.email || "(no email — guest account)"}
                  </p>
                  <p className="text-white/40 font-mono text-[0.65rem]">
                    User ID: {user.id}
                  </p>
                </div>

                <p className="text-xs text-white/70 leading-relaxed">
                  Deleting this user will permanently remove their profile, tasks, habits,
                  focus sessions, and quest records in accordance with database cascade rules.
                </p>

                <div>
                  <label
                    htmlFor="detail-delete-confirm-input"
                    className="block text-xs font-bold text-white/80 mb-1"
                  >
                    Type <span className="text-rose-400 font-mono">DELETE</span> to confirm:
                  </label>
                  <input
                    id="detail-delete-confirm-input"
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="w-full px-3.5 py-2 bg-black/40 border border-rose-500/30 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-rose-400 transition-colors"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setIsDeleting(false)}
                    disabled={deleteSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={deleteConfirmText.trim() !== "DELETE" || deleteSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleteSubmitting ? "Deleting..." : "Permanently Delete User"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
