// Task Aura — POST /api/v1/auth/login
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { buildSessionCookieHeader, createSession } from "@/lib/auth/session";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/api/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "client";
    const rate = checkRateLimit(`login:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Too many login attempts. Please retry in ${Math.ceil(
          rate.resetMs / 1000
        )} seconds.`,
        429
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return apiError("INVALID_INPUT", "Request body must be a JSON object", 400);
    }

    const { email, password } = body;
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return apiError("INVALID_INPUT", "Email and password are required", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      return apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      return apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    const { token, expiresAt } = await createSession(user.id);
    const cookieHeader = buildSessionCookieHeader(token, expiresAt);

    return apiSuccess(
      {
        user: {
          id: user.id,
          name: user.displayName,
          displayName: user.displayName,
          email: user.email,
          isGuest: user.isGuest,
        },
      },
      200,
      { "Set-Cookie": cookieHeader }
    );
  } catch (err) {
    return safeCatchError(err);
  }
}
