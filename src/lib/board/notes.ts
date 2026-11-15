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
export type NoteOutcome =
  | { status: "written"; where: string }
  /** The same question is already on the board; the board now shows it. */
  | { status: "already"; where: string }
  | { status: "queued" }
  | { status: "hidden" }
  | { status: "refused"; reason: NoteRefusal };

/** Clear space kept around every stroke and every other note, in screen px. */
export const NOTE_MARGIN = 24;
export const MAX_NOTE_CHARS = 200;
/** A safety limit only: a session never needs this many questions. */
export const MAX_NOTES_PER_SESSION = 30;

// ---- what may be written -----------------------------------------------------------------------

export type NoteRefusal = "empty" | "too_long" | "unsafe" | "limit";

// LaTeX commands that load, define or link things: never needed for a question.
const UNSAFE = /\\(href|url|includegraphics|input|include|def|newcommand|renewcommand|catcode|write|html[a-z]*)\b/i;

/**
 * Cleans a note and applies the hard limits: 200 chars, nothing unsafe, a session cap. Repeats are
 * caught by the board (same maths already there) and pace by the caller (it queues), so neither is refused here.
 */
export function admitNote(input: NoteInput, writtenSoFar: number): { ok: true; note: NoteInput } | { ok: false; reason: NoteRefusal } {
  const content = input.content
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .trim();
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > MAX_NOTE_CHARS) return { ok: false, reason: "too_long" };
  if (UNSAFE.test(content)) return { ok: false, reason: "unsafe" };
  if (writtenSoFar >= MAX_NOTES_PER_SESSION) return { ok: false, reason: "limit" };
  const label = input.label?.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  return { ok: true, note: { content, kind: input.kind === "text" ? "text" : "math", ...(label ? { label } : {}) } };
}

// ---- how it reads ------------------------------------------------------------------------------

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", to: "→", rightarrow: "→", leftarrow: "←", infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β",
  gamma: "γ", delta: "δ", Delta: "Δ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω", degree: "°",
};

/** LaTeX as readable plain text ("\frac{1}{x}" -> "(1)/(x)"): the accessible label of what Sam wrote. */
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

/** Pan (x, y in screen px) and zoom of the board: screen = world * scale + offset. */
export interface BoardView {
  x: number;
  y: number;
  scale: number;
}

/**
 * The view that shows the whole of `rect` (world coordinates): the current view if it already does,
 * otherwise the smallest pan, zooming out only when the rectangle is larger than the visible board.
 * `screen` is the board size in px with the strips its controls cover at the top and bottom.
 */
export function viewToShow(rect: Rect, view: BoardView, screen: { w: number; h: number; top: number; bottom: number }, margin: number, minScale: number): BoardView {
  const availW = Math.max(1, screen.w - 2 * margin);
  const availH = Math.max(1, screen.h - screen.top - screen.bottom - 2 * margin);
  const scale = Math.max(minScale, Math.min(view.scale, availW / rect.w, availH / rect.h));
  // Zooming out keeps the centre of the visible board where it is.
  const cx = screen.w / 2;
  const cy = (screen.top + screen.h - screen.bottom) / 2;
  const k = scale / view.scale;
  let x = cx - (cx - view.x) * k;
  let y = cy - (cy - view.y) * k;
  const fit = (offset: number, start: number, len: number, lo: number, hi: number) => {
    const a = start * scale + offset;
    if (a < lo) return offset + (lo - a);
    const b = a + len * scale;
    return b > hi ? offset - (b - hi) : offset;
  };
  x = fit(x, rect.x, rect.w, margin, screen.w - margin);
  y = fit(y, rect.y, rect.h, screen.top + margin, screen.h - screen.bottom - margin);
  return { x, y, scale };
}

// ---- handwriting (T22) -------------------------------------------------------------------------
// Sam writes the question by hand, in step with its voice. The layout below turns the question
// (plain words with LaTeX-style maths) into pen ops in writing order; `revealScript` says how much
// of them to draw at a given progress; `writeProgress` turns speech and time into that progress.
// A handwriting font drawn through these ops was chosen over a single-stroke vector font: the same
// ops draw on screen and into the examiner PNG, and no glyph table has to be hand-made and verified.

/** Width of `text` at font size `size`, in px. Injected (canvas measureText in the browser) so the layout stays pure. */
export type Measure = (text: string, size: number) => number;

export type PenOp =
  /** A run of letters; (x, y) is the left end of its baseline; w is its width. */
  | { kind: "text"; text: string; x: number; y: number; size: number; w: number }
  /** A straight pen stroke (fraction bar, root sign); w is its length. */
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; w: number };

export interface Script {
  ops: PenOp[];
  w: number;
  h: number;
}

/** Sam's writing size in px at the zoom it was written at, and the room kept around it. */
export const HAND = { size: 28, pad: 8, tag: 16 } as const;

type Node =
  | { t: "text"; s: string }
  | { t: "row"; body: Node[] }
  | { t: "sup" | "sub" | "sqrt"; body: Node[] }
  | { t: "frac"; num: Node[]; den: Node[] };

