// Run: node --test src/lib/curriculum/gaps.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { gapsWorstFirst, safeSvg } from "./gaps.ts";

test("safeSvg accepts a plain svg and rejects script, handlers, external refs and non-svg", () => {
  assert.ok(safeSvg('<svg viewBox="0 0 600 340"><rect width="600" height="340" fill="#fff"/><text x="10" y="30">ok</text></svg>'));
  assert.equal(safeSvg('<svg><script>alert(1)</script></svg>'), null);
  assert.equal(safeSvg('<svg onload="x()"></svg>'), null);
  assert.equal(safeSvg('<svg><a href="https://evil.example"><text>x</text></a></svg>'), null);
  assert.equal(safeSvg('<svg><image href="https://x/y.png"/></svg>'), null);
  assert.equal(safeSvg("<div>not svg</div>"), null);
  assert.equal(safeSvg(null), null);
});

const scheme = {
  topic: "t", sourceFile: "f", pages: "p. 1", totalMarks: 9,
  criteria: [
    { id: "c1", title: "A", expected: ["a", "b", "c"], marks: 3, source: { page: 1 } },
    { id: "c2", title: "B", expected: ["a", "b", "c", "d"], marks: 4, source: { page: 1 } },
    { id: "c3", title: "C", expected: ["a", "b"], marks: 2, source: { page: 1 } },
  ],
};
const r = (criterionId, status, awarded) => ({ criterionId, status, awarded, missingSteps: [], attempts: 0, parked: false });

test("gaps: lost marks, worst first, ties in scheme order, not_covered and full excluded", () => {
  const out = gapsWorstFirst(scheme, [r("c1", "partial", 1), r("c2", "full", 4), r("c3", "parked", 0)]);
  assert.deepEqual(out.map((x) => x.criterion.id), ["c1", "c3"]); // c1 lost 2, c3 lost 2: tie keeps scheme order
  const none = gapsWorstFirst(scheme, [r("c1", "not_covered", 0), r("c2", "full", 4), r("c3", "full", 2)]);
  assert.equal(none.length, 0);
});
