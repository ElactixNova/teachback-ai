// T19: split text into prose and LaTeX spans. Pure, so it can be unit-tested (math.test.mjs).
//
// Contract (Ali, round 3): strings from the examiner, scheme and notes may contain inline LaTeX as $...$ and
// display LaTeX as $$...$$. Everything else is plain text. The rules keep ordinary prose safe:
//   - \$ is a literal dollar sign.
//   - Inline $...$ must not start with whitespace after the opening $ or end with whitespace before the
//     closing $, and the closing $ must not be followed by a digit (so "$5 and $10" stays prose).
//   - A $ inside {...} does not close the span (nested braces are tracked).
//   - An unmatched $ or $$ is kept as literal text.

export type MathSegment = { kind: "text"; value: string } | { kind: "inline" | "display"; value: string };

/** Index of the closing delimiter for a span whose body starts at `from`, or -1. Skips \-escapes and {...}. */
function findClose(s: string, from: number, delim: "$" | "$$"): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++; // skip the escaped character (\$, \{, \\ ...)
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === "$" && depth === 0) {
      if (delim === "$$") {
        if (s[i + 1] === "$") return i;
      } else {
        if (s[i + 1] === "$") return -1; // "$a$$" is ambiguous: treat as not a valid inline span
        return i;
      }
    }
  }
  return -1;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

export function parseMath(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", value: text });
    text = "";
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "\\" && input[i + 1] === "$") {
      text += "$";
      i += 2;
      continue;
    }
    if (c !== "$") {
      text += c;
      i++;
      continue;
    }
    // $$display$$
    if (input[i + 1] === "$") {
      const end = findClose(input, i + 2, "$$");
      const body = end >= 0 ? input.slice(i + 2, end).trim() : "";
      if (end >= 0 && body) {
        flush();
        out.push({ kind: "display", value: body });
        i = end + 2;
      } else {
        text += "$$";
        i += 2;
      }
      continue;
    }
    // $inline$
    const end = isSpace(input[i + 1]) ? -1 : findClose(input, i + 1, "$");
    const body = end >= 0 ? input.slice(i + 1, end) : "";
    if (end >= 0 && body && !isSpace(input[end - 1]) && !isDigit(input[end + 1])) {
      flush();
      out.push({ kind: "inline", value: body });
      i = end + 1;
    } else {
      text += "$";
      i++;
    }
  }
  flush();
  return out;
}

/** True when the text has at least one maths span (cheap check before loading KaTeX output). */
export const hasMath = (input: string) => parseMath(input).some((s) => s.kind !== "text");

/**
 * Cheap heuristic: does a spoken/plain transcript line look like maths worth converting with /api/to-latex?
 * Needs a maths word or symbol AND a number or a single-letter variable, so ordinary sentences are skipped.
 */
export function looksMathy(input: string): boolean {
  if (hasMath(input)) return false; // already LaTeX
  const t = ` ${input.toLowerCase()} `;
  const word = /\b(squared|cubed|over|plus|minus|times|equals|equal to|root|square root|power|to the|negative|divided by|integral|derivative|sine|cosine|pi|fraction|log)\b/.test(t);
  const symbol = /[=^+*/√×÷±]|\d\s*-\s*\d/.test(input);
  const operand = /\d/.test(input) || /(^|[\s(])[a-z]([\s)^²³,.?!]|$)/i.test(input.replace(/\b[aI]\b/g, ""));
  return (word || symbol) && operand;
}

/** The text with $ delimiters removed, for alt text, aria-labels and titles (no KaTeX there). */
export const plainMath = (input: string) =>
  parseMath(input)
    .map((s) => s.value)
    .join("");
