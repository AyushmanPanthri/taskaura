# LifeXP — Gamify Your Productivity ⚡

> Track habits, complete tasks, earn XP, and level up your real life. A gamified productivity system that turns daily routines into rewarding quests.

---

## ✨ Features

### 📊 Dashboard
- **XP & Leveling** — Earn experience points for every completed task, habit, and focus session. Level up with a smooth progression curve (`level = √(totalXP / 100) + 1`).
- **Streak Tracking** — Maintain daily streaks with a grace-day system to stay motivated without burnout.
- **Stat Cards** — At-a-glance view of Total XP, Tasks Today, Focus Minutes, and Best Streak — each with animated ring visualisations.

### ✅ Task Management
- Create and manage tasks with four difficulty tiers: **Easy**, **Normal**, **Hard**, and **Epic**.
- AI-suggested "Quest" tasks generated from behavioural pattern analysis.
- XP rewards scale with difficulty via configurable multipliers.
- Status lifecycle: `Pending → In Progress → Completed / Cancelled / Expired`.

### 🧘 Habit Tracker
- Daily, weekday, weekend, or custom-frequency habits.
- Per-habit streak counters with personal-best tracking.
- Each habit completion awards **+75 XP**.

### 🎯 Focus Timer
- Pomodoro-style focus sessions with preset durations (15 / 25 / 45 / 60 min).
- Animated countdown ring with real-time progress.
- Heartbeat-based session validation for integrity.
- Earn **+100 XP** per completed session, plus streak bonuses up to **+50 XP**.

### 🏆 Leaderboard
- Weekly ranked leaderboard comparing XP across users.
- Highlighted personal ranking with weekly stats (XP earned, tasks done, focus time).

### 🧠 AI Insights Engine
- **Rule-based AI** — 10+ deterministic rules (no LLM required) that analyse behavioral metrics and generate insights, recommendations, and auto-quests.
- Bounded context assembly (capped metrics window + task cap) for efficiency.
- Configurable daily limits for insights and quests.

### 🏅 Achievements
- Milestone-based badges (First Steps, Streak Master, Task Warrior, Focus Champion, and more).
- Unlockable with visual lock/unlock states and category-coloured icons.

---

## 🏗️ Architecture

```
lifexp/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (Inter font, dark mode)
│   ├── page.tsx                # Main SPA — Dashboard, Tasks, Focus, Leaderboard tabs
│   └── globals.css             # Design system (glassmorphism, animations, tokens)
├── lib/
│   ├── logic/                  # Pure business logic (no side effects)
│   │   ├── types.ts            # Core enums & interfaces
│   │   ├── constants.ts        # XP tables, thresholds, AI limits
│   │   ├── xp-engine.ts        # XP calculation & leveling
│   │   ├── task-engine.ts      # Task lifecycle & XP rewards
│   │   ├── focus-engine.ts     # Focus session validation
│   │   ├── streak.ts           # Streak logic with grace days
│   │   ├── difficulty.ts       # Difficulty multiplier system
│   │   ├── achievement-engine.ts # Achievement condition evaluation
│   │   ├── ai-rules.ts         # Deterministic AI rules (§14–§17)
│   │   ├── baseline.ts         # Behavioral baseline & delta detection
│   │   ├── aggregation.ts      # Daily metrics aggregation pipeline
│   │   └── leaderboard.ts      # Weekly score ranking
│   └── services/               # Stateful service layer
│       ├── store.ts            # In-memory data store (hackathon MVP)
│       ├── xp-service.ts       # XP transaction management
│       ├── task-service.ts     # Task CRUD + completion
│       ├── focus-service.ts    # Focus session orchestration
│       ├── sync-service.ts     # Client ↔ server sync with dedup
│       ├── leaderboard-service.ts # Leaderboard queries
│       └── aggregation-service.ts # Metrics aggregation scheduler
├── prisma/
│   └── schema.prisma           # Canonical data model (PostgreSQL-ready)
└── public/                     # Static assets
```

### Design Principles
- **Logic / Service split** — All business rules in `lib/logic/` are pure functions with zero side effects. The `lib/services/` layer handles state and I/O.
- **Idempotent XP** — Every XP transaction carries an idempotency key (`hash(sourceType + sourceId + rewardType)`) to prevent double-awarding.
- **Offline-first sync** — `clientEventId`-based deduplication ensures reliable data sync.
- **Deterministic AI** — No LLM dependency; all AI insights come from rule-based pattern matching on aggregated behavioural metrics.

---

## 🛠️ Tech Stack

| Layer       | Technology                                 |
| ----------- | ------------------------------------------ |
| Framework   | [Next.js](https://nextjs.org) 16 (App Router) |
| Language    | TypeScript 5                               |
| UI          | React 19, Tailwind CSS 4                   |
| Database    | Prisma ORM (PostgreSQL schema, in-memory MVP) |
| Auth        | bcrypt (password hashing)                  |
| Font        | [Inter](https://fonts.google.com/specimen/Inter) via `next/font` |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** ≥ 18
- **npm** (or yarn / pnpm / bun)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd lifexp

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Database Setup (Optional)

The app runs with an in-memory store by default. To use PostgreSQL:

```bash
# Set your database URL
export DATABASE_URL="postgresql://user:password@localhost:5432/lifexp"

# Uncomment the schema in prisma/schema.prisma, then:
npx prisma db push
npx prisma generate
```

---

## 📜 Available Scripts

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `npm run dev`    | Start development server       |
| `npm run build`  | Create production build         |
| `npm run start`  | Start production server         |
| `npm run lint`   | Run ESLint                      |

---

## 🎨 Design

- **Dark mode** — Full dark theme with glassmorphism cards (`backdrop-blur`, subtle borders)
- **Micro-animations** — Fade-in-up entries, pulse glows, streak flame animations
- **XP toast notifications** — Floating toast with purple glow on every XP earn
- **Responsive** — Sidebar navigation on desktop, compact icon bar on mobile

---

## 📄 License

This project is private.
