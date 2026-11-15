// T49: the examiner must catch a wrong worked answer (5 x 8 / 2 written as 10). Calls the real /api/analyze, no avatar.
//   node tests/e2e/arith.mjs [final|live]
const BASE = process.env.BASE_URL || "http://localhost:3000";
const mode = process.argv[2] || "final";
const markScheme = {
  topic: "Area of a triangle", sourceFile: "t.pdf", totalMarks: 4,
  criteria: [
    { id: "c1", title: "The area formula", marks: 2, page: 1, label: null, expected: ["States area = base x height / 2", "Says the height is perpendicular to the base"] },
    { id: "c2", title: "Calculating an area with units", marks: 2, page: 1, label: null, expected: ["Substitutes the values correctly into the formula", "Gets the correct answer with square units"] },
  ],
};
const say = (t, text) => ({ speaker: "student", t, text });
const run = async (name, lines) => {
  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ markScheme, transcript: lines, mode }) });
  const r = await res.json();
  const c2 = r.results?.find((x) => x.criterionId === "c2");
  console.log(`${name}: awarded ${r.awarded}/${r.total}; c2 ${c2?.status} ${c2?.awarded}; fix: ${c2?.fix}`);
  return c2;
};
const base = [say("00:10", "The area of a triangle is base times height all over two, and the height is perpendicular to the base."), say("00:30", "Let's say the base is 5 and the height is 8.")];
const wrong = await run("WRONG (10)", [...base, say("00:50", "So five times eight over two, which is 10 square units.")]);
const right = await run("RIGHT (20)", [...base, say("00:50", "So five times eight over two, which is 20 square units.")]);
const ok = wrong?.awarded < 2 && right?.awarded === 2;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
