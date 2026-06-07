/**
 * proxy-auth watchdog tests.
 *
 * Test approach: mock session (EventEmitter-based, no real Chrome).
 *
 * Rationale: a full e2e proxy test requires Chrome to connect through
 * a loopback proxy and navigate to an external URL. On macOS headless,
 * Chrome bypasses loopback proxies by default, and enabling
 * --proxy-bypass-list=<-loopback> still requires the proxy to implement
 * full HTTP CONNECT / forwarding logic.  The proxy-server.mjs stub only
 * checks the Proxy-Authorization header — it does not forward traffic —
 * so navigation would stall at the TCP layer.
 *
 * The load-bearing contract of the watchdog is:
 *   1. Fetch.enable({ handleAuthRequests: true }) is called on every page session
 *   2. Fetch.authRequired → Fetch.continueWithAuth(ProvideCredentials, username, password)
 *   3. Fetch.requestPaused → Fetch.continueRequest(requestId)
 *   4. dispose() removes all listeners (no further sends)
 *
 * A mock session lets us verify all four contracts deterministically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installProxyAuthWatchdog } from "../../../scripts/cdp/watchdogs/proxy-auth.mjs";
import { startAuthProxy } from "../../../scripts/fixtures/proxy-server.mjs";

// ---------------------------------------------------------------------------
// Mock session factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal BrowserSession mock backed by an EventEmitter.
 * The mock client records every client.send() call for later assertion.
 *
 * @param {{ targetId: string, sessionId: string }[]} initialTargets
 * @returns {{ session: import("../../../scripts/cdp/browser-session.mjs").BrowserSession, sends: Array<{method: string, params: unknown, sessionId: string|undefined}>, emitClientEvent: (event: string, params: unknown, sessionId?: string) => void, attachTarget: (targetId: string, sessionId: string) => void }}
 */
function makeMockSession(initialTargets = [{ targetId: "t1", sessionId: "s1" }]) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  /** @type {Array<{method: string, params: unknown, sessionId: string|undefined}>} */
  const sends = [];

  /** @type {import("../../../scripts/cdp/browser-session.mjs").BrowserSession["client"]} */
  const client = {
    send(method, params, sessionId) {
      sends.push({ method, params, sessionId });
      return Promise.resolve(/** @type {any} */ ({}));
    },
    on(event, handler) {
      emitter.on(event, handler);
      return () => emitter.removeListener(event, handler);
    },
    async close() {
      emitter.removeAllListeners();
    }
  };

  // Minimal SessionManager
  /** @type {Set<(info: any, sessionId: string) => void>} */
  const attachedHandlers = new Set();
  /** @type {Map<string, { targetId: string, type: string, url: string, title: string }>} */
  const targetMap = new Map(
    initialTargets.map((t) => [
      t.targetId,
      { targetId: t.targetId, type: "page", url: "about:blank", title: "" }
    ])
  );
  /** @type {Map<string, string>} */
  const sidMap = new Map(initialTargets.map((t) => [t.targetId, t.sessionId]));

  /** @type {import("../../../scripts/cdp/browser-session.mjs").BrowserSession["sessionManager"]} */
  const sessionManager = {
    listPageTargets() {
      return Array.from(targetMap.values());
    },
    getSessionId(targetId) {
      return sidMap.get(targetId);
    },
    onPageAttached(handler) {
      attachedHandlers.add(handler);
      return () => attachedHandlers.delete(handler);
    },
    onTargetDetached(_handler) {
      return () => {};
    },
    async dispose() {
      attachedHandlers.clear();
      targetMap.clear();
      sidMap.clear();
    }
  };

  const session = /** @type {any} */ ({
    client,
    sessionManager,
    chromeProcess: new EventEmitter(),
    async dispose() {
      await sessionManager.dispose();
      await client.close();
    }
  });

  /**
   * @param {string} event
   * @param {unknown} params
   * @param {string} [sessionId]
   */
  function emitClientEvent(event, params, sessionId) {
    emitter.emit(event, params, sessionId);
  }

  // Helper to simulate a new page attaching
  /**
   * @param {string} targetId
   * @param {string} sessionId
   */
  function attachTarget(targetId, sessionId) {
    const info = { targetId, type: "page", url: "about:blank", title: "" };
    targetMap.set(targetId, info);
    sidMap.set(targetId, sessionId);
    for (const h of attachedHandlers) h(info, sessionId);
  }

  return { session, sends, emitClientEvent, attachTarget };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("proxy-auth watchdog: Fetch.enable called for existing page sessions on install", async () => {
  const { session, sends } = makeMockSession([
    { targetId: "t1", sessionId: "s1" },
    { targetId: "t2", sessionId: "s2" }
  ]);

  const watchdog = await installProxyAuthWatchdog(session, { username: "u", password: "p" });

  const enableCalls = sends.filter((s) => s.method === "Fetch.enable");
  assert.equal(enableCalls.length, 2, "Fetch.enable should be called once per existing session");
  assert.deepEqual(
    enableCalls.map((c) => c.params),
    [{ handleAuthRequests: true }, { handleAuthRequests: true }]
  );
  assert.deepEqual(
    new Set(enableCalls.map((c) => c.sessionId)),
    new Set(["s1", "s2"])
  );

  await watchdog.dispose();
  await session.dispose();
});

