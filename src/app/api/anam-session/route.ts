import { NextResponse } from "next/server";
import type { AnamSessionResponse } from "@/types/session";

// T2 (Anam): replace this stub. Create a real session token with ANAM_API_KEY, avatar model, persona
// system prompt, Director Notes and the client tools. Keep the key server-side.
export async function POST() {
  const body: AnamSessionResponse = { sessionToken: "stub-session-token" };
  return NextResponse.json(body);
}
