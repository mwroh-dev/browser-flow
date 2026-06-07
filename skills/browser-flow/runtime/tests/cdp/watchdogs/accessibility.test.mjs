import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installAccessibilityWatchdog } from "../../../scripts/cdp/watchdogs/accessibility.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("accessibility watchdog returns role+name for elements", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "ax-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const ax = await installAccessibilityWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const nodes = await ax.getFullAxTree(target.targetId);
    assert.ok(nodes.some((n) => n.role === "button"), "expected a button node");
  } finally {
    await ax.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
