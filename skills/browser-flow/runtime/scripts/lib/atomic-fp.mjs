/**
 * Atomic fingerprint derivation.
 *
 * Derives a runner-consumable `atomicFp` descriptor from
 * a single sanitized event. Pure function — no IO, no globals.
 *
 * Decision (role-first + ancestor fallback):
 *   - selector already unique (totalMatchingSelector <= 1) → null
 *   - implicit role exists + totalMatchingRole === 1 + text non-empty
 *     → { strategy: "role", role, name }
 *   - else find deepest ancestor with a stable identifier
 *     → { strategy: "ancestor-scope", scopeSelector }
 *   - no stable ancestor → null (degrades to `.first()`)
 */

/**
 * @typedef {{
 *   tag?: string,
 *   id?: string,
 *   role?: string,
 *   ariaLabel?: string,
 *   dataBf?: string,
 *   dataTestid?: string
 * }} AncestorFrame
 */

/**
 * @typedef {{
 *   selector?: string,
 *   type?: string,
 *   text?: string,
 *   role?: string,
 *   fieldName?: string,
 *   ancestors?: AncestorFrame[],
 *   siblings?: { totalMatchingSelector?: number, totalMatchingRole?: number },
 *   submitterSelector?: string,
 *   submitterText?: string
 * }} AtomicFpInput
 */

/**
 * @typedef {(
 *   | null
 *   | { strategy: "role", role: string, name: string }
 *   | { strategy: "ancestor-scope", scopeSelector: string }
 * )} AtomicFp
 */

// Implicit ARIA role map. Minimal on purpose — grow only when real-site captures demand
// it. Keys are the tag portion of the captured selector (lowercased).
const IMPLICIT_ROLE_BY_TAG = new Map([
  ["button", "button"],
  ["a", "link"]
]);

/**
 * Extract the tag-name prefix from a CSS selector string.
 * Returns the prefix up to the first non-tag character (`[`, `.`, `#`, `:`, ` `).
 *
 * @param {string} selector
 */
function tagOfSelector(selector) {
  if (!selector) {
    return "";
  }
  const match = selector.match(/^([a-z][a-z0-9-]*)/i);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Pick an ancestor-scope CSS selector if a stable identifier exists.
 * Walks from deepest (closest to the target — first element of the
 * recorder's top-down chain is the OUTERMOST ancestor; the LAST
 * element is the CLOSEST) outward, preferring the closest ancestor.
 *
 * Stable identifiers (priority order, highest first):
 *   1. dataBf attribute
 *   2. dataTestid attribute
 *   3. role attribute (e.g., dialog, menu, region) — Angular Material
 *      surfaces these on the structural container
 *   4. custom-element tag (contains `-`, e.g., `mat-dialog-container`,
 *      `notebook-search-input`) — these are Angular component names,
 *      stable across renders
 *
 * Explicitly skipped: numeric/generated IDs. Angular Material assigns
 * `mat-menu-panel-279`, `cdk-overlay-3`, `mat-mdc-dialog-0` etc. —
 * incrementing per overlay instance, unstable across reruns.
 *
 * @param {AncestorFrame[]} ancestors
 * @returns {string} CSS selector or "" if no stable ancestor found
 */
function pickAncestorScope(ancestors) {
  if (!Array.isArray(ancestors) || ancestors.length === 0) {
    return "";
  }
  // Recorder emits ancestors top-down: index 0 = outermost ancestor,
  // last index = closest (immediate parent's parent etc.). Closest
  // ancestor has the tightest scope, so reverse-walk.
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const frame = ancestors[i] ?? {};
    if (frame.dataBf) {
      return `[data-bf="${escapeAttrValue(frame.dataBf)}"]`;
    }
    if (frame.dataTestid) {
      return `[data-testid="${escapeAttrValue(frame.dataTestid)}"]`;
    }
    if (frame.role) {
      return `[role="${escapeAttrValue(frame.role)}"]`;
    }
    const tag = typeof frame.tag === "string" ? frame.tag.toLowerCase() : "";
    if (tag && tag.includes("-")) {
      return tag;
    }
  }
  return "";
}

/**
 * Escape a value for inclusion in a CSS attribute selector double-quoted
 * string. We only need to neutralize `"` and `\` per CSS spec.
 *
 * @param {string} value
 */
function escapeAttrValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Derive an atomic-fp descriptor for a single sanitized event.
 *
 * @param {AtomicFpInput | null | undefined} event
 * @returns {AtomicFp}
 */
export function deriveAtomicLocator(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const siblings = event.siblings;
  const totalMatchingSelector =
    typeof siblings?.totalMatchingSelector === "number"
      ? siblings.totalMatchingSelector
      : 1;
  if (totalMatchingSelector <= 1) {
    return null;
  }
  const totalMatchingRole =
    typeof siblings?.totalMatchingRole === "number" ? siblings.totalMatchingRole : 0;
  const text = typeof event.text === "string" && event.text.trim()
    ? event.text.trim()
    : (typeof event.fieldName === "string" ? event.fieldName.trim() : "");
  const explicitRole = typeof event.role === "string" ? event.role.trim() : "";
  const tag = tagOfSelector(typeof event.selector === "string" ? event.selector : "");
  const role = explicitRole || IMPLICIT_ROLE_BY_TAG.get(tag) || "";
  if (role && totalMatchingRole === 1 && text.length > 0) {
    return { strategy: "role", role, name: text };
  }
  const scopeSelector = pickAncestorScope(event.ancestors ?? []);
  if (scopeSelector) {
    return { strategy: "ancestor-scope", scopeSelector };
  }
  return null;
}

/**
 * Convenience: same derivation but specifically for the submitter of a
 * submit event. Submitter has its own selector + text; ancestors and
 * siblings are NOT separately recorded by the emitter, so we fall
 * back to the parent event's ancestor chain (the form's chain). When
 * the submitter selector is itself unique under the form-scope, this
 * yields a usable atomic combo.
 *
 * @param {AtomicFpInput | null | undefined} event
 */
export function deriveAtomicSubmitter(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const submitterSelector = /** @type {string | undefined} */ (
    /** @type {Record<string, unknown>} */ (event).submitterSelector
  );
  const submitterText = /** @type {string | undefined} */ (
    /** @type {Record<string, unknown>} */ (event).submitterText
  );
  if (!submitterSelector) {
    return null;
  }
  // No separate `siblings` are emitted for the submitter element,
  // so we cannot apply the totalMatchingSelector gate here. Use the
  // role rule when the submitter selector tag has an implicit role and
  // a meaningful submitterText — this is strictly an enhancement; the
  // existing `step.submitterSelector` continues to be the fallback.
  const tag = tagOfSelector(submitterSelector);
  const role = IMPLICIT_ROLE_BY_TAG.get(tag) ?? "";
  const text = typeof submitterText === "string" ? submitterText.trim() : "";
  if (role && text.length > 0 && tag === "button") {
    return { strategy: "role", role, name: text };
  }
  return null;
}
