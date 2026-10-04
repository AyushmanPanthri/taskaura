"use client";

// ============================================================
// Task Aura — Dedicated Habits View (/habits)
// Server-backed habit tracking, streak integration,
// idempotent daily logging, and commitment tracking.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import {
  triggerCelebration,
  triggerGamificationUpdate,
  triggerXpToast,
} from "@/components/AppShell";
import { EmptyState, ErrorState } from "@/components/States";
import type { HabitWithTodayStatus } from "@/lib/services/habit-service";
import { HabitFrequency } from "@/lib/logic/types";

export default function HabitsPage() {
  const [habits, setHabits] = useState<HabitWithTodayStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Creation form state
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [frequency, setFrequency] = useState<HabitFrequency>(HabitFrequency.DAILY);
  const [creating, setCreating] = useState(false);

  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/habits");
      const json = await res.json();
      if (json.success) {
        setHabits(json.data);
        setError(null);
      } else {
        setError(json.error?.message ?? "Failed to load habits");
      }
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/habits")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) setHabits(json.data);
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

  const handleLog = async (habitId: string) => {
    try {
      const res = await fetch(`/api/v1/habits/${habitId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      const json = await res.json();
      if (
        json.success &&
        json.data.log?.completed &&
        !json.data.isDuplicate
      ) {
        triggerGamificationUpdate(json.data.gamification);
        if (json.data.xpAwarded > 0) {
          triggerXpToast(json.data.xpAwarded, "Habit Completed");
        }
        triggerCelebration("habit-complete");
        await fetchHabits();
      }
    } catch {
      // Habit log failed
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/v1/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          frequency,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTitle("");
        setShowCreate(false);
        await fetchHabits();
      }
    } finally {
      setCreating(false);
    }
  };

  const completedCount = habits.filter((h) => h.completedToday).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Daily Habits</h1>
          <p className="text-xs text-white/40 mt-1">
            Build compounding routines. Completing daily habits protects your streak.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="action-btn action-btn-primary flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span>{showCreate ? "✕ Close" : "+ New Habit"}</span>
        </button>
      </div>

      {/* Daily Streak Commitment Explainer */}
      <div className="glass-card p-4 border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-xl text-emerald-400">
            🌱
          </div>
          <div>
            <p className="text-xs font-bold text-white/90">Daily Commitment Target</p>
            <p className="text-[0.7rem] text-white/50">
              Log all daily habits OR complete at least 25 focus minutes to lock in today&apos;s streak.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-xs font-mono font-bold text-emerald-400">
            {completedCount} / {habits.length} Logged Today
          </span>
        </div>
      </div>

      {/* Creation Drawer / Form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="glass-card p-5 border border-purple-500/30 space-y-4 animate-fade-in-up"
        >
          <h3 className="font-bold text-sm text-white/90">Create New Habit</h3>
          <div>
            <label className="text-xs text-white/50 block mb-1">Habit Name</label>
            <input
              type="text"
              required
              placeholder="e.g. 15 Minutes Mindfulness"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          <div>
            <label className="text-xs text-white/50 block mb-1">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as HabitFrequency)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            >
              <option value="DAILY" className="bg-[#121220]">Daily (Every day)</option>
              <option value="WEEKDAYS" className="bg-[#121220]">Weekdays Only</option>
              <option value="WEEKENDS" className="bg-[#121220]">Weekends Only</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="action-btn action-btn-ghost text-xs py-2 px-4"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="action-btn action-btn-primary text-xs py-2 px-5"
            >
              {creating ? "Creating..." : "Save Habit"}
            </button>
          </div>
        </form>
      )}

      {/* Habit List */}
      {loading ? (
        <div className="glass-card p-8 text-center text-white/40 text-sm">
          Loading habits from server...
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchHabits} />
      ) : habits.length === 0 ? (
        <EmptyState
          title="No habits configured"
          description="Build daily momentum by tracking routines like reading, meditating, or reviewing flashcards."
          actionLabel="+ New Habit"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="glass-card divide-y divide-white/5">
          {habits.map((habit) => (
            <div
              key={habit.id}
              className="flex items-center gap-4 p-4 transition-colors hover:bg-white/[0.02]"
            >
              <button
                className={`task-check ${habit.completedToday ? "completed" : ""}`}
                onClick={() => !habit.completedToday && handleLog(habit.id)}
                disabled={habit.completedToday}
                aria-label={`Toggle: ${habit.title}`}
              >
                {habit.completedToday && <span className="text-white text-xs">✓</span>}
              </button>

              <div className="flex-1 min-w-0">
                <p
                  className={`font-semibold text-sm ${
                    habit.completedToday ? "line-through text-white/40" : "text-white/95"
                  }`}
                >
                  {habit.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="badge badge-purple text-[0.65rem]">{habit.frequency}</span>
                  <span className="text-xs text-orange-400 font-medium flex items-center gap-1">
                    <span>🔥</span>
                    <span>{habit.streak} day streak</span>
                  </span>
                </div>
              </div>

              <div className="text-right">
                <button
                  onClick={() => !habit.completedToday && handleLog(habit.id)}
                  disabled={habit.completedToday}
                  className={`action-btn text-xs py-1.5 px-3.5 ${
                    habit.completedToday
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "action-btn-primary"
                  }`}
                >
                  {habit.completedToday ? "Logged Today" : "+75 XP Check-in"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
