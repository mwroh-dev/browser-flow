import { findDeleteAffordances } from "./affordance-search.mjs";
import { deriveAtomicLocator } from "./atomic-fp.mjs";

/**
 * Build a `record`-strategy teardown object from a cleanup capture's steps.
 * The cleanup steps are the operator's recorded "how to remove what the
 * forward flow created" — run by verify AFTER the forward replay.
 *
 * @param {Array<Record<string, unknown>>} cleanupSteps
 * @param {{ prefix: string, hashLen: number }} [dummyNaming]
 * @returns {{ strategy: "record", steps: Array<Record<string, unknown>>, dummyNaming: { prefix: string, hashLen: number } }}
 */
export function buildRecordTeardown(cleanupSteps, dummyNaming) {
  return {
    strategy: "record",
    steps: Array.isArray(cleanupSteps) ? cleanupSteps : [],
    dummyNaming: dummyNaming ?? { prefix: "__bf_test__", hashLen: 8 }
  };
}

/**
 * Build a `search`-strategy teardown by deterministically discovering a delete
 * affordance in a captured page's selectors. Human-verified on first verify
 * (same gate as `record`). Empty steps = nothing found → operator falls back to record.
 *
 * @param {import("./affordance-search.mjs").SelectorEntry[]} selectorEntries
 * @param {string} intent  natural-language cleanup intent (operator-supplied; reserved for ranking)
 * @param {{ prefix: string, hashLen: number }} [dummyNaming]
 * @returns {{ strategy: "search", steps: Array<Record<string, unknown>>, dummyNaming: { prefix: string, hashLen: number } }}
 */
export function buildSearchTeardown(selectorEntries, intent, dummyNaming) {
  void intent; // reserved for future ranking by intent overlap
  const hits = findDeleteAffordances(selectorEntries);
  /** @type {Array<Record<string, unknown>>} */
  const steps = [];
  if (hits.length > 0) {
    const best = hits[0]; // first match; ranking by intent overlap is a later refinement
    /** @type {Record<string, unknown>} */
    const step = { action: "click", selector: best.selector, text: best.text };
    const fp = deriveAtomicLocator(/** @type {any} */ ({ selector: best.selector, text: best.text, ancestors: best.ancestors, siblings: best.siblings }));
    if (fp) step.atomicFp = fp;
    steps.push(step);
  }
  return { strategy: "search", steps, dummyNaming: dummyNaming ?? { prefix: "__bf_test__", hashLen: 8 } };
}
