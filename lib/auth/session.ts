import { prisma } from "../prisma";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "taskaura_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string;
  name?: string | null;
  isGuest?: boolean;
  role?: "USER" | "ADMIN";
  timezone?: string;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function validateSession(token: string): Promise<SessionUser | null> {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            isGuest: true,
            role: true,
          },
        },
      },
    });

    if (!session || !session.user) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      // Session expired, clean it up
      await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
      return null;
    }

    const name = session.user.displayName || (session.user.isGuest ? "Guest" : "Adventurer");
    return {
      id: session.user.id,
      email: session.user.email,
      displayName: name,
      name,
      isGuest: session.user.isGuest,
      role: (session.user.role as "USER" | "ADMIN") || "USER",
      timezone: "UTC",
    };
  } catch (err) {
    // If DB is unreachable or in-memory fallback, return null safely
    console.error("[Session] Error validating session:", err);
    return null;
  }
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  try {
    await prisma.session.delete({ where: { token } }).catch(() => null);
  } catch {
    // ignore
  }
}

export function extractTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.substring(SESSION_COOKIE_NAME.length + 1));
}

export function buildSessionCookieHeader(token: string, expiresAt: Date): string {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureFlag}`;
}

export function buildClearSessionCookieHeader(): string {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
}
