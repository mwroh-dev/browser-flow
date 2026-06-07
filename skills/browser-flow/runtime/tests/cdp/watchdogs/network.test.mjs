import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installNetworkWatchdog } from "../../../scripts/cdp/watchdogs/network.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("network watchdog records request + response with loaderId", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "net-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  /** @type {object[]} */
  const events = [];
  const watchdog = await installNetworkWatchdog(session, { onEvent: (e) => events.push(e) });
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await session.client.send("Page.navigate", { url: `${fixture.baseUrl}/synthetic` }, sid);
    await new Promise((r) => setTimeout(r, 1500));
    const requests = events.filter((e) => /** @type {any} */ (e).type === "network.request");
    const responses = events.filter((e) => /** @type {any} */ (e).type === "network.response");
    assert.ok(requests.length >= 1, "expected at least one request");
    assert.ok(responses.length >= 1, "expected at least one response");
    assert.ok(/** @type {any} */ (requests[0]).loaderId, "expected loaderId on request event");
  } finally {
    await watchdog.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
