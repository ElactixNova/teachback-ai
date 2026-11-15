import assert from "node:assert/strict";
import { test } from "node:test";
import { announcesReport, lineAnnouncesReport } from "./report-intent.ts";

test("T45: she announcing the report opens it; asking about it does not", () => {
  for (const s of ["Okay, let me check your report.", "Great, I'll open your report now.", "Pulling up your results.", "Let me put up the report."]) assert.ok(announcesReport(s), s);
  for (const s of ["Would you like me to open your report?", "Shall I open the report now?", "Do you want to see your report.", "Anything to add, or shall I move on?", "I see the formula is written."]) assert.ok(!announcesReport(s), s);
  assert.ok(lineAnnouncesReport("Okay. Let me check your report.", true));
  assert.ok(!lineAnnouncesReport("Okay. Let me check your report", false), "an unfinished sentence waits");
  assert.ok(lineAnnouncesReport("Okay. Let me check your report", true));
});
