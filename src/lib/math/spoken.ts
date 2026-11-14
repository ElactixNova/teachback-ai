// T29: instant, synchronous spoken maths -> LaTeX for display (no network, safe in the browser).
// Returns the same text with each maths phrase wrapped in $...$, or null when there is nothing it can convert
// with confidence; callers then show the raw text and may fall back to POST /api/to-latex (the LLM).
//
// It handles the common spoken forms Sam and students use: numbers (words or digits, "two point five",
// "twenty five"), single-letter variables ("five x", "four a c"), squared / cubed / to the power (of) n,
// plus, minus, negative, times, multiplied by, divided by, over (simple fractions), equals, plus or minus.
// Anything it is not sure about (square roots, "all squared" groups, brackets, chemistry) is left as words,
// and the whole line returns null if nothing converted, so the LLM fallback can do it properly.

type Tok =
  | { k: "num"; v: string }
  | { k: "var"; v: string }
  | { k: "op"; v: "+" | "-" | "\\times" | "\\div" | "=" | "\\pm" | "over" }
  | { k: "pow"; v: string };

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** Letters that are always variables when spoken alone. "a" and "i" are English words, so they need context. */
const VARS = new Set("bcdefghjklmnpqrstuvwxyz".split(""));

const isNumWord = (w: string) => w in UNITS || w in TENS || w === "hundred";

interface Word {
  core: string; // lower-case word without surrounding punctuation
  raw: string; // original word
  lead: string; // punctuation before it
  trail: string; // punctuation after it
}

