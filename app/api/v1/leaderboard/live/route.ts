// Task Aura — GET /api/v1/leaderboard/live (Server-Sent Events)
// Delivers lightweight real-time leaderboard updates without heavy socket infrastructure.
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date();
  const dayOfWeek = (today.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOfWeek));
  const weekStartStr = monday.toISOString().slice(0, 10);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Fetch current weekly scores from PostgreSQL
        const scores = await prisma.weeklyScore.findMany({
          where: { weekStart: weekStartStr },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
          orderBy: { totalXp: "desc" },
          take: 20,
        });

        const sanitized = scores.map((s, idx) => {
          const isSelf = s.userId === user.id;
          let displayName = isSelf ? "You" : (s.user.displayName || "Adventurer");
          if (!isSelf) {
            const parts = displayName.trim().split(" ");
            displayName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
          }
          return {
            rank: idx + 1,
            userId: isSelf ? s.userId : `anonymous_${idx + 1}`,
            name: displayName,
            totalXp: s.totalXp,
            isSelf,
          };
        });

        const payload = `data: ${JSON.stringify({ weekStart: weekStartStr, entries: sanitized })}\n\n`;
        controller.enqueue(encoder.encode(payload));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
