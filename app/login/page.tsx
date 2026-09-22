"use client";

// ============================================================
// TaskAura — Login / Registration View (/login)
// Two-panel layout:
//   LEFT  — background image + branding tagline (hidden on mobile)
//   RIGHT — auth form: Google OAuth + Guest + Email/Password (Sign In & Sign Up)
//
// AUTH LOGIC:
//   - handleEmailSignIn: POST /api/v1/auth/login, router.push("/")
//   - handleEmailSignUp: POST /api/v1/auth/register, router.push("/")
//   - handleGuestSignIn: POST /api/v1/auth/guest, router.push("/")
//   - Google button: <a href="/api/v1/auth/google">
//   - Password visibility toggles (type="password" <-> type="text")
// ============================================================

import React, { useState, Suspense } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

// ── Google SVG icon ──────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg className="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

// ── Eye Icon for Password Visibility Toggle ──────────────────
function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="w-4 h-4 text-white/50 hover:text-white/80 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-white/50 hover:text-white/80 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

// ── Main form component ──────────────────────────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const queryError = searchParams.get("error");
  const queryMessage =
    queryError === "google_oauth_not_configured"
      ? "Google OAuth credentials are not yet configured on the server. Please use Email/Password or Continue as Guest."
      : queryError
      ? `Authentication notice: ${queryError}`
      : null;

  const error = formError || queryMessage;

  // ── Email/Password Sign In ─────────────────────────────────
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();
      if (json.success) {
        router.push("/");
        router.refresh();
      } else {
        setFormError(json.error?.message || "Invalid credentials. Please verify your email and password.");
      }
    } catch {
      setFormError("Network error. Unable to connect to authentication server.");
    } finally {
      setLoading(false);
    }
  };

  // ── Email/Password Sign Up / Register ─────────────────────
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please re-enter.");
      return;
    }

    if (password.length < 6) {
      setFormError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email,
          password,
          confirmPassword,
        }),
      });

      const json = await res.json();
      if (json.success) {
        router.push("/");
        router.refresh();
      } else {
        setFormError(json.error?.message || "Registration failed. Please try again.");
      }
    } catch {
      setFormError("Network error. Unable to connect to registration server.");
    } finally {
      setLoading(false);
    }
  };

  // ── Continue as Guest ──────────────────────────────────────
  const handleGuestSignIn = async () => {
    setFormError(null);
    setGuestLoading(true);

    try {
      const res = await fetch("/api/v1/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const json = await res.json();
      if (json.success) {
        router.push("/");
        router.refresh();
      } else {
        setFormError(json.error?.message || "Could not initialize guest session. Please retry.");
      }
    } catch {
      setFormError("Network error. Unable to start guest session.");
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row overflow-hidden">
      {/* ══════════════════════════════════════════════════════
          LEFT PANEL — image + tagline
          ══════════════════════════════════════════════════════ */}
      <div
        className="relative hidden md:flex md:w-[46%] flex-col justify-between overflow-hidden"
        aria-hidden="true"
      >
        <Image
          src="/login-panel-bg.jpg"
          alt=""
          fill
          priority
          className="object-cover object-center select-none"
          sizes="46vw"
        />

        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(10,10,18,0.55) 0%, rgba(10,10,18,0.15) 50%, rgba(10,10,18,0.72) 100%)",
          }}
        />

        <div className="relative z-10 p-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/30 to-cyan-400/30 border border-white/20 flex items-center justify-center backdrop-blur-sm">
              <Image
                src="/taskaura-logo.png"
                alt="TaskAura"
                width={20}
                height={20}
                className="object-contain"
              />
            </div>
            <span className="text-sm font-bold tracking-wide text-white/90 select-none">
              Task<span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Aura</span>
            </span>
          </div>
        </div>

        <div className="relative z-10 p-8 pb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 backdrop-blur-sm mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-[0.65rem] font-semibold text-purple-300 uppercase tracking-widest">
              Productivity RPG
            </span>
          </div>

          <h2 className="text-[2.1rem] font-extrabold leading-[1.15] text-white mb-3 drop-shadow-md">
            Level Up<br />
            <span className="bg-gradient-to-r from-purple-400 via-violet-300 to-cyan-400 bg-clip-text text-transparent">
              Every Single Day
            </span>
          </h2>
          <p className="text-sm text-white/55 leading-relaxed max-w-[260px]">
            Earn real XP for your habits, tasks, and focus sessions — and watch your aura grow.
          </p>

          <div className="flex items-center gap-3 mt-5">
            {["XP & Levels", "Streaks", "Focus Mode"].map((label) => (
              <span
                key={label}
                className="text-[0.65rem] font-semibold px-2.5 py-1 rounded-full bg-white/8 border border-white/12 text-white/60 tracking-wide"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT PANEL — form
          ══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 md:px-12 lg:px-16 min-h-screen md:min-h-0 bg-[#0a0a12] relative overflow-y-auto">
        <div
          className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="relative w-full max-w-[400px] animate-fade-in-up py-4">
          {/* Logo + wordmark */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/25 to-cyan-400/25 border border-white/10 flex items-center justify-center">
              <Image
                src="/taskaura-logo.png"
                alt="TaskAura"
                width={26}
                height={26}
                priority
                className="object-contain"
              />
            </div>
            <div>
              <p className="text-[0.95rem] font-extrabold tracking-tight text-white leading-none">
                Task<span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Aura</span>
              </p>
              <p className="text-[0.65rem] text-white/35 leading-none mt-0.5">Productivity workspace</p>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-[1.75rem] font-extrabold text-white leading-tight tracking-tight mb-1">
            {isSignUp ? "Create an account" : "Welcome back"}
          </h1>
          <p className="text-sm text-white/45 mb-6">
            {isSignUp
              ? "Join TaskAura and start your productivity adventure"
              : "Sign in to continue your productivity streak"}
          </p>

          {/* Error banner */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs leading-relaxed flex gap-2.5 items-start">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Third-party / Fast login actions */}
          <div className="space-y-2.5 mb-5">
            {/* Google button */}
            <a
              href="/api/v1/auth/google"
              id="google-signin-btn"
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border transition-all duration-200 group"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor: "rgba(255,255,255,0.1)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.07)";
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(139,92,246,0.4)";
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 0 20px rgba(139,92,246,0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
              }}
            >
              <GoogleIcon />
              <span className="text-sm font-semibold text-white/85 group-hover:text-white transition-colors">
                Continue with Google
              </span>
            </a>

            {/* Continue as Guest button */}
            <button
              type="button"
              id="guest-signin-btn"
              disabled={loading || guestLoading}
              onClick={handleGuestSignIn}
              className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "rgba(255,255,255,0.025)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(6,182,212,0.4)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(6,182,212,0.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.025)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <span className="text-sm">🎮</span>
              <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
                {guestLoading ? "Starting Guest Session…" : "Continue as Guest"}
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-[0.65rem] text-white/25 uppercase tracking-widest font-mono">
              or with email
            </span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Email / Password Form */}
          <form onSubmit={isSignUp ? handleEmailSignUp : handleEmailSignIn} className="space-y-4" noValidate>
            {/* Name Field (Sign Up Only) */}
            {isSignUp && (
              <div>
                <label
                  className="block text-xs font-semibold text-white/55 mb-1.5 tracking-wide"
                  htmlFor="register-name"
                >
                  Your Name
                </label>
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
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
              </div>
            )}

            {/* Email */}
            <div>
              <label
                className="block text-xs font-semibold text-white/55 mb-1.5 tracking-wide"
                htmlFor="login-email"
              >
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@taskaura.dev"
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
            </div>

            {/* Password with Visibility Toggle */}
            <div>
              <label
                className="block text-xs font-semibold text-white/55 mb-1.5 tracking-wide"
                htmlFor="login-password"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl text-sm text-white placeholder:text-white/20 transition-all duration-200"
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
                <button
                  type="button"
                  id="toggle-password-btn"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-white/5 focus:outline-none"
                >
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
            </div>

            {/* Confirm Password (Sign Up Only) */}
            {isSignUp && (
              <div>
                <label
                  className="block text-xs font-semibold text-white/55 mb-1.5 tracking-wide"
                  htmlFor="register-confirm-password"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="register-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-11 rounded-xl text-sm text-white placeholder:text-white/20 transition-all duration-200"
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
                  <button
                    type="button"
                    id="toggle-confirm-password-btn"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-white/5 focus:outline-none"
                  >
                    <EyeIcon visible={showConfirmPassword} />
                  </button>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              id={isSignUp ? "email-signup-btn" : "email-signin-btn"}
              disabled={loading || guestLoading}
              className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              style={{
                background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4f46e5 100%)",
                boxShadow: "0 4px 24px rgba(139,92,246,0.3)",
              }}
              onMouseEnter={(e) => {
                if (!loading && !guestLoading) {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 32px rgba(139,92,246,0.5)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 24px rgba(139,92,246,0.3)";
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {isSignUp ? "Creating Account…" : "Signing In…"}
                </span>
              ) : isSignUp ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Toggle between Log In and Sign Up */}
          <div className="mt-5 text-center">
            <button
              type="button"
              id="switch-auth-mode-btn"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setFormError(null);
              }}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium cursor-pointer"
            >
              {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>

          {/* Demo credentials */}
          <p className="mt-6 text-[0.7rem] text-center text-white/30 leading-relaxed">
            Demo:{" "}
            <code className="text-purple-400/80 font-mono">demo@taskaura.dev</code>
            {" / "}
            <code className="text-purple-400/80 font-mono">TaskAura2026!</code>
          </p>
        </div>
      </div>

      {/* Mobile-only top banner */}
      <div
        className="md:hidden order-first relative h-40 overflow-hidden"
        aria-hidden="true"
      >
        <Image
          src="/login-panel-bg.jpg"
          alt=""
          fill
          className="object-cover object-top"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(10,10,18,0.3) 0%, rgba(10,10,18,0.85) 100%)",
          }}
        />
        <div className="absolute bottom-4 left-5 z-10">
          <p className="text-white font-extrabold text-lg leading-tight">
            Level Up{" "}
            <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Every Day
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a12]">
          <div className="text-white/30 text-sm animate-pulse">Loading…</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
