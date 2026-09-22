"use client";

// ============================================================
// TaskAura — User Profile Page (/profile)
// Displays authenticated user's own data (name, email, avatar, guest status)
// Allows editing display name & preset RPG avatar
// Calls PATCH /api/v1/user/profile for updates
// Calls existing POST /api/v1/auth/logout for sign-out
// ============================================================

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_AVATARS } from "@/lib/constants/avatars";

interface UserProfileData {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatar: string;
  isGuest: boolean;
  createdAt: string;
}

const AVATAR_DETAILS: Record<string, { title: string; subtitle: string }> = {
  "🧑‍💻": { title: "Technomancer", subtitle: "Code & Logic Architect" },
  "⚔️": { title: "Shadowblade", subtitle: "Relentless Discipline" },
  "🧙‍♂️": { title: "Arcane Mage", subtitle: "Deep Focus Mastery" },
  "🏹": { title: "Ranger", subtitle: "Strategic Goal Seeker" },
  "🥷": { title: "Cyber Shinobi", subtitle: "Silent Sprint Execution" },
  "⚡": { title: "Storm Champion", subtitle: "High-Energy Productivity" },
  "🦊": { title: "Kitsune Spirit", subtitle: "Adaptive Habit Weaver" },
  "👑": { title: "Grand Sovereign", subtitle: "Master of Self-Control" },
};

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("🧑‍💻");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetch current user's profile on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/user/profile");
        const json = await res.json();
        if (cancelled) return;
        if (json.success && json.data?.user) {
          const u = json.data.user;
          setProfile(u);
          setDisplayName(u.displayName || u.name || "");
          setSelectedAvatar(u.avatar || "🧑‍💻");
        } else {
          setFeedback({
            type: "error",
            message: json.error?.message || "Failed to load profile details.",
          });
        }
      } catch {
        if (!cancelled) {
          setFeedback({
            type: "error",
            message: "Network error loading profile.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle saving profile changes
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setFeedback({ type: "error", message: "Display name cannot be empty." });
      return;
    }

    if (trimmed.length > 100) {
      setFeedback({ type: "error", message: "Display name cannot exceed 100 characters." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmed,
          avatar: selectedAvatar,
        }),
      });

      const json = await res.json();
      if (json.success && json.data?.user) {
        setProfile(json.data.user);
        setDisplayName(json.data.user.displayName);
        setSelectedAvatar(json.data.user.avatar);
        setFeedback({
          type: "success",
          message: "Profile updated successfully! Your aura reflects your new changes.",
        });

        // Notify AppShell to update sidebar
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("taskaura:profile-updated"));
        }
      } else {
        setFeedback({
          type: "error",
          message: json.error?.message || "Failed to update profile.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Network error. Unable to save profile changes.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Handle logout using existing endpoint
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-white/50 text-sm animate-pulse">
          <span className="text-xl">✨</span>
          <span>Loading adventurer profile…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up pb-12">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
          <span>Adventurer Profile</span>
          <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30">
            {profile?.isGuest ? "Guest Persona" : "Verified Hero"}
          </span>
        </h1>
        <p className="text-xs sm:text-sm text-white/45 mt-1">
          Customize your persona, display name, and avatar across TaskAura
        </p>
      </div>

      {/* Guest Warning Banner (if guest account) */}
      {profile?.isGuest && (
        <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/5 rounded-2xl flex items-start gap-3 text-amber-200 text-xs leading-relaxed">
          <span className="text-lg shrink-0 mt-0.5">⚠️</span>
          <div>
            <p className="font-bold text-amber-100">Guest Account Active</p>
            <p className="text-amber-200/80 mt-0.5">
              You are exploring TaskAura as a Guest. You can customize your name and avatar, but guest sessions are temporary. To permanently secure your aura and XP, you can register or log in anytime.
            </p>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center gap-2.5 border animate-fade-in ${
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-rose-500/10 border-rose-500/30 text-rose-300"
          }`}
        >
          <span className="text-base">{feedback.type === "success" ? "✓" : "⚠️"}</span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Profile Overview Card */}
      <div className="glass-card p-6 rounded-2xl border border-white/10 relative overflow-hidden">
        <div
          className="absolute -right-16 -bottom-16 w-52 h-52 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Avatar Preview with Glow */}
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/30 via-violet-500/20 to-cyan-400/30 border-2 border-purple-400/40 p-1 flex items-center justify-center text-4xl shadow-xl backdrop-blur-md">
              {selectedAvatar}
            </div>
            <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#0a0a12] flex items-center justify-center text-[0.6rem] text-white" title="Active">
              ⚡
            </span>
          </div>

          {/* User Info */}
          <div className="flex-1 text-center sm:text-left min-w-0">
            <h2 className="text-xl font-extrabold text-white truncate">
              {profile?.displayName || profile?.name || "Adventurer"}
            </h2>
            <p className="text-xs text-purple-300/80 font-mono mt-0.5">
              {AVATAR_DETAILS[selectedAvatar]?.title || "Hero"} • {AVATAR_DETAILS[selectedAvatar]?.subtitle || "TaskAura Player"}
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <span className="text-[0.7rem] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">
                Email: {profile?.email ? <code className="text-purple-300 font-mono">{profile.email}</code> : <span className="text-white/40 italic">None (Guest)</span>}
              </span>
              <span className="text-[0.7rem] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50">
                Adventurer ID: <code className="font-mono text-white/70">{profile?.id ? `${profile.id.slice(0, 8)}…` : "—"}</code>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile Form */}
      <form onSubmit={handleSave} className="glass-card p-6 sm:p-7 rounded-2xl border border-white/10 space-y-6">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>⚙️</span>
          <span>Edit Persona</span>
        </h3>

        {/* Display Name Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="profile-display-name" className="text-xs font-semibold text-white/75 tracking-wide">
              Display Name
            </label>
            <span className="text-[0.65rem] text-white/35 font-mono">
              {displayName.length}/100
            </span>
          </div>
          <input
            id="profile-display-name"
            type="text"
            required
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your adventurer name"
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder:text-white/20 transition-all duration-200"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.09)",
              outline: "none",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(139,92,246,0.6)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          <p className="text-[0.7rem] text-white/40 mt-1.5">
            This name appears on your dashboard greeting, active quest log, and leaderboard entries.
          </p>
        </div>

        {/* Preset Avatar Selector */}
        <div>
          <label className="block text-xs font-semibold text-white/75 mb-2.5 tracking-wide">
            Choose RPG Archetype Avatar
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ALLOWED_AVATARS.map((emoji) => {
              const isSelected = selectedAvatar === emoji;
              const details = AVATAR_DETAILS[emoji] || { title: "Archetype", subtitle: "Hero" };
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSelectedAvatar(emoji)}
                  className={`p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-1.5 group ${
                    isSelected
                      ? "bg-purple-500/20 border-purple-400/60 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
                      : "bg-white/[0.025] border-white/10 hover:bg-white/[0.06] hover:border-white/20"
                  }`}
                >
                  <span className="text-3xl group-hover:scale-110 transition-transform">
                    {emoji}
                  </span>
                  <p className={`text-xs font-bold ${isSelected ? "text-purple-300" : "text-white/80"}`}>
                    {details.title}
                  </p>
                  <p className="text-[0.62rem] text-white/40 text-center leading-tight">
                    {details.subtitle}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/5">
          <button
            type="submit"
            disabled={saving}
            id="save-profile-btn"
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4f46e5 100%)",
              boxShadow: "0 4px 20px rgba(139,92,246,0.3)",
            }}
          >
            {saving ? "Saving Changes…" : "Save Changes"}
          </button>

          {/* Direct Logout Option */}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            id="profile-logout-btn"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 hover:border-rose-500/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <span>🚪</span>
            <span>{loggingOut ? "Logging out…" : "Log Out of TaskAura"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
