/**
 * Variable-binding dependency graph.
 *
 * Segments are page-node-bounded step ranges. A segment "references" input X
 * if any step in its range has `valueRef: "{{input.X}}"`. Segments sharing
 * an input are data-coupled; a "hold" on one cascades to all downstream
 * segments that share its inputs (transitively).
 */

import { parsePlaceholder } from "./workflow-inputs.mjs";

/**
 * @typedef {{ steps?: unknown[], segments?: unknown[] }} Workflow
 */

/**
 * Return the effective segments for a workflow. If `workflow.segments` is a
 * non-empty array, use it. If steps exist but no segments, synthesise one
 * implicit segment covering all steps. Otherwise return [].
 *
 * @param {Workflow} wf
 * @returns {{ range: [number, number] }[]}
 */
function effectiveSegments(wf) {
  const segs = wf.segments;
  if (Array.isArray(segs) && segs.length > 0) {
    return /** @type {{ range: [number, number] }[]} */ (segs);
  }
  const steps = wf.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    return [{ range: [0, steps.length - 1] }];
  }
  return [];
}

/**
 * For each segment, return the distinct input names referenced by steps in
 * its range.
 *
 * @param {Workflow} wf
 * @returns {string[][]}
 */
export function segmentInputs(wf) {
  if (!wf || typeof wf !== "object") return [];
  const steps = Array.isArray(wf.steps) ? wf.steps : [];
  const segs = effectiveSegments(wf);
  if (segs.length === 0) return [];

  return segs.map((seg) => {
    const [start, end] = /** @type {[number, number]} */ (
      Array.isArray(seg.range) ? seg.range : [0, steps.length - 1]
    );
    /** @type {Set<string>} */
    const names = new Set();
    for (let i = start; i <= end; i++) {
      const step = steps[i];
      if (!step || typeof step !== "object") continue;
      const valueRef = /** @type {Record<string, unknown>} */ (step).valueRef;
      const inputName = parsePlaceholder(valueRef);
      if (inputName !== null) names.add(inputName);
    }
    return [...names];
  });
}

/**
 * Build a dependency graph from a workflow. Exposes `sharesInput(i, j)`
 * which returns true when segments i and j share at least one input binding.
 *
 * @param {Workflow} wf
 * @returns {{ sharesInput(i: number, j: number): boolean }}
 */
export function buildDependencyGraph(wf) {
  const inputsPerSeg = segmentInputs(wf);
  return {
    sharesInput(i, j) {
      if (i === j) return false;
      const a = inputsPerSeg[i];
      const b = inputsPerSeg[j];
      if (!a || !b || a.length === 0 || b.length === 0) return false;
      return a.some((x) => b.includes(x));
    }
  };
}

/**
 * Return the set of segment indices affected when segment `heldIndex` is
 * held (including itself). Cascades transitively to downstream segments that
 * share an input with any already-affected segment.
 *
 * @param {Workflow} wf
 * @param {number} heldIndex
 * @returns {number[]}
 */
export function affectedByHold(wf, heldIndex) {
  const inputsPerSeg = segmentInputs(wf);

  // If no segments or heldIndex is out of range, return just the held index.
  if (inputsPerSeg.length === 0 || heldIndex >= inputsPerSeg.length) {
    return [heldIndex];
  }

  /** @type {Set<number>} */
  const affected = new Set([heldIndex]);

  // Collect the union of inputs for all segments currently in affected.
  // Re-compute on each iteration to support transitive propagation.
  let changed = true;
  while (changed) {
    changed = false;
    // Build current affected-inputs union
    /** @type {Set<string>} */
    const affectedInputs = new Set();
    for (const idx of affected) {
      const ins = inputsPerSeg[idx];
      if (ins) for (const name of ins) affectedInputs.add(name);
    }

    for (let m = heldIndex + 1; m < inputsPerSeg.length; m++) {
      if (affected.has(m)) continue;
      const mIns = inputsPerSeg[m];
      if (!mIns || mIns.length === 0) continue;
      if (mIns.some((x) => affectedInputs.has(x))) {
        affected.add(m);
        changed = true;
      }
    }
  }

  return [...affected].sort((a, b) => a - b);
}
