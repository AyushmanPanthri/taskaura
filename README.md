# TaskAura — Gamify Your Productivity ⚡

> Turn daily habits, tasks, and focus sessions into rewarding XP-driven quests. TaskAura is a full-stack, production-grade gamified productivity system with real PostgreSQL persistence, secure authentication, and a role-based admin layer.

---

## ✨ Features

### 📊 Dashboard
- **XP & Leveling** — Earn experience points for every completed task, habit, and focus session. Progression is derived from an authoritative server-side XP ledger (never client-calculated).
- **Streak Tracking** — Daily streaks with a grace-day token system to stay motivated without burnout.
- **Stat Cards** — At-a-glance view of Total XP, Current Level, Tasks Today, Focus Minutes, and Best Streak.

### ✅ Task Management
- Create tasks with four difficulty tiers: **Easy**, **Normal**, **Hard**, and **Epic**.
- Status lifecycle: `Pending → In Progress → Completed / Cancelled / Expired`.
- XP rewards scale with difficulty via the authoritative server-side economy engine.
- Anti-farming: per-day soft cap and idempotent XP transactions prevent double-awarding.

### 🧘 Habit Tracker
- Daily, weekday, weekend, or custom-frequency habits.
- Per-habit streak counters with personal-best tracking.
- Each habit completion awards XP based on streak multipliers.

### 🎯 Focus Timer
- Pomodoro-style sessions with preset durations (15 / 25 / 45 / 60 min).
- Animated countdown ring with heartbeat-based session validation.
- XP awarded on completion via the authoritative server-side focus service.

### 🏆 Leaderboard
- Weekly ranked leaderboard comparing XP across users.
- Highlighted personal ranking with weekly stats.

### 🧠 AI Insights Engine
- **Rule-based AI** — 10+ deterministic rules (no LLM required) that analyse behavioral metrics and generate insights, recommendations, and auto-quests.
- Bounded context assembly (capped metrics window + task cap) for efficiency.

### 🏅 Achievements
- Milestone-based badges (First Steps, Streak Master, Task Warrior, Focus Champion, and more).
- Evaluated server-side against the authoritative XP ledger.

### 👤 User Profile
- Display name and RPG archetype avatar selector (8 presets: 🧑‍💻 ⚔️ 🧙‍♂️ 🏹 🥷 ⚡ 🦊 👑).
- Live sidebar mini-profile updates on save.
- Dedicated sign-out with session invalidation.

### 🛡️ Admin Headquarters (`/admin`)
- **Command Center Overview (`/admin`)** — Real-time platform telemetry across 8 PostgreSQL metrics (Total Users, Registered vs Guest, New This Week, Total Quests, Active Quests, Completed Quests, Total XP Ledger, Badges Earned) and live recent audit activity.
- **Player Directory (`/admin/users`)** — Searchable, filterable player index with role and account type filters, progression metrics, streak indicators, and pagination.
- **Player Detail Inspector (`/admin/users/[id]`)** — Comprehensive telemetry panel for individual players with tabs for XP ledger transactions, quest mission logs, active tasks, habits, and unlocked badges. Password hashes are never exposed.
- **Quest Forge (`/admin/quests` & `/admin/quests/create`)** — Admin workbench to design server quests, set difficulty tiers, configure XP bounties, and fan out assignments (GLOBAL across all players or targeted SPECIFIC player groups). Includes built-in **AI Quest Proposal Generator** to instantly draft challenge blueprints.
- **Rewards Center (`/admin/rewards`)** — Authoritative manual XP adjustments and duplicate-safe achievement awards routed directly through the append-only ledger and audit system.
- **Audit Activity Log (`/admin/activity`)** — Immutable, chronological record of all administrative operations with actor metadata, target player details, and change history.
- **Security & Layout** — Protected by strict server-side `requireAdmin()` gate; non-admins redirected to `/`, unauthenticated users to `/login`. Wrapped in dedicated `AdminShell` with desktop navigation, quick action headers, and mobile drawer.

---

## 🔐 Authentication & Security

| Feature | Detail |
|---|---|
| Password hashing | `bcrypt` (10 salt rounds) — plaintext never stored or logged |
| Session storage | HTTP-only cookie (`taskaura_session`) backed by PostgreSQL `sessions` table |
| Session validation | Every protected request validates the session token against PostgreSQL — cookie presence alone is never sufficient |
| Revoked sessions | A deleted session row immediately blocks access even with a valid cookie |
| Header spoofing | `x-user-id` / raw Bearer headers are strictly rejected in production |
| Rate limiting | Registration, login, and guest login are rate-limited per IP |
| Multi-user isolation | All data queries use `WHERE userId = authUser.id` from the verified session |
| Role system | `Role` enum: `USER` (default) \| `ADMIN` — stored in PostgreSQL, read on every request |
| `requireAdmin()` | Server-side helper that validates role and returns `401`/`403` or redirects |

---

## 🏗️ Architecture

