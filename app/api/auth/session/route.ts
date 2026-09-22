// Task Aura — GET /api/auth/session
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiSuccess, safeCatchError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return apiSuccess({ authenticated: false, user: null }, 200);
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUser.id);
    if (!isUuid) {
      return apiSuccess({ authenticated: false, user: null }, 200);
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        isGuest: true,
        createdAt: true,
      },
    });

    if (!user) {
      return apiSuccess({ authenticated: false, user: null }, 200);
    }

    return apiSuccess({
      authenticated: true,
      user: {
        id: user.id,
        name: user.displayName,
        displayName: user.displayName,
        email: user.email,
        isGuest: user.isGuest,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    return safeCatchError(err);
  }
}
