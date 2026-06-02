/**
 * @typedef {{ cookies: Array<Record<string, unknown>> }} SessionState
 */

/**
 * Capture the authenticated session (cookies) from a live CDP session.
 * @param {{ send: (method: string, params: unknown, sessionId: string) => Promise<unknown> }} client
 * @param {string} sessionId
 * @returns {Promise<SessionState>}
 */
export async function captureSessionState(client, sessionId) {
  await client.send("Network.enable", {}, sessionId).catch(() => {});
  const result = /** @type {any} */ (await client.send("Network.getCookies", {}, sessionId));
  return { cookies: Array.isArray(result?.cookies) ? result.cookies : [] };
}

/**
 * Inject a saved session (cookies) into a fresh CDP session before navigate.
 * No-ops if cookies list is empty.
 * @param {{ send: (method: string, params: unknown, sessionId: string) => Promise<unknown> }} client
 * @param {string} sessionId
 * @param {SessionState} state
 */
export async function injectSessionState(client, sessionId, state) {
  const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
  if (cookies.length === 0) return;
  await client.send("Network.enable", {}, sessionId).catch(() => {});
  await client.send("Network.setCookies", { cookies }, sessionId);
}
