// @ts-check
/**
 * CDP explorer driver — builds the deps object for exploreGraph()
 * using real Chrome via CDP. Navigation is achieved via lifecycle.navigateAndWait
 * and clicks via resolveLocator + action.clickByBackendNodeId.
 */

import { classifyAffordance } from "../lib/affordance-classifier.mjs";
import { derivePageKey } from "../lib/page-key.mjs";
import { resolveLocator } from "../cdp/locator-resolver.mjs";
import { locatorCaptureSource } from "../observe/locator-capture.mjs";

/**
 * @typedef {{
 *   role?: string,
 *   name?: string,
 *   structuralKey?: string
 * }} Aff
 */

/**
 * @typedef {{
 *   session: import("../cdp/browser-session.mjs").CdpSession,
 *   targetId: string,
 *   lifecycle: import("../cdp/watchdogs/lifecycle.mjs").LifecycleWatchdog,
 *   action: import("../cdp/watchdogs/action.mjs").ActionWatchdog,
 *   seedUrl: string,
 *   seedPageKey: string,
 *   fixture: string
 * }} ExplorerDepsInput
 */

/**
 * Build the deps object expected by exploreGraph().
 *
 * @param {ExplorerDepsInput} input
 * @returns {{
 *   seedPageKey: string,
 *   classify: typeof classifyAffordance,
 *   enumerate: (node: {pageKey: string, clickPrefix: Aff[], depth: number}) => Promise<Aff[]>,
 *   clickObserve: (clickPrefix: Aff[], aff: Aff) => Promise<string>
 * }}
 */
export function buildExplorerDeps(input) {
  const { session, targetId, lifecycle, action, seedUrl, seedPageKey, fixture } = input;

  /**
   * Get the current page URL via Runtime.evaluate.
   * @returns {Promise<string>}
   */
  async function getCurrentUrl() {
    const sid = session.sessionManager.getSessionId(targetId);
    if (!sid) throw new Error(`buildExplorerDeps: no sessionId for ${targetId}`);
    const result = /** @type {any} */ (await session.client.send(
      "Runtime.evaluate",
      { expression: "location.href", returnByValue: true },
      sid
    ));
    return String(result?.result?.value ?? "");
  }

  /**
   * Wait for URL to change from the given previous href, with a short timeout.
   * @param {string} prevHref
   * @param {number} timeoutMs
   * @returns {Promise<string>} the new URL
   */
  async function waitForUrlChange(prevHref, timeoutMs = 2000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const href = await getCurrentUrl().catch(() => prevHref);
      if (href !== prevHref) return href;
      await new Promise((r) => setTimeout(r, 80));
    }
    // Timeout — return current URL (may be same as prevHref if no nav happened)
    return getCurrentUrl().catch(() => prevHref);
  }

  /**
   * Click a single affordance by resolving it through the locator resolver.
   * @param {Aff} aff
   * @returns {Promise<void>}
   */
  async function clickAff(aff) {
    const { backendNodeId } = await resolveLocator(session, targetId, {
      locator: {
        role: aff.role,
        name: aff.name,
        structuralKey: aff.structuralKey
      }
    });
    await action.clickByBackendNodeId(targetId, backendNodeId);
  }

  /**
   * Navigate to the seed URL and replay each affordance in the prefix sequence.
   * After each replay click, we wait up to 2s for a URL change so the browser
   * has settled before the next click.
   *
   * @param {Aff[]} prefix
   * @returns {Promise<void>}
   */
  async function navAndReplay(prefix) {
    await lifecycle.navigateAndWait(targetId, seedUrl, {
      waitUntil: "domcontentloaded",
      timeoutMs: 5000
    }).catch(() => {});

    for (const prev of prefix) {
      const beforeHref = await getCurrentUrl().catch(() => "");
      await clickAff(prev);
      await waitForUrlChange(beforeHref, 2000);
    }
  }

  /**
   * Enumerate affordances on the current page via the in-page skeleton function.
   * @param {{ pageKey: string, clickPrefix: Aff[], depth: number }} node
   * @returns {Promise<Aff[]>}
   */
  async function enumerate(node) {
    await navAndReplay(node.clickPrefix);

    const sid = session.sessionManager.getSessionId(targetId);
    if (!sid) return [];

    const expr =
      "(function(){ " + locatorCaptureSource +
      "; return (typeof __bfAffordanceSkeleton==='function') ? __bfAffordanceSkeleton() : []; })()";

    try {
      const result = /** @type {any} */ (await session.client.send(
        "Runtime.evaluate",
        { expression: expr, returnByValue: true },
        sid
      ));
      const value = result?.result?.value;
      if (Array.isArray(value)) return /** @type {Aff[]} */ (value);
    } catch (_) { /* fall through — return empty */ }
    return [];
  }

  /**
   * Navigate + replay the click prefix, then click the given affordance,
   * wait for the resulting navigation to settle, and return the new pageKey.
   *
   * @param {Aff[]} clickPrefix
   * @param {Aff} aff
   * @returns {Promise<string>}
   */
  async function clickObserve(clickPrefix, aff) {
    try {
      await navAndReplay(clickPrefix);
      const beforeHref = await getCurrentUrl().catch(() => "");
      await clickAff(aff);
      const afterHref = await waitForUrlChange(beforeHref, 2000);
      return derivePageKey(afterHref, fixture);
    } catch (err) {
      // Resolve/click failure — keep BFS alive by returning the seed page key.
      // This avoids crashing the whole explore on a single unresolvable element.
      process.stderr.write(
        `[cdp-explorer] clickObserve failed for ${JSON.stringify(aff)}: ${err instanceof Error ? err.message : String(err)}\n`
      );
      return seedPageKey;
    }
  }

  return {
    seedPageKey,
    classify: classifyAffordance,
    enumerate,
    clickObserve
  };
}
