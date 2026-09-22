// Task Aura — POST /api/v1/auth/guest
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSessionCookieHeader, createSession } from "@/lib/auth/session";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/api/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "client";
    const rate = checkRateLimit(`guest:${ip}`, { limit: 15, windowMs: 60_000 });
    if (!rate.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Too many guest login requests. Please retry in ${Math.ceil(
          rate.resetMs / 1000
        )} seconds.`,
        429
      );
    }

    // Create a new distinct guest user in PostgreSQL
    const guestUser = await prisma.user.create({
      data: {
        displayName: "Guest",
        email: null,
        passwordHash: null,
        isGuest: true,
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        isGuest: true,
        createdAt: true,
      },
    });

    // Create session associated with this guest user
    const { token, expiresAt } = await createSession(guestUser.id);
    const cookieHeader = buildSessionCookieHeader(token, expiresAt);

    return apiSuccess(
      {
        user: {
          id: guestUser.id,
          name: guestUser.displayName,
          displayName: guestUser.displayName,
          email: null,
          isGuest: true,
          createdAt: guestUser.createdAt,
        },
      },
      201,
      { "Set-Cookie": cookieHeader }
    );
  } catch (err) {
    return safeCatchError(err);
  }
}
