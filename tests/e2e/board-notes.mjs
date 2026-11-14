// Headless check for Sam's notes on the whiteboard (T20). Needs no API keys and costs nothing.
//
//   npm run dev                                  # in the repo root
//   cd tests/e2e && npm install && npm run board-notes
//
// Draws strokes, has "Sam" write questions through the same WorkspaceActions.writeOnBoard the avatar's
// write_on_board tool calls (dev builds expose it as window.__feynmanActions), then checks: cards land
// inside the visible board, clear of the ink and of each other; a note waits while the pen is down;
// the exported examiner PNG contains the cards; a full board scrolls to the note; Clear leaves the cards.
// Env: BASE_URL (default http://localhost:3000), CHROMIUM_PATH, HEADED=1.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const BASE = process.env.BASE_URL || "http://localhost:3000";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: !process.env.HEADED });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
const canvas = page.locator('canvas[aria-label="Whiteboard drawing area"]');
await canvas.waitFor();
await page.waitForFunction(() => !!window.__feynmanActions);
const box = await canvas.boundingBox();

/** Draws a polyline in canvas coordinates; with hold=true the pen stays down. Returns its bounding box. */
async function draw(points, hold = false) {
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  if (!hold) await page.mouse.up();
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const write = (note) => page.evaluate((n) => window.__feynmanActions.writeOnBoard(n), note);
const cards = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Whiteboard drawing area"]').getBoundingClientRect();
    return [...document.querySelectorAll("[data-sam-note]")].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, text: e.innerText };
    });
  });
const near = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
// Notes stay out of the tool dock (top 64px) and the zoom / check controls (bottom 88px).
const visible = (c) => c.x >= 0 && c.y >= 64 && c.x + c.w <= box.width && c.y + c.h <= box.height - 88;

// 1. Free space next to ink.
const ink = [
  await draw([[40, 90], [300, 110], [520, 130]]),
  await draw([[60, 180], [130, 220], [200, 280]]),
  await draw([[300, 300], [450, 330], [600, 310]]),
];
await page.waitForTimeout(1300);
const first = await write({ content: "x^2 + 5x + 6 = 0", kind: "math" });
const second = await write({ content: "\\frac{1}{x} + \\sqrt{x^{2}+1} = 3", kind: "math", label: "Question 2" });
let placed = await cards();
check("two notes written", first.status === "written" && second.status === "written" && placed.length === 2, `${first.where}; ${second.where}`);
check("notes are inside the visible board", placed.every(visible), JSON.stringify(placed.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h)])));
check("notes keep 24px from every stroke", placed.every((c) => ink.every((s) => !near(c, s, 20))));
check("notes keep 24px from each other", !near(placed[0], placed[1], 23));
check("LaTeX is shown as readable text", placed[1].text.includes("(1)/(x) + √(x^2+1) = 3") && /SAM · QUESTION 2/i.test(placed[1].text), placed[1].text.replace(/\n/g, " | "));

// 2. Pen down: queued, written one quiet second after the pen lifts.
ink.push(await draw([[420, 420], [470, 470], [520, 440]], true));
const queued = await write({ content: "Explain why both roots are negative", kind: "text" });
check("queued while the pen is down", queued.status === "queued" && (await cards()).length === 2);
await page.mouse.up();
await page.waitForTimeout(500);
check("still waiting half a second after the pen lifts", (await cards()).length === 2);
await page.waitForTimeout(900);
placed = await cards();
check("written once the student pauses", placed.length === 3 && visible(placed[2]) && ink.every((s) => !near(placed[2], s, 20)));
await page.screenshot({ path: path.join(outDir, "board-notes.png") });

// 3. The examiner PNG contains the indigo cards as well as the student's ink.
const png = await page.evaluate(async () => {
  const snap = window.__feynmanActions.captureWhiteboard();
  if (!snap) return null;
  const img = new Image();
  img.src = `data:image/png;base64,${snap.pngBase64}`;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let indigo = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 0x4f) < 14 && Math.abs(d[i + 1] - 0x46) < 14 && Math.abs(d[i + 2] - 0xe5) < 14) indigo++;
    if (d[i] < 40 && d[i + 1] < 50 && d[i + 2] < 60) dark++;
  }
  return { indigo, dark };
});
check("exported PNG has the student's ink and Sam's indigo cards", !!png && png.indigo > 300 && png.dark > 50, JSON.stringify(png));

// 4. Clear and Undo only touch the student's strokes.
await page.getByRole("button", { name: "Clear board" }).click();
check("Clear leaves Sam's notes", (await cards()).length === 3);
await page.getByRole("button", { name: "Undo", exact: true }).first().click();

// 5. A board with no free space: the note goes below the work and the board scrolls to it.
await draw([[10, 70], [box.width - 10, box.height - 100]]);
await page.waitForTimeout(1300);
const beyond = await write({ content: "y = mx + c", kind: "math" });
await page.waitForTimeout(700);
placed = await cards();
check("full board: note placed beyond the ink and scrolled into view", beyond.status === "written" && /below/.test(beyond.where) && visible(placed[placed.length - 1]), beyond.where);

// 6. A card can be removed.
await page.locator("[data-sam-note] button").first().click();
check("x removes a note", (await cards()).length === placed.length - 1);

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
