// Run: node --test src/lib/curriculum/report.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeReport } from "./report.ts";

const gap = { id: "gap-1", concept: "c", misconception: "m", correction: "k", severity: "major" };
const step = { id: "step-1", title: "t", detail: "d", estimatedMinutes: 5 };
const report = (over) => ({ strengths: [], gaps: [gap], studyPlan: [], score: 50, summary: "s", ...over });

test("clamps and rounds the score to 0..100", () => {
  assert.equal(normalizeReport(report({ score: 140 })).score, 100);
  assert.equal(normalizeReport(report({ score: -3 })).score, 0);
  assert.equal(normalizeReport(report({ score: 72.6 })).score, 73);
});

test("keeps a gapId that matches a gap, drops null and dangling ones", () => {
  const { studyPlan } = normalizeReport(
    report({
      studyPlan: [
        { ...step, gapId: "gap-1" },
        { ...step, gapId: null },
        { ...step, gapId: "gap-9" },
      ],
    }),
  );
  assert.equal(studyPlan[0].gapId, "gap-1");
  assert.ok(!("gapId" in studyPlan[1]));
  assert.ok(!("gapId" in studyPlan[2]));
});
