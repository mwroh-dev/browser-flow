import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installDomWatchdog } from "../../../scripts/cdp/watchdogs/dom.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("DOM watchdog captureOuterHtml returns rendered HTML", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "dom-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const dom = await installDomWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const html = await dom.captureOuterHtml(target.targetId);
    assert.ok(html.includes("<html"), `expected <html in output, got: ${html.slice(0, 200)}`);
    assert.ok(html.length > 100, `expected length > 100, got: ${html.length}`);
  } finally {
    await dom.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
