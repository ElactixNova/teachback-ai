// A scripted teaching session with the real avatar, to read Sam's behaviour off a transcript (T32).
// Plays typed student lines (and board strokes) at Sam, then prints the conversation and flags the
// habits Ali's 15 Nov session showed: praise for answers Sam cannot judge, two asks in one turn, the
// same point asked again, a bare "Got it" after a board task, and the results offered too early.
//
//   npm run dev                                   # repo root, real ANAM / ANTHROPIC keys in .env
//   cd tests/e2e && npm install && npm run dialogue
//
// Env: BASE_URL (default http://localhost:3000), PDF (fixture name), CHROMIUM_PATH, HEADED=1.
// One Anam session plus mark scheme and live marking calls: costs a little per run. The avatar's LLM
// is not deterministic, so read the flags as a report, not as a pass/fail gate (exit code 1 = flags).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3000";

/** What the student does, in order. "<board>" writes on the board and then says "Done." */
const STUDENT = [
  "Photosynthesis is how plants make their own food using light.",
  "<board>",
  "I don't know.",
  "It happens in the roots, where the water comes in.",
  "In what part of the plant, do you mean?",
  "<board>",
  "I've already done that.",
  "The plant uses the glucose for energy and stores the rest as starch.",
];

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: !process.env.HEADED,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.resolve(here, "../../fixtures", process.env.PDF || "photosynthesis-notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 90000 });
await page.getByRole("button", { name: /start session/i }).click();
await page.getByText("LIVE", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(7000);

const box = page.getByPlaceholder(/type part of your explanation/i);
const board = await page.getByLabel("Whiteboard drawing area").boundingBox();
const samLines = () => page.evaluate(() => window.__feynmanActions.getRail().transcript.filter((l) => l.speaker === "avatar").length);
/** Waits until Sam has said something new and then stopped for a moment. */
async function samReplies(before) {
  for (let i = 0; i < 40 && (await samLines()) <= before; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(2500);
}
let row = 0;
for (const line of STUDENT) {
  const before = await samLines();
  if (line === "<board>") {
    for (let i = 0; i < 3; i++) {
      const y = board.y + 150 + row++ * 34;
      await page.mouse.move(board.x + 60, y);
      await page.mouse.down();
      await page.mouse.move(board.x + 380, y + 6, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(3500);
  }
  await box.fill(line === "<board>" ? "Done." : line);
  await box.press("Enter");
  await samReplies(before);
}

const lines = await page.evaluate(() => window.__feynmanActions.getRail().transcript);
await page.getByRole("button", { name: /^end$/i }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(1500);
await browser.close();

const flags = [];
const words = (s) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 5)));
const asked = [];
lines.forEach((l, i) => {
  if (l.speaker !== "avatar") return;
  const prev = lines[i - 1];
  if (/^\W*(right|correct|exactly|great|nice|good|perfect|well done|that makes sense)\b/i.test(l.text)) flags.push(`${l.t} judges the answer: "${l.text.slice(0, 60)}"`);
  if ((l.text.match(/\?/g) ?? []).length > 1) flags.push(`${l.t} two asks in one turn: "${l.text.slice(0, 90)}"`);
  if (prev?.speaker === "student" && /^done\.?$/i.test(prev.text.trim()) && l.text.split(/\s+/).length < 5) flags.push(`${l.t} bare reply after a board task: "${l.text}"`);
  if (/\b(report|results|how you did)\b/i.test(l.text) && i < lines.length - 2) flags.push(`${l.t} offers the results mid-session: "${l.text.slice(0, 80)}"`);
  const w = words(l.text.split("?")[0].split(/[.!]/).pop() ?? "");
  if (l.text.includes("?") && w.size >= 3) {
    const twin = asked.find((a) => [...w].filter((x) => a.w.has(x)).length / Math.min(w.size, a.w.size) >= 0.7);
    if (twin) flags.push(`${l.t} asks again what it asked at ${twin.t}: "${l.text.slice(0, 80)}"`);
    asked.push({ t: l.t, w });
  }
});
for (const l of lines) console.log(`${l.t} ${l.speaker === "avatar" ? "Sam" : "You"}: ${l.text}`);
console.log(`\n${flags.length} flag(s)`);
for (const f of flags) console.log(`  - ${f}`);
process.exit(flags.length ? 1 : 0);
