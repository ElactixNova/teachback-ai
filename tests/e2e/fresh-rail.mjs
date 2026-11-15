// Headless check for T30: the rail is brought up to date on demand, and the board alone is enough to mark.
// Needs no API keys and costs nothing: the server routes are mocked.
//
//   npm run dev                                  # in the repo root
//   cd tests/e2e && npm install && npm run fresh-rail
//
// WorkspaceActions.refreshRail() is what the avatar's get_rail_status tool and its "stopped writing"
// note call before they read the rail (dev builds expose the actions as window.__feynmanActions).
// Env: BASE_URL (default http://localhost:3000), CHROMIUM_PATH, HEADED=1.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const scheme = {
  topic: "Photosynthesis",
  sourceFile: "photosynthesis-notes.pdf",
  pages: "p. 1",
  totalMarks: 4,
  criteria: [
    { id: "c1", title: "The overall equation", expected: ["carbon dioxide and water go in", "glucose and oxygen come out"], marks: 2, source: { page: 1 }, probe: "Can you write the equation?", ask: "write" },
    { id: "c2", title: "Where it happens", expected: ["in the leaves", "in chloroplasts"], marks: 2, source: { page: 1 } },
  ],
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: !process.env.HEADED });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.route("**/api/parse-pdf", (r) => r.fulfill({ json: { title: "photosynthesis-notes", text: "[Page 1] Photosynthesis.", pageCount: 1 } }));
await page.route("**/api/mark-scheme", (r) => r.fulfill({ json: scheme }));
/** Every live-marking request the page makes. The fake examiner reports what it was sent. */
const calls = [];
await page.route("**/api/analyze", async (r) => {
  const body = r.request().postDataJSON();
  calls.push(body);
  await new Promise((done) => setTimeout(done, 300));
  const spoke = body.transcript.some((l) => l.speaker === "student");
  r.fulfill({
    json: {
      results: [
        { criterionId: "c1", status: body.whiteboardBase64 ? "partial" : "not_covered", awarded: body.whiteboardBase64 ? 1 : 0, missingSteps: [], attempts: 0, parked: false, ...(body.whiteboardBase64 ? { boardObservation: "6CO2 + 6H2O is written" } : {}) },
        { criterionId: "c2", status: spoke ? "full" : "not_covered", awarded: spoke ? 2 : 0, missingSteps: [], attempts: 0, parked: false },
      ],
    },
  });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, "photosynthesis-notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 30000 });
await page.waitForFunction(() => !!window.__feynmanActions?.refreshRail);

const refresh = () =>
  page.evaluate(async () => {
    const t0 = performance.now();
    await window.__feynmanActions.refreshRail();
    return Math.round(performance.now() - t0);
  });
const rail = () => page.evaluate(() => window.__feynmanActions.getRail().results.map((r) => ({ id: r.criterionId, status: r.status, awarded: r.awarded, board: r.boardObservation ?? null })));

// 1. Nothing said, nothing drawn: nothing to mark, no model call.
const idle = await refresh();
check("nothing new: refresh returns at once without a marking call", calls.length === 0 && idle < 200, `${idle} ms, ${calls.length} calls`);

// 2. The student writes on the board and says nothing: that alone is marked, straight away.
const canvas = await page.locator('canvas[aria-label="Whiteboard drawing area"]').boundingBox();
await page.mouse.move(canvas.x + 80, canvas.y + 160);
await page.mouse.down();
await page.mouse.move(canvas.x + 320, canvas.y + 190, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150); // the stroke reaches the workspace state on the next render
const drawn = await refresh();
let now = await rail();
check("board only: one marking call, made now (not after the 20 s debounce)", calls.length === 1 && !!calls[0].whiteboardBase64 && calls[0].mode === "live" && drawn < 3000, `${drawn} ms, ${calls.length} calls`);
check("the rail has what the examiner saw on the board when refresh resolves", now[0].board === "6CO2 + 6H2O is written" && now[0].awarded === 1, JSON.stringify(now[0]));

// 3. Asking again with nothing new costs nothing.
await refresh();
check("unchanged since the last result: no second call", calls.length === 1);

// 4. The student says something: the next refresh marks it before anyone reads the rail.
const box = page.getByPlaceholder(/type part of your explanation/i);
await box.fill("It happens in the chloroplasts in the leaves.");
await box.press("Enter");
await page.waitForTimeout(150);
await refresh();
now = await rail();
check("a new line is marked on refresh, so a step just made no longer looks missing", calls.length === 2 && calls[1].transcript.some((l) => l.speaker === "student" && /chloroplasts/.test(l.text)) && now[1].status === "full", JSON.stringify(now[1]));

// 5. The background loop does not mark the same state again afterwards.
await page.waitForTimeout(3500);
check("no duplicate run from the background loop after a refresh", calls.length === 2, `${calls.length} calls`);

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
