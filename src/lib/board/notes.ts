// Sam's notes on the whiteboard (T20): where a note goes, how big it is, and whether it may be written.
// Pure functions, no runtime imports, so node --test can load them.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NoteKind = "math" | "text";

export interface NoteInput {
  /** LaTeX for kind "math", plain words for kind "text". */
  content: string;
  kind: NoteKind;
  label?: string;
}

/** What happened to a note, so the avatar can react naturally. */
export type NoteOutcome = { status: "written"; where: string } | { status: "queued" } | { status: "hidden" };

/** Card metrics in screen px at the moment the note is written. The card, the placement and the PNG export share them. */
export const NOTE = { font: 20, charW: 12, line: 28, pad: 12, label: 20, radius: 12 } as const;
/** Clear space kept around every stroke and every other note, in screen px. */
export const NOTE_MARGIN = 24;
export const MAX_NOTE_CHARS = 200;
export const MIN_NOTE_GAP_MS = 8000;
export const MAX_NOTES_PER_SESSION = 6;

// ---- what may be written -----------------------------------------------------------------------

export type NoteRefusal = "empty" | "too_long" | "unsafe" | "duplicate" | "too_soon" | "limit";

// LaTeX commands that load, define or link things: never needed for a question.
const UNSAFE = /\\(href|url|includegraphics|input|include|def|newcommand|renewcommand|catcode|write|html[a-z]*)\b/i;

/** Cleans a note and applies the limits: 200 chars, one per 8 s, six per session, no repeat of the last one. */
export function admitNote(
  input: NoteInput,
  written: { content: string; at: number }[],
  now: number,
): { ok: true; note: NoteInput } | { ok: false; reason: NoteRefusal } {
  const content = input.content
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .trim();
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > MAX_NOTE_CHARS) return { ok: false, reason: "too_long" };
  if (UNSAFE.test(content)) return { ok: false, reason: "unsafe" };
  const last = written[written.length - 1];
  if (last && last.content === content) return { ok: false, reason: "duplicate" };
  if (written.length >= MAX_NOTES_PER_SESSION) return { ok: false, reason: "limit" };
  if (last && now - last.at < MIN_NOTE_GAP_MS) return { ok: false, reason: "too_soon" };
  const label = input.label?.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  return { ok: true, note: { content, kind: input.kind === "text" ? "text" : "math", ...(label ? { label } : {}) } };
}

// ---- how it reads and how big it is ------------------------------------------------------------

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", to: "→", rightarrow: "→", leftarrow: "←", infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β",
  gamma: "γ", delta: "δ", Delta: "Δ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω", degree: "°",
};

/** LaTeX as readable plain text ("\frac{1}{x}" -> "(1)/(x)"). Used on the card and in the examiner PNG. */
export function plainMath(latex: string): string {
  let t = latex;
  // Innermost first, a few passes for nesting.
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
      .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1")
      .replace(/([\^_])\{([^{}]*)\}/g, (_, op: string, body: string) => (body.length === 1 ? op + body : `${op}(${body})`));
  }
  return t
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wraps the text to at most ~45% of the viewport width and returns the card size, all in screen px. */
export function noteLayout(text: string, viewportW: number): { lines: string[]; w: number; h: number } {
  const maxW = Math.max(160, viewportW * 0.45);
  const maxChars = Math.max(8, Math.floor((maxW - 2 * NOTE.pad) / NOTE.charW));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    let rest = word;
    // A single token longer than a line (a long expression without spaces) is cut.
    while (rest.length > maxChars) {
      if (line) lines.push(line);
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
      line = "";
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= maxChars) line += ` ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  const longest = Math.max(6, ...lines.map((l) => l.length));
  return { lines, w: 2 * NOTE.pad + longest * NOTE.charW, h: 2 * NOTE.pad + NOTE.label + lines.length * NOTE.line };
}

// ---- where it goes -----------------------------------------------------------------------------

/**
 * Finds an empty spot for a note of `size` inside `viewport`, at least `margin` away from every ink
 * rectangle and every other note, scanning from the top-left. All rectangles are in the same (world)
 * coordinates. When nothing fits, the note goes just below everything on the board (`inView: false`),
 * and the caller scrolls to it.
 */
export function placeNote(ink: Rect[], notes: Rect[], viewport: Rect, size: { w: number; h: number }, margin: number): { x: number; y: number; inView: boolean } {
  const taken = [...ink, ...notes];
  const free = (x: number, y: number) =>
    !taken.some((o) => x < o.x + o.w + margin && x + size.w + margin > o.x && y < o.y + o.h + margin && y + size.h + margin > o.y);
  const step = Math.max(margin / 2, 1e-6);
  const x1 = viewport.x + viewport.w - margin - size.w;
  const y1 = viewport.y + viewport.h - margin - size.h;
  for (let y = viewport.y + margin; y <= y1; y += step) {
    for (let x = viewport.x + margin; x <= x1; x += step) {
      if (free(x, y)) return { x, y, inView: true };
    }
  }
  if (taken.length === 0) return { x: viewport.x + margin, y: viewport.y + margin, inView: false };
  const left = Math.min(...taken.map((o) => o.x));
  const bottom = Math.max(...taken.map((o) => o.y + o.h));
  return { x: left, y: bottom + margin, inView: false };
}

/** "top-left", "centre", "bottom-right"...: where a rectangle sits in the viewport, for the tool result. */
export function describeSpot(r: Rect, viewport: Rect): string {
  const third = (v: number, start: number, len: number) => Math.min(2, Math.max(0, Math.floor(((v - start) / len) * 3)));
  const col = third(r.x + r.w / 2, viewport.x, viewport.w);
  const row = third(r.y + r.h / 2, viewport.y, viewport.h);
  if (row === 1 && col === 1) return "centre";
  return [["top", "", "bottom"][row], ["left", "", "right"][col]].filter(Boolean).join("-");
}

/** The smallest pan (dx, dy) that brings `r` fully inside `viewport` with `margin` to spare. */
export function shiftIntoView(r: Rect, viewport: Rect, margin: number): { dx: number; dy: number } {
  const axis = (start: number, len: number, vStart: number, vLen: number) => {
    if (start < vStart + margin) return start - (vStart + margin);
    if (start + len > vStart + vLen - margin) return start + len - (vStart + vLen - margin);
    return 0;
  };
  return { dx: axis(r.x, r.w, viewport.x, viewport.w), dy: axis(r.y, r.h, viewport.y, viewport.h) };
}
