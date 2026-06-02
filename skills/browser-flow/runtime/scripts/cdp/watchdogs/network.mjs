/**
 * @typedef {Object} NetworkWatchdogOptions
 * @property {(event: object) => void} onEvent
 */

/**
 * @typedef {Object} NetworkWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").CdpSession} session
 * @param {NetworkWatchdogOptions} options
 * @returns {Promise<NetworkWatchdog>}
 */
export async function installNetworkWatchdog(session, options) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];
  // Track requestId → method so responses can inherit the correct request method
  // (HTTP/1.1 Network.responseReceived does not carry :method in requestHeaders).
  /** @type {Map<string, string>} */
  const requestMethods = new Map();

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Network.enable", {}, sessionId);
  }

  for (const target of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(target.targetId);
    if (sid) await enableFor(sid);
  }

  off.push(sessionManager.onPageAttached(async (_info, sessionId) => {
    await enableFor(sessionId).catch(() => {});
  }));

  off.push(client.on("Network.requestWillBeSent", (params) => {
    const p = /** @type {any} */ (params);
    const method = String(p.request.method ?? "GET");
    requestMethods.set(p.requestId, method);
    /** @type {object} */
    const event = {
      type: "network.request",
      timestamp: Date.now(),
      requestId: p.requestId,
      loaderId: p.loaderId,
      url: p.request.url,
      method,
      headers: p.request.headers,
      ...(p.redirectResponse !== undefined ? { redirectResponse: p.redirectResponse } : {})
    };
    options.onEvent(event);
  }));

  off.push(client.on("Network.responseReceived", (params) => {
    const p = /** @type {any} */ (params);
    // Prefer the method tracked from the request; fall back to response pseudo-header.
    const method = requestMethods.get(p.requestId) ?? p.response.requestHeaders?.[":method"] ?? "GET";
    /** @type {object} */
    const event = {
      type: "network.response",
      timestamp: Date.now(),
      requestId: p.requestId,
      loaderId: p.loaderId,
      url: p.response.url,
      status: p.response.status,
      method,
      headers: p.response.headers,
      mimeType: p.response.mimeType,
      contentDisposition: p.response.headers?.["content-disposition"] ?? p.response.headers?.["Content-Disposition"] ?? ""
    };
    options.onEvent(event);
  }));

  off.push(client.on("Network.loadingFinished", (params) => {
    const p = /** @type {any} */ (params);
    /** @type {object} */
    const event = {
      type: "network.loadingFinished",
      timestamp: Date.now(),
      requestId: p.requestId,
      encodedDataLength: p.encodedDataLength
    };
    options.onEvent(event);
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
      requestMethods.clear();
    }
  };
}
