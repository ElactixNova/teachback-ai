// Renders the demo fixtures with headless Chromium (playwright-core from tests/e2e).
//   cd tests/e2e && npm install && node ../../fixtures/render-fixtures.mjs
// Output: fixtures/photosynthesis-notes.pdf, fixtures/whiteboard-sample.png
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../tests/e2e/package.json"));
const { chromium } = require("playwright-core");
const { chromiumPath } = require("./chromium-path.cjs");

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const page = await browser.newPage();

// 1. Lecture notes PDF (clean, text-based so unpdf extracts it).
await page.goto(pathToFileURL(path.join(here, "photosynthesis-notes.html")).href);
await page.pdf({ path: path.join(here, "photosynthesis-notes.pdf"), format: "A4", printBackground: true });

// 2. Whiteboard sample: what a student sketches while teaching (contains the "roots" misconception).
await page.setViewportSize({ width: 1000, height: 620 });
await page.setContent(`<canvas id="c" width="1000" height="620"></canvas>`);
await page.evaluate(() => {
  const c = document.getElementById("c");
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.lineCap = "round"; x.lineJoin = "round";
  const ink = (color, w) => { x.strokeStyle = color; x.fillStyle = color; x.lineWidth = w; };
  const text = (t, px, py, size = 30) => { x.font = `${size}px "Segoe Print", "Comic Sans MS", cursive`; x.fillText(t, px, py); };
  const arrow = (x1, y1, x2, y2) => {
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    x.beginPath(); x.moveTo(x2, y2); x.lineTo(x2 - 16 * Math.cos(a - 0.5), y2 - 16 * Math.sin(a - 0.5));
    x.moveTo(x2, y2); x.lineTo(x2 - 16 * Math.cos(a + 0.5), y2 - 16 * Math.sin(a + 0.5)); x.stroke();
  };
  // Sun
  ink("#e0a000", 4); x.beginPath(); x.arc(110, 100, 45, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; x.beginPath(); x.moveTo(110 + 58 * Math.cos(a), 100 + 58 * Math.sin(a)); x.lineTo(110 + 78 * Math.cos(a), 100 + 78 * Math.sin(a)); x.stroke(); }
  // Plant: stem, leaves, ground, roots
  ink("#2f7d32", 6);
  x.beginPath(); x.moveTo(500, 470); x.lineTo(500, 200); x.stroke();
  x.beginPath(); x.ellipse(440, 260, 60, 24, -0.5, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.ellipse(560, 230, 60, 24, 0.5, 0, Math.PI * 2); x.stroke();
  ink("#78716c", 4); x.beginPath(); x.moveTo(300, 470); x.lineTo(700, 470); x.stroke();
  ink("#8d5a2b", 5);
  for (const [dx, dy] of [[-70, 70], [0, 95], [70, 70], [-35, 110], [40, 115]]) { x.beginPath(); x.moveTo(500, 470); x.quadraticCurveTo(500 + dx / 2, 500, 500 + dx, 470 + dy); x.stroke(); }
  // Sunlight going down the stem to the roots (the misconception)
  ink("#e0a000", 4); arrow(170, 140, 470, 300); arrow(500, 320, 500, 520);
  ink("#1c1917", 2); text("light", 260, 200);
  // Equation and labels
  ink("#1d4ed8", 2); text("CO2 + H2O  ->  glucose", 560, 90, 30);
  ink("#b91c1c", 2); text("glucose made", 600, 540, 30); text("in the ROOTS", 600, 580, 30);
  ink("#b91c1c", 3); arrow(595, 545, 540, 545);
  ink("#1c1917", 2); text("O2 taken in", 600, 330, 28); arrow(595, 320, 560, 260);
});
await page.locator("#c").screenshot({ path: path.join(here, "whiteboard-sample.png") });

await browser.close();
console.log("wrote fixtures/photosynthesis-notes.pdf and fixtures/whiteboard-sample.png");
