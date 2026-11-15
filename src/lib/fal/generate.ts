// fal.ai visual explainer pipeline (T4). Server-only: reads FAL_KEY, never imported by client code.
// Models and latencies measured live on Sat 14 Nov 2026 (see docs/research/fal.md in the team workspace).
import { fal } from "@fal-ai/client";
import type { VisualExplainer, VisualRequest } from "@/types/session";

/** The only model: best accuracy on diagrams with exact formulas and labels (~17s). The faster model drew inaccurate pictures, so it is not used. */
export const PRIMARY_MODEL = "fal-ai/nano-banana-pro";

const PRIMARY_TIMEOUT_MS = Number(process.env.FAL_PRIMARY_TIMEOUT_MS) || 30_000;

interface ImageOutput {
  images?: { url?: string }[];
}

export class FalConfigError extends Error {}

function ensureConfigured() {
  const key = process.env.FAL_KEY;
  if (!key) throw new FalConfigError("FAL_KEY is not set on the server.");
  fal.config({ credentials: key });
}

/** Shapes the prompt coming from the UI/avatar so the picture shows the correct idea with exact text. */
export function buildPrompt(req: VisualRequest): string {
  const base = req.visualPrompt?.trim() || `Educational explainer of ${req.concept}`;
  return (
    `${base}\n\n` +
    `Draw the CORRECT idea clearly; do not present the misconception as correct. ` +
    `Hand-drawn whiteboard style on a plain white background, minimal and uncluttered, high contrast. ` +
    `Every label and formula must be spelled exactly and be legible.`
  );
}

async function render(model: string, prompt: string, timeout: number): Promise<string> {
  const result = await fal.subscribe(model, {
    input: { prompt, aspect_ratio: "16:9", num_images: 1, output_format: "jpeg" },
    timeout,
    logs: false,
  });
  const url = (result.data as ImageOutput).images?.[0]?.url;
  if (!url) throw new Error(`${model} returned no image`);
  return url;
}

export async function generateVisual(req: VisualRequest): Promise<VisualExplainer> {
  ensureConfigured();
  const prompt = buildPrompt(req);
  const url = await render(PRIMARY_MODEL, prompt, PRIMARY_TIMEOUT_MS);
  return { kind: "image", url, model: PRIMARY_MODEL, prompt };
}
