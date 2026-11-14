// Run: node --test src/lib/curriculum/grade.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMarkScheme, buildReport, findQuote, gradeAll, isBackReference, primaryGap } from "./grade.ts";

const scheme = buildMarkScheme(
  {
    topic: "Photosynthesis",
    criteria: [
      { title: "Inputs", expected: ["Uses CO2", "Uses water", "Needs light"], page: 1, label: null },
      { title: "Location", expected: ["Happens in leaves", "Chloroplasts hold chlorophyll"], page: 9, label: "Lecture 4" },
    ],
  },
  { sourceFile: "n.pdf", topic: "Photosynthesis", maxPage: 3 },
);
const transcript = [
  { speaker: "avatar", text: "What goes in?", t: "00:05" },
  { speaker: "student", text: "Plants take in CO2 and water.", t: "00:12" },
];
const raw = (over) => ({
  criterionId: "c1", status: "partial", awarded: 2, evidence: null, boardObservation: null,
  missingSteps: ["Needs light"], fix: "Say that light powers it.", ...over,
});

test("mark scheme: ids, 1 mark per step, totals, clamped pages", () => {
  assert.deepEqual(scheme.criteria.map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(scheme.criteria.map((c) => c.marks), [3, 2]);
  assert.equal(scheme.totalMarks, 5);
  assert.equal(scheme.criteria[1].source.page, 3); // 9 clamped to the last real page
  assert.equal(scheme.pages, "pp. 1-3");
});

test("quotes must be verbatim student words; the timestamp comes from the transcript", () => {
  const ok = findQuote("take in co2 and water", transcript);
  assert.equal(ok.timestamp, "00:12");
  assert.equal(ok.quote, "take in CO2 and water");
  assert.equal(findQuote("What goes in?", transcript), null); // avatar line
  assert.equal(findQuote("plants breathe oxygen", transcript), null); // invented
});

test("grading: invented quote dropped, unknown missing steps ignored, criteria without a result are not_covered", () => {
  const results = gradeAll(
    scheme,
    [raw({ evidence: { quote: "totally made up" }, missingSteps: ["Needs light", "not a step"] })],
    transcript,
    "final",
  );
  assert.equal(results[0].awarded, 2);
  assert.equal(results[0].status, "partial");
  assert.deepEqual(results[0].missingSteps, ["Needs light"]);
  assert.equal(results[0].evidence, undefined);
  assert.equal(results[1].status, "not_covered");
  assert.deepEqual(results[1].missingSteps, scheme.criteria[1].expected);
});

test("grading: full marks clear missing steps; in_progress only survives in live mode", () => {
  const full = gradeAll(scheme, [raw({ status: "full", awarded: 3, missingSteps: [] })], transcript, "final");
  assert.equal(full[0].status, "full");
  assert.equal(full[0].fix, undefined);
  const live = gradeAll(scheme, [raw({ status: "in_progress", awarded: 1, missingSteps: [] })], transcript, "live");
  assert.equal(live[0].status, "in_progress");
  const fin = gradeAll(scheme, [raw({ status: "in_progress", awarded: 1, missingSteps: [] })], transcript, "final");
  assert.notEqual(fin[0].status, "in_progress");
});

test("report: totals and primary gap are computed here, ties go to the earliest", () => {
  const results = gradeAll(scheme, [raw({ awarded: 2 }), raw({ criterionId: "c2", status: "missed", awarded: 0, missingSteps: [] })], transcript, "final");
  assert.equal(primaryGap(scheme, results), "c2"); // lost 2 > lost 1
  const report = buildReport(scheme, results, [
    { title: "a", detail: "b", estimatedMinutes: 5, criterionId: "c1" },
    { title: "c", detail: "d", estimatedMinutes: 500, criterionId: "c2" },
  ]);
  assert.equal(report.awarded, 2);
  assert.equal(report.total, 5);
  assert.equal(report.primaryGapId, "c2");
  assert.equal(report.studyPlan[0].gapId, "c2"); // reordered so the first step targets the primary gap
  assert.equal(report.studyPlan[0].id, "step-1");
  assert.equal(report.studyPlan[0].estimatedMinutes, 90); // clamped
});

test("primary gap is an attempted criterion, never one the student did not cover", () => {
  const res = (criterionId, status, awarded) => ({ criterionId, status, awarded, missingSteps: [], attempts: 0, parked: false });
  assert.equal(primaryGap(scheme, [res("c1", "partial", 1), res("c2", "not_covered", 0)]), "c1"); // c2 lost 2 vs c1's 2: c2 was never attempted
  assert.equal(primaryGap(scheme, [res("c1", "partial", 2), res("c2", "not_covered", 0)]), "c1"); // c2 lost more, still not attempted
  assert.equal(primaryGap(scheme, [res("c1", "not_covered", 0), res("c2", "not_covered", 0)]), "c1"); // nothing attempted: biggest loss (c1: 3)
});

test("back-references are never shown as 'What you said'", () => {
  assert.ok(isBackReference("I already did that."));
  assert.ok(isBackReference("As I said, it needs light"));
  assert.ok(isBackReference("I wrote that on the board"));
  assert.equal(isBackReference("Plants take in CO2 and water and use light to make glucose."), false);
  assert.equal(isBackReference("Chlorophyll absorbs light that is already available"), true); // 'already' alone is enough: drop rather than risk a wrong quote
});

test("said: the summary of what the student said passes through, trimmed, never for a point they never addressed", () => {
  const res = gradeAll(scheme, [raw({ said: "  You said plants use CO2 and water, then corrected the roots.  " }), raw({ criterionId: "c2", status: "not_covered", awarded: 0, missingSteps: [], said: "You said something" })], transcript, "final");
  assert.equal(res[0].said, "You said plants use CO2 and water, then corrected the roots.");
  assert.equal(res[1].said, undefined);
});
