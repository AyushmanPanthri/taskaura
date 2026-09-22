// Task Aura — POST /api/v1/auth/logout
import { NextRequest } from "next/server";
import {
  buildClearSessionCookieHeader,
  destroySession,
  extractTokenFromCookie,
} from "@/lib/auth/session";
import { apiSuccess } from "@/lib/api/response";

export async function POST(req: NextRequest) {
  return handleLogout(req);
}

export async function GET(req: NextRequest) {
  return handleLogout(req);
}

async function handleLogout(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie");
  const token = extractTokenFromCookie(cookieHeader);

  if (token) {
    await destroySession(token);
  }

  const clearCookie = buildClearSessionCookieHeader();
  return apiSuccess({ message: "Logged out successfully" }, 200, {
    "Set-Cookie": clearCookie,
  });
}
