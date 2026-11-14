// Thin typed fetch helpers for the workspace UI. All keys stay in the server routes.
import type {
  LegacyAnalyzeRequest,
  ApiError,
  CurriculumContext,
  LegacyGapReport,
  LegacyKnowledgeGap,
  VisualExplainer,
  VisualRequest,
} from "@/types/session";

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (body === null) throw new Error("Empty response from server");
  return body as T;
}

export async function parsePdf(file: File): Promise<CurriculumContext> {
  const form = new FormData();
  form.append("file", file);
  return readJson<CurriculumContext>(await fetch("/api/parse-pdf", { method: "POST", body: form }));
}

export async function analyze(req: LegacyAnalyzeRequest): Promise<LegacyGapReport> {
  return readJson<LegacyGapReport>(
    await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
}

export function visualRequestFor(gap: LegacyKnowledgeGap, topic?: string): VisualRequest {
  return {
    concept: gap.concept,
    misconception: gap.misconception,
    visualPrompt:
      `Clean educational explainer diagram${topic ? ` for ${topic}` : ""} showing "${gap.concept}". ` +
      `Correct idea: ${gap.correction}. Make clear why this is wrong: ${gap.misconception}. ` +
      `Minimal, labelled, whiteboard style, high contrast, no clutter.`,
  };
}

export async function generateVisual(req: VisualRequest): Promise<VisualExplainer> {
  return readJson<VisualExplainer>(
    await fetch("/api/generate-visual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
}
