// @ts-check
import { equalitySim, normLevenshtein, wordSetJaccard, numericSim, urlPathSim } from "./signal-similarity.mjs";

// Similo-seeded default weights. STABLE tier (high weight) corroborates identity.
export const DEFAULT_WEIGHTS = {
  name: 1.5, structuralKey: 1.5, neighborTexts: 1.5, cleanId: 1.5, semanticRegion: 1.5,   // stable
  identityKey: 1.5, identityShape: 1.5, controlKind: 1.5,
  role: 1.0, type: 1.0, alt: 1.0, href: 1.0,                          // medium
  relXPath: 0.5, box: 0.5                                             // weak
};
// A signal contributes to confidence "mass" iff its EFFECTIVE (possibly-overridden)
// weight is at the stable tier. With DEFAULT_WEIGHTS the tier-1.5 signals are exactly
// {name, structuralKey, neighborTexts, cleanId} — so default behavior is unchanged —
// but a per-element weightOverride that lifts e.g. href to 1.5 makes it
// count toward mass too, and one that drops a brittle structuralKey to 0.5 removes it.
export const STABLE_TIER = 1.5;

// How each signal's similarity is computed.
/** @type {Record<string, (a: unknown, b: unknown) => number>} */
const SIM = {
  structuralKey: equalitySim, cleanId: equalitySim, type: equalitySim, role: equalitySim,
  identityKey: equalitySim, identityShape: equalitySim, controlKind: equalitySim,
  name: normLevenshtein, href: urlPathSim, alt: normLevenshtein, relXPath: normLevenshtein,
  neighborTexts: (a, b) => wordSetJaccard(toArr(a), toArr(b)),
  semanticRegion: semanticRegionSim
};

