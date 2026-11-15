// Finds a Chromium for playwright-core: $CHROMIUM_PATH, else the newest Playwright-installed
// chromium (run `npx playwright install chromium` once), else a system Chrome.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = {
    win32: path.join(process.env.LOCALAPPDATA || "", "ms-playwright"),
    darwin: path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    linux: path.join(os.homedir(), ".cache", "ms-playwright"),
  };
  const root = roots[process.platform];
  const rel = {
    win32: ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"],
    darwin: [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: ["chrome-linux64/chrome", "chrome-linux/chrome"],
  }[process.platform] || [];
  if (root && fs.existsSync(root)) {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split("-")[1] - +a.split("-")[1]);
    for (const d of dirs) for (const r of rel) { const p = path.join(root, d, r); if (fs.existsSync(p)) return p; }
  }
  const system = {
    win32: ["C:/Program Files/Google/Chrome/Application/chrome.exe"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium"],
  }[process.platform] || [];
  const found = system.find((p) => fs.existsSync(p));
  if (found) return found;
  throw new Error("No Chromium found. Run `npx playwright install chromium` or set CHROMIUM_PATH.");
}

module.exports = { chromiumPath };
