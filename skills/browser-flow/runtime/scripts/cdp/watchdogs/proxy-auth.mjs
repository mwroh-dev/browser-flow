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
  // Limit retries per requestId to prevent infinite auth loops on bad credentials.
  const MAX_AUTH_RETRIES = 3;
  /** @type {Map<string, number>} */
  const authRetryCount = new Map();

  off.push(client.on("Fetch.authRequired", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    const sid = sessionIdArg ?? p.sessionId;
    // requestIds are only unique per session — qualify the key so two tabs
    // with the same requestId cannot share a retry counter.
    const retryKey = `${sid ?? ""}:${String(p.requestId)}`;
    const retries = (authRetryCount.get(retryKey) ?? 0) + 1;
    authRetryCount.set(retryKey, retries);
    if (retries > MAX_AUTH_RETRIES) {
      authRetryCount.delete(retryKey);
      client.send("Fetch.continueWithAuth", {
        requestId: p.requestId,
        authChallengeResponse: { response: "CancelAuth" }
      }, sid).catch(() => {});
      return;
    }
    client.send("Fetch.continueWithAuth", {
      requestId: p.requestId,
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: credentials.username,
        password: credentials.password
      }
    }, sid).catch(() => {});
  }));

  // Pass through all other paused requests. A pause after a challenge means
  // auth succeeded for that request — drop its retry entry so the map only
  // holds in-flight challenge loops.
  off.push(client.on("Fetch.requestPaused", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    const sid = sessionIdArg ?? p.sessionId;
    authRetryCount.delete(`${sid ?? ""}:${String(p.requestId)}`);
    client.send("Fetch.continueRequest", { requestId: p.requestId }, sid).catch(() => {});
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
      authRetryCount.clear();
    }
  };
}
