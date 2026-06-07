import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("lifecycle watchdog navigateAndWait resolves on networkidle", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "lc-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "networkidle" });
    const events = lc.getEventsFor(target.targetId);
    assert.ok(events.some((e) => e.name === "DOMContentLoaded"), "expected DOMContentLoaded event");
    assert.ok(events.some((e) => e.name === "load"), "expected load event");
    assert.ok(events.some((e) => e.name === "networkIdle"), "expected networkIdle event");
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
