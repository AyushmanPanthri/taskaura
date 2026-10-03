"use client";

// ============================================================
// TaskAura — Admin Quest Forge: Create Quest
// (/admin/quests/create)
// Form for forging quests with manual inputs or AI generation.
// Supports server fan-out for GLOBAL quests.
// ============================================================

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface UserOption {
  id: string;
  displayName: string;
  email: string;
}

export default function AdminCreateQuestPage() {
  const router = useRouter();

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState("NORMAL");
  const [xpReward, setXpReward] = useState<number>(150);
  const [targetType, setTargetType] = useState<"GLOBAL" | "SPECIFIC" | "PERSONAL">("GLOBAL");
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "DRAFT">("ACTIVE");

  // User list for SPECIFIC targetType
  const [availableUsers, setAvailableUsers] = useState<UserOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // States
  const [generating, setGenerating] = useState(false);
  const [proposalSource, setProposalSource] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load users if SPECIFIC is chosen
  useEffect(() => {
    let ignore = false;
    if (targetType === "SPECIFIC" && availableUsers.length === 0) {
      const loadUsers = async () => {
        await Promise.resolve();
        if (!ignore) setLoadingUsers(true);
        try {
          const res = await fetch("/api/v1/admin/users?limit=50");
          const data = await res.json();
          if (!ignore && data.success) {
            setAvailableUsers(data.data.users);
          }
        } catch {
          // ignore
        } finally {
          if (!ignore) setLoadingUsers(false);
        }
      };
      void loadUsers();
    }
    return () => {
      ignore = true;
    };
  }, [targetType, availableUsers.length]);

  // AI Proposal Generator
  const handleGenerateProposal = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/generate-quest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.data?.proposal) {
        const p = data.data.proposal;
        setTitle(p.title);
        setDescription(p.description);
        setDifficulty(p.difficulty || "NORMAL");
        if (p.estimatedXp) setXpReward(p.estimatedXp);
        setProposalSource(p.suggestedRule || "AI Rules Engine");
      } else {
        setError(data.error?.message || "Failed to generate AI proposal");
      }
    } catch {
      setError("Network error calling AI generator");
    } finally {
      setGenerating(false);
    }
  };

  // Submit quest creation
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Quest title is required");
      return;
    }
    if (!description.trim()) {
      setError("Quest description is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        difficulty,
        xpReward: Number(xpReward) || 0,
        targetType,
        status,
      };

      if (deadline) {
        payload.deadline = new Date(deadline).toISOString();
      }

      if (targetType === "SPECIFIC") {
        if (targetUserIds.length === 0) {
          setError("Please select at least one player for specific targeting");
          setSubmitting(false);
          return;
        }
        payload.targetUserIds = targetUserIds;
      }

      const res = await fetch("/api/v1/admin/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/admin/quests");
        }, 1200);
      } else {
        setError(data.error?.message || "Failed to forge quest");
      }
    } catch {
      setError("Network error forging quest");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setTargetUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Back ────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/quests"
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/50 hover:text-white transition-colors"
        >
          <span>←</span>
          <span>Back to Quest Forge</span>
        </Link>
      </div>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="pb-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">⚔️</span>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Forge New Quest
          </h1>
        </div>
        <p className="text-xs md:text-sm text-white/50 mt-1">
          Compose an authoritative mission with XP rewards, deadlines, and player audience targeting.
        </p>
      </div>

      {/* ── AI Assistant Assist Card ───────────────────────── */}
      <div className="glass-card p-5 border border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-transparent flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <h3 className="text-sm font-bold text-white">AI Quest Generator</h3>
          </div>
          <p className="text-xs text-white/50 mt-1 max-w-md">
            Use the deterministic rules engine to draft a quest blueprint. You can edit any details before finalizing.
          </p>
          {proposalSource && (
            <p className="text-[0.65rem] text-purple-300 font-mono mt-2">
              Blueprint loaded: {proposalSource}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateProposal}
          disabled={generating}
          id="forge-ai-generate-btn"
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)] disabled:opacity-50 shrink-0"
        >
          <span>{generating ? "⏳" : "🪄"}</span>
          <span>{generating ? "Generating..." : "Generate AI Proposal"}</span>
        </button>
      </div>

      {/* ── Quest Form ──────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="glass-card p-6 border border-white/10 space-y-5">
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center gap-2">
            <span>✨</span>
            <span>Quest successfully forged! Redirecting to Quest Forge...</span>
          </div>
        )}

        {/* Quest Title */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="quest-title-input" className="text-xs font-bold text-white">
              Quest Title <span className="text-rose-400">*</span>
            </label>
            <span className="text-[0.65rem] text-white/40">{title.length}/120</span>
          </div>
          <input
            id="quest-title-input"
            type="text"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master the Morning Ritual"
            className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="quest-desc-input" className="text-xs font-bold text-white">
              Description & Objectives <span className="text-rose-400">*</span>
            </label>
            <span className="text-[0.65rem] text-white/40">{description.length}/1000</span>
          </div>
          <textarea
            id="quest-desc-input"
            required
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the challenge goals, conditions for success, and flavor text..."
            className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Difficulty & XP Bounty */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="quest-diff-select" className="text-xs font-bold text-white block mb-1.5">Difficulty</label>
            <select
              id="quest-diff-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="appearance-none w-full px-4 py-2.5 pr-8 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="EASY">EASY (Green)</option>
              <option value="NORMAL">NORMAL (Cyan)</option>
              <option value="HARD">HARD (Amber)</option>
              <option value="EPIC">EPIC (Purple)</option>
              <option value="LEGENDARY">LEGENDARY (Gold Aura)</option>
            </select>
          </div>

          <div>
            <label htmlFor="quest-xp-input" className="text-xs font-bold text-white block mb-1.5">
              XP Reward Bounty
            </label>
            <input
              id="quest-xp-input"
              type="number"
              min={0}
              max={10000}
              value={xpReward}
              onChange={(e) => setXpReward(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50 font-mono"
            />
          </div>
        </div>

        {/* Target Audience */}
        <div>
          <label className="text-xs font-bold text-white block mb-1.5">
            Target Audience Fan-Out
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { type: "GLOBAL", label: "Global", desc: "All current players" },
              { type: "SPECIFIC", label: "Specific", desc: "Selected players" },
              { type: "PERSONAL", label: "Admin Only", desc: "For testing" },
            ].map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => setTargetType(t.type as "GLOBAL" | "SPECIFIC" | "PERSONAL")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  targetType === t.type
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                    : "bg-white/[0.02] border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <p className="text-xs font-bold">{t.label}</p>
                <p className="text-[0.62rem] text-white/40 mt-0.5">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Specific User Selection (conditional) */}
        {targetType === "SPECIFIC" && (
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-2">
            <p className="text-xs font-bold text-white">Select Players ({targetUserIds.length} chosen)</p>
            {loadingUsers ? (
              <p className="text-xs text-white/40">Loading users...</p>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {availableUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={targetUserIds.includes(u.id)}
                      onChange={() => toggleUserSelection(u.id)}
                      className="rounded border-white/20 text-amber-500"
                    />
                    <span className="font-semibold text-white">{u.displayName}</span>
                    <span className="text-white/40 text-[0.65rem] font-mono">({u.email})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deadline & Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="quest-deadline-input" className="text-xs font-bold text-white block mb-1.5">
              Deadline (Optional)
            </label>
            <input
              id="quest-deadline-input"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div>
            <label htmlFor="quest-status-select" className="text-xs font-bold text-white block mb-1.5">Status</label>
            <select
              id="quest-status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as "ACTIVE" | "DRAFT")}
              className="appearance-none w-full px-4 py-2.5 pr-8 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="ACTIVE">ACTIVE (Publish Immediately)</option>
              <option value="DRAFT">DRAFT (Keep in Workbench)</option>
            </select>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-white/5 flex items-center justify-end gap-3">
          <Link
            href="/admin/quests"
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white/50 hover:text-white"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || success}
            id="forge-submit-quest-btn"
            className="px-6 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all disabled:opacity-50"
          >
            {submitting ? "Forging..." : "Forge Quest"}
          </button>
        </div>
      </form>
    </div>
  );
}
