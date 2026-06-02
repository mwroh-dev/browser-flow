// @ts-check

// applyScope — deterministic application of the scope-agent's verdict
// onto a signal-poor step's locator. The model produces the verdict; this
// code applies it so the deterministic pipeline stays in control.
// scope-agent runs at ANALYZE (proactive establish), so apply does NOT
// cleanup/re-run (that is the reactive heal/score path) — it enriches
// the locator and the normal generate→verify continues.
//
// Writes: anchors → locator.neighborTexts (target's identity signal),
//         scope   → locator.disambiguation.scopeRule (candidate harvest rule),
//         signalWeights → locator.disambiguation.weightOverrides (merged).

function isRedacted(/** @type {unknown} */ v) { return /^<redacted/.test(String(v ?? "")); }

/**
 * @param {Array<Record<string, any>>} steps
 * @param {{ stepIndex?: number, status?: string, anchors?: string[], scope?: Record<string, unknown>, signalWeights?: Record<string, number>, resolutionMethod?: "A" | "B" }} scopeResult
 * @returns {{ applied: boolean, stepIndex: number|undefined, anchorCount?: number }}
 */
export function applyScope(steps, scopeResult) {
  const stepIndex = scopeResult ? scopeResult.stepIndex : undefined;
  if (!scopeResult) return { applied: false, stepIndex };
  const step = (Array.isArray(steps) && typeof stepIndex === "number") ? steps[stepIndex] : undefined;
  if (!step || !step.locator) return { applied: false, stepIndex };
  const loc = step.locator;
  let applied = false;

  // freeze the model's resolution-method verdict. Method B
  // (morphing/anonymous) may carry NO anchors, so this is applied independently
  // of the anchor path below.
  if (scopeResult.resolutionMethod === "A" || scopeResult.resolutionMethod === "B") {
    loc.disambiguation = loc.disambiguation || {};
    loc.disambiguation.resolutionMethod = scopeResult.resolutionMethod;
    applied = true;
  }

  // Method-A anchor scoping — only when scoped with non-empty (agent-blind) anchors.
  if (scopeResult.status === "scoped") {
    const anchors = (scopeResult.anchors || []).filter((a) => a != null && String(a) !== "" && !isRedacted(a));
    if (anchors.length > 0) {
      loc.neighborTexts = anchors;
      loc.disambiguation = loc.disambiguation || {};
      if (scopeResult.scope) loc.disambiguation.scopeRule = scopeResult.scope;
      if (scopeResult.signalWeights) {
        loc.disambiguation.weightOverrides = { ...(loc.disambiguation.weightOverrides || {}), ...scopeResult.signalWeights };
      }
      return { applied: true, stepIndex, anchorCount: anchors.length };
    }
  }

  return { applied, stepIndex };
}
