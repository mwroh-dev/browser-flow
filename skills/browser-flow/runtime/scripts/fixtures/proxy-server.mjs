import http from "node:http";

/**
 * Local HTTP proxy that requires Basic Auth.
 * Responds 407 if Proxy-Authorization header is absent, 200 "ok" if present.
 *
 * Note: this is a stub proxy, not a full forwarding proxy. It is only used
 * to verify that Chrome sends the Proxy-Authorization header (i.e. the
 * Fetch.authRequired / continueWithAuth roundtrip worked).
 *
 * @param {{ username: string, password: string }} opts
 * @returns {Promise<{ port: number, stop: () => Promise<void> }>}
 */
export function startAuthProxy(opts) {
  const server = http.createServer((req, res) => {
    const auth = req.headers["proxy-authorization"];
    if (!auth) {
      res.writeHead(407, { "proxy-authenticate": "Basic realm=\"test\"" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = /** @type {any} */ (server.address()).port;
      resolve({
        port,
        stop: () => new Promise((r) => server.close(() => r(undefined)))
      });
    });
  });
}
