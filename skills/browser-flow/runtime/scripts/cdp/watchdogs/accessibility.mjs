/**
 * @typedef {{ nodeId: string, backendDomNodeId?: number, role: string, name: string, value: string }} AxNode
 */

/**
 * @typedef {Object} AccessibilityWatchdog
 * @property {(targetId: string) => Promise<AxNode[]>} getFullAxTree
 * @property {(targetId: string, role: string, name: string) => Promise<number | undefined>} findBackendNodeId
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").CdpSession} session
 * @returns {Promise<AccessibilityWatchdog>}
 */
export async function installAccessibilityWatchdog(session) {
  const { client, sessionManager } = session;

  /** @param {string} targetId @returns {Promise<AxNode[]>} */
  async function getFullAxTree(targetId) {
    const sid = sessionManager.getSessionId(targetId);
    if (!sid) throw new Error(`no sessionId for ${targetId}`);
    await client.send("Accessibility.enable", {}, sid);
    const result = /** @type {any} */ (await client.send("Accessibility.getFullAXTree", {}, sid));
    return /** @type {any[]} */ (result.nodes).map((n) => ({
      nodeId: /** @type {string} */ (n.nodeId),
      backendDomNodeId: /** @type {number | undefined} */ (n.backendDOMNodeId),
      role: /** @type {string} */ (n.role?.value ?? ""),
      name: /** @type {string} */ (n.name?.value ?? ""),
      value: /** @type {string} */ (n.value?.value ?? "")
    }));
  }

  return {
    getFullAxTree,
    async findBackendNodeId(targetId, role, name) {
      const nodes = await getFullAxTree(targetId);
      const match = nodes.find((n) => n.role === role && n.name === name);
      return match?.backendDomNodeId;
    },
    async dispose() {}
  };
}
