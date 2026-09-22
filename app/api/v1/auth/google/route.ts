// TaskAura — GET /api/v1/auth/google
// Initiates Google OAuth flow or informs client if credentials are not configured.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const hasConfig = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  if (!hasConfig) {
    const isApi = req.headers.get("accept")?.includes("application/json");
    if (isApi) {
      return apiError(
        "OAUTH_NOT_CONFIGURED",
        "Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured on this server.",
        503
      );
    }
    const origin = req.nextUrl.origin;
    return NextResponse.redirect(
      new URL("/login?error=google_oauth_not_configured", origin)
    );
  }

  const origin = req.nextUrl.origin;
  return NextResponse.redirect(new URL("/api/auth/signin/google", origin));
}
