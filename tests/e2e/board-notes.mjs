// Headless check for Sam's handwriting on the whiteboard (T20, T22). Needs no API keys and costs nothing.
//
//   npm run dev                                  # in the repo root
//   cd tests/e2e && npm install && npm run board-notes
//
// Draws strokes, has "Sam" write questions through the same WorkspaceActions the avatar's write_on_board
// tool and speech stream call (dev builds expose them as window.__feynmanActions), then checks: the
// writing appears progressively as fake speech chunks arrive and finishes when the turn ends; it lands
// inside the visible board, clear of the ink and of other notes; one question is written at a time; a
// note waits while the pen is down; the examiner PNG holds the finished writing even mid-animation;
// a full board scrolls to the note; Clear leaves the notes; reduced motion shows it at once.
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

async function open(options = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options })).newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const canvas = page.locator('canvas[aria-label="Whiteboard drawing area"]');
  await canvas.waitFor();
  await page.waitForFunction(() => !!window.__feynmanActions);
  await page.evaluate(() => document.fonts.ready);
  return { page, box: await canvas.boundingBox() };
}

const { page, box } = await open();

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
const speak = (chars, done = false) => page.evaluate(([c, d]) => window.__feynmanActions.speechProgress(c, d), [chars, done]);
const notes = (p = page) =>
  p.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Whiteboard drawing area"]').getBoundingClientRect();
    return [...document.querySelectorAll("[data-sam-note]")].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, writing: e.dataset.writing === "true", label: e.getAttribute("aria-label") };
    });
  });
/** Pixels of Sam's ink on its own canvas layer. */
const samInk = (p = page) =>
  p.evaluate(() => {
    const c = document.querySelector("canvas[data-sam-layer]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  });
const allWritten = async (timeout = 10000) => page.waitForFunction(() => [...document.querySelectorAll("[data-sam-note]")].every((e) => e.dataset.writing === "false"), null, { timeout }).then(() => true, () => false);
/** Indigo and dark pixels in the PNG the examiner gets. */
const exported = () =>
  page.evaluate(async () => {
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
      if (Math.abs(d[i] - 0x4f) < 30 && Math.abs(d[i + 1] - 0x46) < 30 && Math.abs(d[i + 2] - 0xe5) < 30) indigo++;
      if (d[i] < 40 && d[i + 1] < 50 && d[i + 2] < 60) dark++;
    }
    return { indigo, dark };
  });
const near = (a, b, m) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
// Notes stay out of the tool dock (top 64px) and the zoom / check controls (bottom 88px).
const visible = (c) => c.x >= 0 && c.y >= 64 && c.x + c.w <= box.width && c.y + c.h <= box.height - 88;

// 1. The pen follows Sam's voice.
const ink = [
  await draw([[40, 90], [300, 110], [520, 130]]),
  await draw([[60, 180], [130, 220], [200, 280]]),
  await draw([[300, 300], [450, 330], [600, 310]]),
];
await page.waitForTimeout(1300);
const first = await write({ content: "Solve x^2 + 5x + 6 = 0", kind: "math" });
const reserved = (await notes())[0];
const second = await write({ content: "\\frac{1}{x} + \\sqrt{x^{2}+1} = 3", kind: "math", label: "Question 2" });
check("first question starts being written at once; a second one waits its turn", first.status === "written" && second.status === "queued" && (await notes()).length === 1 && reserved.writing);
const samples = [await samInk()];
for (let i = 0; i < 5; i++) {
  await speak(8); // "x squared plus five x..." arriving a few words at a time
  await page.waitForTimeout(260);
  samples.push(await samInk());
}
await page.screenshot({ path: path.join(outDir, "board-notes-writing.png") });
const midway = (await notes())[0];
check("the writing appears progressively as speech arrives", samples.every((n, i) => i === 0 || n >= samples[i - 1]) && samples[samples.length - 1] > samples[0] && samples[1] < samples[samples.length - 1], samples.join(" < "));
check("still writing mid-sentence, in the space reserved at the start", midway.writing && midway.x === reserved.x && midway.y === reserved.y && midway.w === reserved.w && midway.h === reserved.h);
await speak(4, true); // Sam's turn ends (or is interrupted)
await page.waitForTimeout(700);
const finished = (await notes())[0];
const full = await samInk();
check("finishes quickly when Sam stops, never left half-written", !finished.writing && full >= samples[samples.length - 1], `${full} px`);

// 2. The queued question is written next, by the timer alone (no speech text at all).
check("the queued question is written after the first, without any speech text", (await allWritten()) && (await notes()).length === 2);
let placed = await notes();
check("notes are inside the visible board", placed.every(visible), JSON.stringify(placed.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h)])));
check("notes keep 24px from every stroke", placed.every((c) => ink.every((s) => !near(c, s, 20))));
check("notes keep 24px from each other", !near(placed[0], placed[1], 23));
check("screen readers get the question in words", placed[0].label === "Sam wrote: Solve x^2 + 5x + 6 = 0" && placed[1].label === "Sam · Question 2 wrote: (1)/(x) + √(x^2+1) = 3", placed[1].label);

