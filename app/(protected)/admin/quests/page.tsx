"use client";

// ============================================================
// TaskAura — Quest Forge (/admin/quests)
// Command view for forged and global missions.
// Review active, draft, and completed quests; filter by status.
// ============================================================

import React, { useState, useEffect } from "react";
import Link from "next/link";

interface QuestRow {
  id: string;
  title: string;
  description: string;
  difficulty: "EASY" | "NORMAL" | "HARD" | "EPIC" | "LEGENDARY";
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "EXPIRED";
  xpReward: number | null;
  deadline: string | null;
  targetType: "PERSONAL" | "SPECIFIC" | "GLOBAL";
  createdByAdmin: string | null;
  createdAt: string;
  assignedCount: number;
}

const DIFFICULTY_STYLES: Record<string, string> = {
  EASY: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  NORMAL: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20",
  HARD: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  EPIC: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  LEGENDARY: "bg-gradient-to-r from-amber-400 to-rose-500 text-black font-black border-amber-400",
};

export default function AdminQuestsPage() {
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const url =
          statusFilter === "ALL"
            ? "/api/v1/admin/quests"
            : `/api/v1/admin/quests?status=${statusFilter}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!ignore) {
          if (data.success) {
            setQuests(data.data.quests);
            setError(null);
          } else {
            setError(data.error?.message || "Failed to load quests");
          }
        }
      } catch {
        if (!ignore) setError("Network error loading quests");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [statusFilter]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚔️</span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Quest Forge
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Admin Missions
            </span>
          </div>
          <p className="text-xs md:text-sm text-white/50 mt-1">
            Design global server challenges, configure authoritative XP bounties, and fan out assignments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin/quests/create"
            id="quest-forge-create-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 transition-all shadow-[0_0_15px_rgba(245,158,11,0.25)]"
          >
            <span>⚔️</span>
            <span>Forge New Quest</span>
          </Link>
        </div>
      </div>

      {/* ── Filter Tabs ────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        {["ALL", "ACTIVE", "DRAFT", "COMPLETED", "EXPIRED"].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              statusFilter === st
                ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                : "text-white/50 hover:text-white"
            }`}
          >
            {st === "ALL" ? "All Quests" : st}
          </button>
        ))}
      </div>

      {/* ── Quests Grid ────────────────────────────────────── */}
      {loading ? (
        <div className="p-16 text-center text-xs text-white/40 animate-pulse">
          Loading forged quests...
        </div>
      ) : error ? (
        <div className="glass-card p-8 text-center text-xs text-rose-400 border border-white/10">
          {error}
        </div>
      ) : quests.length === 0 ? (
        <div className="glass-card p-12 text-center space-y-3 border border-white/10">
          <p className="text-2xl">⚔️</p>
          <p className="text-sm font-bold text-white">No quests found in this category</p>
          <p className="text-xs text-white/40">
            Forge a global challenge or create a targeted quest for your community.
          </p>
          <Link
            href="/admin/quests/create"
            className="inline-block px-4 py-2 rounded-xl text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 mt-2"
          >
            Forge First Quest
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quests.map((q) => (
            <div
              key={q.id}
              className="glass-card p-5 border border-white/10 hover:border-amber-500/30 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[0.62rem] font-bold uppercase tracking-wider border ${
                      DIFFICULTY_STYLES[q.difficulty] || DIFFICULTY_STYLES.NORMAL
                    }`}
                  >
                    {q.difficulty}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase bg-white/5 text-white/60 border border-white/10">
                      {q.targetType}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase ${
                        q.status === "ACTIVE"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : q.status === "DRAFT"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-white/5 text-white/40 border border-white/10"
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-sm text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                    {q.title}
                  </h3>
                  <p className="text-xs text-white/50 line-clamp-2 mt-1">
                    {q.description}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-bold text-purple-300 font-mono">
                  <span>✨</span>
                  <span>{q.xpReward !== null ? `${q.xpReward} XP` : "Rule XP"}</span>
                </div>
                <div className="flex items-center gap-2 text-[0.68rem] text-white/40">
                  <span>👥 {q.assignedCount} assigned</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
