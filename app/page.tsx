"use client";

import { useState, useEffect, useCallback } from "react";

// ── Demo data types (mirrors lib/logic/types) ──────────────────
interface DemoTask {
  id: string;
  title: string;
  difficulty: "EASY" | "NORMAL" | "HARD" | "EPIC";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  xp: number;
  dueLabel: string;
  source: "USER" | "AI";
}

interface DemoHabit {
  id: string;
  title: string;
  streak: number;
  done: boolean;
  emoji: string;
}

interface DemoAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  color: string;
}

interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  level: number;
  isSelf: boolean;
  avatar: string;
}

// ── Helper: level from XP (§11) ────────────────────────────────
function calcLevel(totalXp: number) {
  return Math.floor(Math.sqrt(totalXp / 100)) + 1;
}
function xpForLevel(level: number) {
  return Math.pow(level - 1, 2) * 100;
}

// ── Difficulty styling ─────────────────────────────────────────
const DIFF_BADGE: Record<string, { cls: string; label: string }> = {
  EASY: { cls: "badge-green", label: "Easy" },
  NORMAL: { cls: "badge-cyan", label: "Normal" },
  HARD: { cls: "badge-orange", label: "Hard" },
  EPIC: { cls: "badge-pink", label: "Epic" },
};

// ── SVG Ring component ─────────────────────────────────────────
function Ring({ value, max, size = 80, strokeWidth = 6, color = "#8b5cf6", children }: {
  value: number; max: number; size?: number; strokeWidth?: number; color?: string; children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="stat-ring">
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ── Initial demo data ──────────────────────────────────────────
const INITIAL_TASKS: DemoTask[] = [
  { id: "t1", title: "Complete project proposal", difficulty: "HARD", status: "IN_PROGRESS", xp: 188, dueLabel: "Today", source: "USER" },
  { id: "t2", title: "Review pull requests", difficulty: "NORMAL", status: "PENDING", xp: 150, dueLabel: "Today", source: "USER" },
  { id: "t3", title: "30-min deep reading session", difficulty: "EASY", status: "PENDING", xp: 120, dueLabel: "Tomorrow", source: "AI" },
  { id: "t4", title: "Refactor auth module", difficulty: "EPIC", status: "PENDING", xp: 225, dueLabel: "Wed", source: "USER" },
  { id: "t5", title: "Write unit tests for XP engine", difficulty: "HARD", status: "COMPLETED", xp: 188, dueLabel: "Done", source: "USER" },
];

const INITIAL_HABITS: DemoHabit[] = [
  { id: "h1", title: "Morning workout", streak: 12, done: true, emoji: "💪" },
  { id: "h2", title: "Read 20 pages", streak: 8, done: false, emoji: "📖" },
  { id: "h3", title: "Meditate 10 min", streak: 5, done: true, emoji: "🧘" },
  { id: "h4", title: "No social media till noon", streak: 3, done: false, emoji: "📵" },
  { id: "h5", title: "Drink 8 glasses of water", streak: 15, done: true, emoji: "💧" },
];

const ACHIEVEMENTS: DemoAchievement[] = [
  { id: "a1", name: "First Steps", description: "Earn your first 100 XP", icon: "⭐", unlocked: true, color: "rgba(251,146,60,0.15)" },
  { id: "a2", name: "Streak Master", description: "Maintain a 7-day streak", icon: "🔥", unlocked: true, color: "rgba(239,68,68,0.15)" },
  { id: "a3", name: "Task Warrior", description: "Complete 25 tasks", icon: "⚔️", unlocked: true, color: "rgba(139,92,246,0.15)" },
  { id: "a4", name: "Focus Champion", description: "Log 500 focus minutes", icon: "🎯", unlocked: false, color: "rgba(34,211,238,0.15)" },
  { id: "a5", name: "Level 10", description: "Reach level 10", icon: "🏆", unlocked: false, color: "rgba(52,211,153,0.15)" },
  { id: "a6", name: "Night Owl", description: "Complete tasks after 10 PM", icon: "🦉", unlocked: true, color: "rgba(244,114,182,0.15)" },
];

const LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: "Alex Chen", xp: 4820, level: 8, isSelf: false, avatar: "🥇" },
  { rank: 2, name: "You", xp: 3750, level: 7, isSelf: true, avatar: "🧑‍💻" },
  { rank: 3, name: "Priya S.", xp: 3420, level: 6, isSelf: false, avatar: "🥉" },
  { rank: 4, name: "Marcus W.", xp: 2980, level: 6, isSelf: false, avatar: "👤" },
  { rank: 5, name: "Sofia L.", xp: 2150, level: 5, isSelf: false, avatar: "👤" },
];

