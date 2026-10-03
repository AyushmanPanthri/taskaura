"use client";

// ============================================================
// TaskAura — Admin User Directory (/admin/users)
// Searchable, filterable directory of all players and staff.
// Displays live DB-backed XP, level, streak, tasks, and habits.
// Provides View, Update (name/avatar/role), and Delete actions.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  role: "USER" | "ADMIN";
  avatar: string;
  createdAt: string;
  level: number;
  totalXp: number;
  streak: number;
  taskCount: number;
  habitCount: number;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const AVATAR_PRESETS = ["🧑‍💻", "👑", "🧙‍♂️", "⚔️", "🛡️", "🏹", "🥷", "⚡", "🌟", "🔥"];

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal State
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editRole, setEditRole] = useState<"USER" | "ADMIN">("USER");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Modal State
  const [deletingUser, setDeletingUser] = useState<AdminUserRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Success Feedback Toast
  const [feedback, setFeedback] = useState<string | null>(null);

  // Load current admin identity to guard self-deletion
  useEffect(() => {
    async function loadCurrentAdmin() {
      try {
        const res = await fetch("/api/v1/auth/me");
        const data = await res.json();
        if (data.success && data.data?.user?.id) {
          setCurrentAdminId(data.data.user.id);
        }
      } catch {
        // Non-critical: server-side requireAdmin will still prevent self-deletion
      }
    }
    loadCurrentAdmin();
  }, []);

  const fetchUsers = useCallback(
    async (pageToLoad = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageToLoad));
        params.set("limit", "20");
        if (search.trim()) params.set("search", search.trim());
        if (roleFilter !== "ALL") params.set("role", roleFilter);
        if (accountTypeFilter !== "ALL") params.set("accountType", accountTypeFilter);

        const res = await fetch(`/api/v1/admin/users?${params.toString()}`);
        const data = await res.json();

        if (data.success) {
          setUsers(data.data.users);
          setPagination(data.data.pagination);
          setError(null);
        } else {
          setError(data.error?.message || "Failed to load users");
        }
      } catch {
        setError("Network error fetching users");
      } finally {
        setLoading(false);
      }
    },
    [search, roleFilter, accountTypeFilter]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  // Open Edit Modal
  const handleOpenEdit = (user: AdminUserRow) => {
    setEditingUser(user);
    setEditDisplayName(user.displayName);
    setEditAvatar(user.avatar || "🧑‍💻");
    setEditRole(user.role);
    setEditError(null);
  };

  // Submit Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (!editDisplayName.trim()) {
      setEditError("Display name cannot be empty");
      return;
    }

    setEditSubmitting(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/v1/admin/users/${editingUser.id}`, {
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
        setUsers((prev) =>
          prev.map((u) =>
            u.id === editingUser.id
              ? {
                  ...u,
                  displayName: updated.displayName,
                  avatar: updated.avatar,
                  role: updated.role,
                  level: updated.level ?? u.level,
                  totalXp: updated.totalXp ?? u.totalXp,
                }
              : u
          )
        );
        setEditingUser(null);
        setFeedback(`User ${updated.displayName} updated successfully.`);
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

  // Open Delete Modal
  const handleOpenDelete = (user: AdminUserRow) => {
    setDeletingUser(user);
    setDeleteConfirmText("");
    setDeleteError(null);
  };

  // Submit Delete
  const handleConfirmDelete = async () => {
    if (!deletingUser) return;

    if (currentAdminId && deletingUser.id === currentAdminId) {
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
      const res = await fetch(`/api/v1/admin/users/${deletingUser.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        const deletedId = deletingUser.id;
        const deletedName = deletingUser.displayName;
        setUsers((prev) => prev.filter((u) => u.id !== deletedId));
        setPagination((prev) => ({
          ...prev,
          total: Math.max(0, prev.total - 1),
        }));
        setDeletingUser(null);
        setFeedback(`User ${deletedName} deleted permanently.`);
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setDeleteError(data.error?.message || "Failed to delete user");
      }
    } catch {
      setDeleteError("Network error deleting user");
    } finally {
      setDeleteSubmitting(false);
    }
  };

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

      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">👥</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              User Directory
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
              {pagination.total} Accounts
            </span>
          </div>
          <p className="text-xs md:text-sm text-white/50 mt-1">
            Search, inspect player telemetry, edit user details, and manage accounts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin/rewards"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 transition-all"
          >
            <span>🎁</span>
            <span>Grant XP / Badge</span>
          </Link>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────── */}
      <div className="glass-card p-4 border border-white/10 flex flex-col md:flex-row items-center gap-3">
        {/* Search */}
        <div className="relative w-full md:flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-sm">
            🔍
          </span>
          <input
            type="text"
            id="admin-user-search-input"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-black/30 border border-white/10 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>

        {/* Role Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="admin-role-filter" className="text-xs text-white/50 shrink-0">
            Role:
          </label>
          <select
            id="admin-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="appearance-none px-3 py-2 pr-8 bg-black/30 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          >
            <option value="ALL">All Roles</option>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>

        {/* Account Type Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label htmlFor="admin-account-type-filter" className="text-xs text-white/50 shrink-0">
            Type:
          </label>
          <select
            id="admin-account-type-filter"
            value={accountTypeFilter}
            onChange={(e) => setAccountTypeFilter(e.target.value)}
            className="appearance-none px-3 py-2 pr-8 bg-black/30 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50 transition-colors"
          >
            <option value="ALL">All Types</option>
            <option value="registered">Registered</option>
            <option value="guest">Guest</option>
          </select>
        </div>
      </div>

      {/* ── Users Table ────────────────────────────────────── */}
      <div className="glass-card border border-white/10 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block px-6 py-2 rounded-xl text-xs text-white/40 animate-shimmer">Loading player database...</div>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-400">
            {error}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-xs text-white/40">
            No players found matching current query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-white/40 font-semibold uppercase tracking-wider text-[0.68rem]">
                  <th className="py-3 px-4">Player</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Progression</th>
                  <th className="py-3 px-4">Streak</th>
                  <th className="py-3 px-4">Quests / Habits</th>
                  <th className="py-3 px-4">Joined</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => {
                  const isCurrentAdmin = currentAdminId === u.id;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => router.push(`/admin/users/${u.id}`)}
                      className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-base shrink-0 group-hover:scale-105 transition-transform">
                            {u.avatar || "🧑‍💻"}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-bold text-white group-hover:text-amber-300 transition-colors truncate">
                                {u.displayName}
                              </p>
                              {isCurrentAdmin && (
                                <span className="px-1.5 py-0.2 rounded text-[0.58rem] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[0.65rem] text-white/40 truncate font-mono">
                              {u.email || "(no email — guest account)"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[0.62rem] font-bold uppercase tracking-wider ${
                            u.role === "ADMIN"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : u.isGuest
                              ? "bg-white/5 text-white/40 border border-white/10"
                              : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                          }`}
                        >
                          {u.role === "ADMIN" ? "🛡️ ADMIN" : u.isGuest ? "GUEST" : "PLAYER"}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">Lvl {u.level}</span>
                          <span className="text-[0.65rem] text-purple-300 font-mono">
                            ({u.totalXp.toLocaleString()} XP)
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 font-bold text-orange-400">
                          <span>🔥</span>
                          <span>{u.streak}d</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-white/70">
                        <span>{u.taskCount} tasks</span>
                        <span className="mx-1 text-white/30">·</span>
                        <span>{u.habitCount} habits</span>
                      </td>

                      <td className="py-3 px-4 text-white/40 text-[0.68rem] whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>

                      <td
                        className="py-3 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[0.7rem] font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                            title="Inspect user profile"
                          >
                            <span>Inspect</span>
                            <span>→</span>
                          </Link>

                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[0.7rem] font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
                            title="Edit user details"
                          >
                            <span>✏️</span>
                            <span>Edit</span>
                          </button>

                          <button
                            onClick={() => handleOpenDelete(u)}
                            disabled={isCurrentAdmin}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[0.7rem] font-semibold transition-colors ${
                              isCurrentAdmin
                                ? "opacity-30 cursor-not-allowed bg-white/5 text-white/40 border border-white/10"
                                : "text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20"
                            }`}
                            title={
                              isCurrentAdmin
                                ? "You cannot delete your own account"
                                : "Delete user permanently"
                            }
                          >
                            <span>🗑️</span>
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {pagination.pages > 1 && (
          <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-white/50">
            <span>
              Page {pagination.page} of {pagination.pages} ({pagination.total} players)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchUsers(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => fetchUsers(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit User Modal ─────────────────────────────────── */}
      {editingUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => !editSubmitting && setEditingUser(null)}
        >
          <div
            className="glass-card border border-white/20 p-6 max-w-md w-full shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">✏️</span>
                <h3 id="edit-user-title" className="text-base font-bold text-white">
                  Edit User Details
                </h3>
              </div>
              <button
                onClick={() => !editSubmitting && setEditingUser(null)}
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
                  value={editingUser.email ?? ""}
                  placeholder={!editingUser.email ? "(no email — guest account)" : undefined}
                  disabled
                  className="w-full px-3.5 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white/50 font-mono cursor-not-allowed"
                />
                <span className="text-[0.62rem] text-white/30 mt-1 block">
                  Email changes are restricted to avoid account takeover.
                </span>
              </div>

              <div>
                <label
                  htmlFor="edit-display-name"
                  className="block text-xs font-semibold text-white/80 mb-1"
                >
                  Display Name
                </label>
                <input
                  id="edit-display-name"
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
                  id="edit-avatar-input"
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
                  htmlFor="edit-role-select"
                  className="block text-xs font-semibold text-white/80 mb-1"
                >
                  Role
                </label>
                <select
                  id="edit-role-select"
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
                  onClick={() => setEditingUser(null)}
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
      {deletingUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => !deleteSubmitting && setDeletingUser(null)}
        >
          <div
            className="glass-card border border-rose-500/30 p-6 max-w-md w-full shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-rose-500/20 pb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 id="delete-user-title" className="text-base font-black text-rose-400">
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

            {currentAdminId && deletingUser.id === currentAdminId ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                <p className="font-bold">Cannot Delete Your Own Account</p>
                <p className="text-white/70">
                  Admins are protected from deleting their own active session via this endpoint.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setDeletingUser(null)}
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
                      {deletingUser.displayName}
                    </span>
                  </p>
                  <p className="text-white/60 font-mono text-[0.68rem]">
                    Email: {deletingUser.email || "(no email — guest account)"}
                  </p>
                  <p className="text-white/40 font-mono text-[0.65rem]">
                    User ID: {deletingUser.id}
                  </p>
                </div>

                <p className="text-xs text-white/70 leading-relaxed">
                  Deleting this user will permanently remove their profile, tasks, habits,
                  focus sessions, and quest records in accordance with database cascade rules.
                </p>

                <div>
                  <label
                    htmlFor="delete-confirm-input"
                    className="block text-xs font-bold text-white/80 mb-1"
                  >
                    Type <span className="text-rose-400 font-mono">DELETE</span> to confirm:
                  </label>
                  <input
                    id="delete-confirm-input"
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
                    onClick={() => setDeletingUser(null)}
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
