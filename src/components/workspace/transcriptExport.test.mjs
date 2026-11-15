// Run: node --test src/components/workspace/transcriptExport.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTranscript, transcriptFileName } from "./transcriptExport.ts";

const date = new Date(2026, 10, 14, 9, 5); // local 2026-11-14 09:05

test("file name: topic slug and local date/time", () => {
  assert.equal(transcriptFileName("Solving quadratic equations", date), "feynman-solving-quadratic-equations-2026-11-14-0905.txt");
  assert.equal(transcriptFileName("Photosynthesis: CO₂ & H₂O!", date), "feynman-photosynthesis-co2-h2o-2026-11-14-0905.txt");
  assert.equal(transcriptFileName("Électrons", date), "feynman-electrons-2026-11-14-0905.txt");
  assert.equal(transcriptFileName("", date), "feynman-session-2026-11-14-0905.txt");
  assert.equal(transcriptFileName(undefined, date), "feynman-session-2026-11-14-0905.txt");
  assert.ok(transcriptFileName("a".repeat(200), date).length < 70);
});

test("header, one line per turn, raw text, system lines dropped", () => {
  const out = formatTranscript({
    topic: "Quadratics",
    date,
    mark: { awarded: 5, total: 7 },
    lines: [
      { speaker: "avatar", text: "[curious] So what is x squared plus five x plus six?", t: "00:00" },
      { speaker: "system", text: "Next up: Roots", t: "00:01" },
      { speaker: "student", text: "It factorises to\n(x+2)(x+3)", t: "00:04" },
      { speaker: "student", text: "   ", t: "00:05" },
    ],
  });
  assert.equal(
    out,
    [
      "Feynman AI session transcript",
      "Topic: Quadratics",
      "Date: 2026-11-14 09:05",
      "Final mark: 5 / 7 (71%)",
      "",
      "[00:00] Sam: [curious] So what is x squared plus five x plus six?",
      "[00:04] You: It factorises to (x+2)(x+3)",
      "",
    ].join("\n"),
  );
});

test("no mark before the final report; empty transcript says so", () => {
  const out = formatTranscript({ topic: "", date, lines: [] });
  assert.ok(!out.includes("Final mark"));
  assert.ok(out.includes("Topic: (none)"));
  assert.ok(out.includes("(no lines yet)"));
  assert.ok(formatTranscript({ date, mark: { awarded: 0, total: 0 }, lines: [] }).includes("Final mark: 0 / 0\n"));
  assert.ok(formatTranscript({ date, mark: { awarded: 2, total: 4, final: false }, lines: [] }).includes("Mark at last check: 2 / 4 (50%)"));
});
