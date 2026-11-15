// A small ring buffer of what actually went to and came from the avatar, so a glitch ("Sam spewed gibberish
// for a few seconds") can be matched to the exact stream and the private notes around it. Browser only,
// appended to the downloaded transcript. The chat shows a cleaned line; this keeps the raw one.
const MAX = 400;
const entries: string[] = [];
let startedAt = Date.now();

const stamp = () => {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export function diagReset() {
  entries.length = 0;
  startedAt = Date.now();
}

/** kind: sam = a streamed chunk of her speech, you = the student's, note = private context sent, tool = a tool call. */
export function diag(kind: "sam" | "you" | "note" | "tool" | "event", text: string) {
  entries.push(`${stamp()} ${kind}: ${JSON.stringify(text.slice(0, 600))}`);
  if (entries.length > MAX) entries.shift();
}

export const diagLines = (): string[] => [...entries];
