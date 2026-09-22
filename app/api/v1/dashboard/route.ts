// Task Aura — GET /api/v1/dashboard (Deprecated Compatibility Forwarder)
// Canonical endpoint: GET /api/v1/progress
import { NextRequest } from "next/server";
import { GET as getProgress } from "../progress/route";

export async function GET(request: NextRequest) {
  const response = await getProgress(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/v1/progress>; rel="canonical"');
  return response;
}
