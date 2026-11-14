import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { analyzeExplanation } from "@/lib/curriculum/analyze";
import { MAX_CURRICULUM_CHARS, tooLongMessage } from "@/lib/curriculum/limits";
import type { AnalyzeRequest, ApiError, GapReport } from "@/types/session";

const fail = (status: number, error: string) => NextResponse.json<ApiError>({ error }, { status });

/** AnalyzeRequest { transcript, curriculumText, whiteboard? } -> GapReport. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<AnalyzeRequest> | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  const curriculumText = typeof body?.curriculumText === "string" ? body.curriculumText.trim() : "";
  const whiteboard = typeof body?.whiteboard?.pngBase64 === "string" && body.whiteboard.pngBase64 ? body.whiteboard : undefined;

  // Notes are optional: without them the explanation is checked against general knowledge of the subject.
  if (curriculumText.length > MAX_CURRICULUM_CHARS) return fail(413, tooLongMessage(curriculumText.length));
  if (!transcript && !whiteboard) return fail(400, "Explain or draw something first.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY is not set on the server.");

  try {
    return NextResponse.json<GapReport>(await analyzeExplanation({ transcript, curriculumText, whiteboard }));
  } catch (err) {
    console.error("analyze failed", err);
    if (err instanceof Anthropic.AuthenticationError) return fail(500, "The server's ANTHROPIC_API_KEY was rejected.");
    if (err instanceof Anthropic.RateLimitError) return fail(429, "The analysis model is rate limited. Try again in a moment.");
    if (err instanceof Anthropic.APIError) return fail(502, `The analysis model returned an error (${err.status ?? "network"}).`);
    return fail(502, err instanceof Error ? err.message : "Analysis failed.");
  }
}
