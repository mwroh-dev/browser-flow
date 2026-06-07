import test from "node:test";
import assert from "node:assert/strict";
import { captureSessionState, injectSessionState } from "../../scripts/lib/session-state.mjs";

/**
 * @param {Record<string, unknown>} responses
 */
function fakeClient(responses) {
  /** @type {Array<{ method: string, params: unknown, sessionId: string }>} */
  const calls = [];
  return {
    calls,
    /**
     * @param {string} method
     * @param {unknown} params
     * @param {string} sessionId
     * @returns {Promise<unknown>}
     */
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return responses[method] ?? {};
    }
  };
}

test("captureSessionState reads cookies via Network.getCookies", async () => {
  const client = fakeClient({ "Network.getCookies": { cookies: [{ name: "SID", value: "v", domain: "x" }] } });
  const state = await captureSessionState(client, "sess-1");
  assert.deepEqual(state.cookies, [{ name: "SID", value: "v", domain: "x" }]);
  assert.ok(client.calls.some((c) => c.method === "Network.getCookies" && c.sessionId === "sess-1"));
});

test("injectSessionState sets cookies via Network.setCookies", async () => {
  const client = fakeClient({});
  await injectSessionState(client, "sess-1", { cookies: [{ name: "SID", value: "v", domain: "x" }] });
  const call = client.calls.find((c) => c.method === "Network.setCookies");
  assert.ok(call, "Network.setCookies call should exist");
  assert.deepEqual(/** @type {any} */ (call).params.cookies, [{ name: "SID", value: "v", domain: "x" }]);
});

test("injectSessionState no-ops on empty/missing cookies", async () => {
  const client = fakeClient({});
  await injectSessionState(client, "sess-1", { cookies: [] });
  assert.equal(client.calls.filter((c) => c.method === "Network.setCookies").length, 0);
});
