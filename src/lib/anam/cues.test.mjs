// Run: node --test src/lib/anam/cues.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCues, stripBrackets } from "./cues.ts";

test("cue tags are pulled out and reported", () => {
  assert.deepEqual(extractCues("[curious] Wait, why does that happen?"), { clean: "Wait, why does that happen?", cues: ["curious"] });
});

test("stripBrackets removes bracketed segments and tidies the gap", () => {
  assert.equal(stripBrackets("Okay [RAIL UPDATE, private] so what next?"), "Okay so what next?");
  assert.equal(stripBrackets("Got it [waiting for the user to finish], take your time."), "Got it, take your time.");
  assert.equal(stripBrackets("Sure. [BOARD] Could you write it?"), "Sure. Could you write it?");
  assert.equal(stripBrackets("[note] Right, and then?"), "Right, and then?");
  assert.equal(stripBrackets("No brackets here."), "No brackets here.");
});

test("nested and unbalanced brackets", () => {
  assert.equal(stripBrackets("One [two [three] four] five"), "One five");
  assert.equal(stripBrackets("Hello [this never closes and so on"), "Hello");
  assert.equal(stripBrackets("stray] bracket"), "stray bracket");
  assert.equal(stripBrackets("a ] b [ c ] d"), "a b d");
});

test("a line that is only brackets becomes empty", () => {
  assert.equal(stripBrackets("[PRIVATE NOTE never say this]"), "");
  assert.equal(stripBrackets("  [a] [b]. "), "");
  assert.equal(stripBrackets("[unclosed"), "");
});

test("unknown tags left by extractCues are stripped too", () => {
  const { clean } = extractCues("[happy] Nice! [thinking] So the roots are minus two and minus three?");
  assert.equal(stripBrackets(clean), "Nice! So the roots are minus two and minus three?");
});
