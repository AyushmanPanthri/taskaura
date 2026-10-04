"use client";

// ============================================================
// Task Aura — Dedicated Tasks View (/tasks)
// Server-backed task list, difficulty & effort management,
// completion/cancellation actions, and AI Quest integration.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import { handleTaskCompletionResponse } from "@/components/task-completion-feedback";
import { AiProposalCard } from "@/components/AiProposalCard";
import { EmptyState, ErrorState } from "@/components/States";
import type { Task, Difficulty } from "@/lib/logic/types";

const DIFF_BADGE: Record<string, { cls: string; label: string }> = {
  EASY: { cls: "badge-green", label: "Easy" },
  NORMAL: { cls: "badge-cyan", label: "Normal" },
  HARD: { cls: "badge-orange", label: "Hard" },
  EPIC: { cls: "badge-pink", label: "Epic" },
};

type TaskFilter = "ALL" | "ACTIVE" | "COMPLETED";

/** Rejection metadata kept per task-id so the banner appears inline. */
interface RejectionInfo {
  reason: string;
  minimumRequiredDurationMs?: number;
  serverDurationMs?: number;
  remainingMs?: number;
}

/** Human-readable remaining time in "Xm Ys" format. */
function formatRemainingMs(remainingMs: number): string {
  const totalSec = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** Human-readable minimum required time in "Xm" format. */
function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes}m`;
}

/** Inline rejection banner displayed below a task row when the server rejects
 *  a completion attempt. Dismissable by the user. */
function RejectionBanner({
  taskTitle,
  info,
  onDismiss,
}: {
  taskTitle: string;
  info: RejectionInfo;
  onDismiss: () => void;
}) {
  if (info.reason !== "TOO_FAST") {
    // Generic fallback for any other future rejection reason
    return (
      <div
        className="mx-4 mb-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-3 animate-fade-in-up"
        role="alert"
        aria-live="polite"
        data-testid={`rejection-banner-${taskTitle}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <div>
            <p className="text-xs text-amber-300 font-semibold">
              Completion rejected: {info.reason}
            </p>
            {info.remainingMs !== undefined && info.remainingMs > 0 && (
              <p className="text-[0.7rem] text-white/50 mt-0.5">
                Try again in {formatRemainingMs(info.remainingMs)}.
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-400/60 hover:text-amber-300 text-xs transition-colors"
          aria-label="Dismiss rejection notice"
        >
          ✕
        </button>
      </div>
    );
  }

  const remainingMs =
    info.remainingMs ??
    (info.minimumRequiredDurationMs !== undefined &&
    info.serverDurationMs !== undefined
      ? Math.max(0, info.minimumRequiredDurationMs - info.serverDurationMs)
      : undefined);

  return (
    <div
      className="mx-4 mb-3 px-4 py-3 rounded-xl border border-rose-500/30 bg-rose-500/8 flex items-start justify-between gap-3 animate-fade-in-up"
      role="alert"
      aria-live="polite"
      data-testid={`rejection-banner-${taskTitle}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-base mt-0.5 shrink-0">⏳</span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-rose-300">Not yet — too fast!</p>
          <p className="text-[0.7rem] text-white/50 mt-0.5">
            {info.minimumRequiredDurationMs !== undefined && (
              <>Minimum required: <span className="text-white/70 font-semibold">{formatMinutes(info.minimumRequiredDurationMs)}</span>.</>
            )}{" "}
            {remainingMs !== undefined && remainingMs > 0 ? (
              <>About <span className="text-rose-300 font-semibold">{formatRemainingMs(remainingMs)}</span> remaining.</>
            ) : null}
          </p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="text-rose-400/60 hover:text-rose-300 text-xs transition-colors shrink-0 mt-0.5"
        aria-label="Dismiss rejection notice"
      >
        ✕
      </button>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("ALL");

  // Per-task rejection state keyed by task id
  const [rejections, setRejections] = useState<Map<string, RejectionInfo>>(
    new Map()
  );

  // Inline creation form state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDifficulty, setNewDifficulty] = useState<Difficulty>("NORMAL" as Difficulty);
  const [newMinutes, setNewMinutes] = useState(30);
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/tasks");
      const json = await res.json();
      if (json.success) {
        setTasks(json.data);
        setError(null);
      } else {
        setError(json.error?.message ?? "Failed to load tasks");
      }
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/tasks")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) setTasks(json.data);
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

  const handleComplete = async (taskId: string) => {
    // Clear any existing rejection banner for this task before retrying
    setRejections((prev) => {
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });

    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();

      if (!json.success && !json.data?.rejected) {
        // Network / server error — no side effects
        return;
      }

      const outcome = handleTaskCompletionResponse(json.data, {
        onRejected: (data) => {
          setRejections((prev) => {
            const next = new Map(prev);
            next.set(taskId, {
              reason: data.reason ?? "REJECTED",
              minimumRequiredDurationMs: data.minimumRequiredDurationMs,
              serverDurationMs: data.serverDurationMs,
              remainingMs: data.gamification?.feedback.remainingMs,
            });
            return next;
          });
        },
        onConfirmed: (completedTask) => {
          setTasks((previous) =>
            previous.map((task) =>
              task.id === taskId ? { ...task, ...completedTask } : task
            )
          );
        },
      });

      if (outcome === "rejected") {
        // Refresh task list to sync updated completionAttempts
        await fetchTasks();
        return;
      }

      if (outcome === "duplicate") {
        await fetchTasks();
        return;
      }

      await fetchTasks();
    } catch {
      // Network failure — silent, let the user retry
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success) {
        await fetchTasks();
      }
    } catch {
      // Cancel failed
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          difficulty: newDifficulty,
          estimatedMinutes: newMinutes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNewTitle("");
        setShowCreate(false);
        await fetchTasks();
      }
    } finally {
      setCreating(false);
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === "ACTIVE") return t.status === "PENDING" || t.status === "IN_PROGRESS";
    if (filter === "COMPLETED") return t.status === "COMPLETED";
    return true;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Tasks &amp; Quests</h1>
          <p className="text-xs text-white/40 mt-1">
            Complete tasks to gain authoritative XP and level up
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="action-btn action-btn-primary flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span>{showCreate ? "✕ Close" : "+ New Task"}</span>
        </button>
      </div>

      {/* Embedded AI Quest Proposal Card */}
      <AiProposalCard onQuestAccepted={fetchTasks} />

      {/* Creation Drawer / Form */}
      {showCreate && (
        <form
          onSubmit={handleCreateTask}
          className="glass-card p-5 border border-purple-500/30 space-y-4 animate-fade-in-up"
        >
          <h3 className="font-bold text-sm text-white/90">Create New Task</h3>
          <div>
            <label className="text-xs text-white/50 block mb-1">Task Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Read Chapter 4 & take notes"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/50 block mb-1">Difficulty</label>
              <select
                value={newDifficulty}
                onChange={(e) => setNewDifficulty(e.target.value as Difficulty)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
              >
                <option value="EASY" className="bg-[#121220]">Easy (0.8x)</option>
                <option value="NORMAL" className="bg-[#121220]">Normal (1.0x)</option>
                <option value="HARD" className="bg-[#121220]">Hard (1.25x - min 45m)</option>
                <option value="EPIC" className="bg-[#121220]">Epic (1.5x - min 90m)</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-white/50 block mb-1">Estimated Effort (min)</label>
              <input
                type="number"
                min={5}
                max={240}
                value={newMinutes}
                onChange={(e) => setNewMinutes(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
              />
            </div>
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
              disabled={creating || !newTitle.trim()}
              className="action-btn action-btn-primary text-xs py-2 px-5"
            >
              {creating ? "Creating..." : "Save Task"}
            </button>
          </div>
        </form>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-2 text-xs">
        {(["ALL", "ACTIVE", "COMPLETED"] as TaskFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filter === f
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {f === "ALL" ? "All Tasks" : f === "ACTIVE" ? "Active" : "Completed"}
          </button>
        ))}
      </div>

      {/* Task List */}
      {loading ? (
        <div className="glass-card p-8 text-center text-white/40 text-sm">
          Loading tasks from server...
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchTasks} />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="No tasks found"
          description={
            filter === "COMPLETED"
              ? "You haven't completed any tasks in this filter yet."
              : "Nothing scheduled yet. Create a task or accept an AI quest above!"
          }
          actionLabel="+ New Task"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="glass-card divide-y divide-white/5">
          {filteredTasks.map((task) => {
            const isCompleted = task.status === "COMPLETED";
            const isCancelled = task.status === "CANCELLED";
            const isTerminal = isCompleted || isCancelled;
            const rejection = rejections.get(task.id);

            return (
              <React.Fragment key={task.id}>
                <div
                  className={`flex items-center gap-4 p-4 transition-colors ${
                    isTerminal ? "opacity-50" : "hover:bg-white/[0.02]"
                  }`}
                >
                  {/* Checkbox button */}
                  <button
                    className={`task-check ${isCompleted ? "completed" : ""}`}
                    onClick={() => !isTerminal && handleComplete(task.id)}
                    disabled={isTerminal}
                    aria-label={`Complete: ${task.title}`}
                    id={`task-check-${task.id}`}
                  >
                    {isCompleted && <span className="text-white text-xs">✓</span>}
                  </button>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-semibold text-sm ${
                        isCompleted ? "line-through text-white/40" : "text-white/95"
                      }`}
                    >
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-xs text-white/40 mt-0.5 truncate">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`badge ${DIFF_BADGE[task.difficulty]?.cls ?? "badge-cyan"}`}>
                        {DIFF_BADGE[task.difficulty]?.label ?? task.difficulty}
                      </span>
                      {task.source === "AI" && (
                        <span className="badge badge-purple">🤖 AI Quest</span>
                      )}
                      {task.estimatedMinutes && (
                        <span className="text-[0.7rem] text-white/30">
                          ⏱️ {task.estimatedMinutes}m
                        </span>
                      )}
                      <span className="text-[0.7rem] text-white/20 capitalize">
                        {task.status.toLowerCase().replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {!isTerminal && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="text-xs text-white/30 hover:text-rose-400 p-1 transition-colors"
                        title="Cancel Task"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      onClick={() => !isTerminal && handleComplete(task.id)}
                      disabled={isTerminal}
                      className={`action-btn text-xs py-1.5 px-3 ${
                        isCompleted
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "action-btn-primary"
                      }`}
                      id={`task-complete-btn-${task.id}`}
                    >
                      {isCompleted ? "Done" : "Complete"}
                    </button>
                  </div>
                </div>

                {/* Rejection banner — rendered immediately below the task row */}
                {rejection && (
                  <RejectionBanner
                    taskTitle={task.title}
                    info={rejection}
                    onDismiss={() =>
                      setRejections((prev) => {
                        const next = new Map(prev);
                        next.delete(task.id);
                        return next;
                      })
                    }
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
