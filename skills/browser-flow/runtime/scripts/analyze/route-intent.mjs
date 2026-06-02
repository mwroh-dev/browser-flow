import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { isSamePageStateControlLike } from "./replay-policy.mjs";

/**
 * @param {{
 *   steps: Array<Record<string, any>>,
 *   proofs: Array<Record<string, any>>,
 *   finalUrl?: string,
 *   allowStateRoute?: boolean
 * }} input
 */
export function detectRouteIntent(input) {
  if (input.allowStateRoute === false) {
    return {
      schemaVersion: SCHEMA_VERSIONS.routeIntentPreview,
      status: "clean",
      suggestions: []
    };
  }
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const proofs = Array.isArray(input.proofs) ? input.proofs : [];
  const finalUrl = input.finalUrl || findFinalUrlProof(proofs)?.expectedUrl || "";
  const candidate = buildStateUrlCandidate(steps, proofs, finalUrl);
  const suggestions = candidate ? [candidate] : [];
  return {
    schemaVersion: SCHEMA_VERSIONS.routeIntentPreview,
    status: suggestions.length > 0 ? "needs_review" : "clean",
    suggestions
  };
}

/**
 * @param {{
 *   steps: Array<Record<string, any>>,
 *   proofs: Array<Record<string, any>>,
 *   finalUrl?: string,
 *   preview?: Record<string, any> | null,
 *   result?: Record<string, any> | null
 * }} input
 */
export function applyRouteIntentReview(input) {
  const preview = input.preview;
  if (!preview || preview.status !== "needs_review") {
    return {
      steps: input.steps,
      proofs: input.proofs,
      intentPlan: null
    };
  }

  const candidates = Array.isArray(preview.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
  const decisions = new Map(
    Array.isArray(input.result?.decisions)
      ? input.result.decisions
        .filter((entry) => entry && typeof entry.candidateId === "string" && typeof entry.verdict === "string")
        .map((entry) => [entry.candidateId, entry.verdict])
      : []
  );
  const unresolved = candidates.filter((candidate) => !decisions.has(candidate.candidateId));
  if (unresolved.length > 0) {
    throw new Error(`route intent review required before analyze: unresolved candidate(s) ${unresolved.map((entry) => entry.candidateId).join(", ")}`);
  }

  const confirmed = candidates.find((candidate) => decisions.get(candidate.candidateId) === "confirm-state-route");
  if (!confirmed) {
    return {
      steps: input.steps,
      proofs: input.proofs,
      intentPlan: {
        strategy: "captured-dom",
        source: "route-intent",
        omittedStepIndexes: [],
        checkpointResolved: "route_intent_review"
      }
    };
  }

  const targetStateUrl = String(confirmed.targetStateUrl || input.finalUrl || findFinalUrlProof(input.proofs)?.expectedUrl || "");
  const proofs = Array.isArray(confirmed.proofs) && confirmed.proofs.length > 0
    ? confirmed.proofs
    : input.proofs;
  const omittedStepIndexes = Array.isArray(confirmed.omittedSteps)
    ? confirmed.omittedSteps
      .map((/** @type {Record<string, any>} */ step) => step?.stepIndex)
      .filter((/** @type {unknown} */ value) => Number.isInteger(value))
    : [];

  return {
    steps: [{ action: "goto", url: targetStateUrl }],
    proofs,
    intentPlan: {
      strategy: "state-url",
      source: "route-intent",
      targetStateUrl,
      proofs,
      omittedStepIndexes,
      checkpointResolved: "route_intent_review"
    }
  };
}

/**
 * @param {Array<Record<string, any>>} steps
 * @param {Array<Record<string, any>>} proofs
 * @param {string} finalUrl
 */
function buildStateUrlCandidate(steps, proofs, finalUrl) {
  if (!finalUrl) return null;
  const urlStateProof = proofs.find((proof) =>
    proof?.kind === "url-state" &&
    String(proof.expectedUrl || "") === finalUrl &&
    Array.isArray(proof.params) &&
    proof.params.length > 0
  );
  if (!urlStateProof) return null;
  const finalUrlProof = findFinalUrlProof(proofs);
  if (!finalUrlProof) return null;
  const omittedSteps = steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => step?.action && step.action !== "goto");
  if (omittedSteps.length === 0) return null;
  if (omittedSteps.some(({ step }) => isUnsafeForStateRoute(step))) return null;
  if (omittedSteps.some(({ step }) => !isSimpleNavigationClick(step, finalUrl))) return null;

  const routeProofs = selectStateRouteProofs(proofs);
  if (!routeProofs.some((proof) => proof.kind === "final-url") ||
      !routeProofs.some((proof) => proof.kind === "url-state")) {
    return null;
  }

  return {
    candidateId: "ri1",
    strategy: "state-url",
    targetStateUrl: finalUrl,
    proofs: routeProofs,
    omittedSteps: omittedSteps.map(({ step, stepIndex }) => ({
      stepIndex,
      action: String(step.action || ""),
      text: stringOrUndefined(step.text || step.locator?.name),
      href: stringOrUndefined(step.href || step.locator?.href || step.expectUrl),
      pageUrl: stringOrUndefined(step.pageUrl || step.url),
      ...(step.providerContext ? { providerContext: step.providerContext } : {})
    })),
    risks: [
      "omits captured DOM clicks after user confirms the final URL state is outcome-equivalent",
      "state route is allowed only because query/hash URL state is part of the proof set"
    ],
    recommendedAction: "confirm-state-route",
    summary: `Replay can navigate directly to the approved state URL ${finalUrl} instead of replaying ${omittedSteps.length} captured DOM click(s).`
  };
}

