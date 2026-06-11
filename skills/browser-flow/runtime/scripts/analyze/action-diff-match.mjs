import { derivePageKey } from "../lib/page-key.mjs";

/**
 * @typedef {{
 *   event: Record<string, any>,
 *   index: number
 * }} ActionDiffMatch
 */

/**
 * Creates a consume-once action-diff matcher for one event stream.
 *
 * @param {Array<Record<string, any>>} events
 * @param {{ fixture?: string }} [options]
 */
export function createActionDiffMatcher(events, options = {}) {
  const fixture = options.fixture ?? "manual";
  const used = new Set();
  const diffs = events
    .map((event, index) => ({ event, index }))
    .filter((entry) => entry.event?.type === "action-diff");

  /**
   * @param {number} actionIndex
   * @param {"click" | "input" | "submit"} refType
   * @returns {ActionDiffMatch | null}
   */
  return function matchActionDiff(actionIndex, refType) {
    const action = events[actionIndex];
    if (!action) return null;
    const candidates = diffs.filter(({ event, index }) =>
      !used.has(index) &&
      index > actionIndex &&
      event.refType === refType &&
      sameTab(action, event)
    );
    const match =
      findNearest(candidates.filter(({ event }) => sameActionSeq(action, event))) ??
      findNearest(candidates.filter(({ event }) => sameDocumentActionId(action, event))) ??
      findNearest(candidates.filter(({ event }) => samePageActionId(action, event, fixture))) ??
      findNearest(candidates.filter(({ event }) => sameCapturePage(action, event, fixture)));
    if (!match) return null;
    used.add(match.index);
    return match;
  };
}

/**
 * @param {Array<ActionDiffMatch>} entries
 * @returns {ActionDiffMatch | null}
 */
function findNearest(entries) {
  return entries.length > 0
    ? entries.reduce((best, entry) => entry.index < best.index ? entry : best, entries[0])
    : null;
}

/**
 * @param {Record<string, any>} action
 * @param {Record<string, any>} diff
 */
function sameActionSeq(action, diff) {
  return typeof action.actionSeq === "number" &&
    action.actionSeq > 0 &&
    diff.actionSeq === action.actionSeq;
}

/**
 * @param {Record<string, any>} action
 * @param {Record<string, any>} diff
 */
function sameDocumentActionId(action, diff) {
  return typeof action.actionId === "string" &&
    action.actionId &&
    action.actionId === diff.actionId &&
    typeof action.documentId === "string" &&
    action.documentId &&
    action.documentId === diff.documentId;
}

/**
 * @param {Record<string, any>} action
 * @param {Record<string, any>} diff
 * @param {string} fixture
 */
function samePageActionId(action, diff, fixture) {
  return typeof action.actionId === "string" &&
    action.actionId &&
    action.actionId === diff.actionId &&
    sameCapturePage(action, diff, fixture);
}

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 */
function sameTab(a, b) {
  return (a.tabOrdinal ?? 0) === (b.tabOrdinal ?? 0);
}

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @param {string} fixture
 */
function sameCapturePage(a, b, fixture) {
  if (!sameTab(a, b)) return false;
  const aUrl = typeof a.url === "string" ? a.url : "";
  const bUrl = typeof b.url === "string" ? b.url : "";
  // Both URLs absent: no page information to distinguish — treat as same page.
  // One absent, one present: ambiguous — do not assume same page (conservative).
  if (!aUrl && !bUrl) return true;
  if (!aUrl || !bUrl) return false;
  if (aUrl === bUrl) return true;
  return derivePageKey(aUrl, fixture) === derivePageKey(bUrl, fixture);
}
