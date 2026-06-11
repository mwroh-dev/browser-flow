/**
 * @typedef {Object} TargetInfo
 * @property {string} targetId
 * @property {string} type
 * @property {string} url
 * @property {string} title
 * @property {string} [openerId]
 */

/**
 * @typedef {Object} SessionManager
 * @property {() => TargetInfo[]} listPageTargets
 * @property {(targetId: string) => string | undefined} getSessionId
 * @property {(handler: (info: TargetInfo, sessionId: string) => void) => () => void} onPageAttached
 * @property {(handler: (targetId: string) => void) => () => void} onTargetDetached
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("./client.mjs").CdpClient} client
 * @returns {Promise<SessionManager>}
 */
export async function createSessionManager(client) {
  /** @type {Map<string, TargetInfo>} */
  const targetIdToInfo = new Map();
  /** @type {Map<string, string>} */
  const targetIdToSessionId = new Map();
  /** @type {Set<(info: TargetInfo, sessionId: string) => void>} */
  const attachedHandlers = new Set();
  /** @type {Set<(targetId: string) => void>} */
  const detachedHandlers = new Set();
  /** @type {Array<() => void>} */
  const off = [];

  off.push(client.on("Target.attachedToTarget", (params) => {
    const p = /** @type {any} */ (params);
    const info = {
      targetId: p.targetInfo.targetId,
      type: p.targetInfo.type,
      url: p.targetInfo.url,
      title: p.targetInfo.title,
      openerId: p.targetInfo.openerId
    };
    targetIdToInfo.set(info.targetId, info);
    targetIdToSessionId.set(info.targetId, p.sessionId);
    if (info.type === "page") {
      for (const h of attachedHandlers) {
        try {
          h(info, p.sessionId);
        } catch (handlerError) {
          console.error("attachedHandlers error:", handlerError instanceof Error ? handlerError.message : String(handlerError));
        }
      }
    }
  }));

  off.push(client.on("Target.detachedFromTarget", (params) => {
    const p = /** @type {any} */ (params);
    const targetId = findTargetIdBySessionId(targetIdToSessionId, p.sessionId);
    if (targetId) {
      targetIdToInfo.delete(targetId);
      targetIdToSessionId.delete(targetId);
      for (const h of detachedHandlers) {
        try {
          h(targetId);
        } catch (handlerError) {
          console.error("detachedHandlers error:", handlerError instanceof Error ? handlerError.message : String(handlerError));
        }
      }
    }
  }));

  off.push(client.on("Target.targetInfoChanged", (params) => {
    const p = /** @type {any} */ (params);
    const existing = targetIdToInfo.get(p.targetInfo.targetId);
    if (existing) {
      targetIdToInfo.set(p.targetInfo.targetId, {
        ...existing,
        url: p.targetInfo.url,
        title: p.targetInfo.title
      });
    }
  }));

  await client.send("Target.setAutoAttach", {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false
  });

  return {
    listPageTargets() {
      return Array.from(targetIdToInfo.values()).filter((t) => t.type === "page");
    },
    getSessionId(targetId) {
      return targetIdToSessionId.get(targetId);
    },
    onPageAttached(handler) {
      attachedHandlers.add(handler);
      return () => attachedHandlers.delete(handler);
    },
    onTargetDetached(handler) {
      detachedHandlers.add(handler);
      return () => detachedHandlers.delete(handler);
    },
    async dispose() {
      for (const cleanup of off) cleanup();
      attachedHandlers.clear();
      detachedHandlers.clear();
      targetIdToInfo.clear();
      targetIdToSessionId.clear();
    }
  };
}

/**
 * @param {Map<string, string>} map
 * @param {string} sessionId
 */
function findTargetIdBySessionId(map, sessionId) {
  for (const [targetId, sid] of map) {
    if (sid === sessionId) return targetId;
  }
  return undefined;
}
