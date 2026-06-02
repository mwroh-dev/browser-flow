import { isStateProofProviderContext } from "../lib/provider-context.mjs";

export const REPLAY_PERMISSION_LEVELS = Object.freeze({
  DENY: "deny",
  STRICT_REPLAY: "strict-replay",
  CANONICALIZE: "canonicalize",
  CONFIRMED_EQUIVALENCE: "confirmed-equivalence",
  STATE_PROOF_REPLAY: "state-proof-replay"
});

/**
 * @param {string} value
 */
export function normalizeActionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Generic affordance labels describe UI mechanics, not the destination. They
 * need semantic context before replay can safely pick among repeated copies.
 * @param {string} value
 */
export function isGenericAffordanceName(value) {
  const text = normalizeActionText(value).toLowerCase();
  if (!text) return true;
  if (/^(more|details?|view more|learn more|see more|open|show|expand|next)$/.test(text)) return true;
  if (/^(더보기|더 보기|자세히 보기|상세보기|상세 보기|보기|열기)$/.test(text)) return true;
  return false;
}

/**
 * Short labels can still be meaningful domain concepts. Do not treat them like
 * generic affordances when stable surrounding signals exist.
 * @param {string} value
 */
export function isShortDomainLabel(value) {
  const text = normalizeActionText(value);
  if (!text || isGenericAffordanceName(text)) return false;
  return text.length <= 3;
}

/**
 * @param {string} value
 */
export function isWeakActionName(value) {
  const text = normalizeActionText(value);
  return !text || isGenericAffordanceName(text) || isShortDomainLabel(text);
}

/**
 * @param {Record<string, any>} action
 * @param {{
 *   replayIntent?: string,
 *   locatorIntentConfirmed?: boolean,
 *   navigationFallback?: boolean,
 *   actionSemantics?: Record<string, any> | null
 * }} [context]
 */
export function classifyReplayPermission(action, context = {}) {
  const replayIntent = String(context.replayIntent || action.replayIntent || "").toLowerCase();
  const rawKind = String(action.actionKind || "").toLowerCase();
  const actionSemantics = context.actionSemantics || action.actionSemantics || null;
  const hasNavigationFallback = Boolean(context.navigationFallback || action.navigationFallback);
  const hasLocatorIntent = Boolean(context.locatorIntentConfirmed || action.locatorIntentReview);

  if (action.denyReplay === true) {
    return permission(REPLAY_PERMISSION_LEVELS.DENY, "explicit-deny", "runtime");
  }
  if (actionSemantics?.kind === "stateful-affordance") {
    return permission(REPLAY_PERMISSION_LEVELS.CANONICALIZE, "stateful-affordance", "runtime", false, false);
  }
  if (hasNavigationFallback && hasLocatorIntent) {
    return permission(REPLAY_PERMISSION_LEVELS.CONFIRMED_EQUIVALENCE, "confirmed-pure-navigation", "user-review", true, false);
  }
  if (replayIntent === "state_action") {
    return permission(REPLAY_PERMISSION_LEVELS.STATE_PROOF_REPLAY, "same-page-state-control", "runtime", false, true);
  }
  if (isStateProofProviderContext(action.providerContext)) {
    return permission(REPLAY_PERMISSION_LEVELS.STATE_PROOF_REPLAY, "provider-state-control", "runtime", false, true);
  }
  if (rawKind === "implementation-layer" || action.replayRisk) {
    return permission(REPLAY_PERMISSION_LEVELS.STRICT_REPLAY, "reviewed-implementation-layer", "user-review", false, false);
  }
  return permission(REPLAY_PERMISSION_LEVELS.STRICT_REPLAY, "default-action", "runtime", false, false);
}

/**
 * @param {Record<string, any>} action
 */
export function isSamePageStateControlLike(action) {
  if (isStateProofProviderContext(action.providerContext)) return true;
  const href = String(action.href || action.submitterHref || action.formAction || action.locator?.href || "").trim();
  if (href || action.action === "submit") return false;
  const role = String(action.role || action.locator?.role || "").toLowerCase();
  const actionKind = String(action.actionKind || action.locator?.actionKind || action.replayIntent || "").toLowerCase();
  if (actionKind === "state_action") return true;
  if (action.actionSemantics || action.surfaceContext) return true;
  return new Set([
    "button",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "menuitem",
    "option"
  ]).has(role);
}

/**
 * @param {string} level
 * @param {string} reasonCode
 * @param {string} decisionSource
 * @param {boolean} [fallbackAllowed]
 * @param {boolean} [proofRequired]
 */
function permission(level, reasonCode, decisionSource, fallbackAllowed = false, proofRequired = false) {
  return {
    level,
    reasonCode,
    decisionSource,
    fallbackAllowed,
    proofRequired
  };
}
