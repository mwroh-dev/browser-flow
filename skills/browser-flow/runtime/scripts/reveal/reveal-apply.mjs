/**
 * Apply a reveal-agent result to workflow action semantics. PURE — returns a
 * cloned workflow when applied and leaves the input untouched.
 *
 * @param {{ id?: string, steps: Array<Record<string, any>>, revealCandidates?: number[] } & Record<string, any>} workflow
 * @param {{ runId?: string, status: string, stepIndex: number, verification?: string, hrefPolicy?: string, followupStepIndex?: number, reason?: string }} revealResult
 * @returns {{ workflow: any, applied: boolean, stepIndex: number, status: string, reason?: string }}
 */
export function applyReveal(workflow, revealResult) {
  if (revealResult.runId !== workflow.id) {
    throw new Error(`reveal-result for step ${revealResult.stepIndex} belongs to run ${JSON.stringify(revealResult.runId)}, expected ${JSON.stringify(workflow.id)}`);
  }
  if (!Array.isArray(workflow.revealCandidates) || !workflow.revealCandidates.includes(revealResult.stepIndex)) {
    throw new Error(`step ${revealResult.stepIndex} is not a queued reveal candidate`);
  }

  const next = structuredClone(workflow);
  if (Array.isArray(next.revealCandidates)) {
    next.revealCandidates = next.revealCandidates.filter((i) => i !== revealResult.stepIndex);
  }

  const step = next.steps?.[revealResult.stepIndex];
  if (!step) {
    throw new Error(`reveal-result stepIndex ${revealResult.stepIndex} does not exist in workflow`);
  }
  if (step.action !== "click") {
    throw new Error(`reveal-result stepIndex ${revealResult.stepIndex} is not a click step`);
  }

  if (revealResult.status === "not-reveal") {
    return {
      workflow: next,
      applied: false,
      stepIndex: revealResult.stepIndex,
      status: "not-reveal",
      reason: revealResult.reason
    };
  }

  if (!hasRevealTransitionEvidence(step.transition)) {
    throw new Error(`step ${revealResult.stepIndex} requires recorded transition evidence before enabling stateful-affordance semantics`);
  }
  const expectedFollowupStepIndex = nextClickIndex(next.steps, revealResult.stepIndex);
  if (
    typeof revealResult.followupStepIndex === "number" &&
    revealResult.followupStepIndex !== expectedFollowupStepIndex
  ) {
    throw new Error(`followupStepIndex ${revealResult.followupStepIndex} does not match expected ${expectedFollowupStepIndex}`);
  }

  step.actionSemantics = {
    kind: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    ...(typeof revealResult.followupStepIndex === "number"
      ? { followupStepIndex: revealResult.followupStepIndex }
      : {})
  };

  return {
    workflow: next,
    applied: true,
    stepIndex: revealResult.stepIndex,
    status: "stateful-affordance"
  };
}

/**
 * @param {Array<Record<string, any>>} steps
 * @param {number} stepIndex
 * @returns {number | null}
 */
function nextClickIndex(steps, stepIndex) {
  for (let i = stepIndex + 1; i < steps.length; i += 1) {
    if (steps[i]?.action === "click") return i;
  }
  return null;
}

/**
 * Reveal semantics must be grounded in an actual captured affordance change,
 * not just a stale href override.
 *
 * @param {Record<string, any> | undefined} transition
 * @returns {boolean}
 */
function hasRevealTransitionEvidence(transition) {
  const appeared = Array.isArray(transition?.appeared) ? transition.appeared : [];
  const changed = Array.isArray(transition?.changed) ? transition.changed : [];
  return appeared.length > 0 || changed.length > 0;
}
