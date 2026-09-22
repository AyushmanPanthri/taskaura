// Task Aura — POST /api/v1/ai/quest (Deprecated Compatibility Forwarder)
// Canonical endpoint: POST /api/v1/ai/quests
import { NextRequest } from "next/server";
import { POST as postAiQuests } from "../quests/route";

export async function POST(request: NextRequest) {
  const response = await postAiQuests(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/v1/ai/quests>; rel="canonical"');
  return response;
}
