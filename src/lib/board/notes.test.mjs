// Run: node --test src/lib/board/notes.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { admitNote, describeSpot, noteLayout, placeNote, plainMath, shiftIntoView, MAX_NOTES_PER_SESSION, NOTE } from "./notes.ts";

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

test("wrap: a long expression stays within about 45% of the viewport", () => {
  const long = "solve x^2 + 5x + 6 = 0 and then explain why both roots are negative using the sum and product of roots";
  const { lines, w, h } = noteLayout(long, 900);
  assert.ok(lines.length > 1);
  assert.ok(w <= 900 * 0.45, `${w}`);
  assert.equal(h, 2 * NOTE.pad + NOTE.label + lines.length * NOTE.line);
  assert.equal(lines.join(" "), long);
  // A token with no spaces is cut, never overflowing.
  const cut = noteLayout("x".repeat(100), 900);
  assert.ok(cut.lines.every((l) => l.length <= Math.floor((900 * 0.45 - 2 * NOTE.pad) / NOTE.charW)));
  assert.equal(noteLayout("x^2 = 4", 900).lines.length, 1);
});

test("plainMath: readable text for the card and the examiner PNG", () => {
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
