import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

/**
 * @returns {string}
 */
export function resolveChromeBinary() {
  const override = process.env.BROWSER_FLOW_CHROME_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`BROWSER_FLOW_CHROME_PATH=${override} does not exist`);
    }
    return override;
  }

  for (const candidate of SYSTEM_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }

  const playwrightCache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(playwrightCache)) {
    for (const entry of readdirSync(playwrightCache)) {
      if (entry.startsWith("chromium")) {
        const macPath = join(playwrightCache, entry, "chrome-mac/Chromium.app/Contents/MacOS/Chromium");
        if (existsSync(macPath)) return macPath;
        const linuxPath = join(playwrightCache, entry, "chrome-linux/chrome");
        if (existsSync(linuxPath)) return linuxPath;
      }
    }
  }

  throw new Error(
    "Chrome/Chromium binary not found. Set BROWSER_FLOW_CHROME_PATH or run `npx playwright install chromium`."
  );
}
