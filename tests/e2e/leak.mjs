// Leak check: Sam must never say or show internal markup or talk about the machinery behind the session.
// Runs four scenarios in one live session and FAILS (exit 1) if any line Sam said contains a banned term.
//
//   npm run dev                                   # repo root, real ANAM / ANTHROPIC / FAL keys in .env
//   cd tests/e2e && npm install && npm run leak            # typed
//   cd tests/e2e && npm run leak -- --voice                # also plays fixtures/student-speech.wav into a fake mic
//
// Scenarios: (1) a maths question that Sam should put on the board, (2) an unfinished sentence,
// (3) the student writes on the board in silence, (4) 30 s of silence.
// Env: BASE_URL (default http://localhost:3000), PDF (fixture name), CHROMIUM_PATH, HEADED=1.
// Uses one Anam session and real API calls (mark scheme + live marking), so it costs a little per run.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fixtures");
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const VOICE = process.argv.includes("--voice");
const BASE = process.env.BASE_URL || "http://localhost:3000";
/** Anything from the prompt, the private notes or the tooling that must never reach the student. */
const BANNED = /\[|\]|bracket|script|\brail\b|mark scheme|examiner|waiting for|private/i;

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: !process.env.HEADED,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(VOICE ? [`--use-file-for-fake-audio-capture=${path.join(fixtures, "student-speech.wav")}`] : []),
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, process.env.PDF || "photosynthesis-notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 90000 });
await page.getByRole("button", { name: /start session/i }).click();
await page.getByText("LIVE", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(6000);

const box = page.getByPlaceholder(/type part of your explanation/i);
const say = async (text, waitMs) => {
  await box.fill(text);
  await box.press("Enter");
  await page.waitForTimeout(waitMs);
};
const board = page.getByLabel("Whiteboard drawing area");
const b = await board.boundingBox();
const stroke = async (pts) => {
  await page.mouse.move(b.x + pts[0][0] * b.width, b.y + pts[0][1] * b.height);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x * b.width, b.y + y * b.height, { steps: 10 });
  await page.mouse.up();
};

// 1. Maths question: Sam should write it on the board and say it in words.
await say("Before I start, set me one question that has an equation or numbers in it, and put it on the board.", 14000);
// 2. Unfinished sentence: Sam should wait, not describe that it is waiting.
await say("So the first thing that happens is, um", 10000);
// 3. Board writing in silence: private board notes must stay private.
for (let i = 0; i < 4; i++) {
  await stroke([[0.1, 0.45 + i * 0.08], [0.5, 0.45 + i * 0.08]]);
  await page.waitForTimeout(2500);
}
// 4. Silence.
await page.waitForTimeout(30000);
await page.screenshot({ path: path.join(outDir, "leak.png") });

// The raw transcript (what the examiner gets), not the chat display, so a display filter cannot hide a leak.
const lines = await page.evaluate(() => window.__feynmanActions.getRail().transcript);
await page.getByRole("button", { name: /^end$/i }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(2000);
await browser.close();

const sam = lines.filter((l) => l.speaker === "avatar");
const leaks = sam.filter((l) => BANNED.test(l.text));
for (const l of lines) console.log(`${l.t} ${l.speaker === "avatar" ? "Sam" : "You"}: ${l.text}${l.speaker === "avatar" && BANNED.test(l.text) ? "   <-- LEAK" : ""}`);
console.log(`\n${sam.length} Sam lines, ${leaks.length} leak(s)${VOICE ? " (voice mode)" : ""}`);
if (sam.length === 0) console.log("FAIL: Sam said nothing, so nothing was checked.");
process.exit(leaks.length || sam.length === 0 ? 1 : 0);