// 3. Pen down: queued, written one quiet second after the pen lifts.
ink.push(await draw([[420, 420], [470, 470], [520, 440]], true));
const queued = await write({ content: "Explain why both roots are negative", kind: "text" });
check("queued while the pen is down", queued.status === "queued" && (await notes()).length === 2);
await page.mouse.up();
await page.waitForTimeout(500);
check("still waiting half a second after the pen lifts", (await notes()).length === 2);
await page.waitForTimeout(900);
placed = await notes();
check("written once the student pauses", placed.length === 3 && visible(placed[2]) && ink.every((s) => !near(placed[2], s, 20)));

// 4. The examiner PNG holds the finished question even while the pen is mid-word.
const during = await exported();
const stillWriting = (await notes())[2].writing;
await allWritten();
const after = await exported();
check("exported PNG has the student's ink and Sam's indigo writing", !!after && after.indigo > 300 && after.dark > 50, JSON.stringify(after));
check("an export taken mid-writing already shows the finished text", stillWriting && !!during && during.indigo === after.indigo, `${during?.indigo} vs ${after?.indigo}`);
await page.screenshot({ path: path.join(outDir, "board-notes.png") });

// 5. Clear and Undo only touch the student's strokes.
await page.getByRole("button", { name: "Clear board" }).click();
check("Clear leaves Sam's notes", (await notes()).length === 3 && (await samInk()) > 0);
await page.getByRole("button", { name: "Undo", exact: true }).first().click();

// 6. A board with no free space: the note goes below the work and the board scrolls to it.
await draw([[10, 70], [box.width - 10, box.height - 100]]);
await page.waitForTimeout(1300);
const beyond = await write({ content: "y = mx + c", kind: "math" });
await page.waitForTimeout(700);
placed = await notes();
check("full board: note placed beyond the ink and scrolled into view", beyond.status === "written" && /below/.test(beyond.where) && visible(placed[placed.length - 1]), beyond.where);

// 7. A note can be removed.
await allWritten();
await page.locator("[data-sam-note] button").first().click();
check("x removes a note", (await notes()).length === placed.length - 1);

// 8. Reduced motion: no animation, the question is simply there.
const calm = await open({ reducedMotion: "reduce" });
await calm.page.mouse.move(calm.box.x + 60, calm.box.y + 120);
await calm.page.mouse.down();
await calm.page.mouse.move(calm.box.x + 260, calm.box.y + 140, { steps: 4 });
await calm.page.mouse.up();
await calm.page.waitForTimeout(1300);
await calm.page.evaluate(() => window.__feynmanActions.writeOnBoard({ content: "x^2 = 49", kind: "math" }));
const instant = await notes(calm.page);
check("prefers-reduced-motion: written at once", instant.length === 1 && !instant[0].writing && (await samInk(calm.page)) > 100);

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
