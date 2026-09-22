// Task Aura — POST /api/v1/auth/register
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { buildSessionCookieHeader, createSession } from "@/lib/auth/session";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/api/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "client";
    const rate = checkRateLimit(`register:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Too many registration requests. Please retry in ${Math.ceil(
          rate.resetMs / 1000
        )} seconds.`,
        429
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return apiError("INVALID_INPUT", "Request body must be a JSON object", 400);
    }

    const { email, password, confirmPassword, name, displayName } = body;
    if (!email || typeof email !== "string") {
      return apiError("INVALID_INPUT", "Email is required", 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return apiError("INVALID_INPUT", "A valid email address is required", 400);
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return apiError(
        "INVALID_INPUT",
        "Password must be at least 6 characters long",
        400
      );
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      return apiError("INVALID_INPUT", "Passwords do not match", 400);
    }

    const rawName = typeof name === "string" && name.trim() ? name.trim() : typeof displayName === "string" && displayName.trim() ? displayName.trim() : "Adventurer";
    const cleanName = rawName.slice(0, 100);
    const normalizedEmail = email.trim().toLowerCase();

    // Check existing email
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return apiError("CONFLICT", "An account with this email already exists", 409);
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: cleanName,
        isGuest: false,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        isGuest: true,
        createdAt: true,
      },
    });

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
          createdAt: user.createdAt,
        },
      },
      201,
      { "Set-Cookie": cookieHeader }
    );
  } catch (err) {
    return safeCatchError(err);
  }
}
