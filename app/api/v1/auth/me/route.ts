// Task Aura — GET /api/v1/auth/me
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUser.id);
    if (!isUuid) {
      return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        isGuest: true,
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
        isGuest: user.isGuest,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