function toArr(/** @type {unknown} */ v) { return Array.isArray(v) ? v : (v ? [String(v)] : []); }

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function toObj(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * User-visible section/card context is stronger than DOM sibling text for
 * repeated generic actions ("More", "Details"). Keep it generic: compare
 * labels/headings, role, and coarse target position within the region.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
function semanticRegionSim(a, b) {
  const left = toObj(a);
  const right = toObj(b);
  const leftText = [left.headingText, left.label].filter(Boolean).join(" ");
  const rightText = [right.headingText, right.label].filter(Boolean).join(" ");
  const textScore = leftText || rightText ? wordSetJaccard(toArr(leftText), toArr(rightText)) : 0;
  const roleScore = left.role || right.role ? equalitySim(left.role, right.role) : 0;
  const positionScore = targetPositionSim(left.targetPosition, right.targetPosition);
  const regionCountScore = typeof left.sameNameCountRegion === "number" && typeof right.sameNameCountRegion === "number"
    ? numericScalarSim(left.sameNameCountRegion, right.sameNameCountRegion)
    : 0;
  return (textScore * 0.65) + (roleScore * 0.15) + (positionScore * 0.15) + (regionCountScore * 0.05);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function targetPositionSim(a, b) {
  const left = toObj(a);
  const right = toObj(b);
  if (typeof left.x !== "number" || typeof left.y !== "number" ||
      typeof right.x !== "number" || typeof right.y !== "number") {
    return 0;
  }
  const distance = Math.hypot(left.x - right.x, left.y - right.y);
  return Math.max(0, 1 - Math.min(distance, 1));
}

function numericScalarSim(/** @type {number} */ a, /** @type {number} */ b) {
  if (a === b) return 1;
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.max(0, 1 - Math.abs(a - b) / max);
}

// A signal redacted by the agent-blind sanitizer ("<redacted-field>", "<redacted-secret>", …)
// carries NO matchable information — it must be treated as ABSENT, not scored against the live
// value (else the redaction token mismatches the real value and wrongly tanks confidence).
function isRedacted(/** @type {unknown} */ s) { return /^<redacted/.test(String(s ?? "")); }
/** Strip redaction tokens: string -> "" if redacted; array -> drop redacted entries. @returns {unknown} */
function clean(/** @type {unknown} */ v) {
  if (Array.isArray(v)) return v.filter((x) => !isRedacted(x));
  return isRedacted(v) ? "" : v;
}
/** a signal is "present" in the target if it has a non-empty, non-redacted value. */
function present(/** @type {unknown} */ v) { const c = clean(v); if (Array.isArray(c)) return c.length > 0; return c != null && String(c) !== ""; }

/**
 * Score each candidate vs target. Only signals PRESENT in target contribute
 * (missing target signals don't penalize). Returns [{cand, score, perSignal}].
 * @param {Record<string,unknown>} target
 * @param {Array<Record<string,unknown>>} candidates
 * @param {Record<string,number>} weights
 * @param {{w?:number,h?:number}} [viewport]
 * @returns {Array<{cand:Record<string,unknown>, score:number, perSignal:Record<string,number>}>}
 */
export function scoreCandidates(target, candidates, weights = DEFAULT_WEIGHTS, viewport = { w: 1, h: 1 }) {
  const keys = Object.keys(weights).filter((k) => present(target[k]));
  return (candidates || []).map((cand) => {
    /** @type {Record<string,number>} */ const perSignal = {};
    let num = 0, den = 0;
    for (const k of keys) {
      const w = weights[k];
      /** @type {number} */ let sim;
      if (k === "box") {
        sim = numericSim(
          /** @type {{cx?:number,cy?:number}} */ (target["box"] || {}),
          /** @type {{cx?:number,cy?:number}} */ (cand["box"] || {}),
          /** @type {{w?:number,h?:number}} */ (target["viewport"] || viewport)
        );
      } else if (SIM[k]) {
        sim = SIM[k](clean(target[k]), clean(cand[k]));
      } else {
        sim = equalitySim(clean(target[k]), clean(cand[k]));
      }
      perSignal[k] = sim;
      num += w * sim; den += w;
    }
    const rawScore = den === 0 ? 0 : num / den;
    const visibilityPenalty = targetVisibilityPenalty(target);
    if (visibilityPenalty < 1) {
      perSignal.visibility = visibilityPenalty;
    }
    return { cand, score: rawScore * visibilityPenalty, perSignal };
  });
}

/**
 * A captured zero-box/hidden target is usually an implementation-layer node,
 * not the visible thing the operator meant. Keep raw evidence, but prevent
 * those signals from becoming high-confidence replay identity by themselves.
 * @param {Record<string, unknown>} target
 */
function targetVisibilityPenalty(target) {
  const visibility = target.targetVisibility && typeof target.targetVisibility === "object"
    ? /** @type {Record<string, unknown>} */ (target.targetVisibility)
    : null;
  if (visibility?.hasVisibleBox === false) return 0.5;
  const box = target.box && typeof target.box === "object"
    ? /** @type {Record<string, unknown>} */ (target.box)
    : null;
  if (box && typeof box.w === "number" && typeof box.h === "number" && (box.w <= 0 || box.h <= 0)) {
    return 0.5;
  }
  return 1;
}

/**
 * Coverage-aware confidence: HIGH iff winner>=absFloor AND margin>=marginMin AND
 * highWeightMass>=massMin. highWeightMass = (weighted sim of STABLE signals present)
 * normalized by stable weight present — "did the high-weight signals corroborate".
 * @param {Array<{cand:Record<string,unknown>, score:number, perSignal:Record<string,number>}>} scored
 * @param {{absFloor?:number, marginMin?:number, massMin?:number, weights?:Record<string,number>}} [opts]
 * @returns {{pick:number, confidence:"high"|"low", reason:string, winner:number, margin:number, highWeightMass:number}}
 */
export function decideConfidence(scored, opts = {}) {
  const absFloor = opts.absFloor ?? 0.6, marginMin = opts.marginMin ?? 0.12, massMin = opts.massMin ?? 0.55;
  /** @type {Record<string,number>} */ const weights = opts.weights ?? DEFAULT_WEIGHTS;
  if (!scored || scored.length === 0) return { pick: -1, confidence: "low", reason: "no candidates", winner: 0, margin: 0, highWeightMass: 0 };
  const order = scored.map((s, i) => ({ i, s })).sort((a, b) => b.s.score - a.s.score);
  const top = order[0], second = order[1];
  const winner = top.s.score;
  const margin = winner - (second ? second.s.score : 0);
  // highWeightMass for the winner
  let mNum = 0, mDen = 0;
  for (const k of Object.keys(top.s.perSignal)) if ((weights[k] ?? 0) >= STABLE_TIER) { mNum += weights[k] * top.s.perSignal[k]; mDen += weights[k]; }
  const highWeightMass = mDen === 0 ? 0 : mNum / mDen;
  const ok = winner >= absFloor && margin >= marginMin && highWeightMass >= massMin;
  return {
    pick: ok ? top.i : -1,
    confidence: ok ? "high" : "low",
    reason: ok ? "high" : `winner=${winner.toFixed(2)} margin=${margin.toFixed(2)} mass=${highWeightMass.toFixed(2)} (floor=${absFloor}/marginMin=${marginMin}/massMin=${massMin})`,
    winner, margin, highWeightMass
  };
}

/**
 * Ordinal tie-break for method B. When the scorer ties (N
 * identical/anonymous candidates, distinguishable only by position), pick the
 * one the user originally targeted via its recorded ordinal among same-key
 * candidates (DOM order). Only the tie group (scores within eps of the winner)
 * that shares the target's structuralKey is considered. Returns the index into
 * `scored`/`candidates`, or -1 when the ordinal can't be applied (→ caller
 * drift-holds, fail-safe).
 *
 * @param {Array<{score:number}>} scored
 * @param {Array<{i:number, signals?:Record<string,unknown>}>} candidates  parallel to scored
 * @param {string|undefined} targetStructuralKey
 * @param {number} ordinalHint  0-based index among same-key candidates in DOM order
 * @param {{ eps?: number }} [opts]
 * @returns {number}
 */
export function pickByOrdinal(scored, candidates, targetStructuralKey, ordinalHint, opts = {}) {
  const eps = opts.eps ?? 0.001;
  if (!Array.isArray(scored) || scored.length === 0) return -1;
  if (!Number.isInteger(ordinalHint) || ordinalHint < 0) return -1;
  const top = Math.max(...scored.map((s) => s.score));
  /** @type {Array<{ k:number, dom:number }>} */
  const group = [];
  for (let k = 0; k < scored.length; k += 1) {
    if (top - scored[k].score > eps) continue;
    const sig = candidates[k] && candidates[k].signals ? candidates[k].signals : undefined;
    const key = sig ? sig.structuralKey : undefined;
    if (targetStructuralKey && key !== targetStructuralKey) continue;
    group.push({ k, dom: candidates[k] ? candidates[k].i : k });
  }
  if (group.length <= 1) return -1; // not a real tie group → nothing to disambiguate
  group.sort((a, b) => a.dom - b.dom);
  if (ordinalHint >= group.length) return -1;
  return group[ordinalHint].k;
}
