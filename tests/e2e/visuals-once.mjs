// T54: a picture for the same gap is requested once, however many times the report is rebuilt. /api/generate-visual is stubbed
// (counts calls, returns a tiny image); marking is real. Typed lines only, no avatar.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const calls = [];
await page.route("**/api/generate-visual", async (route) => {
  calls.push(JSON.parse(route.request().postData() || "{}").concept);
  await route.fulfill({ json: { kind: "image", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", model: "fal-ai/nano-banana-pro", prompt: "x" } });
});
await page.goto(process.env.BASE_URL || "http://localhost:3000", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.resolve(here, "../../fixtures/Quadratic_Equations_GCSE_AQA_Notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 90000 });
const box = page.getByPlaceholder(/type part of your explanation/i);
const say = async (t) => { await box.fill(t); await box.press("Enter"); await page.waitForTimeout(500); };
const check = async () => {
  const back = page.getByRole("button", { name: /back to teaching/i });
  if (await back.count()) await back.first().click();
  await page.getByRole("button", { name: /check my progress/i }).first().click();
  await page.waitForTimeout(45000);
};
await say("To solve a quadratic you always use the formula, and the discriminant is just b plus c.");
await check();
const first = calls.length;
await say("Also factorising means finding two numbers that multiply to c.");
await check();
await check();
console.log(`visual requests after 1st check: ${first}; after 3 checks: ${calls.length}; concepts: ${calls.join(" | ")}`);
await browser.close();
const dup = new Set(calls).size !== calls.length;
console.log(dup ? "FAIL: the same point was drawn more than once" : "PASS: every point drawn once");
process.exit(dup ? 1 : 0);
