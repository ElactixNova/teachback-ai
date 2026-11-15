// Run: node --test src/lib/curriculum/limits.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TRANSCRIPT_CHARS, MAX_TRANSCRIPT_LINES, fitTranscript } from "./limits.ts";

const line = (i, speaker = i % 2 ? "avatar" : "student", text = `line ${i}`) => ({ speaker, text, t: `${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}` });

test("fitTranscript: short transcripts are unchanged", () => {
  const lines = [line(0), line(1)];
  assert.deepEqual(fitTranscript(lines), lines);
});

test("fitTranscript: a long session fits the server limits, Sam's older lines go first, order kept", () => {
  const lines = Array.from({ length: 1000 }, (_, i) => line(i));
  const out = fitTranscript(lines);
  assert.ok(out.length <= MAX_TRANSCRIPT_LINES);
  assert.equal(out.filter((l) => l.speaker === "student").length, 500, "every student line kept");
  assert.deepEqual(out.slice(-40), lines.slice(-40), "recent context kept whole");
  for (let i = 1; i < out.length; i++) assert.ok(lines.indexOf(out[i - 1]) < lines.indexOf(out[i]));
});

test("fitTranscript: still too long after Sam's lines -> oldest student lines go; huge lines are cut", () => {
  const lines = Array.from({ length: 700 }, (_, i) => line(i, "student"));
  const out = fitTranscript(lines);
  assert.equal(out.length, MAX_TRANSCRIPT_LINES);
  assert.equal(out.at(-1), lines.at(-1));
  const huge = fitTranscript(Array.from({ length: 100 }, (_, i) => line(i, "student", "x".repeat(5000))));
  assert.ok(huge.reduce((n, l) => n + l.text.length, 0) <= MAX_TRANSCRIPT_CHARS);
  assert.ok(huge.every((l) => l.text.length <= 2000));
});
