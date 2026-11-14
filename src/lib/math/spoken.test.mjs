// Run: node --test src/lib/math/spoken.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { spokenToLatex } from "./spoken.ts";

const cases = [
  ["Solve x squared plus five x plus six equals zero.", "Solve $x^2 + 5x + 6 = 0$."],
  ["So x equals minus two or x equals minus three", "So $x = -2$ or $x = -3$"],
  ["What is one over x?", "What is $\\frac{1}{x}$?"],
  ["b squared minus four a c", "$b^2 - 4ac$"],
  ["x to the power of n plus one", "$x^n + 1$"],
  ["two point five times y", "$2.5 \\times y$"],
  ["twenty five divided by five equals five", "$25 \\div 5 = 5$"],
  ["minus b plus or minus four", "$-b \\pm 4$"],
  ["I typed 2x^2 + 3x = 5 here", "I typed $2x^2 + 3x = 5$ here"],
  ["three x cubed minus x", "$3x^3 - x$"],
  ["Okay, so y equals two x plus one, right?", "Okay, so $y = 2x + 1$, right?"],
];

for (const [input, want] of cases) {
  test(`converts: ${input}`, () => assert.equal(spokenToLatex(input), want));
}

const prose = [
  "I have two ideas about this.",
  "Can you write that on the board for me?",
  "Plants take in carbon dioxide and water.",
  "That was a plus for me.",
  "x plus a few more things",
  "Take your time.",
  "What is x?",
  "It costs $5 now",
  "",
];
for (const input of prose) {
  test(`leaves prose alone: ${JSON.stringify(input)}`, () => {
    const out = spokenToLatex(input);
    // Either nothing changed (null) or only a real maths phrase was wrapped.
    if (out !== null) assert.doesNotMatch(out, /\$[^$]*\b(few|ideas|plus for)\b/);
    if (input !== "x plus a few more things") assert.equal(out, null);
  });
}

test("trailing operator stays as words", () => {
  assert.equal(spokenToLatex("five x plus"), null);
  assert.equal(spokenToLatex("x squared plus... um"), "$x^2$ plus... um");
});

test("ambiguous runs are not converted", () => {
  assert.equal(spokenToLatex("two three plus four"), "two $3 + 4$");
});
