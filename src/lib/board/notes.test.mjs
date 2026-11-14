// Run: node --test src/lib/board/notes.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { admitNote, describeSpot, layoutScript, placeNote, plainMath, revealScript, shiftIntoView, spokenLength, startClock, writeProgress, FINISH_MS, MAX_NOTES_PER_SESSION, MAX_WRITE_MS, MIN_WRITE_MS } from "./notes.ts";

const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const inside = (r, v) => r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h;
const viewport = { x: 0, y: 0, w: 900, h: 600 };
const size = { w: 240, h: 80 };

test("empty board: top-left of the viewport, a margin in", () => {
  const p = placeNote([], [], viewport, size, 24);
  assert.deepEqual(p, { x: 24, y: 24, inView: true });
  assert.equal(describeSpot({ ...p, ...size }, viewport), "top-left");
});

test("crowded board: the note lands in the free gap, clear of ink and earlier notes", () => {
  const ink = [{ x: 0, y: 0, w: 900, h: 250 }, { x: 0, y: 250, w: 420, h: 350 }];
  const notes = [{ x: 460, y: 290, w: 240, h: 80 }];
  const p = placeNote(ink, notes, viewport, size, 24);
  assert.equal(p.inView, true);
  const r = { ...p, ...size };
  assert.ok(inside(r, viewport));
  for (const o of [...ink, ...notes]) assert.ok(!overlaps(r, o, 23.9), "keeps the 24px margin");
});

test("no room: placed just below everything, flagged for scrolling", () => {
  const ink = [{ x: 0, y: 0, w: 900, h: 600 }];
  const p = placeNote(ink, [], viewport, size, 24);
  assert.deepEqual(p, { x: 0, y: 624, inView: false });
  // The pan that brings it into view moves the viewport down, not sideways.
  assert.deepEqual(shiftIntoView({ ...p, ...size }, viewport, 24), { dx: -24, dy: 128 });
});

test("panned and zoomed viewport: world coordinates, margin scaled by the caller", () => {
  // Zoom 2x, panned: the visible world rect is small and far from the origin.
  const v = { x: 1000, y: -400, w: 450, h: 300 };
  const k = 0.5; // world units per screen px
  const s = { w: 240 * k, h: 80 * k };
  const ink = [{ x: 1000, y: -400, w: 200, h: 100 }];
  const p = placeNote(ink, [], v, s, 24 * k);
  assert.equal(p.inView, true);
  assert.ok(inside({ ...p, ...s }, v));
  assert.ok(!overlaps({ ...p, ...s }, ink[0], 24 * k - 0.1));
  // Ink outside the viewport does not matter.
  assert.deepEqual(placeNote([{ x: 0, y: 0, w: 50, h: 50 }], [], v, s, 12), { x: 1012, y: -388, inView: true });
});

test("plainMath: readable text for the accessible label", () => {
  assert.equal(plainMath("x^{2} + 5x + 6 = 0"), "x^2 + 5x + 6 = 0");
  assert.equal(plainMath("\\frac{1}{x} + \\sqrt{x^{2}+1}"), "(1)/(x) + √(x^2+1)");
  assert.equal(plainMath("x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}"), "x = (-b ± √(b^2 - 4ac))/(2a)");
  assert.equal(plainMath("6CO_{2} + 6H_{2}O \\to \\text{glucose}"), "6CO_2 + 6H_2O → glucose");
});

test("admitNote: sanitises, and enforces length, repeat, pace and session limits", () => {
  const ok = admitNote({ content: "  $x^2 +\n5x + 6 = 0$ ", kind: "math", label: " Question 1 " }, [], 0);
  assert.deepEqual(ok, { ok: true, note: { content: "x^2 + 5x + 6 = 0", kind: "math", label: "Question 1" } });
  assert.deepEqual(admitNote({ content: " \n ", kind: "text" }, [], 0), { ok: false, reason: "empty" });
  assert.deepEqual(admitNote({ content: "x".repeat(201), kind: "math" }, [], 0), { ok: false, reason: "too_long" });
  assert.deepEqual(admitNote({ content: "\\href{http://x}{y}", kind: "math" }, [], 0), { ok: false, reason: "unsafe" });
  assert.equal(admitNote({ content: "<b>hi</b>", kind: "text" }, [], 0).note.content, "b hi /b");
  const one = [{ content: "x^2 = 4", at: 1000 }];
  assert.deepEqual(admitNote({ content: "x^2 = 4", kind: "math" }, one, 60_000), { ok: false, reason: "duplicate" });
  assert.deepEqual(admitNote({ content: "x^2 = 9", kind: "math" }, one, 8999), { ok: false, reason: "too_soon" });
  assert.equal(admitNote({ content: "x^2 = 9", kind: "math" }, one, 9000).ok, true);
  const six = Array.from({ length: MAX_NOTES_PER_SESSION }, (_, i) => ({ content: `q${i}`, at: i * 10_000 }));
  assert.deepEqual(admitNote({ content: "one more", kind: "text" }, six, 1e9), { ok: false, reason: "limit" });
});

// ---- handwriting ----
const measure = (text, size) => text.length * size * 0.5; // every character half an em wide
const texts = (script) => script.ops.filter((o) => o.kind === "text");

test("layout: plain words and an equation on one baseline, in writing order", () => {
  const s = layoutScript("Solve x^2 + 5x + 6 = 0", 1000, measure, 20);
  assert.deepEqual(texts(s).map((o) => o.text), ["Solve", "x", "2", "+", "5x", "+", "6", "=", "0"]);
  const [solve, x, two, plus] = texts(s);
  assert.equal(solve.y, x.y);
  assert.ok(two.y < x.y && two.size < x.size, "the power is raised and smaller");
  assert.equal(two.x, x.x + x.w, "and sits right after its base");
  assert.equal(plus.x, two.x + two.w + measure(" ", 20), "words are a space apart");
  assert.ok(s.w > 0 && s.h > 0 && s.ops.every((o) => (o.kind === "text" ? o.x + o.w <= s.w + 1e-9 : true)));
});

