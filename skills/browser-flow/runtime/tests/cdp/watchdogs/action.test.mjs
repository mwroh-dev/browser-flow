import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../../scripts/cdp/watchdogs/action.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("clickBySelector clicks element via Input.dispatchMouseEvent, JS fallback when coords fail", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "act-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const result = await action.clickBySelector(target.targetId, "[data-bf='launch']");
    assert.equal(result.strategy, "input.dispatchMouseEvent");
    assert.equal(result.clicked, true);
  } finally {
    await action.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("clickByBackendNodeId clicks via backendNodeId (locator-resolver chain entry)", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "act-wd-bn-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });

    // Resolve backendNodeId manually (simulates what locator-resolver returns)
    const { client, sessionManager } = session;
    const sid = sessionManager.getSessionId(target.targetId);
    const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
    const found = /** @type {any} */ (await client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "[data-bf='launch']"
    }, sid));
    const desc = /** @type {any} */ (await client.send("DOM.describeNode", { nodeId: found.nodeId }, sid));
    const backendNodeId = desc.node.backendNodeId;

    const result = await action.clickByBackendNodeId(target.targetId, backendNodeId);
    assert.equal(result.clicked, true);
    assert.equal(result.strategy, "input.dispatchMouseEvent");
  } finally {
    await action.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
