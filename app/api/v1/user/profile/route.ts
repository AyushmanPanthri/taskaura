// ============================================================
// TaskAura — /api/v1/user/profile
// GET:   Fetch the authenticated user's own profile
// PATCH: Update the authenticated user's own display name & avatar
// Security Invariant: Updates req.session.user.id ONLY.
// Never accepts userId from client body.
// Never allows updating email, password, or isGuest.
// ============================================================

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

import { ALLOWED_AVATARS } from "@/lib/constants/avatars";
export { ALLOWED_AVATARS };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser || !UUID_REGEX.test(authUser.id)) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatar: true,
        isGuest: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return apiError("NOT_FOUND", "User not found", 404);
    }

    return apiSuccess({
      user: {
        id: user.id,
        name: user.displayName,
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar || "🧑‍💻",
        isGuest: user.isGuest,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser || !UUID_REGEX.test(authUser.id)) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return apiError("INVALID_INPUT", "Request body must be a JSON object", 400);
    }

    const updateData: { displayName?: string; avatar?: string } = {};

    // 1. Validate display name
    const rawName = body.name !== undefined ? body.name : body.displayName;
    if (rawName !== undefined) {
      if (typeof rawName !== "string" || !rawName.trim()) {
        return apiError("INVALID_INPUT", "Display name cannot be empty", 400);
      }
      const trimmedName = rawName.trim();
      if (trimmedName.length > 100) {
        return apiError(
          "INVALID_INPUT",
          "Display name must be between 1 and 100 characters",
          400
        );
      }
      updateData.displayName = trimmedName;
    }

    // 2. Validate avatar preset
    if (body.avatar !== undefined) {
      if (typeof body.avatar !== "string" || !ALLOWED_AVATARS.includes(body.avatar.trim())) {
        return apiError(
          "INVALID_INPUT",
          `Avatar must be one of the supported presets: ${ALLOWED_AVATARS.join(" ")}`,
          400
        );
      }
      updateData.avatar = body.avatar.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return apiError("INVALID_INPUT", "No valid profile fields to update", 400);
    }

    // 3. Security: STRICTLY update the authenticated user's ID
    // Client-supplied userId in body is completely ignored.
    // Email, password, and isGuest are never allowed to be modified here.
    const updatedUser = await prisma.user.update({
      where: { id: authUser.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        avatar: true,
        isGuest: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return apiSuccess({
      user: {
        id: updatedUser.id,
        name: updatedUser.displayName,
        displayName: updatedUser.displayName,
        email: updatedUser.email,
        avatar: updatedUser.avatar || "🧑‍💻",
        isGuest: updatedUser.isGuest,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
