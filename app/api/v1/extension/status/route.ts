// ============================================================
// TaskAura — GET /api/v1/extension/status
//
// Lightweight endpoint for the browser extension's 30-second polling loop.
// Returns auth status + active focus session state + current blocklist.
//
// Auth mechanism: The extension calls this with credentials: 'include'.
// The browser automatically attaches the taskaura_session httpOnly cookie.
// getAuthenticatedUser() validates it via the existing session table —
// no new auth code is introduced.
//
// CORS: Responds with appropriate headers for chrome-extension:// origins
// so the MV3 background service worker can make credentialed fetches.
//
// Graceful degradation: Returns { authenticated: false } when no valid
// session exists. A user without the extension installed is unaffected —
// this endpoint is only called by the extension background worker.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiSuccess } from "@/lib/api/response";
import { focusRepository } from "@/lib/repositories/focus-repository";
import { blocklistRepository } from "@/lib/repositories/blocklist-repository";
import { FocusSessionStatus } from "@/lib/logic/types";

const ALLOWED_EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

function extensionCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  // Reflect the exact chrome-extension:// origin back — cannot use * with credentials
  if (origin && origin.startsWith(ALLOWED_EXTENSION_ORIGIN_PREFIX)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: extensionCorsHeaders(origin) });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const corsHeaders = extensionCorsHeaders(origin);

  const user = await getAuthenticatedUser(req);

  if (!user) {
    return new Response(
      JSON.stringify({ success: true, data: { authenticated: false, activeSession: null, blocklist: [] } }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // Fetch active session and blocklist in parallel
  const [activeSession, blocklist] = await Promise.all([
    focusRepository.findActiveSession(user.id),
    blocklistRepository.listDomainStrings(user.id),
  ]);

  const now = new Date();
  const sessionData = activeSession
    ? {
        id: activeSession.id,
        status: activeSession.status,
        startedAt: activeSession.startedAt.toISOString(),
        requiredMinutes: activeSession.requiredMinutes,
        elapsedMinutes:
          Math.round(
            ((now.getTime() - activeSession.startedAt.getTime()) / 60_000) * 10
          ) / 10,
        remainingMinutes: Math.max(
          0,
          Math.round(
            (activeSession.requiredMinutes -
              (now.getTime() - activeSession.startedAt.getTime()) / 60_000) *
              10
          ) / 10
        ),
        isRunning: activeSession.status === FocusSessionStatus.RUNNING,
      }
    : null;

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        authenticated: true,
        userId: user.id,
        displayName: user.displayName ?? user.name ?? null,
        activeSession: sessionData,
        blocklist,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    }
  );
}
