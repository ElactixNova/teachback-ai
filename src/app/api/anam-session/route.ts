import { NextResponse } from "next/server";
import type { AnamSessionResponse, ApiError } from "@/types/session";
import { buildPersonaConfig, type PersonaContext } from "@/lib/anam/persona";

// T2: exchanges ANAM_API_KEY (server-side only) for a short-lived Anam session token.
// Body (optional JSON): { topic?: string, notesExcerpt?: string } to scope the persona.
const ANAM_API = process.env.ANAM_API_URL || "https://api.anam.ai";

export async function POST(req: Request) {
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json<ApiError>({ error: "ANAM_API_KEY is not set on the server." }, { status: 500 });
  }

  let ctx: PersonaContext = {};
  try {
    const body = (await req.json()) as Partial<PersonaContext> | null;
    if (body && typeof body === "object") {
      ctx = {
        topic: typeof body.topic === "string" ? body.topic : undefined,
        notesExcerpt: typeof body.notesExcerpt === "string" ? body.notesExcerpt : undefined,
      };
    }
  } catch {
    // No or invalid body: use the generic persona.
  }

  try {
    const res = await fetch(`${ANAM_API}/v1/auth/session-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        clientLabel: "teachback",
        expiresInSeconds: 900,
        personaConfig: buildPersonaConfig(ctx),
      }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { sessionToken?: string; message?: string; error?: string };
    if (!res.ok || !data.sessionToken) {
      const detail = data.message || data.error || `HTTP ${res.status}`;
      console.error("[anam-session] token request failed:", detail);
      return NextResponse.json<ApiError>({ error: `Anam session failed: ${detail}` }, { status: 502 });
    }
    return NextResponse.json<AnamSessionResponse>({ sessionToken: data.sessionToken });
  } catch (e) {
    console.error("[anam-session] network error:", e);
    return NextResponse.json<ApiError>({ error: "Could not reach Anam." }, { status: 502 });
  }
}
