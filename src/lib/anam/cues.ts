// Director Notes cues (T2). Anam tags: https://anam.ai/docs/personas/director-notes.md
// The persona writes inline tags like "[curious] Wait, why..." and the engine reports them as
// MessageStreamEvent.cueTag / DIRECTOR_NOTE_CUE_APPLIED. We map Anam's tag set onto the four
// UI cues in src/types/session.ts.
import type { Cue } from "@/types/session";

const CUE_MAP: Record<string, Cue> = {
  happy: "happy",
  warm: "happy",
  playful: "happy",
  laughter: "happy",
  supportive: "happy",
  curious: "curious",
  concerned: "concerned",
  sad: "concerned",
  distressed: "concerned",
  angry: "concerned",
  surprised: "surprised",
};

/** Map any Anam cue tag (with or without brackets) to a UI cue, or null if unknown. */
export function toUiCue(tag: string | undefined | null): Cue | null {
  if (!tag) return null;
  return CUE_MAP[tag.replace(/[[\]]/g, "").trim().toLowerCase()] ?? null;
}

const TAG_RE = /\[(happy|warm|playful|laughter|supportive|curious|concerned|sad|distressed|angry|surprised)\]/gi;

/**
 * Pull inline cue tags out of persona text. Anam normally strips recognised tags from
 * client-visible text, so this is a fallback that also keeps tags out of the transcript.
 */
export function extractCues(text: string): { clean: string; cues: Cue[] } {
  const cues: Cue[] = [];
  const clean = text
    .replace(TAG_RE, (_m, tag: string) => {
      const c = toUiCue(tag);
      if (c) cues.push(c);
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { clean, cues };
}

/**
 * Removes every square-bracketed segment from a line Sam said, so no leaked instruction or stage
 * direction reaches the chat or the examiner's transcript. Handles nesting; an opening bracket that
 * never closes takes the rest of the line with it; a stray closing bracket is dropped. A line that
 * was only brackets comes back empty (the caller drops it).
 */
export function stripBrackets(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:]+/, "")
    .trim();
}
