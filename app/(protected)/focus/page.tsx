"use client";

// ============================================================
// Task Aura — Dedicated Focus View (/focus)
// Server-authoritative focus sessions, heartbeat sync,
// task-linking evidence, and duration validation.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import { Ring } from "@/components/Ring";
import {
  triggerGamificationUpdate,
  triggerXpToast,
} from "@/components/AppShell";
import { ErrorState } from "@/components/States";
import type { FocusSession, Task } from "@/lib/logic/types";

export default function FocusPage() {
  const [runningSession, setRunningSession] = useState<FocusSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<FocusSession[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Timer controls
  const [focusTargetMinutes, setFocusTargetMinutes] = useState(25);
  const [timerSeconds, setTimerSeconds] = useState(0);

  const fetchFocus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/focus");
      const json = await res.json();
      if (json.success) {
        setRunningSession(json.data.runningSession);
        setRecentSessions(json.data.sessions ?? []);
        setError(null);
      } else {
        setError(json.error?.message ?? "Failed to load focus sessions");
      }
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
        const [fRes, tRes] = await Promise.all([
          fetch("/api/v1/focus").then((r) => r.json()).catch(() => null),
          fetch("/api/v1/tasks").then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (fRes?.success) {
          setRunningSession(fRes.data.runningSession);
          setRecentSessions(fRes.data.sessions ?? []);
          if (fRes.data.runningSession) {
            const started = new Date(fRes.data.runningSession.startedAt).getTime();
            setTimerSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
            if (fRes.data.runningSession.taskId) {
              setSelectedTaskId(fRes.data.runningSession.taskId);
            }
          }
        } else {
          setError(fRes?.error?.message ?? "Failed to load focus sessions");
        }
        if (tRes?.success && Array.isArray(tRes.data)) {
          const incomplete = tRes.data.filter(
            (t: Task) =>
              t.status !== "COMPLETED" &&
              t.status !== "CANCELLED" &&
              t.status !== "EXPIRED"
          );
          setTasks(incomplete);
        }
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

  // Heartbeat & timer tick interval
  useEffect(() => {
    if (!runningSession) return;

    const tickInterval = setInterval(() => {
      setTimerSeconds((s) => s + 1);
    }, 1000);

    // Send heartbeat every 30 seconds to server
    const heartbeatInterval = setInterval(async () => {
      try {
        await fetch(`/api/v1/focus/${runningSession.id}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Handled gracefully
      }
    }, 30_000);

    return () => {
      clearInterval(tickInterval);
      clearInterval(heartbeatInterval);
    };
  }, [runningSession]);

  const handleStart = async () => {
    try {
      const body: { requiredMinutes: number; taskId?: string } = {
        requiredMinutes: focusTargetMinutes,
      };
      if (selectedTaskId) {
        body.taskId = selectedTaskId;
      }
      const res = await fetch("/api/v1/focus/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setRunningSession(json.data);
        setTimerSeconds(0);
        setError(null);
      } else {
        setError(json?.error?.message || json?.message || "Failed to start focus session");
      }
    } catch {
      setError("Failed to start focus session");
    }
  };

  const handleComplete = async () => {
    if (!runningSession) return;
    try {
      const res = await fetch(`/api/v1/focus/${runningSession.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientElapsedSeconds: timerSeconds }),
      });
      const json = await res.json();
      if (json.success) {
        if (!json.data.isDuplicate) {
          triggerGamificationUpdate(json.data.gamification);
        }
        if (json.data.xpAwarded > 0) {
          triggerXpToast(json.data.xpAwarded, "Focus Session Complete");
        }
        setRunningSession(null);
        setTimerSeconds(0);
        await fetchFocus();
      } else {
        setError(json.error?.message ?? "Session completion was rejected");
      }
    } catch {
      setError("Failed to complete focus session");
    }
  };

  const handleAbandon = async () => {
    if (!runningSession) return;
    try {
      await fetch(`/api/v1/focus/${runningSession.id}/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      setRunningSession(null);
      setTimerSeconds(0);
      await fetchFocus();
    } catch {
      setError("Failed to abandon session");
    }
  };

  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const targetSeconds = runningSession
    ? runningSession.requiredMinutes * 60
    : focusTargetMinutes * 60;

  const remainingSeconds = Math.max(0, targetSeconds - timerSeconds);

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Focus Chamber</h1>
        <p className="text-xs text-white/40 mt-1">
          Eliminate distractions. Time in the chamber earns verified XP.
        </p>
      </div>

      {error && <ErrorState message={error} onRetry={fetchFocus} />}

      {/* Main Focus Ring Section */}
      <div className="glass-card p-8 text-center flex flex-col items-center justify-center relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -z-10" />

        <Ring
          value={timerSeconds}
          max={targetSeconds}
          size={240}
          strokeWidth={10}
          color={runningSession ? "#8b5cf6" : "#22d3ee"}
        >
          <div className="text-center">
            <p className="text-5xl font-extrabold font-mono tracking-wider text-white">
              {formatTime(runningSession ? remainingSeconds : targetSeconds)}
            </p>
            <p className="text-xs text-white/40 mt-2 font-medium">
              {runningSession
                ? remainingSeconds === 0
                  ? "Target Reached!"
                  : "Remaining"
                : "Planned Session"}
            </p>
          </div>
        </Ring>

        {/* Duration Presets (Only when idle) */}
        {!runningSession && (
          <div className="flex flex-wrap justify-center gap-2.5 mt-8">
            {[15, 25, 45, 60].map((m) => (
              <button
                key={m}
                onClick={() => setFocusTargetMinutes(m)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  focusTargetMinutes === m
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                    : "bg-white/5 text-white/50 hover:bg-white/10"
                }`}
              >
                {m} Minutes
              </button>
            ))}
          </div>
        )}

        {/* Task Linking Option */}
        <div className="mt-6 w-full max-w-sm text-left">
          <label htmlFor="focus-task-select" className="text-[0.7rem] text-white/40 block mb-1">
            Link to Task (Optional Proof of Work)
          </label>
          <div className="relative">
            <select
              id="focus-task-select"
              value={selectedTaskId}
              disabled={Boolean(runningSession)}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="appearance-none w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 pr-8 text-xs text-white focus:outline-none focus:border-purple-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <option value="" className="bg-[#121220]">
                No task (unlinked session)
              </option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#121220]">
                  {t.title} ({t.difficulty})
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-white/40">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <p className="text-[0.68rem] text-white/40 mt-1">
            Complete this task within 30 minutes of finishing your session to earn the focus-verified bonus.
          </p>
        </div>

        {/* Controls */}
        <div className="mt-8 flex gap-3">
          {runningSession ? (
            <>
              <button
                onClick={handleAbandon}
                className="action-btn action-btn-ghost px-6 text-xs text-rose-300 border-rose-500/30"
              >
                Abandon Session
              </button>
              <button
                onClick={handleComplete}
                className="action-btn action-btn-primary px-8 text-xs font-bold"
              >
                ⚡ Complete & Claim XP
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              className="action-btn action-btn-primary px-10 py-3 text-sm font-extrabold flex items-center gap-2"
            >
              <span>🎯</span>
              <span>Start Focus Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Rules Notice */}
      <div className="glass-card p-4 border border-white/5 space-y-1 text-xs text-white/40">
        <p className="font-bold text-white/70">Anti-Farming & Validation Rules:</p>
        <p>• Sessions under 10 minutes or &lt;80% of planned duration receive 0 XP.</p>
        <p>• Credited duration is capped at 1.25× the planned duration.</p>
        <p>• Linked focus sessions count as evidence for the parent task (paying at verified rate upon task completion).</p>
      </div>

      {/* Recent Sessions */}
      <div className="glass-card p-5">
        <h3 className="font-bold text-sm mb-3 text-white/90">Recent Focus Sessions</h3>
        {loading ? (
          <p className="text-xs text-white/30 py-4 text-center">Loading history...</p>
        ) : recentSessions.length === 0 ? (
          <p className="text-xs text-white/30 py-4 text-center">No focus sessions recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {recentSessions.slice(0, 5).map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <p className="font-medium text-white/80">
                    {s.requiredMinutes} min planned ({s.actualMinutes} min actual)
                  </p>
                  <p className="text-[0.65rem] text-white/30">
                    {new Date(s.startedAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`badge ${
                    s.status === "COMPLETED"
                      ? "badge-green"
                      : s.status === "RUNNING"
                      ? "badge-cyan"
                      : "badge-orange"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
