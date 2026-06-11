/**
 * @typedef {{ clicked: boolean, strategy: "input.dispatchMouseEvent" | "runtime.callFunctionOn" | "input.dispatchMouseEvent.coords" }} ClickResult
 */

/**
 * @typedef {Object} ActionWatchdog
 * @property {(targetId: string, selector: string) => Promise<ClickResult>} clickBySelector
 * @property {(targetId: string, backendNodeId: number) => Promise<ClickResult>} clickByBackendNodeId
 * @property {(targetId: string, selector: string, text: string) => Promise<void>} typeIntoSelector
 * @property {(targetId: string, backendNodeId: number, text: string) => Promise<void>} typeIntoBackendNodeId
 * @property {(targetId: string, backendNodeId: number, text: string) => Promise<void>} typeKeysIntoNode
 * @property {(targetId: string, x: number, y: number) => Promise<{clicked: boolean, strategy: string}>} clickByCoords
 * @property {(targetId: string, x: number, y: number) => Promise<number | undefined>} nodeAtPoint
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").CdpSession} session
 * @returns {Promise<ActionWatchdog>}
 */
export async function installActionWatchdog(session) {
  const { client, sessionManager } = session;

  /**
   * @param {string} sessionId
   * @param {string} selector
   * @returns {Promise<number>}
   */
  async function resolveBackendNodeId(sessionId, selector) {
    const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sessionId));
    const found = /** @type {any} */ (await client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector
    }, sessionId));
    if (!found.nodeId) throw new Error(`selector did not resolve: ${selector}`);
    const desc = /** @type {any} */ (await client.send("DOM.describeNode", { nodeId: found.nodeId }, sessionId));
    return desc.node.backendNodeId;
  }

  /**
   * Focus a node and type each character via key events. Shared by
   * typeIntoSelector and typeKeysIntoNode so a step resolved through
   * the layered/healed locator ladder types into the SAME node the ladder
   * found (rather than re-querying a possibly-stale selector).
   * @param {string} sessionId
   * @param {number} backendNodeId
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function typeKeysAtBackendNodeId(sessionId, backendNodeId, text) {
    await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId).catch(() => {});
    await client.send("DOM.focus", { backendNodeId }, sessionId);
    for (const char of text) {
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", text: char }, sessionId);
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", text: char }, sessionId);
    }
  }

  /**
   * Core click logic: scroll → coords → JS fallback ladder.
   * @param {string} sessionId
   * @param {number} backendNodeId
   * @returns {Promise<ClickResult>}
   */
  async function clickAtBackendNodeId(sessionId, backendNodeId) {
    // Scroll into view (best-effort)
    await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId).catch(() => {});

    // Coords-based click via Input.dispatchMouseEvent
    try {
      const box = /** @type {any} */ (await client.send("DOM.getBoxModel", { backendNodeId }, sessionId));
      const q = box.model.content; // [x1,y1, x2,y2, x3,y3, x4,y4]
      const x = (q[0] + q[2] + q[4] + q[6]) / 4;
      const y = (q[1] + q[3] + q[5] + q[7]) / 4;
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, sessionId);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
      return { clicked: true, strategy: "input.dispatchMouseEvent" };
    } catch (_coordsErr) {
      // JS click fallback
      const obj = /** @type {any} */ (await client.send("DOM.resolveNode", { backendNodeId }, sessionId));
      await client.send("Runtime.callFunctionOn", {
        objectId: obj.object.objectId,
        functionDeclaration: "function() { this.click(); }",
        arguments: [],
        returnByValue: true
      }, sessionId);
      return { clicked: true, strategy: "runtime.callFunctionOn" };
    }
  }

  return {
    async clickBySelector(targetId, selector) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const backendNodeId = await resolveBackendNodeId(sid, selector);
      return clickAtBackendNodeId(sid, backendNodeId);
    },

    async clickByBackendNodeId(targetId, backendNodeId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      return clickAtBackendNodeId(sid, backendNodeId);
    },

    async typeIntoSelector(targetId, selector, text) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const backendNodeId = await resolveBackendNodeId(sid, selector);
      await typeKeysAtBackendNodeId(sid, backendNodeId, text);
    },

    async typeKeysIntoNode(targetId, backendNodeId, text) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      await typeKeysAtBackendNodeId(sid, backendNodeId, text);
    },

    async typeIntoBackendNodeId(targetId, backendNodeId, text) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sid).catch(() => {});
      let focused = false;
      try {
        await client.send("DOM.focus", { backendNodeId }, sid);
        focused = true;
      } catch (_focusErr) {
        // the resolved node is a non-focusable host inside a
        // contentEditable composer (e.g. <p role=presentation> in Google Keep's
        // note body). DOM.focus rejects it. Click its center to focus the editing
        // host, exactly as a real user does (this is how the click step opens it).
        try {
          const bm = /** @type {any} */ (await client.send("DOM.getBoxModel", { backendNodeId }, sid));
          const q = bm && bm.model && bm.model.content;
          if (Array.isArray(q) && q.length >= 8) {
            const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
            const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
            await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 }, sid);
            await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 }, sid);
            focused = true;
          }
        } catch (_clickErr) {
          /* fall through to fail-loud below */
        }
      }
      if (!focused) throw new Error("typeIntoBackendNodeId: node is not focusable and click-to-focus failed");
      await client.send("Input.insertText", { text }, sid);
    },

    async clickByCoords(targetId, x, y) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, sid);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sid);
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sid);
      return { clicked: true, strategy: "input.dispatchMouseEvent.coords" };
    },

    /** Returns the backendNodeId of the element at (x,y), or undefined. */
    async nodeAtPoint(targetId, x, y) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const res = /** @type {any} */ (await client.send("DOM.getNodeForLocation", { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false }, sid).catch(() => null));
      return res && typeof res.backendNodeId === "number" ? res.backendNodeId : undefined;
    },

    async dispose() {}
  };
}