test("layout: a fraction stacks top, bar, bottom; a root gets its hook before the body", () => {
  const f = layoutScript("\\frac{1}{x+1}", 1000, measure, 20);
  assert.deepEqual(f.ops.map((o) => (o.kind === "text" ? o.text : "bar")), ["1", "bar", "x+1"]);
  const [num, bar, den] = f.ops;
  assert.ok(num.y < bar.y1 && bar.y1 < den.y - den.size * 0.5, "top above the bar, bottom below it");
  assert.equal(bar.y1, bar.y2);
  assert.ok(bar.w >= den.w, "the bar spans the wider part");
  assert.ok(Math.abs(num.x + num.w / 2 - (den.x + den.w / 2)) < 1e-9, "top and bottom are centred");
  const r = layoutScript("\\sqrt{b^2 - 4ac}", 1000, measure, 20);
  assert.deepEqual(r.ops.map((o) => o.kind), ["line", "line", "line", "line", "text", "text", "text"]);
  const overline = r.ops[3];
  assert.ok(overline.y1 === overline.y2 && overline.y1 < texts(r)[0].y - 20 * 0.7, "the bar runs over the body");
  assert.ok(r.ops.every((o) => (o.kind === "text" ? o.y - o.size <= r.h : true)) && r.h > 20);
});

test("layout: wraps at spaces to the width it is given, and survives odd input", () => {
  const long = "Solve x^2 + 5x + 6 = 0 and explain why both roots are negative";
  const wide = layoutScript(long, 2000, measure, 20);
  const narrow = layoutScript(long, 200, measure, 20);
  assert.ok(narrow.w <= 200 && narrow.h > wide.h * 2);
  assert.deepEqual(texts(narrow).map((o) => o.text), texts(wide).map((o) => o.text));
  for (const odd of ["", "x^", "\\frac{1}", "}{", "a_{b", "\\sqrt", "$x^2$", "\\unknown{y}"]) assert.ok(Number.isFinite(layoutScript(odd, 300, measure).w), odd);
  assert.deepEqual(texts(layoutScript("\\alpha \\to \\pi", 500, measure)).map((o) => o.text), ["α", "→", "π"]);
});

test("reveal: ink appears op by op, the op being written is part-drawn, the nib leads", () => {
  const { ops } = layoutScript("ab cd", 1000, measure, 20); // two ops, 20px each
  assert.deepEqual(revealScript(ops, 0), { whole: [], partial: { op: ops[0], frac: 0 }, nib: { x: 0, y: ops[0].y - 6 } });
  const mid = revealScript(ops, 0.75);
  assert.deepEqual(mid.whole, [ops[0]]);
  assert.equal(mid.partial.op, ops[1]);
  assert.ok(Math.abs(mid.partial.frac - 0.5) < 1e-9 && Math.abs(mid.nib.x - (ops[1].x + 10)) < 1e-9);
  assert.deepEqual(revealScript(ops, 1), { whole: ops, partial: null, nib: null });
  // Monotonic: more progress never draws less.
  let last = -1;
  for (let p = 0; p <= 1.001; p += 0.05) {
    const r = revealScript(ops, p);
    const drawn = r.whole.reduce((n, o) => n + o.w, 0) + (r.partial ? r.partial.op.w * r.partial.frac : 0);
    assert.ok(drawn >= last - 1e-9);
    last = drawn;
  }
});

test("progress: follows the voice, keeps moving without it, and always finishes", () => {
  const plain = "Solve x^2 + 5x + 6 = 0";
  assert.ok(spokenLength(plain) > plain.length * 2, "maths takes longer to say than to write");
  const c = startClock(plain, 1000);
  assert.equal(writeProgress(c, 1000), 0);
  // No speech text at all: the timer writes it, complete at durationMs, never past the hard cap.
  assert.ok(c.durationMs >= 1500 && c.durationMs <= MAX_WRITE_MS);
  assert.ok(Math.abs(writeProgress(c, 1000 + c.durationMs / 2) - 0.5) < 1e-9);
  assert.equal(writeProgress(c, 1000 + c.durationMs), 1);
  assert.equal(writeProgress({ ...c, durationMs: 60_000 }, 1000 + MAX_WRITE_MS), 1);
  // Speech ahead of the timer pulls the pen forward...
  const heard = { ...c, spokenChars: c.expectedChars * 0.8, durationMs: 60_000 };
  assert.ok(Math.abs(writeProgress(heard, 1000 + MIN_WRITE_MS) - 0.8) < 1e-9);
  // ...but a burst of text cannot write the whole question in an instant.
  assert.ok(writeProgress({ ...heard, spokenChars: 1e6 }, 1000 + MIN_WRITE_MS / 4) <= 0.25 + 1e-9);
  // Sam stops or is interrupted early: the rest is written within FINISH_MS, not left half-done.
  const cut = { ...c, durationMs: 60_000, spokenChars: 5, endedAt: 1500 };
  assert.ok(writeProgress(cut, 1500 + FINISH_MS / 2) >= 0.5);
  assert.equal(writeProgress(cut, 1500 + FINISH_MS), 1);
  // Never backwards.
  let last = 0;
  for (let t = 1000; t <= 1000 + MAX_WRITE_MS; t += 100) {
    const p = writeProgress(c, t);
    assert.ok(p >= last);
    last = p;
  }
});
