// Run: node --test src/components/workspace/transcriptClean.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSamLine } from "./transcriptClean.ts";

test("ordinary lines are untouched", () => {
  assert.equal(cleanSamLine("Okay, got it. So where does the water come from?"), "Okay, got it. So where does the water come from?");
  assert.equal(cleanSamLine("Is it 0.5 or 1.5 then?"), "Is it 0.5 or 1.5 then?");
  assert.equal(cleanSamLine("What happens after the light stage?"), "What happens after the light stage?");
});

test("bracketed prompt markers are removed", () => {
  assert.equal(cleanSamLine("[RAIL UPDATE, private] Nice, that makes sense."), "Nice, that makes sense.");
  assert.equal(cleanSamLine("[happy] Great! [curious] And then?"), "Great! And then?");
  assert.equal(cleanSamLine("[BOARD] waiting"), "waiting");
  assert.equal(cleanSamLine("Unclosed [marker text"), "Unclosed");
});

test("sentences about the machinery are dropped, the rest kept", () => {
  assert.equal(cleanSamLine("That's part of the script. So what's the next step?"), "So what's the next step?");
  assert.equal(cleanSamLine("Let's park that and come back to it later. How do you factorise it?"), "How do you factorise it?");
  assert.equal(cleanSamLine("The mark scheme wants more. Can you say why?"), "Can you say why?");
  assert.equal(cleanSamLine("I'll note that for the report. Okay!"), "Okay!");
  assert.equal(cleanSamLine("Waiting for the user to finish."), "");
  assert.equal(cleanSamLine("We'll go back to it later."), "");
});

test("a line that is all machinery is hidden", () => {
  assert.equal(cleanSamLine("[RAIL UPDATE, private, do not read out]"), "");
  assert.equal(cleanSamLine("The examiner says the rail is updated."), "");
});

test("words that merely contain a trigger are not dropped", () => {
  assert.equal(cleanSamLine("So the derailleur on a bike works like that?"), "So the derailleur on a bike works like that?");
  assert.equal(cleanSamLine("Is a parkland ecosystem different?"), "Is a parkland ecosystem different?");
  assert.equal(cleanSamLine("Does it happen later in the cycle?"), "Does it happen later in the cycle?");
});
