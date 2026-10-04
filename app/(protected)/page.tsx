"use client";

// ============================================================
// Task Aura — Dashboard View (/)
// Focused "How am I doing today?" overview:
// stat cards, today's tasks & habits, AI guidance, and achievements.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Ring } from "@/components/Ring";
import {
  triggerCelebration,
  triggerGamificationUpdate,
  triggerXpToast,
} from "@/components/AppShell";
import { handleTaskCompletionResponse } from "@/components/task-completion-feedback";
import { AiProposalCard } from "@/components/AiProposalCard";
import { ErrorState } from "@/components/States";
import type { ProgressSummary } from "@/lib/services/progress-service";
import type { Task } from "@/lib/logic/types";
import type { HabitWithTodayStatus } from "@/lib/services/habit-service";
import type { CompletionGamification } from "@/lib/logic/completion-gamification";

const DIFF_BADGE: Record<string, { cls: string; label: string }> = {
  EASY: { cls: "badge-green", label: "Easy" },
  NORMAL: { cls: "badge-cyan", label: "Normal" },
  HARD: { cls: "badge-orange", label: "Hard" },
  EPIC: { cls: "badge-pink", label: "Epic" },
};

export default function DashboardPage() {
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<HabitWithTodayStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [streakPulse, setStreakPulse] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [pRes, tRes, hRes] = await Promise.all([
        fetch("/api/v1/progress").then((r) => r.json()).catch(() => null),
        fetch("/api/v1/tasks").then((r) => r.json()).catch(() => null),
        fetch("/api/v1/habits").then((r) => r.json()).catch(() => null),
      ]);

      if (pRes?.success) {
        setProgress(pRes.data);
        setError(null);
      } else {
        setError(pRes?.error?.message ?? "Progress unavailable");
      }

      if (tRes?.success) setTasks(tRes.data);
      if (hRes?.success) setHabits(hRes.data);
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [pRes, tRes, hRes] = await Promise.all([
          fetch("/api/v1/progress").then((r) => r.json()).catch(() => null),
          fetch("/api/v1/tasks").then((r) => r.json()).catch(() => null),
          fetch("/api/v1/habits").then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;

        if (pRes?.success) {
          setProgress(pRes.data);
        } else {
          setError(pRes?.error?.message ?? "Progress unavailable");
        }
        if (tRes?.success) setTasks(tRes.data);
        if (hRes?.success) setHabits(hRes.data);
      } catch {
        if (!cancelled) setError("Unable to connect to server");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onGamificationUpdate = (event: Event) => {
      const gamification = (
        event as CustomEvent<CompletionGamification>
      ).detail;
      if (!gamification?.xp || !gamification.progression) return;

      setProgress((current) => {
        if (!current) return current;
        return {
          ...current,
          totalXp: gamification.xp!.newTotal,
          level: gamification.progression!.newLevel,
          fraction: gamification.progression!.levelProgress,
          xpEarnedInLevel: gamification.progression!.xpIntoLevel,
          xpRequiredForLevel: gamification.progression!.xpForNextLevel,
          xpRemaining: Math.max(
            0,
            gamification.progression!.xpForNextLevel -
              gamification.progression!.xpIntoLevel
          ),
          levelProgressPercentage:
            gamification.progression!.levelProgress * 100,
          streak: gamification.streak
            ? { ...current.streak, current: gamification.streak.current }
            : current.streak,
          achievements: current.achievements.map((achievement) => {
            const unlocked = gamification.achievements?.find(
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
      });
      if (
        gamification.streak?.changed &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setStreakPulse(true);
        setTimeout(() => setStreakPulse(false), 900);
      }
    };

    window.addEventListener("taskaura:gamification-update", onGamificationUpdate);
    return () =>
      window.removeEventListener("taskaura:gamification-update", onGamificationUpdate);
  }, []);

  const handleCompleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success && json.data) {
        handleTaskCompletionResponse(json.data, {
          onConfirmed: (completedTask) => {
            setTasks((current) =>
              current.map((task) =>
                task.id === completedTask.id
                  ? { ...task, ...completedTask }
                  : task
              )
            );
            setProgress((current) =>
              current
                ? {
                    ...current,
                    dailyMetrics: {
                      ...current.dailyMetrics,
                      tasksCompleted: current.dailyMetrics.tasksCompleted + 1,
                    },
                  }
                : current
            );
          },
          onRejected: (rejection) => {
            const reason =
              rejection.gamification?.feedback.reason ??
              rejection.reason ??
              "REJECTED";
            const remainingMs =
              rejection.gamification?.feedback.remainingMs;
            setCompletionNotice(
              remainingMs && remainingMs > 0
                ? `${reason}: ${Math.ceil(remainingMs / 60_000)}m remaining.`
                : `Completion rejected: ${reason}`
            );
          },
        });
      }
    } catch {
      // Failed to complete
    }
  };

  const handleToggleHabit = async (habitId: string) => {
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
          triggerXpToast(json.data.xpAwarded, "Habit Logged");
        }
        triggerCelebration("habit-complete");
        await fetchDashboardData();
      }
    } catch {
      // Failed to log habit
    }
  };

  // Authoritative metrics
  const level = progress?.level ?? 1;
  const totalXp = progress?.totalXp ?? 0;
  const levelPct = progress ? progress.fraction * 100 : 0;
  const streakDays = progress?.streak.current ?? 0;
  const completedTasksToday = progress?.dailyMetrics.tasksCompleted ?? 0;
  const focusMinutesToday = progress?.dailyMetrics.focusMinutes ?? 0;
  const totalTasks = tasks.length;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Error state */}
      {error && <ErrorState message={error} onRetry={fetchDashboardData} />}
      {completionNotice && (
        <div className="glass-card px-4 py-3 border border-amber-500/30 text-sm text-amber-200" role="alert">
          {completionNotice}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="glass-card p-10 text-center text-white/40 text-sm">
          Synchronizing authoritative progress...
        </div>
      ) : (
        <>
          {/* Welcome + Streak Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Welcome back, {progress?.title ?? "Hero"} 👋
              </h1>
              <p className="text-xs text-white/40 mt-1">
                Here is your authoritative productivity standing today
              </p>
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/5 px-4 py-2 rounded-2xl">
              <span className={`text-2xl${streakPulse ? " streak-flame" : ""}`}>🔥</span>
              <div>
                <p className="text-xl font-extrabold text-orange-400">{streakDays} day streak</p>
                <p className="text-[0.65rem] text-white/40">Active Streak</p>
              </div>
            </div>
          </div>

          {/* 4 Stat Cards Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total XP */}
            <div className="glass-card p-5 flex flex-col justify-between">
              <div>
                <p className="section-title">Total XP</p>
                <p className="text-2xl font-extrabold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  {totalXp.toLocaleString()}
                </p>
              </div>
              <div className="mt-4 pt-2">
                <div className="flex justify-between text-[0.7rem] text-white/40 mb-1">
                  <span>Level {level}</span>
                  <span>Level {level + 1}</span>
                </div>
                <div className="xp-bar-track">
                  <div className="xp-bar-fill" style={{ width: `${levelPct}%` }} />
                </div>
              </div>
            </div>

            {/* Tasks Completed */}
            <div className="glass-card p-5 flex flex-col justify-between">
              <p className="section-title">Tasks Completed</p>
              <div className="flex items-center gap-3 mt-1">
                <Ring value={completedTasksToday} max={Math.max(totalTasks, 1)} size={54} color="#34d399">
                  <span className="text-xs font-bold text-emerald-400">{completedTasksToday}</span>
                </Ring>
                <div>
                  <p className="text-lg font-bold text-white">{completedTasksToday}</p>
                  <p className="text-[0.65rem] text-white/30">completed today</p>
                </div>
              </div>
            </div>

            {/* Focus Minutes */}
            <div className="glass-card p-5 flex flex-col justify-between">
              <p className="section-title">Focus Chamber</p>
              <div className="flex items-center gap-3 mt-1">
                <Ring value={focusMinutesToday} max={60} size={54} color="#22d3ee">
                  <span className="text-xs font-bold text-cyan-400">{focusMinutesToday}</span>
                </Ring>
                <div>
                  <p className="text-lg font-bold text-white">{focusMinutesToday}m</p>
                  <p className="text-[0.65rem] text-white/30">focused today</p>
                </div>
              </div>
            </div>

            {/* Streak & Grace Tokens */}
            <div className="glass-card p-5 flex flex-col justify-between">
              <p className="section-title">Streak & Grace</p>
              <div>
                <p className="text-2xl font-extrabold text-orange-400 flex items-center gap-1">
                  <span>🔥</span> {streakDays}
                </p>
                <p className="text-[0.68rem] text-white/40 mt-1">
                  Grace tokens: <span className="text-purple-300 font-bold">{progress?.streak.graceTokens ?? 1}</span>
                </p>
              </div>
            </div>
          </div>

          {/* AI Guidance Proposal */}
          <AiProposalCard onQuestAccepted={fetchDashboardData} />

          {/* Middle Grid: Tasks & Habits Previews */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Tasks Preview */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm text-white/90">Today&apos;s Tasks</h3>
                <Link
                  href="/tasks"
                  className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  View All ({tasks.length}) →
                </Link>
              </div>
              {tasks.filter((t) => t.status !== "COMPLETED").length === 0 ? (
                <p className="text-xs text-white/30 py-6 text-center">
                  All active tasks completed for today!
                </p>
              ) : (
                <div className="space-y-2.5">
                  {tasks
                    .filter((t) => t.status !== "COMPLETED")
                    .slice(0, 4)
                    .map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.02] transition-colors group"
                      >
                        <button
                          className="task-check"
                          onClick={() => handleCompleteTask(task.id)}
                          aria-label={`Complete: ${task.title}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white/90 truncate">{task.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`badge ${DIFF_BADGE[task.difficulty]?.cls ?? "badge-cyan"}`}>
                              {DIFF_BADGE[task.difficulty]?.label ?? task.difficulty}
                            </span>
                            {task.source === "AI" && (
                              <span className="badge badge-purple">🤖 AI</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleCompleteTask(task.id)}
                          className="action-btn text-xs py-1 px-3 action-btn-primary opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Complete
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Habits Preview */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm text-white/90">Daily Habits</h3>
                <Link
                  href="/habits"
                  className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Manage Habits ({habits.length}) →
                </Link>
              </div>
              {habits.length === 0 ? (
                <p className="text-xs text-white/30 py-6 text-center">No daily habits tracked.</p>
              ) : (
                <div className="space-y-2.5">
                  {habits.slice(0, 4).map((habit) => (
                    <div
                      key={habit.id}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.02] transition-colors"
                    >
                      <button
                        className={`task-check ${habit.completedToday ? "completed" : ""}`}
                        onClick={() => !habit.completedToday && handleToggleHabit(habit.id)}
                        disabled={habit.completedToday}
                        aria-label={`Toggle: ${habit.title}`}
                      >
                        {habit.completedToday && <span className="text-white text-xs">✓</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            habit.completedToday ? "line-through text-white/30" : "text-white/90"
                          }`}
                        >
                          {habit.title}
                        </p>
                        <p className="text-xs text-white/25">🔥 {habit.streak} day streak</p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-400">+75 XP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Achievements Preview */}
          <div className="glass-card p-5">
            <h3 className="font-bold text-sm mb-3 text-white/90">Recent Achievements</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {(progress?.achievements ?? []).slice(0, 6).map((a) => (
                <div
                  key={a.id}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${
                    a.unlocked ? "hover:bg-white/[0.03]" : "opacity-30 grayscale"
                  }`}
                  title={`${a.name}: ${a.description}`}
                >
                  <div
                    className="achievement-icon"
                    style={{
                      background: a.unlocked
                        ? "rgba(139,92,246,0.25)"
                        : "rgba(255,255,255,0.05)",
                    }}
                  >
                    ⭐
                  </div>
                  <p className="text-[0.65rem] text-white/50 text-center leading-tight">
                    {a.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
