import { connectToExistingChrome } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../scripts/cdp/watchdogs/action.mjs";
import { installDomWatchdog } from "../../scripts/cdp/watchdogs/dom.mjs";

/**
 * Poll until the selector is present in the DOM for the given target.
 *
 * @param {{ client: import("../../scripts/cdp/client.mjs").CdpClient, sessionManager: import("../../scripts/cdp/session-manager.mjs").SessionManager }} session
 * @param {string} targetId
 * @param {string} selector
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
async function waitForSelector(session, targetId, selector, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { client, sessionManager } = session;
  const sid = sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(`waitForSelector: no sessionId for ${targetId}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
    const found = /** @type {any} */ (await client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector
    }, sid));
    if (found.nodeId) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitForSelector timeout for "${selector}"`);
}

/**
 * Poll until location.href matches the given pattern.
 *
 * @param {{ client: import("../../scripts/cdp/client.mjs").CdpClient, sessionManager: import("../../scripts/cdp/session-manager.mjs").SessionManager }} session
 * @param {string} targetId
 * @param {RegExp} pattern
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
async function waitForURL(session, targetId, pattern, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { client, sessionManager } = session;
  const sid = sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(`waitForURL: no sessionId for ${targetId}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = /** @type {any} */ (await client.send("Runtime.evaluate", { expression: "location.href" }, sid));
    const href = String(result.result.value ?? "");
    if (pattern.test(href)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitForURL timeout for ${pattern}`);
}

/**
 * @param {{ debugPort: number, workflow: "synthetic" | "docs" | "stateful" | "submit" | "secret" | "signals" | "samename" }} input
 */
export async function driveObservedWorkflow(input) {
  const session = await connectToExistingChrome(input.debugPort);
  const lifecycle = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);

  try {
    const targets = session.sessionManager.listPageTargets();
    if (targets.length === 0) {
      throw new Error("Observed browser has no page targets.");
    }
    const targetId = targets[0].targetId;

    if (input.workflow === "synthetic") {
      await waitForSelector(session, targetId, '[data-bf="name-input"]');
      await action.typeIntoSelector(targetId, '[data-bf="name-input"]', "Codex");
      await action.clickBySelector(targetId, '[data-bf="launch"]');
      await waitForURL(session, targetId, /\/synthetic\/result/);
      await waitForSelector(session, targetId, '[data-bf-evidence="result"]');
    } else if (input.workflow === "docs") {
      await waitForSelector(session, targetId, '[data-bf="catalog-link"]');
      await action.clickBySelector(targetId, '[data-bf="catalog-link"]');
      await waitForURL(session, targetId, /\/docs\/catalog/);
      await action.clickBySelector(targetId, '[data-bf="browser-filter"]');
      await action.clickBySelector(targetId, '[data-bf="detail-link"]');
      await waitForURL(session, targetId, /\/docs\/detail\/browser-flow/);
      await waitForSelector(session, targetId, '[data-bf-evidence="detail-title"]');
    } else if (input.workflow === "stateful") {
      await waitForSelector(session, targetId, '[data-bf="stateful-launch"]');
      await action.clickBySelector(targetId, '[data-bf="stateful-launch"]');
      await waitForURL(session, targetId, /\/stateful\/result/);
      await waitForSelector(session, targetId, '[data-bf-evidence="stateful-result"]');
    } else if (input.workflow === "secret") {
      await waitForSelector(session, targetId, '[data-bf="secret-password"]');
      await action.typeIntoSelector(targetId, '[data-bf="secret-password"]', "letmein");
      await action.clickBySelector(targetId, '[data-bf="secret-launch"]');
      await waitForURL(session, targetId, /\/secret\/result/);
      await waitForSelector(session, targetId, '[data-bf-evidence="secret-result"]');
    } else if (input.workflow === "signals") {
      await waitForSelector(session, targetId, '[data-bf="field"]');
      await action.typeIntoSelector(targetId, '[data-bf="field"]', "x@y.com");
      await action.clickBySelector(targetId, '[data-bf="go"]');
      await waitForURL(session, targetId, /\/signals\/dest/);
      await waitForSelector(session, targetId, '[data-bf-evidence="signals-dest"]');
    } else if (input.workflow === "samename") {
      // Click the ARTICLE "지리" link (href /samename/geo, neighbor "지리학 문서").
      // There are TWO links with the same visible text "지리"; the scorer must pick
      // the article one via href+neighborTexts, NOT the anchor (#geo).
      await waitForSelector(session, targetId, '[data-bf="article"]');
      await action.clickBySelector(targetId, '[data-bf="article"]');
      await waitForURL(session, targetId, /\/samename\/geo/);
      await waitForSelector(session, targetId, '[data-bf-evidence="samename-dest"]');
    } else {
      // "submit" workflow
      await waitForSelector(session, targetId, '[data-bf="submit-name"]');
      await action.typeIntoSelector(targetId, '[data-bf="submit-name"]', "Codex");
      await action.clickBySelector(targetId, '[data-bf="submit-button"]');
      await waitForURL(session, targetId, /\/submit\/result/);
      await waitForSelector(session, targetId, '[data-bf-evidence="submit-result"]');
    }
  } finally {
    await lifecycle.dispose();
    await action.dispose();
    // Dispose session (closes CDP client only — does NOT kill Chrome)
    await session.dispose();
  }
}
