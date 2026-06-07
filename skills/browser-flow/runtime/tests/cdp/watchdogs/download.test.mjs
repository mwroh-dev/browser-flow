import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installDownloadWatchdog } from "../../../scripts/cdp/watchdogs/download.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("download watchdog routes file to configured directory", async () => {
  const fixture = await startFixtureServer();
  const downloadDir = mkdtempSync(join(tmpdir(), "dl-"));
  const profileDir = mkdtempSync(join(tmpdir(), "dl-prof-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const dl = await installDownloadWatchdog(session, { downloadDir });
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    // Navigate to the download fixture — this triggers a file download rather than
    // a full page load, so we issue the CDP navigate and then wait for the file.
    await session.client.send("Page.navigate", { url: `${fixture.baseUrl}/download-fixture` }, sid);
    // Wait for the download to complete (the file arrives within ~2 s in headless mode)
    await new Promise((r) => setTimeout(r, 3000));
    const files = readdirSync(downloadDir);
    assert.ok(files.length >= 1, "expected at least one downloaded file");
    assert.ok(dl.listDownloads().length >= 1, "expected listDownloads() to return at least one entry");
  } finally {
    await dl.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
    rmSync(downloadDir, { recursive: true, force: true });
  }
});
