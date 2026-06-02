/**
 * @typedef {{ name: string, loaderId: string, timestamp: number }} LifecycleEvent
 * @typedef {"commit" | "domcontentloaded" | "load" | "networkidle"} WaitUntil
 */

/**
 * @typedef {Object} LifecycleWatchdog
 * @property {(targetId: string, url: string, options?: { waitUntil?: WaitUntil, timeoutMs?: number }) => Promise<void>} navigateAndWait
 * @property {(targetId: string) => LifecycleEvent[]} getEventsFor
 * @property {() => Promise<void>} dispose
 */

/** @type {Record<WaitUntil, string>} */
const WAIT_EVENT = {
  commit: "init",
  domcontentloaded: "DOMContentLoaded",
  load: "load",
  networkidle: "networkIdle"
};

/**
 * @param {import("../browser-session.mjs").CdpSession} session
 * @returns {Promise<LifecycleWatchdog>}
 */
export async function installLifecycleWatchdog(session) {
  const { client, sessionManager } = session;
  /** @type {Map<string, LifecycleEvent[]>} */
  const eventsByTarget = new Map();
  /** @type {Array<() => void>} */
  const off = [];

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
  }

  // Enable for all existing page targets.
  for (const t of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(t.targetId);
    if (sid) await enableFor(sid);
    eventsByTarget.set(t.targetId, []);
  }

  // Enable for future page targets.
  off.push(sessionManager.onPageAttached(async (info, sessionId) => {
    eventsByTarget.set(info.targetId, []);
    await enableFor(sessionId).catch(() => {});
  }));

  // Listen for lifecycle events; CRI flat-session delivers sessionId as the second arg.
  off.push(client.on("Page.lifecycleEvent", (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    // In CRI flat-session mode the sessionId comes as the second handler argument.
    const sid = sessionIdArg ?? p.sessionId;
    for (const t of sessionManager.listPageTargets()) {
      if (sessionManager.getSessionId(t.targetId) === sid) {
        const arr = eventsByTarget.get(t.targetId) ?? [];
        arr.push({ name: p.name, loaderId: p.loaderId, timestamp: Date.now() });
        eventsByTarget.set(t.targetId, arr);
        break;
      }
    }
  }));

  return {
    async navigateAndWait(targetId, url, opts = {}) {
      const waitUntil = opts.waitUntil ?? "load";
      const timeoutMs = opts.timeoutMs ?? 30_000;
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for target ${targetId}`);
      const startedAt = Date.now();
      const expectedEvent = WAIT_EVENT[waitUntil];
      const navResult = /** @type {any} */ (await client.send("Page.navigate", { url }, sid));
      const loaderId = navResult.loaderId;
      while (Date.now() - startedAt < timeoutMs) {
        const arr = eventsByTarget.get(targetId) ?? [];
        if (arr.some((e) => e.loaderId === loaderId && e.name === expectedEvent)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`navigateAndWait timeout (${waitUntil}) for ${url}`);
    },
    getEventsFor(targetId) {
      return eventsByTarget.get(targetId) ?? [];
    },
    async dispose() {
      for (const cleanup of off) cleanup();
      eventsByTarget.clear();
    }
  };
}
