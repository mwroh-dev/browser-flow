import { isDummyName } from "./dummy-naming.mjs";

/** Default delete-affordance keywords (case-insensitive substring match on element text). */
export const DEFAULT_DELETE_KEYWORDS = ["삭제", "delete", "remove", "trash", "지우기", "휴지통"];

/**
 * @typedef {{ selector: string, actions?: string[], text?: string, ancestors?: Array<Record<string, unknown>>, siblings?: unknown, fieldName?: string }} SelectorEntry
 */

/**
 * Find clickable elements whose visible text matches a delete keyword.
 * Pure deterministic search over a captured page's selectors.json entries.
 * @param {Array<SelectorEntry | null | undefined> | null | undefined} selectorEntries
 * @param {string[]} [keywords]
 * @returns {SelectorEntry[]}
 */
export function findDeleteAffordances(selectorEntries, keywords) {
  const kws = (keywords ?? DEFAULT_DELETE_KEYWORDS).map((k) => k.toLowerCase());
  const list = Array.isArray(selectorEntries) ? selectorEntries : [];
  /** @type {SelectorEntry[]} */
  const result = /** @type {any} */ (list.filter((e) => {
    if (!e || typeof e !== "object") return false;
    const actions = Array.isArray(e.actions) ? e.actions : [];
    if (!actions.includes("click")) return false;
    const text = typeof e.text === "string" ? e.text.toLowerCase() : "";
    if (!text) return false;
    return kws.some((k) => text.includes(k));
  }));
  return result;
}

/**
 * From live AX nodes, return the (deduped, in-order) names matching the dummy prefix.
 * @param {Array<{ role?: string, name?: string }>} axNodes
 * @param {string} prefix
 * @returns {string[]}
 */
export function findDummyItemNames(axNodes, prefix) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const n of Array.isArray(axNodes) ? axNodes : []) {
    const name = typeof n?.name === "string" ? n.name : "";
    if (name && isDummyName(name, prefix) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
