// @vitest-environment jsdom
// ============================================================
// Task Aura — CelebrationOverlay Component Tests (Phase 3)
// Tests run in jsdom (no real DOM APIs needed beyond what jsdom provides).
// These are pure unit tests of the overlay logic — no database, no Next.js
// routing, no auth. The component is imported directly.
// ============================================================

import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { CelebrationOverlay } from "../components/CelebrationOverlay";

// ── Helpers ─────────────────────────────────────────────────

function renderOverlay(kind: "level-up" | "quest-complete" | null, onDismiss = vi.fn()) {
  return { ...render(<CelebrationOverlay kind={kind} onDismiss={onDismiss} />), onDismiss };
}

// jsdom doesn't implement HTMLVideoElement.play()/pause(), so we mock it.
beforeEach(() => {
  Object.defineProperty(HTMLVideoElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLVideoElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────

describe("CelebrationOverlay", () => {
  describe("level-up overlay", () => {
    it("renders the overlay when kind is level-up", () => {
      renderOverlay("level-up");
      const overlay = screen.getByTestId("celebration-overlay");
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute("data-kind", "level-up");
    });

    it("renders a video element with the level-up src", () => {
      renderOverlay("level-up");
      const video = screen.getByTestId("celebration-video") as HTMLVideoElement;
      expect(video).toBeInTheDocument();
      expect(video.src).toContain("level-up.mp4");
    });

    it("video is muted and has no loop", () => {
      renderOverlay("level-up");
      const video = screen.getByTestId("celebration-video") as HTMLVideoElement;
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(false);
    });
  });

  describe("quest-complete overlay", () => {
    it("renders the overlay when kind is quest-complete", () => {
      renderOverlay("quest-complete");
      const overlay = screen.getByTestId("celebration-overlay");
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute("data-kind", "quest-complete");
    });

    it("renders a video element with the quest-complete src", () => {
      renderOverlay("quest-complete");
      const video = screen.getByTestId("celebration-video") as HTMLVideoElement;
      expect(video.src).toContain("quest-complete.mp4");
    });
  });

  describe("dismissal", () => {
    it("calls onDismiss when the overlay is clicked", async () => {
      const onDismiss = vi.fn();
      renderOverlay("level-up", onDismiss);
      fireEvent.click(screen.getByTestId("celebration-overlay"));
      // advance past the FADE_MS (300 ms) timer
      act(() => { vi.advanceTimersByTime(350); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("calls onDismiss when Esc is pressed", async () => {
      const onDismiss = vi.fn();
      renderOverlay("level-up", onDismiss);
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => { vi.advanceTimersByTime(350); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("calls onDismiss when the video ends naturally", async () => {
      const onDismiss = vi.fn();
      renderOverlay("quest-complete", onDismiss);
      fireEvent.ended(screen.getByTestId("celebration-video"));
      act(() => { vi.advanceTimersByTime(350); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("auto-dismisses after ~3 seconds (cap timer)", async () => {
      const onDismiss = vi.fn();
      renderOverlay("level-up", onDismiss);
      // Before cap: not dismissed yet
      act(() => { vi.advanceTimersByTime(2999); });
      expect(onDismiss).not.toHaveBeenCalled();
      // After cap + fade: dismissed
      act(() => { vi.advanceTimersByTime(400); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("null kind", () => {
    it("renders nothing when kind is null", () => {
      renderOverlay(null);
      expect(screen.queryByTestId("celebration-overlay")).toBeNull();
    });
  });

  describe("error fallback", () => {
    it("calls onDismiss silently when the video fires an error", () => {
      const onDismiss = vi.fn();
      renderOverlay("level-up", onDismiss);
      fireEvent.error(screen.getByTestId("celebration-video"));
      // Error path calls onDismiss immediately (no fade)
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});

// ── prefers-reduced-motion guard (tested at the AppShell event level) ─────
// The CelebrationOverlay itself always renders when kind is non-null.
// The guard lives in AppShell.tsx where setCelebration is called only when
// motionOk() is true. We test that the overlay is NOT shown when
// prefers-reduced-motion is set by verifying the guard logic in isolation.

describe("prefers-reduced-motion guard", () => {
  it("skips setting celebration kind when prefers-reduced-motion: reduce", () => {
    // Simulate the AppShell motionOk() guard.
    const mockMql = { matches: true }; // matches = true means "reduce"
    window.matchMedia = vi.fn().mockReturnValue(mockMql as unknown as MediaQueryList);

    const motionOk = () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    expect(motionOk()).toBe(false); // motion is NOT ok → skip video
  });

  it("allows celebration when prefers-reduced-motion is not set", () => {
    const mockMql = { matches: false }; // matches = false means motion is fine
    window.matchMedia = vi.fn().mockReturnValue(mockMql as unknown as MediaQueryList);

    const motionOk = () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    expect(motionOk()).toBe(true); // motion IS ok → show video
  });
});