test("proxy-auth watchdog: Fetch.enable called for newly attached page sessions", async () => {
  const { session, sends, attachTarget } = makeMockSession([]);

  const watchdog = await installProxyAuthWatchdog(session, { username: "u", password: "p" });

  // Simulate a new page attaching after the watchdog is installed
  attachTarget("t-new", "s-new");
  // Allow the async enableFor to flush
  await new Promise((r) => setTimeout(r, 10));

  const enableCalls = sends.filter((s) => s.method === "Fetch.enable");
  assert.equal(enableCalls.length, 1, "Fetch.enable should be called for the newly attached session");
  assert.equal(enableCalls[0].sessionId, "s-new");

  await watchdog.dispose();
  await session.dispose();
});

test("proxy-auth watchdog: Fetch.authRequired → Fetch.continueWithAuth with credentials", async () => {
  const { session, sends, emitClientEvent } = makeMockSession();

  const watchdog = await installProxyAuthWatchdog(session, { username: "alice", password: "secret" });

  // Simulate Chrome emitting a Fetch.authRequired event
  emitClientEvent(
    "Fetch.authRequired",
    { requestId: "req-42", authChallenge: { scheme: "Basic", realm: "test" } },
    "s1"
  );

  // Allow async sends to flush
  await new Promise((r) => setTimeout(r, 10));

  const authCalls = sends.filter((s) => s.method === "Fetch.continueWithAuth");
  assert.equal(authCalls.length, 1, "Fetch.continueWithAuth should be called once");

  const call = authCalls[0];
  assert.deepEqual(call.params, {
    requestId: "req-42",
    authChallengeResponse: {
      response: "ProvideCredentials",
      username: "alice",
      password: "secret"
    }
  });
  assert.equal(call.sessionId, "s1", "continueWithAuth should use the sessionId from the event");

  await watchdog.dispose();
  await session.dispose();
});

test("proxy-auth watchdog: Fetch.requestPaused → Fetch.continueRequest (pass-through)", async () => {
  const { session, sends, emitClientEvent } = makeMockSession();

  const watchdog = await installProxyAuthWatchdog(session, { username: "u", password: "p" });

  emitClientEvent(
    "Fetch.requestPaused",
    { requestId: "req-99", resourceType: "Document", request: { url: "http://example.com/" } },
    "s1"
  );

  await new Promise((r) => setTimeout(r, 10));

  const continueCalls = sends.filter((s) => s.method === "Fetch.continueRequest");
  assert.equal(continueCalls.length, 1, "Fetch.continueRequest should be called once");
  assert.deepEqual(continueCalls[0].params, { requestId: "req-99" });

  await watchdog.dispose();
  await session.dispose();
});

test("proxy-auth watchdog: dispose() removes all listeners (no further sends)", async () => {
  const { session, sends, emitClientEvent } = makeMockSession();

  const watchdog = await installProxyAuthWatchdog(session, { username: "u", password: "p" });
  const sendsBeforeDispose = sends.length;

  await watchdog.dispose();

  // Emit events after dispose — they should be ignored
  emitClientEvent("Fetch.authRequired", { requestId: "req-after-dispose" }, "s1");
  emitClientEvent("Fetch.requestPaused", { requestId: "req-paused-after-dispose" }, "s1");

  await new Promise((r) => setTimeout(r, 10));

  assert.equal(
    sends.length,
    sendsBeforeDispose,
    "No sends should occur after dispose()"
  );

  await session.dispose();
});

test("proxy-auth watchdog: startAuthProxy fixture starts and stops cleanly", async () => {
  const proxy = await startAuthProxy({ username: "testuser", password: "testpass" });
  assert.ok(proxy.port > 0, "proxy port should be positive");
  assert.ok(typeof proxy.stop === "function", "proxy should have a stop function");
  await proxy.stop();
});
