import { NextResponse } from "next/server";
import type { ApiError, VisualRequest } from "@/types/session";
import { FalConfigError, generateVisual } from "@/lib/fal/generate";

export const maxDuration = 60;

function bad(error: string, status: number) {
  return NextResponse.json<ApiError>({ error }, { status });
}

/** POST { concept, misconception, visualPrompt } -> VisualExplainer. Video within ~10s, else a fast image. */
export async function POST(req: Request) {
  let body: Partial<VisualRequest>;
  try {
    body = (await req.json()) as Partial<VisualRequest>;
  } catch {
    return bad("Body must be JSON.", 400);
  }
  if (typeof body.concept !== "string" || !body.concept.trim()) return bad("`concept` is required.", 400);

  const request: VisualRequest = {
    concept: body.concept.trim().slice(0, 300),
    misconception: typeof body.misconception === "string" ? body.misconception.slice(0, 600) : "",
    visualPrompt: typeof body.visualPrompt === "string" ? body.visualPrompt.slice(0, 1500) : "",
    quality: body.quality === "draft" ? "draft" : "final",
  };

  try {
    return NextResponse.json(await generateVisual(request));
  } catch (e) {
    if (e instanceof FalConfigError) return bad(e.message, 503);
    console.error("generate-visual failed", e);
    return bad("Could not generate a visual right now. Try again.", 502);
  }
}
