/**
 * @typedef {Object} ProxyAuthWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * Installs a per-session proxy-auth watchdog that handles 407 Proxy Authentication
 * Required challenges via the CDP Fetch domain.
 *
 * For every current (and future) page session:
 *   - Calls Fetch.enable({ handleAuthRequests: true })
 *   - Listens for Fetch.authRequired → responds with Fetch.continueWithAuth (ProvideCredentials)
 *   - Listens for Fetch.requestPaused → passes through with Fetch.continueRequest
 *
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<ProxyAuthWatchdog>}
 */
export async function installProxyAuthWatchdog(session, credentials) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Fetch.enable", { handleAuthRequests: true }, sessionId);
  }

  // Enable for all existing page targets.
  for (const t of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(t.targetId);
    if (sid) await enableFor(sid);
  }

  // Enable for future page targets.
  off.push(sessionManager.onPageAttached(async (_info, sessionId) => {
    await enableFor(sessionId).catch(() => {});
  }));

  // Handle proxy auth challenges: provide credentials.
  off.push(client.on("Fetch.authRequired", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    const sid = sessionIdArg ?? p.sessionId;
    client.send("Fetch.continueWithAuth", {
      requestId: p.requestId,
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: credentials.username,
        password: credentials.password
      }
    }, sid).catch(() => {});
  }));

  // Pass through all other paused requests.
  off.push(client.on("Fetch.requestPaused", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    const sid = sessionIdArg ?? p.sessionId;
    client.send("Fetch.continueRequest", { requestId: p.requestId }, sid).catch(() => {});
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}
