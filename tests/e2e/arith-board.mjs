// T49: a wrong answer that is ONLY on the whiteboard (as a handwritten line) must be caught too.
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
const png = async (lines) => {
  await page.setContent(`<canvas id=c width=900 height=300></canvas>`);
  return page.evaluate((ls) => { const c = document.getElementById("c"); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 900, 300); x.fillStyle = "#111"; x.font = "42px 'Comic Sans MS', cursive"; ls.forEach((t, i) => x.fillText(t, 30, 70 + i * 70)); return c.toDataURL("image/png").split(",")[1]; }, lines);
};
const markScheme = { topic: "Area of a triangle", sourceFile: "t.pdf", totalMarks: 4, criteria: [
  { id: "c1", title: "The area formula", marks: 2, page: 1, label: null, expected: ["States area = base x height / 2", "Says the height is perpendicular to the base"] },
  { id: "c2", title: "Calculating an area with units", marks: 2, page: 1, label: null, expected: ["Substitutes the values correctly into the formula", "Reaches the correct final value with square units"] } ] };
const lines = [{ speaker: "student", t: "00:10", text: "The area is base times height over two and the height is perpendicular. I will do an example with base 5 and height 8 on the board." }, { speaker: "student", t: "00:40", text: "Done." }];
const run = async (name, board) => {
  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ markScheme, transcript: lines, whiteboardBase64: await png(board), mode: "final" }) });
  const r = await res.json(); const c2 = r.results?.find((x) => x.criterionId === "c2");
  console.log(`${name}: c2 ${c2?.status} ${c2?.awarded}/2; board: ${c2?.boardObservation}; fix: ${c2?.fix}`); return c2;
};
const wrong = await run("BOARD WRONG", ["A = (5 x 8) / 2", "A = 40 / 2 = 10 units squared"]);
const right = await run("BOARD RIGHT", ["A = (5 x 8) / 2", "A = 40 / 2 = 20 units squared"]);
await browser.close();
const ok = wrong?.awarded < 2 && right?.awarded === 2;
console.log(ok ? "PASS" : "FAIL"); process.exit(ok ? 0 : 1);
