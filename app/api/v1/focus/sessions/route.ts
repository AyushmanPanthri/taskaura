// Task Aura — /api/v1/focus/sessions (Deprecated Compatibility Forwarder)
// Canonical endpoints: GET /api/v1/focus, POST /api/v1/focus/start
import { NextRequest } from "next/server";
import { GET as listFocus } from "../route";
import { POST as startFocus } from "../start/route";

export async function GET(request: NextRequest) {
  const response = await listFocus(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/v1/focus>; rel="canonical"');
  return response;
}

export async function POST(request: NextRequest) {
  const response = await startFocus(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/v1/focus/start>; rel="canonical"');
  return response;
}
