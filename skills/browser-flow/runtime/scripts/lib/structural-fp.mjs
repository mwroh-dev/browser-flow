// @ts-check
// Pure string-ops structural key builder for DOM elements.
// No DOM, no crypto — safe to run both in-page and in Node.

// A class token is "dynamic"/generated if it looks hashed or stateful.
// Heuristics: css-in-js prefixes (css-/sc-/jsx-), state prefixes (is-/has-/js-),
// long opaque tokens, or hex-ish suffixes.
const DYNAMIC_RE = /(^|[-_])(is|has|js)[-_]|^(css|sc|jsx)-|[0-9a-f]{6,}$|[a-z0-9]{8,}$/;

// Auto-generated / unstable element ids (framework-assigned, per-render). Conservative:
// only flag clearly-generated ids so semantic ids (firstHeading, p-search) survive.
const DYNAMIC_ID_RE = /^(mw[A-Za-z0-9]{2,}|ember\d+)$|^(radix-|react-).|^[a-f0-9]{8,}$|^:r[a-z0-9]*:|:r.*:/;

/**
 * Returns true if the given id looks auto-generated or unstable (framework-assigned,
 * per-render). Mirrors __bfIsDynamicId in scripts/observe/locator-capture.mjs.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isDynamicId(id) {
  const s = String(id || "");
  if (!s) return false;
  return DYNAMIC_ID_RE.test(s);
}

/**
 * Filter out dynamic/generated CSS class tokens, keeping only semantic classes.
 * @param {string[]|null|undefined} classes
 * @returns {string[]}
 */
export function filterDynamicClasses(classes) {
  if (!Array.isArray(classes)) return [];
  return classes.filter((c) => typeof c === "string" && c.length > 0 && !DYNAMIC_RE.test(c));
}

/**
 * @typedef {{ tagPath?: string[], tag?: string, staticAttrs?: Record<string, string>, classes?: string[], name?: string }} StructuralDescriptor
 */

/**
 * @param {StructuralDescriptor} d
 * @param {boolean} keepAllClasses
 * @returns {string}
 */
function canonical(d, keepAllClasses) {
  const tagPath = (Array.isArray(d.tagPath) ? d.tagPath : []).join(">");
  const attrs = Object.entries(d.staticAttrs ?? {})
    .filter(([, v]) => v != null && v !== "")
    // Plain code-unit lex order (NOT localeCompare) so the in-page mirror in
    // locator-capture.mjs produces byte-identical keys (equivalence test).
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  const classes = (keepAllClasses ? (Array.isArray(d.classes) ? d.classes : []) : filterDynamicClasses(d.classes))
    .slice()
    .sort()
    .join(".");
  return `${tagPath}|${d.tag ?? ""}|${attrs}|${classes}|${(d.name ?? "").trim()}`;
}

/**
 * Build a structural key that ignores dynamic/generated CSS classes.
 * Stable across SPA re-renders that only change hashed class names.
 * @param {StructuralDescriptor} d
 * @returns {string}
 */
export function buildStructuralKey(d) { return canonical(d, false); }

/**
 * Build an element key that retains all classes (more precise than structuralKey).
 * @param {StructuralDescriptor} d
 * @returns {string}
 */
export function buildElementKey(d) { return canonical(d, true); }
