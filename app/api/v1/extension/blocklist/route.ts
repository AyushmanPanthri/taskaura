// ============================================================
// TaskAura — GET + POST /api/v1/extension/blocklist
//
// GET:  Returns user's full blocklist (for popup UI management).
// POST: Adds a domain to the user's blocklist.
//       Body: { domain: string }
//       Domain is normalized server-side (strips scheme, www, paths).
//       Returns 400 on invalid domain, 409 on duplicate, 422 on cap exceeded.
//
// CORS: Same chrome-extension:// origin handling as the status route.
// ============================================================

import { getAuthenticatedUser } from "@/lib/api/auth";
import { apiError, apiSuccess, safeCatchError } from "@/lib/api/response";
import { blocklistRepository, BLOCKLIST_DOMAIN_CAP } from "@/lib/repositories/blocklist-repository";

const ALLOWED_EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

function extensionCorsHeaders(origin: string | null, methods: string = "GET, POST, OPTIONS"): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": methods,
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
  return new Response(null, {
    status: 204,
    headers: extensionCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const corsHeaders = extensionCorsHeaders(origin);

    const user = await getAuthenticatedUser(req);
    if (!user) return apiError("UNAUTHORIZED", "Authentication required", 401);

    const domains = await blocklistRepository.listDomains(user.id);

    const res = apiSuccess({ domains, cap: BLOCKLIST_DOMAIN_CAP, count: domains.length });
    corsHeaders && Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  } catch (err) {
    return safeCatchError(err);
  }
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const corsHeaders = extensionCorsHeaders(origin);

    const user = await getAuthenticatedUser(req);
    if (!user) return apiError("UNAUTHORIZED", "Authentication required", 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.domain !== "string" || !body.domain.trim()) {
      return apiError("INVALID_INPUT", "Field 'domain' is required", 400);
    }

    const result = await blocklistRepository.addDomain(user.id, body.domain);

    if (!result.added) {
      if (result.reason === "INVALID_DOMAIN") {
        return apiError("INVALID_DOMAIN", "Could not parse a valid domain from the provided input", 400);
      }
      if (result.reason === "ALREADY_EXISTS") {
        return apiError("CONFLICT", "Domain is already in your blocklist", 409);
      }
      if (result.reason.startsWith("DOMAIN_CAP_EXCEEDED")) {
        return apiError("DOMAIN_CAP_EXCEEDED", `Blocklist is full (maximum ${BLOCKLIST_DOMAIN_CAP} domains)`, 422);
      }
      return apiError("INTERNAL_ERROR", result.reason, 500);
    }

    const res = apiSuccess({ domain: result.domain, added: true }, 201);
    corsHeaders && Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  } catch (err) {
    return safeCatchError(err);
  }
}
