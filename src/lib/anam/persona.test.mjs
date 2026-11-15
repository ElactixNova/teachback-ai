// Run: node --test src/lib/anam/persona.test.mjs
// persona.ts imports ./tools without an extension, which plain node cannot resolve, so these checks read the
// prompt source text instead of calling buildRailSystemPrompt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("./persona.ts", import.meta.url), "utf8");

test("rail prompt never plants 'unsure what to ask' for Sam to echo", () => {
  // The old RAIL rule said "when you are unsure what to ask next" and Sam echoed it to the student.
  assert.doesNotMatch(src, /when you are unsure what to ask/i);
  assert.match(src, /YOU ARE THE STUDENT, NOT THE EXAMINER/);
});

test("rail prompt separates requests from answers and rewrites the SAME question on request", () => {
  assert.match(src, /A request is not an answer/);
  assert.match(src, /question you ASKED LAST/);
  assert.match(src, /EVERY time your question/);
});

test("maths is spoken as one fluent phrase with no grouping commas", () => {
  assert.match(src, /FLUENT:/);
  assert.doesNotMatch(src, /x plus two, all/);
});
