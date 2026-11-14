import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_TEXTS, MAX_TEXT_CHARS, toLatexBatch } from "@/lib/math/tolatex";
import type { ApiError } from "@/types/session";

export const maxDuration = 30;

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

const RequestSchema = z.object({ texts: z.array(z.string().max(MAX_TEXT_CHARS)).min(1).max(MAX_TEXTS) });

// Small in-memory cache: the same transcript line is asked for again on every re-render or reload.
const cache = new Map<string, string>();
const CACHE_MAX = 500;

/**
 * POST { texts: string[] } -> { texts: string[] }: each text with its maths wrapped in $...$ (LaTeX), for display
 * only. A text the model could not convert safely comes back unchanged, so the UI can always show the result.
 */
export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, `Send { texts: string[] } (at most ${MAX_TEXTS} texts of ${MAX_TEXT_CHARS} characters).`);
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set on the server.");

  const { texts } = parsed.data;
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  try {
    if (missing.length > 0) {
      const converted = await toLatexBatch(missing);
      missing.forEach((t, i) => {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(t, converted[i]);
      });
    }
    return NextResponse.json({ texts: texts.map((t) => cache.get(t) ?? t) });
  } catch (err) {
    console.error("to-latex failed", err);
    if (err instanceof Anthropic.RateLimitError) return fail(429, "The model is rate limited. Try again in a moment.");
    return fail(502, err instanceof Error ? err.message : "Could not convert the maths.");
  }
}
