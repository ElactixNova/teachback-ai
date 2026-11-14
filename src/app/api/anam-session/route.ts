import { NextResponse } from "next/server";
import type { AnamSessionResponse, ApiError } from "@/types/session";
import { buildPersonaConfig, type PersonaContext } from "@/lib/anam/persona";

// T2: exchanges ANAM_API_KEY (server-side only) for a short-lived Anam session token.
// Body (optional JSON): { topic?, notesExcerpt?, criteria?: {id,title,probe?,ask?}[] }. With criteria: the Mark Scheme Rail persona + tools.
const ANAM_API = process.env.ANAM_API_URL || "https://api.anam.ai";

const clean = (text: string, max: number) => text.trim().replace(/\s+/g, " ").slice(0, max);

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
        // Mark Scheme Rail: titles and questions only (the persona must not know the expected answers).
        criteria: Array.isArray(body.criteria)
          ? body.criteria
              .filter((c): c is NonNullable<PersonaContext["criteria"]>[number] => !!c && typeof c.id === "string" && typeof c.title === "string")
              .slice(0, 12)
              .map((c) => ({
                id: c.id.slice(0, 20),
                title: clean(c.title, 120),
                probe: typeof c.probe === "string" ? clean(c.probe, 300) : undefined,
                ask: c.ask === "write" || c.ask === "draw" ? c.ask : undefined,
              }))
          : undefined,
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
