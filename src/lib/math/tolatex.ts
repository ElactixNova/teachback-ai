// Spoken / plain maths -> the same text with the maths wrapped in $...$ LaTeX (display only). Server-only.
// The transcript keeps the raw spoken text as the source of truth (evidence quotes must stay verbatim);
// this is what the UI shows instead when a line is mathematical.
import { z } from "zod";
import { LIVE_MODEL, generateJson } from "@/lib/curriculum/llm";

export const MAX_TEXTS = 20;
export const MAX_TEXT_CHARS = 600;

const Schema = z.object({ items: z.array(z.object({ index: z.number(), text: z.string() })) });

const PROMPT = `You convert spoken or plainly typed maths into LaTeX for display, keeping all the other words unchanged.
You get a JSON array of short texts (a transcript of speech or typed notes). For each one return the SAME text with every mathematical expression, formula, equation, number-with-unit and chemical formula wrapped in single dollar signs and written in LaTeX.
Rules:
- Spoken forms become real maths: "one over x" -> $\\frac{1}{x}$, "x squared" -> $x^2$, "x to the power n" -> $x^n$, "the square root of b squared minus four a c" -> $\\sqrt{b^2 - 4ac}$, "minus b plus or minus ..." -> $-b \\pm ...$, "x equals two" -> $x = 2$, "C O two" or "CO2" -> $\\mathrm{CO_2}$.
- Keep plus, minus, equals and every sign. Never drop or invent a term: convert exactly what was said. If the speech was ambiguous, pick the most likely reading but do not add anything.
- Words that are not maths stay as words, outside the dollar signs. Do not add or remove sentences. Do not explain.
- Text with no maths is returned unchanged, with no dollar signs.
- Never use a dollar sign for anything except wrapping maths. Use standard LaTeX only (no environments, no macros you define).
Return JSON only: {"items":[{"index":0,"text":"..."}]} with one item per input, same order.`;

/** Dollar signs must pair up; otherwise the conversion cannot be trusted and the original text is shown. */
export function isBalanced(text: string): boolean {
  return (text.replace(/\\\$/g, "").match(/\$/g)?.length ?? 0) % 2 === 0;
}

/** The converted text must still say the same words: only maths markup may change. A cheap sanity check. */
/** Words that legitimately disappear when speech becomes LaTeX (number words, operators, common formulas). */
const MATH_WORDS = new Set(
  ("zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand half third quarter " +
    "squared cubed square cube over plus minus equals equal power root roots divided times brackets bracket negative positive point " +
    "fraction numerator denominator comma open close sine cosine tangent pi theta alpha beta delta sigma " +
    "carbon dioxide oxygen water glucose hydrogen nitrogen").split(" "),
);
const LATEX_WORDS = new Set(["frac", "sqrt", "mathrm", "times", "cdot", "left", "right", "text", "theta", "alpha", "beta", "delta", "sigma"]);
const words = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];

/** The converted text must still say the same prose words: only maths markup and number words may change. */
export function keepsWords(original: string, converted: string): boolean {
  const kept = new Set(words(converted).filter((w) => !LATEX_WORDS.has(w)));
  return words(original).filter((w) => !MATH_WORDS.has(w)).every((w) => kept.has(w));
}

export async function toLatexBatch(texts: string[]): Promise<string[]> {
  const out = await generateJson({
    model: LIVE_MODEL,
    system: PROMPT,
    userText: JSON.stringify(texts),
    schema: Schema,
    maxTokens: 4000,
  });
  const byIndex = new Map(out.items.map((i) => [i.index, i.text]));
  return texts.map((original, i) => {
    const converted = byIndex.get(i)?.trim();
    if (!converted || !isBalanced(converted) || !keepsWords(original, converted)) return original;
    return converted;
  });
}
