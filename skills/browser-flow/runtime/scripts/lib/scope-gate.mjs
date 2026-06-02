// @ts-check

// Signal-poor detection — the deterministic gate that decides which
// captured elements need the scope-agent. A locator is "signal-poor" when NONE
// of its distinguishing signals is present; only volatile/positional signals
// (structuralKey/relXPath/box) remain, so identical look-alikes can't be told
// apart (Gap2 Keep: empty <p role=presentation> ×3). Those are exactly the
// elements where the model must read the DOM to find an identifying region/anchor
// wherever it lives in the tree — code can't know the level a priori.

// The distinguishing (identity-bearing) signals. structuralKey/relXPath/box are
// deliberately excluded: they are positional/volatile (hashed SPA classes, DOM
// path) and don't distinguish look-alikes on their own.
const DISTINGUISHING = ["name", "neighborTexts", "cleanId", "href"];

/** A redaction sentinel carries no matchable info → treat as absent (agent-blind). */
function isRedacted(/** @type {unknown} */ v) {
  return /^<redacted/.test(String(v ?? ""));
}

/** Present = non-empty AND non-redacted (arrays: at least one non-redacted entry). */
function present(/** @type {unknown} */ v) {
  if (Array.isArray(v)) return v.some((x) => x != null && String(x) !== "" && !isRedacted(x));
  return v != null && String(v) !== "" && !isRedacted(v);
}

/**
 * @param {Record<string, unknown> | null | undefined} locator
 * @returns {boolean} true iff no distinguishing signal is present → scope-agent target.
 */
export function isSignalPoor(locator) {
  if (!locator || typeof locator !== "object") return false;
  return !DISTINGUISHING.some((k) => present(/** @type {Record<string, unknown>} */ (locator)[k]));
}
