// fal.ai visual explainer pipeline (T4). Server-only: reads FAL_KEY, never imported by client code.
// Models verified against fal's model pages on Sat 14 Nov 2026 (see docs/research/fal.md in the team workspace).
import { fal } from "@fal-ai/client";
import type { VisualExplainer, VisualRequest } from "@/types/session";

export const VIDEO_MODEL = "fal-ai/ltx-2.3/text-to-video/fast";
export const IMAGE_MODEL = "fal-ai/flux/schnell";

/** Video gets this long before we serve the (already generating) image instead. */
export const VIDEO_BUDGET_MS = Number(process.env.FAL_VIDEO_BUDGET_MS) || 10_000;
/** Hard cap for the image call so the route never hangs. */
const IMAGE_TIMEOUT_MS = 30_000;

interface VideoOutput {
  video?: { url?: string };
}
interface ImageOutput {
  images?: { url?: string }[];
}

export class FalConfigError extends Error {}

function ensureConfigured() {
  const key = process.env.FAL_KEY;
  if (!key) throw new FalConfigError("FAL_KEY is not set on the server.");
  fal.config({ credentials: key });
}

/** Shapes the prompt coming from the UI/avatar into something the models handle well. */
export function buildPrompt(req: VisualRequest, kind: "video" | "image"): string {
  const base = req.visualPrompt?.trim() || `Educational explainer of ${req.concept}`;
  if (kind === "video") {
    return (
      `${base} Slow, steady animated whiteboard-style explainer, clean flat vector diagram, ` +
      `labelled arrows, white background, no people, no text overlays other than short labels.`
    );
  }
  return `${base} Single clear diagram, flat vector, white background, labelled, high contrast, no clutter.`;
}

async function generateVideo(prompt: string, signal: AbortSignal): Promise<VisualExplainer> {
  const result = await fal.subscribe(VIDEO_MODEL, {
    input: { prompt, duration: 6, resolution: "1080p", aspect_ratio: "16:9", generate_audio: false },
    abortSignal: signal,
    logs: false,
  });
  const url = (result.data as VideoOutput).video?.url;
  if (!url) throw new Error("fal returned no video");
  return { kind: "video", url, model: VIDEO_MODEL, prompt };
}

async function generateImage(prompt: string): Promise<VisualExplainer> {
  const result = await fal.subscribe(IMAGE_MODEL, {
    input: { prompt, image_size: "landscape_16_9", num_inference_steps: 4 },
    timeout: IMAGE_TIMEOUT_MS,
    logs: false,
  });
  const url = (result.data as ImageOutput).images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  return { kind: "image", url, model: IMAGE_MODEL, prompt, fallback: true };
}

/**
 * Starts the video and the fast image in parallel. If the video finishes within the budget we return it;
 * otherwise (slow queue or failure) we return the image, which is usually already done.
 */
export async function generateVisual(req: VisualRequest): Promise<VisualExplainer> {
  ensureConfigured();
  const videoPrompt = buildPrompt(req, "video");
  const imagePrompt = buildPrompt(req, "image");

  const abort = new AbortController();
  const video = generateVideo(videoPrompt, abort.signal);
  const image = generateImage(imagePrompt);
  // Avoid unhandled rejections for whichever promise loses the race.
  video.catch(() => {});
  image.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), VIDEO_BUDGET_MS);
  });

  try {
    const winner = await Promise.race([video.then((v) => v, () => "failed" as const), budget]);
    if (typeof winner !== "string") return winner;
    abort.abort(); // stop waiting on the slow video; the image is the fallback
    return await image;
  } finally {
    clearTimeout(timer);
  }
}
