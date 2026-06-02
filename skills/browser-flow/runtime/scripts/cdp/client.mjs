import CDP from "chrome-remote-interface";

/**
 * @typedef {Object} CdpConnectOptions
 * @property {string} [host]
 * @property {number} port
 * @property {string} [target] webSocketDebuggerUrl. Omit to use /json/version browser-level target.
 */

/**
 * @typedef {Object} CdpClient
 * @property {<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<T>} send
 * @property {(event: string, handler: (params: unknown, sessionId?: string) => void) => () => void} on
 * @property {() => Promise<void>} close
 */

/**
 * Fetch the browser-level WebSocket URL from /json/version.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<string>}
 */
async function fetchBrowserWsUrl(host, port) {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/json/version`);
  } catch (err) {
    throw new Error(
      `CDP: cannot reach Chrome at ${host}:${port} — is it running with --remote-debugging-port=${port}?`,
      { cause: err }
    );
  }
  const data = /** @type {{ webSocketDebuggerUrl?: string }} */ (await res.json());
  if (!data.webSocketDebuggerUrl) {
    throw new Error(
      `CDP: /json/version at ${host}:${port} did not return a webSocketDebuggerUrl`
    );
  }
  return data.webSocketDebuggerUrl;
}

/**
 * @param {CdpConnectOptions} options
 * @returns {Promise<CdpClient>}
 */
export async function connectCdpClient(options) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port;

  // When no explicit target is given, connect at browser level via /json/version.
  const target = options.target ?? (await fetchBrowserWsUrl(host, port));

  const cri = await CDP({
    host,
    port,
    target,
    local: true,
  });

  // The CRI Client type doesn't declare removeListener in its typedefs,
  // but at runtime it inherits from EventEmitter.
  const criAsEmitter = /** @type {import("node:events").EventEmitter} */ (/** @type {unknown} */ (cri));

  return {
    /** @type {<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<T>} */
    send(method, params, sessionId) {
      // CRI's send is overloaded; call the promise variant (3-arg form).
      return /** @type {any} */ (cri.send(/** @type {any} */ (method), params, /** @type {any} */ (sessionId)));
    },
    on(event, handler) {
      criAsEmitter.on(event, handler);
      return () => criAsEmitter.removeListener(event, handler);
    },
    async close() {
      criAsEmitter.removeAllListeners();
      await cri.close();
    },
  };
}