const AI_INSIGHT = {
  content: "Your focus sessions have improved 23% this week — you're averaging 42 minutes vs. 34 last week. Consider scheduling a Hard difficulty task during your peak hours (10 AM – 12 PM) to maximize XP gains.",
  rule: "Rule D — Strong Positive Pattern",
};

const TIPS = [
  "Try putting your phone face-down during focus sessions.",
  "Tackle your hardest task first thing in the morning.",
  "A short 5-minute walk between tasks improves focus.",
];

// ── Navigation tabs ────────────────────────────────────────────
type Tab = "dashboard" | "tasks" | "focus" | "leaderboard";

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "tasks", label: "Tasks", icon: "✅" },
  { id: "focus", label: "Focus", icon: "🎯" },
  { id: "leaderboard", label: "Leaderboard", icon: "🏆" },
];

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════
export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [totalXp, setTotalXp] = useState(3750);
  const [tasks, setTasks] = useState<DemoTask[]>(INITIAL_TASKS);
  const [habits, setHabits] = useState<DemoHabit[]>(INITIAL_HABITS);
  const [streakDays, setStreakDays] = useState(12);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [focusTarget, setFocusTarget] = useState(25 * 60); // 25 min
  const [showXpToast, setShowXpToast] = useState<{ amount: number; label: string } | null>(null);

  const level = calcLevel(totalXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const levelPct = ((totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100;

  const completedTasks = tasks.filter(t => t.status === "COMPLETED").length;
  const totalTasks = tasks.length;
  const focusMinutesToday = 42;

  // Focus timer
  useEffect(() => {
    if (!focusRunning) return;
    const interval = setInterval(() => {
      setFocusSeconds(s => {
        if (s + 1 >= focusTarget) {
          setFocusRunning(false);
          earnXp(100, "Focus Session");
          return 0;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [focusRunning, focusTarget]);

  // XP toast auto-dismiss
  useEffect(() => {
    if (!showXpToast) return;
    const t = setTimeout(() => setShowXpToast(null), 2500);
    return () => clearTimeout(t);
  }, [showXpToast]);

  const earnXp = useCallback((amount: number, label: string) => {
    setTotalXp(prev => prev + amount);
    setShowXpToast({ amount, label });
  }, []);

  const completeTask = useCallback((taskId: string) => {
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, status: "COMPLETED" as const, dueLabel: "Done" } : t)
    );
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== "COMPLETED") {
      earnXp(task.xp, `Task: ${task.title}`);
    }
  }, [tasks, earnXp]);

  const toggleHabit = useCallback((habitId: string) => {
    setHabits(prev =>
      prev.map(h => {
        if (h.id === habitId) {
          if (!h.done) {
            earnXp(75, `Habit: ${h.title}`);
            return { ...h, done: true, streak: h.streak + 1 };
          }
          return { ...h, done: false, streak: Math.max(0, h.streak - 1) };
        }
        return h;
      })
    );
  }, [earnXp]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // ── RENDER ──────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 p-5 border-r border-white/5 gap-2">
        {/* Logo */}
        <div className="flex items-center gap-3 px-3 py-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-white font-extrabold text-lg shadow-lg animate-pulse-glow">
            XP
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Life<span className="text-purple-400">XP</span></h1>
            <p className="text-xs text-white/30">Level up your life</p>
          </div>
        </div>

        <p className="section-title px-3">Menu</p>
        {NAV_ITEMS.map(item => (
          <button key={item.id}
            className={`nav-item ${activeTab === item.id ? "active" : ""}`}
            onClick={() => setActiveTab(item.id)}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        {/* Mini profile */}
        <div className="mt-auto glass-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg">
              🧑‍💻
            </div>
            <div>
              <p className="text-sm font-semibold">You</p>
              <p className="text-xs text-white/40">Level {level}</p>
            </div>
          </div>
          <div className="xp-bar-track">
            <div className="xp-bar-fill" style={{ width: `${levelPct}%` }} />
          </div>
          <p className="text-xs text-white/30 mt-1.5">{totalXp - currentLevelXp} / {nextLevelXp - currentLevelXp} XP to next level</p>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────── */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center text-white font-extrabold text-sm animate-pulse-glow">
              XP
            </div>
            <h1 className="text-lg font-bold">Life<span className="text-purple-400">XP</span></h1>
          </div>
          <div className="flex gap-1">
            {NAV_ITEMS.map(item => (
              <button key={item.id}
                className={`p-2.5 rounded-xl text-sm ${activeTab === item.id ? "bg-purple-500/15 text-purple-300" : "text-white/40"}`}
                onClick={() => setActiveTab(item.id)}>
                {item.icon}
              </button>
            ))}
          </div>
        </div>

        {/* ── Dashboard Tab ────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Welcome + Level */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-up">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"} 👋
                </h2>
                <p className="text-white/40 mt-1">Here&apos;s your progress today</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="streak-flame text-2xl">🔥</div>
                <div>
                  <p className="text-2xl font-extrabold text-orange-400">{streakDays}</p>
                  <p className="text-xs text-white/40">Day streak</p>
                </div>
              </div>
            </div>

            {/* Stat cards row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up delay-100" style={{ opacity: 0 }}>
              {/* XP Card */}
              <div className="glass-card p-5 flex flex-col">
                <p className="section-title">Total XP</p>
                <p className="text-2xl font-extrabold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  {totalXp.toLocaleString()}
                </p>
                <div className="mt-auto pt-3">
                  <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>Lvl {level}</span>
                    <span>Lvl {level + 1}</span>
                  </div>
                  <div className="xp-bar-track">
                    <div className="xp-bar-fill" style={{ width: `${levelPct}%` }} />
                  </div>
                </div>
              </div>

              {/* Tasks Card */}
              <div className="glass-card p-5 flex flex-col">
                <p className="section-title">Tasks Today</p>
                <div className="flex items-end gap-3">
                  <Ring value={completedTasks} max={totalTasks} size={56} color="#34d399">
                    <span className="text-sm font-bold text-emerald-400">{completedTasks}</span>
                  </Ring>
                  <div>
                    <p className="text-lg font-bold">{completedTasks}/{totalTasks}</p>
                    <p className="text-xs text-white/30">completed</p>
                  </div>
                </div>
              </div>

              {/* Focus Card */}
              <div className="glass-card p-5 flex flex-col">
                <p className="section-title">Focus Today</p>
                <div className="flex items-end gap-3">
                  <Ring value={focusMinutesToday} max={60} size={56} color="#22d3ee">
                    <span className="text-sm font-bold text-cyan-400">{focusMinutesToday}</span>
                  </Ring>
                  <div>
                    <p className="text-lg font-bold">{focusMinutesToday}m</p>
                    <p className="text-xs text-white/30">focused</p>
                  </div>
                </div>
              </div>

              {/* Streak Card */}
              <div className="glass-card p-5 flex flex-col">
                <p className="section-title">Best Streak</p>
                <p className="text-2xl font-extrabold text-orange-400">
                  <span className="streak-flame mr-1">🔥</span>{streakDays}
                </p>
                <p className="text-xs text-white/30 mt-1">Personal best: 18 days</p>
                <div className="flex gap-1 mt-auto pt-3">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className={`flex-1 h-2 rounded-full ${i < 5 ? "bg-orange-500/60" : "bg-white/6"}`} />
                  ))}
                </div>
              </div>
            </div>

            {/* Middle grid: Tasks + Habits */}
            <div className="grid lg:grid-cols-2 gap-6 animate-fade-in-up delay-200" style={{ opacity: 0 }}>
              {/* Active Tasks */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm">Active Tasks</h3>
                  <button className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    onClick={() => setActiveTab("tasks")}>View All →</button>
                </div>
                <div className="space-y-2.5">
                  {tasks.filter(t => t.status !== "COMPLETED").slice(0, 4).map(task => (
                    <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.02] transition-colors group">
                      <button
                        className="task-check"
                        onClick={() => completeTask(task.id)}
                        aria-label={`Complete: ${task.title}`}>
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`badge ${DIFF_BADGE[task.difficulty].cls}`}>{DIFF_BADGE[task.difficulty].label}</span>
                          {task.source === "AI" && <span className="badge badge-purple">🤖 AI Quest</span>}
                          <span className="text-xs text-white/25">{task.dueLabel}</span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">+{task.xp} XP</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Habits */}
              <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm">Daily Habits</h3>
                  <span className="text-xs text-white/30">{habits.filter(h => h.done).length}/{habits.length} done</span>
                </div>
                <div className="space-y-2.5">
                  {habits.map(habit => (
                    <div key={habit.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.02] transition-colors">
                      <button
                        className={`task-check ${habit.done ? "completed" : ""}`}
                        onClick={() => toggleHabit(habit.id)}
                        aria-label={`Toggle: ${habit.title}`}>
                        {habit.done && <span className="text-white text-xs">✓</span>}
                      </button>
                      <span className="text-lg">{habit.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${habit.done ? "line-through text-white/30" : ""}`}>{habit.title}</p>
                        <p className="text-xs text-white/25">{habit.streak} day streak</p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-400">+75 XP</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom: AI Insight + Achievements */}
            <div className="grid lg:grid-cols-3 gap-6 animate-fade-in-up delay-300" style={{ opacity: 0 }}>
              {/* AI Insight */}
              <div className="lg:col-span-2 glass-card p-5 border-purple-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">🧠</span>
                  <h3 className="font-bold text-sm">AI Insight</h3>
                  <span className="badge badge-purple">{AI_INSIGHT.rule}</span>
                </div>
                <p className="text-sm text-white/60 leading-relaxed">{AI_INSIGHT.content}</p>
                <div className="mt-4 flex gap-2">
                  <button className="action-btn action-btn-primary text-xs py-2 px-4">Create Quest</button>
                  <button className="action-btn action-btn-ghost text-xs py-2 px-4">Dismiss</button>
                </div>
              </div>

              {/* Achievements */}
              <div className="glass-card p-5">
                <h3 className="font-bold text-sm mb-3">Achievements</h3>
                <div className="grid grid-cols-3 gap-3">
                  {ACHIEVEMENTS.map(a => (
                    <div key={a.id}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${a.unlocked ? "hover:bg-white/[0.03]" : "opacity-30 grayscale"}`}
                      title={`${a.name}: ${a.description}`}>
                      <div className="achievement-icon" style={{ background: a.color }}>
                        {a.icon}
                      </div>
                      <p className="text-[0.65rem] text-white/50 text-center leading-tight">{a.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tasks Tab ────────────────────────────────────── */}
        {activeTab === "tasks" && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-extrabold">Tasks</h2>
              <button className="action-btn action-btn-primary">
                <span>+</span> New Task
              </button>
            </div>

            <div className="glass-card divide-y divide-white/5">
              {tasks.map(task => (
                <div key={task.id}
                  className={`flex items-center gap-4 p-4 transition-colors ${task.status === "COMPLETED" ? "opacity-50" : "hover:bg-white/[0.02]"}`}>
                  <button
                    className={`task-check ${task.status === "COMPLETED" ? "completed" : ""}`}
                    onClick={() => task.status !== "COMPLETED" && completeTask(task.id)}
                    disabled={task.status === "COMPLETED"}
                    aria-label={`Complete: ${task.title}`}>
                    {task.status === "COMPLETED" && <span className="text-white text-xs">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${task.status === "COMPLETED" ? "line-through text-white/40" : ""}`}>{task.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`badge ${DIFF_BADGE[task.difficulty].cls}`}>{DIFF_BADGE[task.difficulty].label}</span>
                      {task.source === "AI" && <span className="badge badge-purple">🤖 AI</span>}
                      <span className="text-xs text-white/25">Due: {task.dueLabel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-purple-400">+{task.xp} XP</p>
                    <p className="text-xs text-white/25 capitalize">{task.status.toLowerCase().replace("_", " ")}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Focus Tab ────────────────────────────────────── */}
        {activeTab === "focus" && (
          <div className="max-w-lg mx-auto space-y-8 animate-fade-in-up text-center">
            <h2 className="text-2xl font-extrabold">Focus Timer</h2>

            {/* Timer ring */}
            <div className="flex justify-center">
              <Ring value={focusSeconds} max={focusTarget} size={220} strokeWidth={10}
                color={focusRunning ? "#8b5cf6" : "#22d3ee"}>
                <div>
                  <p className="text-4xl font-extrabold font-mono tracking-wider">
                    {formatTime(focusRunning ? focusTarget - focusSeconds : focusTarget)}
                  </p>
                  <p className="text-xs text-white/30 mt-1">
                    {focusRunning ? "Remaining" : "Press Start"}
                  </p>
                </div>
              </Ring>
            </div>

            {/* Duration presets */}
            {!focusRunning && (
              <div className="flex justify-center gap-3">
                {[15, 25, 45, 60].map(m => (
                  <button key={m}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${focusTarget === m * 60
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                      : "bg-white/4 text-white/40 hover:bg-white/8 hover:text-white/60"}`}
                    onClick={() => { setFocusTarget(m * 60); setFocusSeconds(0); }}>
                    {m}m
                  </button>
                ))}
              </div>
            )}

            {/* Start / Stop */}
            <div className="flex justify-center gap-4">
              {focusRunning ? (
                <>
                  <button className="action-btn action-btn-ghost px-8"
                    onClick={() => { setFocusRunning(false); setFocusSeconds(0); }}>
                    Abandon
                  </button>
                  <button className="action-btn action-btn-primary px-8"
                    onClick={() => {
                      setFocusRunning(false);
                      setFocusSeconds(0);
                      earnXp(100, "Focus Session");
                    }}>
                    Complete Early
                  </button>
                </>
              ) : (
                <button className="action-btn action-btn-primary px-12 py-3 text-base"
                  onClick={() => { setFocusRunning(true); setFocusSeconds(0); }}>
                  🎯 Start Focus
                </button>
              )}
            </div>

            {/* Reward info */}
            <div className="glass-card p-4 text-left">
              <p className="section-title">Session Reward</p>
              <p className="text-sm text-white/50">
                Complete this session to earn <span className="text-purple-400 font-bold">+100 XP</span> + streak bonus up to <span className="text-orange-400 font-bold">+{Math.min(streakDays * 5, 50)} XP</span>
              </p>
            </div>

            {/* Tips */}
            <div className="glass-card p-4 text-left">
              <p className="section-title">💡 Tip</p>
              <p className="text-sm text-white/50">{TIPS[Math.floor(Date.now() / 60000) % TIPS.length]}</p>
            </div>
          </div>
        )}

        {/* ── Leaderboard Tab ──────────────────────────────── */}
        {activeTab === "leaderboard" && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-extrabold">Weekly Leaderboard</h2>
              <span className="badge badge-cyan">This Week</span>
            </div>

            <div className="glass-card overflow-hidden">
              {LEADERBOARD.map((entry, i) => (
                <div key={i}
                  className={`leaderboard-row ${entry.isSelf ? "self" : ""} flex items-center gap-4 p-4 ${i > 0 ? "border-t border-white/5" : ""}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm ${
                    entry.rank === 1 ? "bg-yellow-500/15 text-yellow-400" :
                    entry.rank === 2 ? "bg-slate-300/10 text-slate-300" :
                    entry.rank === 3 ? "bg-orange-500/15 text-orange-400" :
                    "bg-white/5 text-white/30"
                  }`}>
                    {entry.rank <= 3 ? entry.avatar : `#${entry.rank}`}
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold text-sm ${entry.isSelf ? "text-purple-300" : ""}`}>
                      {entry.name}
                      {entry.isSelf && <span className="ml-2 badge badge-purple">You</span>}
                    </p>
                    <p className="text-xs text-white/25">Level {entry.level}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm text-purple-400">{entry.xp.toLocaleString()} XP</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Your stats */}
            <div className="glass-card p-5">
              <p className="section-title">Your Week</p>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div className="text-center">
                  <p className="text-xl font-extrabold text-purple-400">3,750</p>
                  <p className="text-xs text-white/30">XP Earned</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-extrabold text-emerald-400">18</p>
                  <p className="text-xs text-white/30">Tasks Done</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-extrabold text-cyan-400">210m</p>
                  <p className="text-xs text-white/30">Focus Time</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── XP Toast ───────────────────────────────────────── */}
      {showXpToast && (
        <div className="fixed bottom-6 right-6 z-50 glass-card border-purple-500/30 px-5 py-3 flex items-center gap-3 animate-fade-in-up"
          style={{ boxShadow: "0 8px 32px rgba(139,92,246,0.25)" }}>
          <span className="text-xl">⚡</span>
          <div>
            <p className="text-sm font-bold text-purple-400">+{showXpToast.amount} XP</p>
            <p className="text-xs text-white/40">{showXpToast.label}</p>
          </div>
        </div>
      )}
    </div>
  );
}
