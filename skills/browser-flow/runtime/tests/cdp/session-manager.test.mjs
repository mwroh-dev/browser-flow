import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort, waitForPort } from "../../scripts/lib/net.mjs";
import { connectCdpClient } from "../../scripts/cdp/client.mjs";
import { createSessionManager } from "../../scripts/cdp/session-manager.mjs";
import { resolveChromeBinary } from "../../scripts/cdp/chrome-binary.mjs";

/**
 * Build a minimal fake CdpClient whose .on() can be driven synchronously.
 * Returns { client, emit } where emit(event, params) drives registered handlers.
 */
function makeFakeClient() {
  /** @type {Map<string, Set<(params: unknown) => void>>} */
  const listeners = new Map();
  /** @type {Array<{ method: string; params: unknown }>} */
  const sent = [];

  /** @type {import("../../scripts/cdp/client.mjs").CdpClient} */
  const client = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
      return () => { listeners.get(event)?.delete(handler); };
    },
    send(method, params) {
      sent.push({ method, params });
      return /** @type {any} */ (Promise.resolve({}));
    },
    close() { return Promise.resolve(); }
  };

  /**
   * @param {string} event
   * @param {unknown} params
   */
  function emit(event, params) {
    for (const h of (listeners.get(event) ?? [])) h(params);
  }

  return { client, emit, sent };
}

test("listPageTargets exposes openerId from attachedToTarget", async () => {
  const { client, emit } = makeFakeClient();
  const mgr = await createSessionManager(client);

  // Emit a page target without openerId
  emit("Target.attachedToTarget", {
    sessionId: "s0",
    targetInfo: { targetId: "t0", type: "page", url: "about:blank", title: "Tab 0" }
  });

  // Emit a page target with openerId pointing to t0
  emit("Target.attachedToTarget", {
    sessionId: "s1",
    targetInfo: { targetId: "t1", type: "page", url: "about:blank", title: "Tab 1", openerId: "t0" }
  });

  const tabs = mgr.listPageTargets();
  const t1 = tabs.find((t) => t.targetId === "t1");
  const t0 = tabs.find((t) => t.targetId === "t0");
  assert.ok(t1, "t1 should be present");
  assert.ok(t0, "t0 should be present");
  assert.equal(t1.openerId, "t0", "t1 should carry openerId = t0");
  assert.equal(t0.openerId, undefined, "t0 should have openerId = undefined");

  await mgr.dispose();
});

test("SessionManager attaches to existing page target and emits targetCreated", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "session-mgr-"));
  const port = await getFreePort();
  const chrome = spawn(resolveChromeBinary(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"
  ], { stdio: "ignore" });
  try {
    await waitForPort(port, 15_000);
    const client = await connectCdpClient({ port });
    const mgr = await createSessionManager(client);

    const targets = mgr.listPageTargets();
    assert.ok(targets.length >= 1, "expected at least one page target");
    const target = targets[0];
    const sessionId = mgr.getSessionId(target.targetId);
    assert.ok(sessionId, "expected sessionId for page target");

    await client.send("Page.enable", {}, sessionId);
    const { result } = /** @type {{ result: { value: unknown } }} */ (await client.send("Runtime.evaluate", { expression: "1 + 1" }, sessionId));
    assert.equal(result.value, 2);

    await mgr.dispose();
    await client.close();
  } finally {
    chrome.kill("SIGTERM");
    await new Promise((resolve) => chrome.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
