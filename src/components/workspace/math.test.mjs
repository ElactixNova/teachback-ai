// Run: node --test src/components/workspace/math.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMath, looksMathy, parseMath } from "./math.ts";

const kinds = (s) => parseMath(s).map((x) => `${x.kind}:${x.value}`);

test("plain prose is one text segment", () => {
  assert.deepEqual(kinds("The oxygen comes from water."), ["text:The oxygen comes from water."]);
  assert.deepEqual(parseMath(""), []);
});

test("inline and display spans", () => {
  assert.deepEqual(kinds("Solve $x^2+5x+6=0$ first."), ["text:Solve ", "inline:x^2+5x+6=0", "text: first."]);
  assert.deepEqual(kinds("So $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$ done"), [
    "text:So ",
    "display:x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
    "text: done",
  ]);
  assert.deepEqual(kinds("$a$ and $b$"), ["inline:a", "text: and ", "inline:b"]);
});

test("dollar amounts in prose stay prose", () => {
  assert.deepEqual(kinds("It costs $5 and $10 today."), ["text:It costs $5 and $10 today."]);
  assert.deepEqual(kinds("Pay $ 3 now $"), ["text:Pay $ 3 now $"]);
  assert.equal(hasMath("between $5 and $10"), false);
});

test("escaped \\$ is a literal dollar", () => {
  assert.deepEqual(kinds("Price \\$4 and $x$"), ["text:Price $4 and ", "inline:x"]);
  assert.deepEqual(kinds("$\\$5 + y$"), ["inline:\\$5 + y"]);
});

test("nested braces: a $ inside {...} does not close the span", () => {
  assert.deepEqual(kinds("see $\\text{cost in $}x$ ok"), ["text:see ", "inline:\\text{cost in $}x", "text: ok"]);
  assert.deepEqual(kinds("$\\frac{a}{b}$"), ["inline:\\frac{a}{b}"]);
});

test("unbalanced delimiters are kept as text", () => {
  assert.deepEqual(kinds("only one $x here"), ["text:only one $x here"]);
  assert.deepEqual(kinds("open $$x+1 never closed"), ["text:open $$x+1 never closed"]);
  assert.deepEqual(kinds("empty $$$$ pair"), ["text:empty $$$$ pair"]);
});

test("looksMathy: spoken maths yes, ordinary sentences no", () => {
  assert.equal(looksMathy("x squared plus five x plus six equals zero"), true);
  assert.equal(looksMathy("one over x"), true);
  assert.equal(looksMathy("so 6CO2 + 6H2O gives glucose"), true);
  assert.equal(looksMathy("plants take in carbon dioxide"), false);
  assert.equal(looksMathy("I already did that, a plus side is I learnt it"), false);
  assert.equal(looksMathy("Solve $x^2=4$"), false); // already LaTeX
});
