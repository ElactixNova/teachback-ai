// Feynman AI end-to-end smoke test (T6). Drives the real app in headless Chromium.
//
//   npm run dev                      # in the repo root, with ANAM_API_KEY, FAL_KEY, ANTHROPIC_API_KEY in .env
//   cd tests/e2e && npm install && npm run smoke
//
// Flow (voice mode, default): upload fixtures/photosynthesis-notes.pdf -> sketch on the whiteboard ->
// Start session (fake mic plays fixtures/student-speech.wav) -> the student asks the avatar to check
// -> the avatar calls open_gap_report -> /api/analyze -> report drawer -> /api/generate-visual -> visual.
// Typed mode (--typed, no mic/voice): typed explanation + Snap & Check button. Use --no-avatar to skip Anam.
//
// Env: BASE_URL (default http://localhost:3000), CHROMIUM_PATH, HEADED=1, TIMEOUT_S (default 150).
// Writes screenshots to tests/e2e/out/. Exit code 0 = every check passed.
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

const args = new Set(process.argv.slice(2));
const TYPED = args.has("--typed") || args.has("--no-avatar");
const AVATAR = !args.has("--no-avatar");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const TIMEOUT = Number(process.env.TIMEOUT_S || 150) * 1000;

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const log = (...a) => console.log(ts(), ...a);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ts()} ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: !process.env.HEADED,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(TYPED ? [] : [`--use-file-for-fake-audio-capture=${path.join(fixtures, "student-speech.wav")}`]),
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Record API traffic.
const api = {};
page.on("response", async (r) => {
  const p = new URL(r.url()).pathname;
  if (!p.startsWith("/api/")) return;
  (api[p] ??= []).push({ status: r.status(), at: Date.now() });
  log(`API ${r.request().method()} ${p} -> ${r.status()}`);
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const waitApi = async (p, status = 200, ms = TIMEOUT) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (api[p]?.some((x) => x.status === status)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  check("page loads", (await page.title()).length > 0, await page.title());

  // 1. Upload the lecture notes.
  await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, "photosynthesis-notes.pdf"));
  check("parse-pdf 200", await waitApi("/api/parse-pdf", 200, 30000));
  const topic = page.getByPlaceholder(/bayes/i);
  if (await topic.count()) await topic.fill("Photosynthesis");

  // 2. Sketch on the whiteboard: a plant with an arrow down to the roots.
  const board = page.getByLabel("Whiteboard drawing area");
  const b = await board.boundingBox();
  const stroke = async (pts) => {
    await page.mouse.move(b.x + pts[0][0] * b.width, b.y + pts[0][1] * b.height);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x * b.width, b.y + y * b.height, { steps: 8 });
    await page.mouse.up();
  };
  await stroke([[0.5, 0.75], [0.5, 0.3]]); // stem
  await stroke([[0.5, 0.4], [0.4, 0.33], [0.35, 0.4], [0.5, 0.4]]); // leaf
  await stroke([[0.5, 0.35], [0.6, 0.28], [0.65, 0.35], [0.5, 0.35]]); // leaf
  await stroke([[0.35, 0.75], [0.65, 0.75]]); // ground
  await stroke([[0.5, 0.75], [0.45, 0.88]]); // roots
  await stroke([[0.5, 0.75], [0.55, 0.9]]);
  await stroke([[0.15, 0.1], [0.48, 0.35], [0.5, 0.85]]); // light "travels down to the roots"
  check("whiteboard has ink", (await page.getByText(/board in use/i).count()) > 0);

  // 3. Avatar session.
  if (AVATAR) {
    await page.getByRole("button", { name: /start session/i }).click();
    check("anam-session 200", await waitApi("/api/anam-session", 200, 20000));
    const live = await page.getByText("LIVE", { exact: true }).waitFor({ timeout: 25000 }).then(() => true, () => false);
    // "LIVE" shows as soon as the stream starts; frames arrive a moment later.
    await page
      .waitForFunction(() => (document.getElementById("anam-video")?.videoWidth ?? 0) > 0, null, { timeout: 15000 })
      .catch(() => {});
    const video = await page.evaluate(() => {
      const v = document.getElementById("anam-video");
      return v ? { ready: v.readyState, w: v.videoWidth, h: v.videoHeight } : null;
    });
    check("avatar video live", live && !!video && video.ready >= 2, video ? `${video.w}x${video.h}` : "no video");
    await page.screenshot({ path: path.join(outDir, "1-live.png") });
  }

  // 4. Explain + check.
  if (TYPED) {
    const box = page.getByPlaceholder(/type part of your explanation/i);
    for (const line of [
      "Plants take in carbon dioxide and water and use light to make glucose.",
      "The sunlight travels down the stem to the roots, and the glucose is made in the roots.",
      "The plant also takes in oxygen.",
    ]) {
      await box.fill(line);
      await box.press("Enter");
      await page.waitForTimeout(AVATAR ? 4000 : 300);
    }
    await page.getByRole("button", { name: /snap & check/i }).click();
  } else {
    log("waiting for the spoken explanation and the avatar's open_gap_report tool call…");
  }

  const analyzed = await waitApi("/api/analyze", 200, TIMEOUT);
  check(`analyze 200${TYPED ? "" : " (triggered by the avatar's tool call)"}`, analyzed);
  await page.waitForTimeout(8000); // a duplicate check would show up within a few seconds
  check("exactly one analysis ran", (api["/api/analyze"]?.length ?? 0) === 1, `${api["/api/analyze"]?.length ?? 0} calls`);
  const drawer = page.getByRole("dialog", { name: /knowledge gap report/i }).or(page.getByLabel("Knowledge Gap Report"));
  const score = await page.getByRole("img", { name: /understanding score/i }).first().getAttribute("aria-label", { timeout: 20000 }).catch(() => null);
  check("report drawer shows a score", !!score, score ?? "");
  const gapText = (await drawer.first().innerText().catch(() => "")).toLowerCase();
  check("report names the roots misconception", /root/.test(gapText));

  check("generate-visual 200", await waitApi("/api/generate-visual", 200, 60000));
  const media = await page
    .locator('img[alt="Visual explainer"], [aria-label="Knowledge Gap Report"] video')
    .first()
    .waitFor({ timeout: 30000 })
    .then(() => true, () => false);
  check("visual explainer rendered", media);
  await page.waitForTimeout(AVATAR ? 12000 : 1000); // let the avatar speak the result
  await page.screenshot({ path: path.join(outDir, "2-report.png") });

  if (AVATAR) {
    const lines = await page.evaluate(() => [...document.querySelectorAll("section p.rounded-2xl")].map((p) => p.textContent));
    check("transcript has student and avatar lines", lines.length >= 3, `${lines.length} lines`);
    fs.writeFileSync(path.join(outDir, "transcript.txt"), lines.join("\n"));
  }
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("run completed", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  await page.screenshot({ path: path.join(outDir, "error.png") }).catch(() => {});
} finally {
  // End the Anam session cleanly: keys allow few concurrent sessions.
  await page.getByRole("button", { name: /^end$/i }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
