// A fast, cheap read of the whiteboard for Sam (T33): what is written or drawn, in plain words, nothing else.
// The full live marking takes ~8 s because it marks every criterion; Sam only needs to know what is there.
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJson } from "@/lib/curriculum/llm";
import type { ApiError } from "@/types/session";

export const maxDuration = 30;

const MODEL = process.env.BOARD_READ_MODEL ?? "claude-haiku-5-5";
const Body = z.object({ whiteboardBase64: z.string().min(100).max(8_000_000), context: z.string().max(2000).optional() });
const Out = z.object({ text: z.string() });

const SYSTEM = `You read a student's whiteboard image for a classmate. Reply with JSON {"text": "..."}.
- Describe only what is clearly written or drawn: transcribe equations exactly, name diagrams and their labels, in one to three short sentences. For maths, ALWAYS speak it in words ("x squared plus five x plus six equals zero", "five times eight divided by two equals ten units squared"), because Sam reads your text aloud. Describe only the content: never comment on how it is written (no "no symbols", "one line"), and never say whether it is right.
- Indigo handwriting next to a small "Sam" tag is the question Sam wrote: ignore it.
- Handwriting is ambiguous between b and 6, h and 4, l and 1, x and times, s and 5, o and 0. Use the recent conversation (given with the image) to decide: a student who says "B H over two" wrote b, not 6. When it is still unclear, write both, e.g. "b (or 6)", never one with confidence.
- If the board is empty, or the writing is too unclear to read, reply {"text": ""}. Never guess or invent content.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json<ApiError>({ error: "Send { whiteboardBase64 }." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json<ApiError>({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  try {
    const out = await generateJson({
      model: MODEL,
      system: SYSTEM,
      userText: parsed.data.context ? `Recent conversation (to settle ambiguous handwriting only):
${parsed.data.context}

Read this whiteboard.` : "Read this whiteboard.",
      image: { pngBase64: parsed.data.whiteboardBase64 },
      schema: Out,
      maxTokens: 1500,
    });
    return NextResponse.json({ text: out.text.trim().slice(0, 500) });
  } catch (e) {
    console.error("board-read failed", e);
    return NextResponse.json<ApiError>({ error: "Could not read the board." }, { status: 502 });
  }
}
