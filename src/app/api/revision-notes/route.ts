import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_CURRICULUM_CHARS, tooLongMessage } from "@/lib/curriculum/limits";
import { writeRevisionNotes } from "@/lib/curriculum/revision";
import type { ApiError, GapReport, MarkScheme, RevisionNote } from "@/types/session";

export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

const Criterion = z.object({ id: z.string(), title: z.string(), expected: z.array(z.string()), marks: z.number(), source: z.object({ page: z.number(), label: z.string().optional() }) }).passthrough();
const Result = z.object({ criterionId: z.string(), status: z.string(), awarded: z.number(), missingSteps: z.array(z.string()) }).passthrough();
const RequestSchema = z.object({
  markScheme: z.object({ topic: z.string(), criteria: z.array(Criterion).min(1).max(12) }).passthrough(),
  report: z.object({ results: z.array(Result) }).passthrough(),
  curriculumText: z.string().min(1),
});

/** RevisionNotesRequest { markScheme, report, curriculumText } -> RevisionNote[] (one per criterion that lost marks, worst first). */
export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Send { markScheme, report, curriculumText }.");
  if (parsed.data.curriculumText.length > MAX_CURRICULUM_CHARS) return fail(413, tooLongMessage(parsed.data.curriculumText.length));
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set on the server.");

  try {
    const notes = await writeRevisionNotes(
      parsed.data.markScheme as unknown as MarkScheme,
      parsed.data.report as unknown as GapReport,
      parsed.data.curriculumText,
    );
    return NextResponse.json<RevisionNote[]>(notes);
  } catch (err) {
    console.error("revision-notes failed", err);
    if (err instanceof Anthropic.RateLimitError) return fail(429, "The model is rate limited. Try again in a moment.");
    if (err instanceof Anthropic.APIError) return fail(502, `The model returned an error (${err.status ?? "network"}).`);
    return fail(502, err instanceof Error ? err.message : "Could not write revision notes.");
  }
}
