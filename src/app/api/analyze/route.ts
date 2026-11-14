import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { examineFinal, examineLive } from "@/lib/curriculum/examine";
import type { AnalyzeRequest, ApiError } from "@/types/session";

// A long timeout: final marking with the strongest model can take ~10-20s.
export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

const MAX_LINES = 600;
const MAX_TRANSCRIPT_CHARS = 80_000;
const MAX_IMAGE_CHARS = 6_000_000; // base64, about 4.5 MB of PNG

const RequestSchema = z.object({
  mode: z.enum(["live", "final"]),
  markScheme: z.object({
    topic: z.string(),
    criteria: z
      .array(z.object({ id: z.string(), title: z.string(), expected: z.array(z.string()), marks: z.number() }).passthrough())
      .min(1)
      .max(12),
  }).passthrough(),
  transcript: z.array(z.object({ speaker: z.enum(["student", "avatar"]), text: z.string(), t: z.string() })).max(MAX_LINES),
  whiteboardBase64: z.string().max(MAX_IMAGE_CHARS).optional(),
});

/**
 * AnalyzeRequest { markScheme, transcript, whiteboardBase64?, mode }
 *   mode "live"  -> { results: CriterionResult[] }  (may contain "in_progress")
 *   mode "final" -> GapReport
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return fail(400, `Bad request: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const body = parsed.data as unknown as AnalyzeRequest;

  if (body.transcript.reduce((n, l) => n + l.text.length, 0) > MAX_TRANSCRIPT_CHARS) return fail(413, "The transcript is too long to mark.");
  const studentSaid = body.transcript.some((l) => l.speaker === "student" && l.text.trim());
  if (!studentSaid && !body.whiteboardBase64) return fail(400, "Explain or draw something first.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set on the server.");

  try {
    return NextResponse.json(body.mode === "final" ? await examineFinal(body) : await examineLive(body));
  } catch (err) {
    console.error("analyze failed", err);
    if (err instanceof Anthropic.AuthenticationError) return fail(500, "The server's ANTHROPIC_API_KEY was rejected.");
    if (err instanceof Anthropic.RateLimitError) return fail(429, "The marking model is rate limited. Try again in a moment.");
    if (err instanceof Anthropic.APIError) return fail(502, `The marking model returned an error (${err.status ?? "network"}).`);
    return fail(502, err instanceof Error ? err.message : "Marking failed.");
  }
}
