// Repro: draw AFTER the avatar is live, stay silent, and dump what Sam says (private notes must never be spoken).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fixtures");
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, process.env.PDF || "photosynthesis-notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 60000 });
await page.getByRole("button", { name: /start session/i }).click();
await page.getByText("LIVE", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(6000);
const board = page.getByLabel("Whiteboard drawing area");
const b = await board.boundingBox();
const stroke = async (pts) => { await page.mouse.move(b.x + pts[0][0] * b.width, b.y + pts[0][1] * b.height); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x * b.width, b.y + y * b.height, { steps: 10 }); await page.mouse.up(); };
const box = page.getByPlaceholder(/type part of your explanation/i);
await box.fill(process.env.TEXT || "hello");
await box.press("Enter");
await page.waitForTimeout(9000);
if (process.env.TEXT2) { await box.fill(process.env.TEXT2); await box.press("Enter"); await page.waitForTimeout(12000); }
for (let i = 0; i < 4; i++) { await stroke([[0.1, 0.2 + i * 0.1], [0.5, 0.2 + i * 0.1]]); await page.waitForTimeout(2500); }
await page.waitForTimeout(30000); // quiet: Sam must say nothing about waiting
const lines = await page.evaluate(() => [...document.querySelectorAll("[aria-live=polite] p.rounded-lg")].map((p) => p.textContent));
console.log(lines.join("\n"));
await page.getByRole("button", { name: /^end$/i }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(2000);
await browser.close();
