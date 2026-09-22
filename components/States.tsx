// ============================================================
// Task Aura — Empty & Error State Components
// ============================================================

import React from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = "✨",
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="glass-card p-8 text-center flex flex-col items-center justify-center animate-fade-in-up">
      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-2xl mb-3">
        {icon}
      </div>
      <h3 className="text-base font-bold text-white/90">{title}</h3>
      {description && <p className="text-xs text-white/40 mt-1 max-w-sm">{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="action-btn action-btn-primary text-xs py-2 px-4 mt-4"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message = "Failed to load data from server.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="glass-card p-5 border border-rose-500/30 flex items-center justify-between animate-fade-in-up">
      <div className="flex items-center gap-3">
        <span className="text-xl">⚠️</span>
        <div>
          <p className="text-sm font-bold text-rose-400">{title}</p>
          <p className="text-xs text-white/40">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="action-btn action-btn-ghost text-xs py-1.5 px-3 border border-rose-500/30 text-rose-300"
        >
          Retry
        </button>
      )}
    </div>
  );
}
