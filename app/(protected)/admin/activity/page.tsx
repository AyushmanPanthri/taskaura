"use client";

// ============================================================
// TaskAura — Admin Audit Log (/admin/activity)
// Chronological record of administrative operations.
// Read-only, paginated, and structured for security review.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";

interface AuditLogRow {
  id: string;
  action: string;
  adminUserId: string;
  adminName: string;
  adminAvatar: string;
  targetUserId: string | null;
  targetUserName: string | null;
  targetQuestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  QUEST_CREATED: {
    bg: "bg-amber-500/10",
    text: "text-amber-300",
    border: "border-amber-500/30",
  },
  QUEST_ASSIGNED: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-300",
    border: "border-cyan-500/30",
  },
  XP_GRANTED: {
    bg: "bg-purple-500/10",
    text: "text-purple-300",
    border: "border-purple-500/30",
  },
  ACHIEVEMENT_GRANTED: {
    bg: "bg-pink-500/10",
    text: "text-pink-300",
    border: "border-pink-500/30",
  },
};

export default function AdminActivityPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 25,
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async (pageToLoad = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/activity?page=${pageToLoad}&limit=25`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.logs);
        setPagination(data.data.pagination);
        setError(null);
      } else {
        setError(data.error?.message || "Failed to load audit logs");
      }
    } catch {
      setError("Network error fetching activity logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitial = async () => {
      try {
        const res = await fetch("/api/v1/admin/activity?page=1&limit=25");
        const data = await res.json();
        if (!ignore) {
          if (data.success) {
            setLogs(data.data.logs);
            setPagination(data.data.pagination);
            setError(null);
          } else {
            setError(data.error?.message || "Failed to load audit logs");
          }
        }
      } catch {
        if (!ignore) setError("Network error fetching activity logs");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void loadInitial();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">📜</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Audit Activity Log
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {pagination.total} Records
            </span>
          </div>
          <p className="text-xs md:text-sm text-white/50 mt-1">
            Immutable log of all administrative actions, quest creations, and player reward grants.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-[0.68rem] text-white/60 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Immutable Audit Trail
          </span>
        </div>
      </div>

      {/* ── Logs List ──────────────────────────────────────── */}
      <div className="glass-card border border-white/10 overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-xs text-white/40 animate-pulse">
            Loading authoritative audit records...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-400">{error}</div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center text-xs text-white/40">
            No audit records created yet.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {logs.map((log) => {
              const style = ACTION_COLORS[log.action] || {
                bg: "bg-white/5",
                text: "text-white/80",
                border: "border-white/10",
              };

              return (
                <div
                  key={log.id}
                  className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.01] transition-colors"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-base shrink-0">
                      {log.adminAvatar || "👑"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-xs">{log.adminName}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[0.62rem] font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
                        >
                          {log.action.replace(/_/g, " ")}
                        </span>
                        {log.targetUserName && (
                          <span className="text-xs text-white/70">
                            → Target:{" "}
                            <span className="font-semibold text-amber-300">
                              {log.targetUserName}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Metadata Highlights */}
                      <div className="mt-1.5 flex items-center gap-3 text-xs flex-wrap">
                        {log.metadata.title ? (
                          <span className="text-white/80 font-medium">
                            Quest: &ldquo;{String(log.metadata.title)}&rdquo;
                          </span>
                        ) : null}
                        {log.metadata.amount !== undefined ? (
                          <span className="text-purple-300 font-mono font-bold">
                            +{String(log.metadata.amount)} XP
                          </span>
                        ) : null}
                        {log.metadata.achievementName ? (
                          <span className="text-pink-300 font-semibold">
                            Badge: {String(log.metadata.achievementName)}
                          </span>
                        ) : null}
                        {log.metadata.reason ? (
                          <span className="text-white/40 italic">
                            Reason: &ldquo;{String(log.metadata.reason)}&rdquo;
                          </span>
                        ) : null}
                        {log.metadata.targetType ? (
                          <span className="text-white/40 text-[0.68rem]">
                            Target: {String(log.metadata.targetType)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-[0.68rem] text-white/40 font-mono">
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                    <p className="text-[0.6rem] text-white/20 font-mono mt-0.5">
                      ID: {log.id.slice(0, 8)}...
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-white/50">
            <span>
              Page {pagination.page} of {pagination.pages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchLogs(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => fetchLogs(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
