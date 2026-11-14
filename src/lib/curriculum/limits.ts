/**
 * Longest lecture-notes text we send to the model: about 100k tokens, roughly a 150-page text PDF.
 * Longer notes are rejected with a clear message instead of being cut, so a check never runs on partial notes.
 */
export const MAX_CURRICULUM_CHARS = 400_000;

export const tooLongMessage = (chars: number) =>
  `These notes are too long (${chars.toLocaleString("en-GB")} characters, the limit is ${MAX_CURRICULUM_CHARS.toLocaleString("en-GB")}). Upload only the lecture or chapter you want to explain.`;
