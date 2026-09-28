// ============================================================
// TaskAura — DELETE /api/v1/extension/blocklist/[domain]
//
// Removes a domain from the user's blocklist.
// The :domain param is URL-encoded by the client.
// Server normalizes it identically to the POST route before matching.
//
// Returns 200 { removed: true } on success.
// Returns 404 if the domain was not in the blocklist.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { blocklistRepository } from "@/lib/repositories/blocklist-repository";

interface RouteParams {
  params: Promise<{ domain: string }>;
}

const ALLOWED_EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

function extensionCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin && origin.startsWith(ALLOWED_EXTENSION_ORIGIN_PREFIX)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: extensionCorsHeaders(origin) });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const origin = req.headers.get("origin");
    const corsHeaders = extensionCorsHeaders(origin);

    const user = await getAuthenticatedUser(req);
    if (!user) return apiError("UNAUTHORIZED", "Authentication required", 401);

    const { domain: rawDomain } = await params;
    const domain = decodeURIComponent(rawDomain);

    const result = await blocklistRepository.removeDomain(user.id, domain);

    if (!result.removed) {
      return apiError("NOT_FOUND", "Domain not found in your blocklist", 404);
    }

    const res = apiSuccess({ removed: true, domain });
    corsHeaders && Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  } catch (err) {
    return safeCatchError(err);
  }
}
