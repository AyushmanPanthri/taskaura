// ============================================================
// Task Aura — API Response Standard Contract
// Success: { success: true, data: T }
// Error:   { success: false, error: { code: string, message: string } }
// ============================================================

import { NextResponse } from "next/server";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export function apiSuccess<T>(
  data: T,
  status: number = 200,
  headers?: Record<string, string>
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status, headers }
  );
}

export function apiError(
  code: string,
  message: string,
  status: number = 400,
  headers?: Record<string, string>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status, headers }
  );
}

/**
 * Safely sanitizes database and runtime exceptions so internal
 * SQL, stack traces, and database internals are never exposed.
 */
export function safeCatchError(err: unknown): NextResponse<ApiErrorResponse> {
  const errorObj = err as { code?: string; message?: string };
  // Check for common Prisma error codes
  if (errorObj?.code === "P2002") {
    return apiError(
      "CONFLICT",
      "A unique constraint was violated on this operation.",
      409
    );
  }
  if (errorObj?.code === "P2025") {
    return apiError("NOT_FOUND", "The requested record was not found.", 404);
  }
  if (errorObj?.code === "P2003") {
    return apiError("BAD_REQUEST", "Related reference entity does not exist.", 400);
  }

  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected internal error occurred."
      : errorObj?.message || "Internal server error";

  return apiError("INTERNAL_ERROR", message, 500);
}