```
lifexp/
├── app/
│   ├── (protected)/            # Auth-gated route group
│   │   ├── layout.tsx          # Server-side session gate (PostgreSQL validation)
│   │   ├── page.tsx            # Dashboard
│   │   ├── tasks/              # Tasks view
│   │   ├── habits/             # Habits view
│   │   ├── focus/              # Focus timer view
│   │   ├── leaderboard/        # Leaderboard view
│   │   ├── profile/            # User profile & avatar editor
│   │   └── admin/              # Admin headquarters (ADMIN role only)
│   ├── login/                  # Public login/signup page (split-panel design)
│   └── api/
│       └── v1/
│           ├── auth/           # register, login, logout, me, guest, google OAuth
│           ├── tasks/          # CRUD + complete/cancel
│           ├── habits/         # CRUD + log
│           ├── focus/          # start, heartbeat, complete, abandon
│           ├── leaderboard/    # weekly rankings
│           ├── progress/       # authoritative XP/level summary
│           ├── dashboard/      # aggregated dashboard data
│           ├── user/profile/   # GET & PATCH own profile
│           ├── admin/users/    # GET all users (ADMIN only, read-only)
│           └── ai/             # insights, recommendations, quests
├── components/
│   └── AppShell.tsx            # Responsive layout shell (sidebar + mobile nav + logout)
├── lib/
│   ├── auth/
│   │   ├── session.ts          # createSession, validateSession (PostgreSQL)
│   │   ├── server-session.ts   # getServerSessionUser() for Server Components
│   │   ├── password.ts         # hashPassword / verifyPassword (bcrypt)
│   │   └── require-admin.ts    # requireAdmin() helper (API + Server Component)
│   ├── api/
│   │   ├── auth.ts             # getAuthenticatedUser() (session cookie → role)
│   │   ├── response.ts         # apiSuccess / apiError / safeCatchError
│   │   └── rate-limit.ts       # In-memory rate limiter
│   ├── constants/
│   │   └── avatars.ts          # Shared ALLOWED_AVATARS (safe for client & server)
│   ├── logic/                  # Pure business logic (no side effects)
│   │   ├── xp-engine.ts        # XP calculation & leveling
│   │   ├── economy.ts          # Level table, XP thresholds
│   │   ├── achievement-engine.ts
│   │   ├── ai-rules.ts
│   │   └── ...
│   ├── repositories/           # Prisma-backed data access layer
│   └── services/               # Service layer (XP, tasks, focus, leaderboard)
├── prisma/
│   └── schema.prisma           # Canonical PostgreSQL schema
└── tests/                      # Vitest test suites
```

### Design Principles
- **Server-authoritative economy** — XP, level, and streak are always derived server-side from the PostgreSQL ledger. Client calculations are display-only.
- **Idempotent XP** — Every transaction has a unique key (`hash(sourceType + sourceId + rewardType)`) preventing double-awarding.
- **Cookie-presence is never sufficient** — Every protected request validates the session token row in PostgreSQL.
- **Logic / Service split** — All business rules in `lib/logic/` are pure functions. `lib/services/` handles state and I/O.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19, Vanilla CSS (dark glassmorphism design system) |
| Database | PostgreSQL via [Prisma ORM](https://www.prisma.io) + `@prisma/adapter-pg` |
| Auth | bcrypt passwords · HTTP-only session cookies · PostgreSQL session store |
| Testing | [Vitest](https://vitest.dev) — 51+ tests across auth, admin, profile, and routing suites |
| Fonts | [Inter](https://fonts.google.com/specimen/Inter) via `next/font` |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** ≥ 18
- **PostgreSQL** running locally (default: `localhost:5432`)
- **npm**

### Installation

```bash
git clone <repo-url>
cd lifexp
npm install
```

### Environment Setup

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Required variables:

```env
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/taskaura?schema=public"
AUTH_SECRET="<32-char-secret>"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Optional — Google OAuth
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
```

### Database Setup

```bash
# Create the taskaura database in PostgreSQL, then:
npx prisma generate

# Apply the schema manually via psql or run the migration SQL in prisma/migrations/
# The schema is in prisma/schema.prisma
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Granting Admin Role

Admin access is granted **manually in PostgreSQL** — there is no self-service UI:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'your@email.com';
```

Then log in and visit `/admin`.

---

## 📜 Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Create production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run all Vitest test suites |

---

## 🧪 Tests

```bash
npm test
# or target specific suites:
npx vitest run tests/services.test.ts
npx vitest run tests/postgres-concurrency.test.ts
npx vitest run tests/admin-headquarters.test.ts
```

Current test suite: **214 passing tests across 19 test files** verifying:
- Full-stack PostgreSQL authentication, hashing, and sessions
- Concurrency invariants & atomic transactions (20 parallel requests)
- Single source of truth for XP transactions, levels, and progress
- Cold reboot / server restart durability (zero data loss)
- Admin Headquarters role enforcement, audits, and rewards
- AI insights, recommendations, and quests backed by PostgreSQL

---

## 🏛️ Architecture: PostgreSQL Single Source of Truth

TaskAura operates on a unified, durable architecture where PostgreSQL is the sole source of truth:
- **Ledger-Backed Progression**: All XP transactions are append-only rows in `xPTransaction` with strict unique idempotency keys (`userId`, `idempotencyKey`).
- **Zero In-Memory Durability Gap**: All tasks, habits, focus sessions, and progress summaries write through Prisma repositories directly to PostgreSQL. In-memory singletons (`InMemoryStore`) have been completely eliminated.
- **Serverless & Multi-Instance Ready**: Cold boots, restarts, or multi-instance deployments maintain 100% data integrity with zero data loss.

---

## 🎨 Design

- **Dark glassmorphism** — Full dark theme with `backdrop-blur`, subtle borders, and purple/cyan accent palette
- **Micro-animations** — Fade-in-up entries, pulse glows, XP toast notifications
- **Split-panel login** — Gradient hero panel + form panel, responsive to single column on mobile
- **Responsive AppShell** — Sidebar navigation on desktop, bottom icon bar on mobile

---

## 📄 License

This project is private.
