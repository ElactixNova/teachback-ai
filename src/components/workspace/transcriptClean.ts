// T24: display-only clean-up of Sam's transcript lines. The raw text stays in state (and goes to the examiner):
// this only decides what the chat shows. Student lines are never passed through it.
//
// Sam sometimes says, or the transcript carries, the behind-the-scenes machinery: [BRACKETED] markers from her
// prompt, and talk of the script, the mark scheme, the rail, the examiner, parking points or coming back later.
// We drop [...] spans and every sentence that mentions those; if nothing is left, the line is hidden.

/** Sentences mentioning any of these are machinery, not conversation. */
const LEAK =
  /\b(?:scripts?|scripted|mark[\s-]?schemes?|rails?|examiners?|park(?:ed|ing|s)?|(?:come|go|get|circle) back to (?:it|that|this)(?: later)?|later on|for the report|in the report|private notes?|instructions?|system prompt|tool calls?|waiting for (?:the )?(?:user|student|them) to finish)\b|\blater\b(?=[\s,.!?]*$)/i;

/** [ ... ] spans (prompt markers like [RAIL UPDATE ...], [BOARD], [happy]) and stray brackets. */
const BRACKETS = /\[[^\]]*\]?|\]/g;

/** Split into sentences, keeping the end punctuation; decimals like 0.5 stay whole. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/**
 * What the chat shows for one of Sam's lines: the line without [..] markers and without sentences about the
 * machinery. Returns "" when nothing conversational is left (the bubble is then hidden).
 */
export function cleanSamLine(text: string): string {
  const unbracketed = text.replace(BRACKETS, " ");
  const kept = sentences(unbracketed)
    .map((s) => s.trim())
    .filter((s) => s && /[a-z0-9]/i.test(s) && !LEAK.test(s));
  return kept.join(" ").replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
