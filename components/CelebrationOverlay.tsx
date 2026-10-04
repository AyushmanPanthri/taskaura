// ============================================================
// Task Aura — CelebrationOverlay
//
// Full-screen video overlay shown after the server confirms a
// level-up or quest-completion. It never awards or changes
// anything — it is purely presentational.
//
// Behaviour:
//   • Muted, autoplay, no loop.
//   • Auto-dismissed when the video ends (or after ~3 s).
//   • Click/tap anywhere or Esc dismisses immediately.
//   • Under prefers-reduced-motion the video is skipped entirely
//     and the overlay is never shown (the caller's XP toast
//     acts as the existing non-video fallback).
//   • If the <video> fires an error the overlay is torn down
//     silently — the existing XP toast remains the user's
//     feedback.
//   • The 3-second cap is implemented with a JS timer that calls
//     dismiss(); the subsequent fade-out takes 0.3 s via CSS.
// ============================================================

"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

// ── Celebration chime (Web Audio API — no file dependency) ──
// Plays a quick two-note ascending ding when a celebration fires.
// All errors are swallowed: autoplay policy blocks must never surface
// to the user or interrupt the video overlay.
function playCelebrationChime() {
  try {
    // AudioContext may be unavailable in SSR / test environments.
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const now = ctx.currentTime;

    // Two-note ascending ding: C5 → E5
    const notes = [
      { freq: 523.25, start: 0,    dur: 0.18 },
      { freq: 659.25, start: 0.14, dur: 0.28 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;

      // Quick attack, smooth exponential release
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.28, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    });

    // Close the context shortly after the chime ends to free resources.
    setTimeout(() => { try { void ctx.close(); } catch { /* ignore */ } }, 600);
  } catch {
    // Autoplay blocked or API unavailable — fail silently.
  }
}

export type CelebrationKind = "level-up" | "quest-complete" | "task-complete" | "habit-complete";

interface Props {
  kind: CelebrationKind | null;
  onDismiss: () => void;
}

// ── VIDEO SLOT MAP ──────────────────────────────────────────
// One place to control which video plays for each celebration
// event.  To swap a video, change the path here — no other
// file needs editing.
//
// TEMP: "task-complete" and "habit-complete" reuse the two
//       existing clips until dedicated assets are ready.
// ─────────────────────────────────────────────────────────────
export const VIDEO_SLOTS: Record<CelebrationKind, string> = {
  "level-up":       "/celebrations/level-up.mp4",
  "quest-complete": "/celebrations/quest-complete.mp4",
  "task-complete":  "/celebrations/level-up.mp4",     // TEMP: reuse level-up clip
  "habit-complete": "/celebrations/quest-complete.mp4", // TEMP: reuse quest-complete clip
};

// How long the overlay stays at full opacity before the fade begins (ms).
const CAP_MS = 3000;
// Duration of the CSS fade-out (must match the transition in the style block).
const FADE_MS = 300;

export function CelebrationOverlay({ kind, onDismiss }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fading, setFading] = useState(false);

  // Start the fade-out, then call onDismiss after the animation completes.
  const dismiss = useCallback(() => {
    if (capTimerRef.current) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    setFading(true);
    setTimeout(() => {
      setFading(false);
      onDismiss();
    }, FADE_MS);
  }, [onDismiss]);

  // Cap timer, Esc key, and celebration chime — set up when a new celebration starts.
  useEffect(() => {
    if (!kind) return;

    // Play the success chime at the same moment the video fires.
    // Intentionally NOT gated on prefers-reduced-motion: that setting
    // governs visual motion, not audio. The chime is ~0.4 s and non-intrusive.
    playCelebrationChime();

    // Start the 3-second cap.
    capTimerRef.current = setTimeout(dismiss, CAP_MS);

    // Esc to dismiss.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      if (capTimerRef.current) clearTimeout(capTimerRef.current);
      document.removeEventListener("keydown", onKey);
    };
  }, [kind, dismiss]);

  // When the video ends naturally, dismiss.
  const handleEnded = () => dismiss();

  // Silent error fallback — tear down the overlay.
  const handleError = () => {
    setFading(false);
    onDismiss();
  };

  if (!kind) return null;

  return (
    <>
      {/* Inline styles — no external CSS file needed; scoped to this component. */}
      <style>{`
        .celebration-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.82);
          backdrop-filter: blur(4px);
          transition: opacity ${FADE_MS}ms ease;
        }
        .celebration-overlay.fading {
          opacity: 0;
          pointer-events: none;
        }
        .celebration-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          position: absolute;
          inset: 0;
        }
        .celebration-dismiss-hint {
          position: absolute;
          bottom: 2.5rem;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255,255,255,0.55);
          font-size: 0.78rem;
          font-family: sans-serif;
          letter-spacing: 0.04em;
          pointer-events: none;
          text-shadow: 0 1px 4px rgba(0,0,0,0.8);
        }
      `}</style>

      <div
        id="celebration-overlay"
        data-testid="celebration-overlay"
        data-kind={kind}
        className={`celebration-overlay${fading ? " fading" : ""}`}
        onClick={dismiss}
        role="dialog"
        aria-modal="true"
        aria-label={`${kind} celebration`}
      >
        <video
          ref={videoRef}
          id="celebration-video"
          data-testid="celebration-video"
          className="celebration-video"
          src={VIDEO_SLOTS[kind]}
          autoPlay
          muted
          playsInline
          loop={false}
          onEnded={handleEnded}
          onError={handleError}
        />
        <span className="celebration-dismiss-hint">
          Tap anywhere or press Esc to continue
        </span>
      </div>
    </>
  );
}
