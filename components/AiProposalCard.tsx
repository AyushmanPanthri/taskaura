// ============================================================
// Task Aura — AI Proposal Card
// Clean structured display of deterministic AI suggestions
// with rationale, difficulty, effort, expected base XP preview,
// and user [Accept Quest] / [Dismiss] actions. Zero direct XP mutation.
// ============================================================

import React, { useState } from "react";
import { ECONOMY } from "@/lib/logic/economy";

interface AiProposalCardProps {
  insightText?: string;
  ruleLabel?: string;
  reasoning?: string;
  onQuestAccepted?: () => void;
}

export function AiProposalCard({
  insightText = "Your recent study patterns indicate strong focus stability. A targeted quest will maintain this momentum.",
  ruleLabel = "Deterministic Rule D",
  reasoning = "Focus metrics trending positive compared to 7-day baseline.",
  onQuestAccepted,
}: AiProposalCardProps) {
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (dismissed) {
    return null;
  }

  const handleAccept = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/ai/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success) {
        setFeedback("Quest registered into your active tasks in PENDING status!");
        if (onQuestAccepted) {
          onQuestAccepted();
        }
      } else {
        setFeedback(json.error?.message ?? "Unable to generate quest at this time.");
      }
    } catch {
      setFeedback("Failed to reach AI service.");
    } finally {
      setLoading(false);
    }
  };

  const expectedBaseXp = ECONOMY.base.AI_QUEST; // 150 base XP

  return (
    <div className="glass-card p-5 border border-purple-500/30 shadow-lg relative overflow-hidden animate-fade-in-up">
      {/* Subtle glowing accent */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -z-10" />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧠</span>
          <div>
            <h3 className="font-bold text-sm text-white/95">AI System Guidance</h3>
            <p className="text-[0.7rem] text-white/40">Adaptive Behavioral Analysis</p>
          </div>
        </div>
        <span className="badge badge-purple text-[0.65rem]">{ruleLabel}</span>
      </div>

      {/* Contextual insight */}
      <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 mb-4">
        <p className="text-xs text-white/80 leading-relaxed">{insightText}</p>
        {reasoning && (
          <p className="text-[0.7rem] text-purple-300/60 mt-1.5 font-mono">
            Pattern: {reasoning}
          </p>
        )}
      </div>

      {/* Proposed Quest Spec */}
      <div className="space-y-2 border-t border-white/5 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">Proposed Quest:</span>
          <span className="font-semibold text-purple-300">Targeted Exam Practice</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">Difficulty Tier:</span>
          <span className="badge badge-orange">HARD</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">Planned Duration:</span>
          <span className="text-white/80 font-medium">45 min</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">Expected Base Reward:</span>
          <span className="text-emerald-400 font-bold">~{expectedBaseXp} XP (upon completion)</span>
        </div>
      </div>

      {/* Feedback notice */}
      {feedback && (
        <div className="mt-3 p-2 rounded-lg bg-purple-500/20 text-xs text-purple-200 text-center">
          {feedback}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2.5">
        <button
          onClick={() => setDismissed(true)}
          disabled={loading}
          className="action-btn action-btn-ghost text-xs py-2 px-4"
        >
          Dismiss
        </button>
        <button
          onClick={handleAccept}
          disabled={loading}
          className="action-btn action-btn-primary text-xs py-2 px-5"
        >
          {loading ? "Registering..." : "⚡ Accept Quest"}
        </button>
      </div>
    </div>
  );
}
