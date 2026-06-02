import { derivePageKey } from "./page-key.mjs";
import { deriveSurfaceContextForStep } from "./surface-context.mjs";

export const PROVIDER_PATTERNS = Object.freeze([
  "document-navigation",
  "spa-route-state",
  "stateful-affordance",
  "layered-control-surface",
  "rendered-data-surface",
  "implementation-proxy",
  "auto-observation"
]);

export const PROVIDER_STATE_CARRIERS = Object.freeze([
  "url",
  "dom",
  "aria",
  "network",
  "canvas-tile",
  "mixed",
  "none"
]);

export const PROVIDER_REPLAY_STRATEGIES = Object.freeze([
  "strict-click",
  "state-proof-click",
  "route-canonicalization",
  "exclude-observation",
  "needs-review"
]);

/**
 * @param {Record<string, any>} event
 * @param {{ pageKey?: string, fixture?: string, firstNavigate?: string }} [context]
 */
export function deriveProviderContextForEvent(event, context = {}) {
  if (!event || typeof event !== "object") return undefined;
  const pageKey = context.pageKey ||
    derivePageKey(String(event.url || context.firstNavigate || "about:blank"), context.fixture || "manual");
  const step = {
    ...event,
    action: event.type,
    pageKey
  };
  return deriveProviderContextForStep(step);
}

/**
 * @param {Record<string, any>} step
 */
export function deriveProviderContextForStep(step) {
  if (!step || typeof step !== "object") return undefined;
  const action = String(step.action || step.type || "");
  if (action !== "click" && action !== "submit") return undefined;

  const rawKind = String(step.actionKind || "").toLowerCase();
  if (rawKind === "observation") {
    return autoObservationContext();
  }

  const surfaceContext = deriveSurfaceContextForStep({
    ...step,
    action: action === "click" ? "click" : action
  });
  if (surfaceContext) {
    return {
      pattern: "layered-control-surface",
      stateCarrier: "canvas-tile",
      replayStrategy: "state-proof-click",
      surfaceKey: surfaceContext.surfaceKey,
      controlGroup: surfaceContext.controlGroup,
      confidence: "high"
    };
  }

  if (step.actionSemantics?.kind === "stateful-affordance") {
    return {
      pattern: "stateful-affordance",
      stateCarrier: "dom",
      replayStrategy: "state-proof-click",
      confidence: "high"
    };
  }

  if (isImplementationProxy(step)) {
    return {
      pattern: "implementation-proxy",
      stateCarrier: "none",
      replayStrategy: "needs-review",
      confidence: "medium"
    };
  }

  if (isSamePageStateControlShape(step)) {
    return {
      pattern: "layered-control-surface",
      stateCarrier: "dom",
      replayStrategy: "state-proof-click",
      confidence: "medium"
    };
  }

  if (hasNavigationTarget(step)) {
    const targetUrl = String(step.expectUrl || step.href || step.locator?.href || step.submitterHref || step.formAction || "");
    if (hasUrlState(targetUrl)) {
      return {
        pattern: "spa-route-state",
        stateCarrier: "url",
        replayStrategy: "route-canonicalization",
        confidence: "medium"
      };
    }
    return {
      pattern: "document-navigation",
      stateCarrier: "url",
      replayStrategy: "strict-click",
      confidence: "medium"
    };
  }

  return undefined;
}

/**
 * @param {Record<string, any> | null | undefined} providerContext
 */
export function providerSurfaceControlGroup(providerContext) {
  if (!providerContext || typeof providerContext !== "object") return null;
  const pattern = String(providerContext.pattern || "");
  const controlGroup = String(providerContext.controlGroup || "");
  if (pattern !== "layered-control-surface" || !controlGroup) return null;
  return controlGroup;
}

/**
 * @param {Record<string, any> | null | undefined} providerContext
 */
export function isStateProofProviderContext(providerContext) {
  if (!providerContext || typeof providerContext !== "object") return false;
  const strategy = String(providerContext.replayStrategy || "");
  const pattern = String(providerContext.pattern || "");
  return strategy === "state-proof-click" ||
    pattern === "layered-control-surface" ||
    pattern === "rendered-data-surface" ||
    pattern === "stateful-affordance";
}

export function autoObservationContext() {
  return {
    pattern: "auto-observation",
    stateCarrier: "none",
    replayStrategy: "exclude-observation",
    confidence: "medium"
  };
}

/**
 * @returns {readonly string[]}
 */
export function getProviderPatterns() {
  return PROVIDER_PATTERNS;
}

/**
 * @returns {readonly string[]}
 */
export function getProviderStateCarriers() {
  return PROVIDER_STATE_CARRIERS;
}

/**
 * @returns {readonly string[]}
 */
export function getProviderReplayStrategies() {
  return PROVIDER_REPLAY_STRATEGIES;
}

/**
 * @param {Record<string, any>} step
 */
function isImplementationProxy(step) {
  return String(step.actionKind || "").toLowerCase() === "implementation-layer" || step.isTrusted === false;
}

/**
 * @param {Record<string, any>} step
 */
function isSamePageStateControlShape(step) {
  if (hasNavigationTarget(step) || step.action === "submit") return false;
  const role = String(step.role || step.locator?.role || "").toLowerCase();
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
 * @param {Record<string, any>} step
 */
function hasNavigationTarget(step) {
  return Boolean(step.href || step.locator?.href || step.submitterHref || step.formAction || step.expectUrl);
}

/**
 * @param {string} rawUrl
 */
function hasUrlState(rawUrl) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl, "http://browser-flow.local");
    return url.search.length > 1 || url.hash.length > 1;
  } catch {
    return false;
  }
}
