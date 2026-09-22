// TaskAura — GET & POST /api/v1/auth/callback/google
// Handles Google OAuth callback, establishes TaskAura session cookie, and returns user identity.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth-config";
import { googleAuthService, GoogleAuthProfile } from "@/lib/auth/google-auth-service";
import { buildSessionCookieHeader, createSession } from "@/lib/auth/session";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  try {
    const errorParam = req.nextUrl.searchParams.get("error");
    if (errorParam) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(errorParam)}`, req.nextUrl.origin)
      );
    }

    // Retrieve NextAuth session if established by OAuth handshake
    const session = await getServerSession(authOptions);
    const userId = (session?.user as unknown as { id?: string })?.id;

    if (!userId) {
      return NextResponse.redirect(
        new URL("/login?error=oauth_authentication_failed", req.nextUrl.origin)
      );
    }

    // Issue authoritative TaskAura session cookie
    const { token, expiresAt } = await createSession(userId);
    const cookieHeader = buildSessionCookieHeader(token, expiresAt);

    const redirectRes = NextResponse.redirect(new URL("/", req.nextUrl.origin));
    redirectRes.headers.set("Set-Cookie", cookieHeader);
    return redirectRes;
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=oauth_internal_error", req.nextUrl.origin)
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return apiError("INVALID_INPUT", "Request body must be a JSON object", 400);
    }

    const profile: GoogleAuthProfile = body.profile || body;
    if (!profile || typeof profile !== "object") {
      return apiError("INVALID_INPUT", "Google profile data is required", 400);
    }

    // Pass to GoogleAuthService
    const result = await googleAuthService.handleGoogleCallback(profile);

    // Create authoritative TaskAura session
    const { token, expiresAt } = await createSession(result.user.id);
    const cookieHeader = buildSessionCookieHeader(token, expiresAt);

    return apiSuccess(
      {
        user: result.user,
        isNewUser: result.isNewUser,
        linked: result.linked,
      },
      200,
      { "Set-Cookie": cookieHeader }
    );
  } catch (err: unknown) {
    const msg = (err as Error)?.message || "";
    if (msg.startsWith("INVALID_")) {
      return apiError("INVALID_PROVIDER_IDENTITY", msg, 400);
    }
    if (msg.startsWith("UNVERIFIED_EMAIL")) {
      return apiError("UNVERIFIED_EMAIL", msg, 403);
    }
    return safeCatchError(err);
  }
}
