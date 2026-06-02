// @ts-check
// Pure first-seen ordinal assigner for capture tab tagging. targetId is per-run;
// the ordinal (creation order) is the stable cross-run key. Empty/unknown -> 0.
export function makeTabOrdinal() {
  /** @type {Map<string, number>} */ const map = new Map();
  let next = 0;
  return {
    /** @param {string} targetId @returns {number} */
    ordinalFor(targetId) {
      if (!targetId) return 0;
      if (!map.has(targetId)) map.set(targetId, next++);
      return /** @type {number} */ (map.get(targetId));
    },
    /** @param {string} targetId @returns {number | undefined} */
    lookupOrdinal(targetId) {
      if (!targetId) return undefined;
      return map.get(targetId);
    },
    /** @returns {number} */
    count() { return Math.max(1, next); }
  };
}