function parseScript(src: string): Node[] {
  let i = 0;
  const seq = (end?: string): Node[] => {
    const out: Node[] = [];
    while (i < src.length && src[i] !== end) out.push(atom());
    return out;
  };
  /** The argument of a command or of ^ / _: a {group} or the next single token. */
  const arg = (): Node[] => {
    while (src[i] === " ") i++;
    if (src[i] !== "{") return i < src.length ? [atom(true)] : [];
    i++;
    const body = seq("}");
    i++;
    return body;
  };
  const atom = (single = false): Node => {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.?)/.exec(src.slice(i))!;
      i += m[0].length;
      const name = m[1];
      if (/^[dt]?frac$/.test(name)) return { t: "frac", num: arg(), den: arg() };
      if (name === "sqrt") return { t: "sqrt", body: arg() };
      if (/^(text|mathrm|mathbf|operatorname)$/.test(name)) return { t: "row", body: arg() };
      if (name === "left" || name === "right") return { t: "text", s: "" };
      if (name.length === 1 && !/[A-Za-z]/.test(name)) return { t: "text", s: ",;:! ".includes(name) ? " " : name };
      return { t: "text", s: SYMBOLS[name] ?? name };
    }
    if (c === "^" || c === "_") {
      i++;
      return { t: c === "^" ? "sup" : "sub", body: arg() };
    }
    if (c === "{") {
      i++;
      const body = seq("}");
      i++;
      return { t: "row", body };
    }
    if (c === "}" || c === "$") {
      i++;
      return { t: "text", s: "" };
    }
    const m = single ? [c] : /^[^\\^_{}$]+/.exec(src.slice(i))!;
    i += m[0].length;
    return { t: "text", s: m[0] };
  };
  return seq();
}

interface Box {
  w: number;
  asc: number;
  desc: number;
  ops: PenOp[];
}

const shift = (ops: PenOp[], dx: number, dy: number): PenOp[] =>
  ops.map((o) => (o.kind === "text" ? { ...o, x: o.x + dx, y: o.y + dy } : { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }));
const stroke = (x1: number, y1: number, x2: number, y2: number): PenOp => ({ kind: "line", x1, y1, x2, y2, w: Math.hypot(x2 - x1, y2 - y1) });

/** Lays nodes out left to right on one baseline (y = 0, up is negative). */
function layoutRow(nodes: Node[], size: number, measure: Measure): Box {
  const box: Box = { w: 0, asc: size * 0.72, desc: size * 0.22, ops: [] };
  const add = (b: Box, dy = 0) => {
    box.ops.push(...shift(b.ops, box.w, dy));
    box.asc = Math.max(box.asc, b.asc - dy);
    box.desc = Math.max(box.desc, b.desc + dy);
    box.w += b.w;
  };
  for (const n of nodes) {
    if (n.t === "text") {
      if (!n.s) continue;
      const w = measure(n.s, size);
      add({ w, asc: size * 0.72, desc: size * 0.22, ops: n.s.trim() ? [{ kind: "text", text: n.s, x: 0, y: 0, size, w }] : [] });
    } else if (n.t === "row") add(layoutRow(n.body, size, measure));
    else if (n.t === "sup") add(layoutRow(n.body, size * 0.68, measure), -size * 0.42);
    else if (n.t === "sub") add(layoutRow(n.body, size * 0.68, measure), size * 0.2);
    else if (n.t === "frac") {
      // Numerator, then the bar, then the denominator: the order a hand writes them.
      const num = layoutRow(n.num, size * 0.8, measure);
      const den = layoutRow(n.den, size * 0.8, measure);
      const w = Math.max(num.w, den.w) + size * 0.3;
      const axis = size * 0.28;
      const gap = size * 0.12;
      const numY = -axis - gap - num.desc;
      const denY = -axis + gap + den.asc;
      add({
        w,
        asc: -numY + num.asc,
        desc: denY + den.desc,
        ops: [...shift(num.ops, (w - num.w) / 2, numY), stroke(0, -axis, w, -axis), ...shift(den.ops, (w - den.w) / 2, denY)],
      });
    } else {
      // Square root: tick, down, up, then the bar over the body, then the body.
      const body = layoutRow(n.body, size, measure);
      const hook = size * 0.5;
      const top = -(body.asc + size * 0.1);
      add({
        w: hook + body.w + size * 0.1,
        asc: -top + size * 0.06,
        desc: body.desc,
        ops: [
          stroke(0, -size * 0.25, size * 0.14, -size * 0.3),
          stroke(size * 0.14, -size * 0.3, size * 0.3, body.desc * 0.6),
          stroke(size * 0.3, body.desc * 0.6, hook, top),
          stroke(hook, top, hook + body.w + size * 0.1, top),
          ...shift(body.ops, hook + size * 0.04, 0),
        ],
      });
    }
  }
  return box;
}

