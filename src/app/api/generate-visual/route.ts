import { NextResponse } from "next/server";
import type { VisualExplainer } from "@/types/session";

// T4 (fal): replace this stub. Body is VisualRequest { concept, misconception, visualPrompt }.
// Call @fal-ai/client with FAL_KEY (server-side). Try fast video; fall back to a fast image model after ~10s.
export async function POST() {
  const body: VisualExplainer = {
    kind: "image",
    url: "https://placehold.co/640x360?text=visual+explainer",
    model: "stub",
    prompt: "stub",
    fallback: true,
  };
  return NextResponse.json(body);
}
