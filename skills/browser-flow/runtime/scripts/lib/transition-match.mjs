// @ts-check
// Method-B runtime verification. Compares the RECORDED transition
// (step.transition, the capture-time before/after delta = answer key) against the
// LIVE transition (diffSkeletons of before/after captured around the replay
// action). A match confirms the action made the SAME affordances appear/change
// → the right (morphing/anonymous) element reacted. Mismatch → caller drift-holds
// (fail-safe). Deterministic; runtime LLM-free.

/**
 * @typedef {{ structuralKey?: string }} Aff
 * @typedef {{ appeared?: Aff[], disappeared?: Aff[], changed?: Array<{ old?: Aff, live?: Aff }> }} Delta
 */

/**
 * Collect the structuralKeys that a delta touched (appeared + disappeared +
 * both sides of changed). These are the "fingerprint" of what the action did.
 * @param {Delta | null | undefined} d
 * @returns {Set<string>}
 */
function deltaKeys(d) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!d) return out;
  for (const a of d.appeared || []) if (a && a.structuralKey) out.add(a.structuralKey);
  for (const a of d.disappeared || []) if (a && a.structuralKey) out.add(a.structuralKey);
  for (const c of d.changed || []) {
    if (c && c.old && c.old.structuralKey) out.add(c.old.structuralKey);
    if (c && c.live && c.live.structuralKey) out.add(c.live.structuralKey);
  }
  return out;
}

/**
 * Lenient match: the recorded delta's keys must overlap the live delta's keys by
 * at least `minOverlap`. If the recorded delta has no distinguishing keys, there
 * is nothing to verify → return true (don't block). This tolerates incidental
 * DOM churn (extra live changes) while catching "wrong element reacted" (zero
 * overlap of the recorded fingerprint).
 *
 * @param {Delta | null | undefined} recorded  step.transition
 * @param {Delta | null | undefined} live       diffSkeletons(before, after)
 * @param {{ minOverlap?: number }} [opts]
 * @returns {boolean}
 */
export function transitionMatches(recorded, live, opts = {}) {
  const minOverlap = opts.minOverlap ?? 1;
  const recKeys = deltaKeys(recorded);
  if (recKeys.size === 0) return true; // nothing distinguishing was recorded → cannot/needn't verify
  const liveKeys = deltaKeys(live);
  let overlap = 0;
  for (const k of recKeys) if (liveKeys.has(k)) overlap += 1;
  return overlap >= minOverlap;
}
