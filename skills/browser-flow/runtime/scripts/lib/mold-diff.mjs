/**
 * @typedef {{ role?: string, name?: string, structuralKey?: string }} Affordance
 * @typedef {{ unchanged: Affordance[], changed: Array<{ old: Affordance, live: Affordance }>, appeared: Affordance[], disappeared: Affordance[] }} SkeletonDiff
 */

/**
 * Diff two affordance skeletons (stored vs live) to surface what changed.
 *
 * Matching priority:
 *   1. Exact structuralKey match — if name also matches → unchanged; else → changed.
 *   2. role+name match (key changed) → changed.
 *   3. No match → appeared / disappeared.
 *
 * @param {Affordance[]|null|undefined} oldSkel
 * @param {Affordance[]|null|undefined} liveSkel
 * @returns {SkeletonDiff}
 */
export function diffSkeletons(oldSkel, liveSkel) {
  const olds = Array.isArray(oldSkel) ? oldSkel : [];
  const lives = Array.isArray(liveSkel) ? liveSkel : [];

  /** @type {SkeletonDiff} */
  const out = { unchanged: [], changed: [], appeared: [], disappeared: [] };

  /** @type {Set<number>} indices into `lives` already consumed */
  const liveUsed = new Set();
  /** @type {Set<number>} indices into `olds` already matched */
  const oldMatched = new Set();

  // Pass 1: exact structuralKey match.
  for (let i = 0; i < olds.length; i += 1) {
    const o = olds[i];
    if (!o.structuralKey) continue;
    const j = lives.findIndex(
      (l, li) => !liveUsed.has(li) && l.structuralKey === o.structuralKey
    );
    if (j < 0) continue;
    liveUsed.add(j);
    oldMatched.add(i);
    if ((lives[j].name ?? "") === (o.name ?? "")) {
      out.unchanged.push(o);
    } else {
      out.changed.push({ old: o, live: lives[j] });
    }
  }

  // Pass 2: role+name match for unmatched olds (identity moved → new key) → changed.
  for (let i = 0; i < olds.length; i += 1) {
    if (oldMatched.has(i)) continue;
    const o = olds[i];
    const j = lives.findIndex(
      (l, li) =>
        !liveUsed.has(li) &&
        (l.role ?? "") === (o.role ?? "") &&
        (l.name ?? "") === (o.name ?? "")
    );
    if (j < 0) continue;
    liveUsed.add(j);
    oldMatched.add(i);
    out.changed.push({ old: o, live: lives[j] });
  }

  // Leftovers.
  for (let i = 0; i < olds.length; i += 1) {
    if (!oldMatched.has(i)) out.disappeared.push(olds[i]);
  }
  for (let j = 0; j < lives.length; j += 1) {
    if (!liveUsed.has(j)) out.appeared.push(lives[j]);
  }

  return out;
}
