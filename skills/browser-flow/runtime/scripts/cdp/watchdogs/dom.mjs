/**
 * @typedef {Object} DomWatchdog
 * @property {(targetId: string) => Promise<string>} captureOuterHtml
 * @property {(targetId: string) => Promise<string>} currentUrl
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").CdpSession} session
 * @returns {Promise<DomWatchdog>}
 */
export async function installDomWatchdog(session) {
  const { client, sessionManager } = session;

  return {
    async captureOuterHtml(targetId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
      const html = /** @type {any} */ (await client.send("DOM.getOuterHTML", { backendNodeId: doc.root.backendNodeId }, sid));
      return html.outerHTML;
    },
    async currentUrl(targetId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const result = /** @type {any} */ (await client.send("Runtime.evaluate", { expression: "location.href" }, sid));
      return String(result.result.value);
    },
    async dispose() {}
  };
}
