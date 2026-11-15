import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { draftMarkScheme } from "@/lib/curriculum/examine";
import { MAX_CURRICULUM_CHARS, tooLongMessage } from "@/lib/curriculum/limits";
import type { ApiError, MarkScheme } from "@/types/session";

export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

const RequestSchema = z.object({
  curriculumText: z.string().trim().min(1),
  topic: z.string().max(200).default(""),
  sourceFile: z.string().max(300).default("notes.pdf"),
});

/** MarkSchemeRequest { curriculumText, topic, sourceFile } -> MarkScheme. Called right after the PDF upload. */
export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Send { curriculumText, topic, sourceFile }.");
  const body = parsed.data;
  if (body.curriculumText.length > MAX_CURRICULUM_CHARS) return fail(413, tooLongMessage(body.curriculumText.length));
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set on the server.");

  try {
    return NextResponse.json<MarkScheme>(await draftMarkScheme(body));
  } catch (err) {
    console.error("mark-scheme failed", err);
    if (err instanceof Anthropic.AuthenticationError) return fail(500, "The server's ANTHROPIC_API_KEY was rejected.");
    if (err instanceof Anthropic.RateLimitError) return fail(429, "The model is rate limited. Try again in a moment.");
    if (err instanceof Anthropic.APIError) return fail(502, `The model returned an error (${err.status ?? "network"}).`);
    return fail(502, err instanceof Error ? err.message : "Could not build a mark scheme.");
  }
}