/**
 * @param {Array<Record<string, any>>} proofs
 */
function findFinalUrlProof(proofs) {
  return proofs.find((proof) => proof?.kind === "final-url" && typeof proof.expectedUrl === "string");
}

/**
 * @param {Array<Record<string, any>>} proofs
 */
function selectStateRouteProofs(proofs) {
  return proofs.filter((proof) =>
    proof &&
    (proof.kind === "final-url" ||
      proof.kind === "url-state" ||
      proof.kind === "network" ||
      proof.kind === "dom-evidence")
  );
}

/**
 * @param {Record<string, any>} step
 */
function isUnsafeForStateRoute(step) {
  const action = String(step.action || "");
  if (action === "fill" || action === "input" || action === "submit") return true;
  if (step.formAction || step.formId || step.formName || step.submitterHref || step.submitterSelector) return true;
  if (step.newTab || step.opensNewTab || step.modifier || step.modifiers) return true;
  const text = String(step.text || step.locator?.name || "").toLowerCase();
  return /\b(delete|remove|purchase|pay|submit|send|share|save|logout|sign out)\b/.test(text);
}

/**
 * @param {Record<string, any>} step
 * @param {string} finalUrl
 */
function isSimpleNavigationClick(step, finalUrl) {
  if (step.action !== "click") return false;
  if (isSamePageStateControl(step)) return false;
  const href = String(step.href || step.locator?.href || "");
  const expectUrl = String(step.expectUrl || "");
  if (expectUrl && urlsEquivalent(expectUrl, finalUrl)) return true;
  if (href && urlsEquivalent(href, finalUrl)) return true;
  if (href && expectUrl && urlsEquivalent(expectUrl, finalUrl)) return true;
  return Boolean(href && hasUrlState(finalUrl));
}

/**
 * @param {Record<string, any>} step
 */
function isSamePageStateControl(step) {
  return isSamePageStateControlLike(step);
}

/**
 * @param {string} left
 * @param {string} right
 */
function urlsEquivalent(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    return new URL(left, right).href === new URL(right, right).href;
  } catch {
    return false;
  }
}

/**
 * @param {string} rawUrl
 */
function hasUrlState(rawUrl) {
  try {
    const url = new URL(rawUrl, "http://browser-flow.local");
    return url.search.length > 1 || url.hash.length > 1;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 */
function stringOrUndefined(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : undefined;
}
