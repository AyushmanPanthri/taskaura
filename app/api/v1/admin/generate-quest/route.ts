// ============================================================
// TaskAura — /api/v1/admin/generate-quest
// POST: Generate a quest PROPOSAL using the existing AI rules engine
// Returns a proposal only — does NOT create a quest or award XP
// Admin must review, edit, then confirm via POST /api/v1/admin/quests
// ============================================================
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { apiSuccess, safeCatchError } from "@/lib/api/response";

const QUEST_TEMPLATES = [
  {
    title: "7-Day Discipline",
    description: "Complete your daily routine for seven consecutive days. Consistency is the foundation of greatness.",
    difficulty: "HARD",
    xpReward: 500,
    targetType: "GLOBAL",
  },
  {
    title: "Focus Champion",
    description: "Complete 5 full focus sessions this week. Every minute of deep work sharpens the blade.",
    difficulty: "NORMAL",
    xpReward: 250,
    targetType: "GLOBAL",
  },
  {
    title: "Task Conqueror",
    description: "Complete 10 tasks in a single day. Volume builds momentum.",
    difficulty: "HARD",
    xpReward: 400,
    targetType: "GLOBAL",
  },
  {
    title: "Habit Architect",
    description: "Maintain a streak of 14 consecutive days on any habit. Small actions, compounded.",
    difficulty: "EPIC",
    xpReward: 750,
    targetType: "GLOBAL",
  },
  {
    title: "The Grind",
    description: "Accumulate 500 XP in a single week. Push beyond your limits.",
    difficulty: "NORMAL",
    xpReward: 200,
    targetType: "GLOBAL",
  },
  {
    title: "Deep Work Sprint",
    description: "Complete a 60-minute focus session three days in a row. Depth over breadth.",
    difficulty: "HARD",
    xpReward: 350,
    targetType: "GLOBAL",
  },
  {
    title: "Legendary Week",
    description: "Complete tasks every day for 7 days straight. Legends are built in the dark.",
    difficulty: "LEGENDARY",
    xpReward: 1000,
    targetType: "GLOBAL",
  },
];

export async function POST(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin(req);
    if (adminCheck instanceof Response) return adminCheck;

    const body = await req.json().catch(() => ({}));
    const { theme } = body;

    // Select a template — cycle through or pick based on optional theme
    const idx = theme
      ? QUEST_TEMPLATES.findIndex((t) => t.title.toLowerCase().includes(theme.toLowerCase()))
      : Math.floor(Math.random() * QUEST_TEMPLATES.length);

    const template = QUEST_TEMPLATES[idx >= 0 ? idx : Math.floor(Math.random() * QUEST_TEMPLATES.length)];

    // Compute a sensible deadline (7 days from now)
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    return apiSuccess({
      proposal: {
        ...template,
        estimatedXp: template.xpReward,
        deadline,
        status: "ACTIVE",
        generatedBy: "RULE_ENGINE",
        note: "This is a proposal only. Review and edit before confirming.",
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
