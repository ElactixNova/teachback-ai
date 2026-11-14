// fal.ai visual explainer pipeline (T4). Server-only: reads FAL_KEY, never imported by client code.
// Models and latencies measured live on Sat 14 Nov 2026 (see docs/research/fal.md in the team workspace).
import { fal } from "@fal-ai/client";
import type { VisualExplainer, VisualRequest } from "@/types/session";

/** Best accuracy on diagrams with exact formulas and labels (~17s, $0.15). */
export const PRIMARY_MODEL = "fal-ai/nano-banana-pro";
/** Faster and cheaper, usually right but can garble formulas (~8s, $0.04). Used only if the primary fails or is slow. */
export const BACKUP_MODEL = "fal-ai/nano-banana";

const PRIMARY_TIMEOUT_MS = Number(process.env.FAL_PRIMARY_TIMEOUT_MS) || 30_000;
const BACKUP_TIMEOUT_MS = 25_000;

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
    input: { prompt, aspect_ratio: "16:9", num_images: 1 },
    timeout,
    logs: false,
  });
  const url = (result.data as ImageOutput).images?.[0]?.url;
  if (!url) throw new Error(`${model} returned no image`);
  return url;
}

/** Accurate diagram first; if it errors or runs slow, the faster model. `fallback` marks the backup. */
export async function generateVisual(req: VisualRequest): Promise<VisualExplainer> {
  ensureConfigured();
  const prompt = buildPrompt(req);
  try {
    const url = await render(PRIMARY_MODEL, prompt, PRIMARY_TIMEOUT_MS);
    return { kind: "image", url, model: PRIMARY_MODEL, prompt };
  } catch (err) {
    console.warn("primary visual model failed, using backup", err instanceof Error ? err.message : err);
    const url = await render(BACKUP_MODEL, prompt, BACKUP_TIMEOUT_MS);
    return { kind: "image", url, model: BACKUP_MODEL, prompt, fallback: true };
  }
}
