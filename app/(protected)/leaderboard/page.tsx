"use client";

// ============================================================
// Task Aura — Dedicated Leaderboard View (/leaderboard)
// Server-backed weekly standings (UTC Monday 00:00 boundary),
// dense ranking, podium medals, and privacy anonymization.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import { ErrorState } from "@/components/States";

interface LeaderboardEntry {
  rank: number;
  name: string;
  weeklyXp: number;
  isSelf: boolean;
}

interface LeaderboardData {
  weekStart: string;
  weekEnd: string;
  userRank: { rank: number; weeklyXp: number } | null;
  entries: LeaderboardEntry[];
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/leaderboard");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error?.message ?? "Failed to load leaderboard");
      }
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/leaderboard")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) setData(json.data);
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to connect to server");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const userRank = data?.userRank;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Weekly Arena</h1>
          <p className="text-xs text-white/40 mt-1">
            Friendly cohort competition reset every Monday at 00:00 UTC
          </p>
        </div>
        {data && (
          <span className="badge badge-cyan text-xs self-start sm:self-auto font-mono">
            {data.weekStart} → {data.weekEnd}
          </span>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={fetchLeaderboard} />}

      {/* User's Standing Hero Card */}
      {userRank && (
        <div className="glass-card p-5 border border-purple-500/30 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/30 to-cyan-500/30 flex items-center justify-center font-extrabold text-lg text-purple-300 border border-purple-500/40">
              #{userRank.rank}
            </div>
            <div>
              <p className="text-xs text-purple-300 font-semibold uppercase tracking-wider">
                Your Weekly Standing
              </p>
              <p className="text-lg font-bold text-white mt-0.5">
                Rank #{userRank.rank} in Cohort
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-extrabold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              {userRank.weeklyXp.toLocaleString()} XP
            </p>
            <p className="text-[0.65rem] text-white/40">Earned this week</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-white/40 text-xs">
            Calculating cohort rankings...
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-xs">
            No rankings available for this week.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {data.entries.map((entry) => {
              const isTop3 = entry.rank <= 3;
              const medal =
                entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : null;

              return (
                <div
                  key={entry.rank + entry.name}
                  className={`flex items-center gap-4 p-4 transition-colors ${
                    entry.isSelf
                      ? "bg-purple-500/10 border-l-2 border-purple-400"
                      : "hover:bg-white/[0.02]"
                  }`}
                >
                  {/* Rank badge */}
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm shrink-0 ${
                      entry.rank === 1
                        ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                        : entry.rank === 2
                        ? "bg-slate-300/15 text-slate-200 border border-slate-300/30"
                        : entry.rank === 3
                        ? "bg-amber-600/15 text-amber-400 border border-amber-600/30"
                        : "bg-white/5 text-white/40"
                    }`}
                  >
                    {medal ?? `#${entry.rank}`}
                  </div>

                  {/* Name & Self tag */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        entry.isSelf ? "text-purple-300 font-bold" : "text-white/90"
                      }`}
                    >
                      {entry.name}
                      {entry.isSelf && (
                        <span className="ml-2 badge badge-purple text-[0.65rem]">You</span>
                      )}
                    </p>
                    <p className="text-[0.68rem] text-white/30">
                      {isTop3 ? "Podium Contender" : "Active Contender"}
                    </p>
                  </div>

                  {/* Weekly XP */}
                  <div className="text-right">
                    <p className="font-extrabold text-sm text-purple-400">
                      {entry.weeklyXp.toLocaleString()} XP
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Philosophy Footnote */}
      <div className="text-center text-[0.7rem] text-white/30 py-2">
        Leaderboards are friendly motivation benchmarks. Consistency and your personal growth always take precedence.
      </div>
    </div>
  );
}
