/**
 * Longest lecture-notes text we send to the model: about 100k tokens, roughly a 150-page text PDF.
 * Longer notes are rejected with a clear message instead of being cut, so a check never runs on partial notes.
 */
export const MAX_CURRICULUM_CHARS = 400_000;

export const tooLongMessage = (chars: number) =>
  `These notes are too long (${chars.toLocaleString("en-GB")} characters, the limit is ${MAX_CURRICULUM_CHARS.toLocaleString("en-GB")}). Upload only the lecture or chapter you want to explain.`;

/** /api/analyze rejects transcripts beyond these (the client trims to fit first, see fitTranscript). */
export const MAX_TRANSCRIPT_LINES = 600;
export const MAX_TRANSCRIPT_CHARS = 80_000;
/** One line longer than this is cut (a stuck speech-recognition partial must not crowd out the rest). */
const MAX_LINE_CHARS = 2_000;
/** Sam's lines this close to the end are kept as context even when older lines are dropped. */
const RECENT_KEEP = 40;

type Line = { speaker: "student" | "avatar"; text: string; t: string };

/**
 * Fit a transcript under the /api/analyze limits so a long session can still be marked (a 601st line used to
 * fail the whole final report). Only student lines earn marks, so Sam's older lines go first, then the oldest
 * student lines. Order is preserved; a transcript already within the limits is returned unchanged.
 */
export function fitTranscript<T extends Line>(lines: T[], maxLines = MAX_TRANSCRIPT_LINES, maxChars = MAX_TRANSCRIPT_CHARS): T[] {
  const cut = lines.map((l) => (l.text.length > MAX_LINE_CHARS ? { ...l, text: l.text.slice(0, MAX_LINE_CHARS) } : l));
  const size = (ls: T[]) => ls.reduce((n, l) => n + l.text.length, 0);
  if (cut.length <= maxLines && size(cut) <= maxChars) return cut;
  const keep = cut.map(() => true);
  let count = cut.length;
  let chars = size(cut);
  const fits = () => count <= maxLines && chars <= maxChars;
  const drop = (i: number) => {
    keep[i] = false;
    count -= 1;
    chars -= cut[i].text.length;
  };
  for (let i = 0; i < cut.length - RECENT_KEEP && !fits(); i++) if (cut[i].speaker === "avatar") drop(i);
  for (let i = 0; i < cut.length && !fits(); i++) if (keep[i]) drop(i);
  return cut.filter((_, i) => keep[i]);
}
