// T48: Start session stays off until lecture notes are uploaded and the mark scheme has loaded.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { chromiumPath } = require("./chromium-path.cjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(process.env.BASE_URL || "http://localhost:3000", { waitUntil: "networkidle" });
const start = page.getByRole("button", { name: /start session/i });
const before = await start.isDisabled();
await page.locator('input[type="file"]').setInputFiles(path.resolve(here, "../../fixtures/Quadratic_Equations_GCSE_AQA_Notes.pdf"));
await page.getByLabel("Marks awarded").first().waitFor({ timeout: 90000 });
const after = await start.isDisabled();
console.log(`disabled before upload: ${before}; after the mark scheme loaded: ${after}`);
await browser.close();
if (!before || after) process.exit(1);
