/**
 * @typedef {Object} RecorderWatchdogOptions
 * @property {string} bindingName — Runtime.addBinding name (예: "__browserFlowRecord")
 * @property {string} script — 페이지 컨텍스트 init script (recorderInitScript)
 * @property {(event: object, meta: { sessionId: string, targetId: string }) => void} onEvent
 */

/**
 * @typedef {Object} RecorderWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {RecorderWatchdogOptions} options
 * @returns {Promise<RecorderWatchdog>}
 */
export async function installRecorderWatchdog(session, options) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];

  /**
   * @param {{ targetId: string }} info
   * @param {string} sessionId
   */
  async function attach(info, sessionId) {
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.addBinding", { name: options.bindingName }, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: options.script }, sessionId);
    // Also evaluate in the current page context so it fires on the existing page.
    await client.send("Runtime.evaluate", { expression: options.script }, sessionId).catch(() => {
      // Page may be navigating — addScriptToEvaluateOnNewDocument handles next navigation.
    });
  }

  // Attach to all existing page targets.
  for (const target of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(target.targetId);
    if (sid) await attach(target, sid);
  }

  // Attach to future page targets.
  off.push(sessionManager.onPageAttached((info, sessionId) => {
    attach(info, sessionId).catch((err) => {
      console.error("recorder attach failed:", err instanceof Error ? err.message : String(err));
    });
  }));

  // Listen for Runtime.bindingCalled events (scoped per session in flat-session mode).
  // CRI flat-session mode delivers the routing sessionId as the SECOND handler arg, not on params.
  off.push(client.on("Runtime.bindingCalled", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    if (p.name !== options.bindingName) return;
    let payload;
    try { payload = JSON.parse(p.payload); } catch { return; }
    const sessionId = /** @type {string | undefined} */ (sessionIdArg) ?? p.sessionId ?? "";
    const targetId = findTargetIdBySessionId(sessionManager, sessionId);
    options.onEvent(payload, { sessionId, targetId: targetId ?? "" });
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}

/**
 * Find the targetId corresponding to the session that fired the event.
 *
 * @param {import("../session-manager.mjs").SessionManager} mgr
 * @param {string} sessionId
 * @returns {string | undefined}
 */
function findTargetIdBySessionId(mgr, sessionId) {
  if (!sessionId) return undefined;
  for (const target of mgr.listPageTargets()) {
    if (mgr.getSessionId(target.targetId) === sessionId) return target.targetId;
  }
  return undefined;
}