function splitWord(raw: string): Word {
  const m = raw.match(/^([("'“‘]*)(.*?)([)"'”’,.;:!?]*)$/)!;
  return { lead: m[1], core: m[2].toLowerCase(), raw: m[2], trail: m[3] };
}

/**
 * Read one maths token starting at word i. Returns the tokens and how many words were used, or null when
 * the word is not maths. `prevMath` says whether the word before was maths (for the "a" article rule).
 */
function readToken(ws: Word[], i: number, prevMath: boolean): { toks: Tok[]; used: number } | null {
  const w = ws[i].core;
  const next = ws[i + 1]?.core;
  const next2 = ws[i + 2]?.core;
  // A word followed by punctuation that ends a clause (comma, full stop) cannot continue a phrase past it.
  const stops = (j: number) => /[,.;:!?]/.test(ws[j]?.trail ?? "");

  // Numbers: digits, decimals, "twenty five", "two point five", "one hundred".
  if (/^\d+(\.\d+)?$/.test(w)) return { toks: [{ k: "num", v: w }], used: 1 };
  if (isNumWord(w)) {
    let n = 0;
    let used = 0;
    let j = i;
    if (ws[j].core in TENS) {
      n = TENS[ws[j].core];
      used++;
      if (!stops(j) && ws[j + 1]?.core in UNITS && UNITS[ws[j + 1].core] > 0 && UNITS[ws[j + 1].core] < 10) {
        n += UNITS[ws[j + 1].core];
        used++;
      }
    } else if (ws[j].core in UNITS) {
      n = UNITS[ws[j].core];
      used++;
    } else return null; // a bare "hundred"
    j = i + used;
    if (!stops(j - 1) && ws[j]?.core === "hundred") {
      n *= 100;
      used++;
      j++;
    }
    let v = String(n);
    if (!stops(j - 1) && ws[j]?.core === "point" && ws[j + 1]?.core in UNITS && UNITS[ws[j + 1].core] < 10) {
      v += ".";
      let k = j + 1;
      while (ws[k]?.core in UNITS && UNITS[ws[k].core] < 10) {
        v += UNITS[ws[k].core];
        if (stops(k)) {
          k++;
          break;
        }
        k++;
      }
      used = k - i;
    }
    return { toks: [{ k: "num", v }], used };
  }

  // Typed shorthand: "5x", "x^2", "x²", "2x^2".
  const typed = w.match(/^(\d+)?([a-z])(?:\^(\d+)|([²³]))?$/);
  if (typed && (typed[1] || typed[3] || typed[4])) {
    const toks: Tok[] = [];
    if (typed[1]) toks.push({ k: "num", v: typed[1] });
    toks.push({ k: "var", v: typed[2] });
    if (typed[3]) toks.push({ k: "pow", v: typed[3] });
    if (typed[4]) toks.push({ k: "pow", v: typed[4] === "²" ? "2" : "3" });
    return { toks, used: 1 };
  }

  // Operators, multi-word first.
  if (w === "plus" && next === "or" && next2 === "minus" && !stops(i) && !stops(i + 1)) return { toks: [{ k: "op", v: "\\pm" }], used: 3 };
  if ((w === "multiplied" || w === "divided") && next === "by" && !stops(i))
    return { toks: [{ k: "op", v: w === "multiplied" ? "\\times" : "\\div" }], used: 2 };
  if (w === "equal" && next === "to" && !stops(i)) return { toks: [{ k: "op", v: "=" }], used: 2 };
  if (w === "to" && next === "the" && ws[i + 2]?.core === "power" && !stops(i) && !stops(i + 1)) {
    const at = !stops(i + 2) && ws[i + 3]?.core === "of" ? i + 4 : i + 3;
    if (stops(at - 1)) return null;
    const exp = ws[at] ? readToken(ws, at, true) : null;
    const t = exp?.toks[0];
    if (!exp || exp.toks.length !== 1 || !t || (t.k !== "num" && t.k !== "var")) return null;
    return { toks: [{ k: "pow", v: t.v }], used: at - i + exp.used };
  }
  const OPS: Record<string, Tok> = {
    plus: { k: "op", v: "+" },
    "+": { k: "op", v: "+" },
    minus: { k: "op", v: "-" },
    negative: { k: "op", v: "-" },
    "-": { k: "op", v: "-" },
    times: { k: "op", v: "\\times" },
    "×": { k: "op", v: "\\times" },
    over: { k: "op", v: "over" },
    equals: { k: "op", v: "=" },
    "=": { k: "op", v: "=" },
  };
  if (w in OPS) return { toks: [OPS[w]], used: 1 };
  if (w === "squared") return { toks: [{ k: "pow", v: "2" }], used: 1 };
  if (w === "cubed") return { toks: [{ k: "pow", v: "3" }], used: 1 };

  // Single-letter variables. "a" is an article unless maths is on both sides of it (or it ends the phrase).
  if (VARS.has(w)) return { toks: [{ k: "var", v: w }], used: 1 };
  if (w === "a" && prevMath) {
    const after = ws[i + 1];
    const nextIsMath = after && !stops(i) && readToken(ws, i + 1, true) !== null;
    if (nextIsMath || !after || stops(i)) return { toks: [{ k: "var", v: w }], used: 1 };
  }
  return null;
}

const isOperand = (t: Tok) => t.k === "num" || t.k === "var";

/** Render one span of tokens as LaTeX, or null when it is not a confident maths phrase. */
function render(toks: Tok[]): string | null {
  // Group into terms (juxtaposed factors with powers) and operators.
  type Term = string;
  const items: (Term | Tok)[] = [];
  let term = "";
  let last: Tok | null = null;
  for (const t of toks) {
    if (t.k === "pow") {
      if (!last || !isOperand(last)) return null; // "squared" with nothing to square
      term += t.v.length > 1 ? `^{${t.v}}` : `^${t.v}`;
    } else if (isOperand(t)) {
      if (last && last.k === "num" && t.k === "num") return null; // "two three": not a phrase we understand
      if (last && last.k === "pow" && t.k === "num") return null; // "x squared two"
      if (last && last.k === "var" && t.k === "num") return null; // "x two"
      term += t.v;
    } else {
      if (term) items.push(term);
      term = "";
      items.push(t);
    }
    last = t;
  }
  if (term) items.push(term);

  // Fractions: "A over B" between two terms.
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (typeof it !== "string" && it.v === "over") {
      const top = parts.pop();
      const bottom = items[i + 1];
      if (typeof top !== "string" || top.startsWith(" ") || typeof bottom !== "string") return null;
      parts.push(`\\frac{${top}}{${bottom}}`);
      i++;
    } else if (typeof it === "string") {
      parts.push(it);
    } else {
      // A sign at the start or straight after another operator is unary ("equals minus two"): it hugs its number.
      const prev = items[i - 1];
      const unary = (it.v === "-" || it.v === "\\pm") && (i === 0 || (prev !== undefined && typeof prev !== "string"));
      parts.push(unary ? ` ${it.v}` : ` ${it.v} `);
    }
  }
  return parts.join("").replace(/\s{2,}/g, " ").trim();
}

/** Spans must say something mathematical: an operator or a power, and an operand. */
function worthy(toks: Tok[]): boolean {
  return toks.some((t) => t.k === "op" || t.k === "pow") && toks.some(isOperand);
}

export function spokenToLatex(text: string): string | null {
  if (!text || text.includes("$")) return null; // already LaTeX (or a real dollar sign): leave it alone
  const pieces = text.split(/(\s+)/); // words at even indexes, whitespace at odd
  const ws = pieces.filter((_, i) => i % 2 === 0).map(splitWord);
  const out: string[] = [];
  let changed = false;
  let i = 0;
  const sep = (idx: number) => pieces[idx * 2 + 1] ?? "";

  while (i < ws.length) {
    // Collect the longest run of maths tokens starting here.
    const toks: Tok[] = [];
    let j = i;
    let spanEnd = i; // exclusive, in words
    while (j < ws.length) {
      if (j > i && (ws[j].lead || /[,.;:!?]/.test(ws[j - 1].trail) || /[()"]/.test(ws[j - 1].trail))) break;
      const r = readToken(ws, j, j > i);
      if (!r) break;
      toks.push(...r.toks);
      j += r.used;
      spanEnd = j;
    }
    // Trailing operators are words again ("x plus", "equals"), and so is a leading one other than a sign.
    let end = spanEnd;
    while (toks.length && toks[toks.length - 1].k === "op") {
      toks.pop();
      end = trimLastWord(ws, i, end);
    }
    const start = i;
    if (toks.length && toks[0].k === "op" && toks[0].v !== "-" && toks[0].v !== "\\pm") {
      // A phrase cannot start with "plus" or "times": keep this word as text and look again from the next one.
      out.push(ws[i].lead + ws[i].raw + ws[i].trail + sep(i));
      i++;
      continue;
    }
    const latex = toks.length && end > start && worthy(toks) ? render(toks) : null;
    if (latex) {
      const first = ws[start];
      const lastW = ws[end - 1];
      out.push(`${first.lead}$${latex}$${lastW.trail}${sep(end - 1)}`);
      changed = true;
      i = end;
    } else {
      out.push(ws[start].lead + ws[start].raw + ws[start].trail + sep(start));
      i = start + 1;
    }
  }
  return changed ? out.join("") : null;
}

/** Drop the last word of a span whose final token was an operator (multi-word operators count as one). */
function trimLastWord(ws: Word[], start: number, end: number): number {
  const last = ws[end - 1]?.core;
  const before = ws[end - 2]?.core;
  if (last === "minus" && before === "or" && ws[end - 3]?.core === "plus") return Math.max(start, end - 3);
  if ((last === "by" && (before === "multiplied" || before === "divided")) || (last === "to" && before === "equal")) return Math.max(start, end - 2);
  return Math.max(start, end - 1);
}