/** Splits the top level into words at spaces, keeping ^ and _ attached to what they follow. */
function words(nodes: Node[]): Node[][] {
  const out: Node[][] = [];
  let word: Node[] = [];
  const flush = () => {
    if (word.length) out.push(word);
    word = [];
  };
  for (const n of nodes) {
    if (n.t !== "text") {
      word.push(n);
      continue;
    }
    n.s.split(/( +)/).forEach((piece) => {
      if (!piece) return;
      if (piece.trim()) word.push({ t: "text", s: piece });
      else flush();
    });
  }
  flush();
  return out;
}

/**
 * The pen ops for a question, wrapped at spaces to `maxWidth`. Coordinates are px from the top-left
 * of the writing at font size `size`; the size is final, so it can be placed before the pen starts.
 */
export function layoutScript(content: string, maxWidth: number, measure: Measure, size: number = HAND.size): Script {
  const space = measure(" ", size);
  const lines: Box[] = [];
  let line: Box = { w: 0, asc: 0, desc: 0, ops: [] };
  for (const word of words(parseScript(content))) {
    const b = layoutRow(word, size, measure);
    if (line.w > 0 && line.w + space + b.w > maxWidth) {
      lines.push(line);
      line = { w: 0, asc: 0, desc: 0, ops: [] };
    }
    const x = line.w > 0 ? line.w + space : 0;
    line = { w: x + b.w, asc: Math.max(line.asc, b.asc), desc: Math.max(line.desc, b.desc), ops: [...line.ops, ...shift(b.ops, x, 0)] };
  }
  if (line.w > 0) lines.push(line);
  const ops: PenOp[] = [];
  let y = 0;
  for (const l of lines) {
    ops.push(...shift(l.ops, 0, y + l.asc));
    y += l.asc + l.desc + size * 0.15;
  }
  return { ops, w: Math.max(0, ...lines.map((l) => l.w)), h: Math.max(0, y - size * 0.15) };
}

/** What to draw at progress p (0..1): whole ops, at most one part-written op, and where the pen tip is. */
export function revealScript(ops: PenOp[], p: number): { whole: PenOp[]; partial: { op: PenOp; frac: number } | null; nib: { x: number; y: number } | null } {
  const total = ops.reduce((sum, o) => sum + o.w, 0);
  if (p >= 1 || total === 0) return { whole: ops, partial: null, nib: null };
  let ink = Math.max(0, p) * total;
  const whole: PenOp[] = [];
  for (const op of ops) {
    if (ink >= op.w) {
      whole.push(op);
      ink -= op.w;
      continue;
    }
    const frac = op.w > 0 ? ink / op.w : 0;
    const nib = op.kind === "text" ? { x: op.x + op.w * frac, y: op.y - op.size * 0.3 } : { x: op.x1 + (op.x2 - op.x1) * frac, y: op.y1 + (op.y2 - op.y1) * frac };
    return { whole, partial: { op, frac }, nib };
  }
  return { whole, partial: null, nib: null };
}

// ---- in step with Sam's voice ------------------------------------------------------------------

/** The pen never writes a whole question faster than this, even if the speech text arrives in one burst. */
export const MIN_WRITE_MS = 1200;
/** However slowly Sam speaks (or if it never does), the question is complete after this long. */
export const MAX_WRITE_MS = 8000;
/** When Sam stops or is interrupted, the rest is written within this long: never left half-written. */
export const FINISH_MS = 400;

export interface WriteClock {
  startedAt: number;
  /** Characters Sam is expected to speak while giving the question. */
  expectedChars: number;
  /** Fallback when speech text is late or missing: the time the question takes to say at ~2.5 words a second. */
  durationMs: number;
  /** Characters of speech heard since the pen started (Anam's streamed message chunks). */
  spokenChars: number;
  /** When Sam's turn ended or was interrupted, or null while it is still speaking. */
  endedAt: number | null;
}

/** How long the question is when spoken: letters as they are, each digit or symbol about one short word. */
export function spokenLength(plain: string): number {
  let n = 0;
  for (const ch of plain) n += /[A-Za-z\s]/.test(ch) ? 1 : 5;
  return Math.max(12, n);
}

export function startClock(plain: string, now: number): WriteClock {
  const expectedChars = spokenLength(plain);
  const durationMs = Math.min(MAX_WRITE_MS, Math.max(1500, (expectedChars / 5 / 2.5) * 1000));
  return { startedAt: now, expectedChars, durationMs, spokenChars: 0, endedAt: null };
}

/** 0..1: how much of the question is written at `now`. Never goes backwards as time passes. */
export function writeProgress(c: WriteClock, now: number): number {
  const t = now - c.startedAt;
  if (t >= MAX_WRITE_MS) return 1;
  // The voice leads; the timer keeps the pen moving when no speech text arrives.
  let p = Math.min(Math.max(c.spokenChars / c.expectedChars, t / c.durationMs), t / MIN_WRITE_MS);
  if (c.endedAt !== null) p = Math.max(p, (now - c.endedAt) / FINISH_MS);
  return Math.min(1, Math.max(0, p));
}
