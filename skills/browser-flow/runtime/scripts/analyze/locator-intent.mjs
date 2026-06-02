import { derivePageKey } from "../lib/page-key.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import {
  isGenericAffordanceName,
  isShortDomainLabel,
  isWeakActionName,
  REPLAY_PERMISSION_LEVELS
} from "./replay-policy.mjs";

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 */
export function detectLocatorIntent(input) {
  const suggestions = assignLocatorIntentIds(detectLocatorIntentCandidates(input));
  return {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentPreview,
    status: suggestions.length > 0 ? "needs_review" : "clean",
    suggestions
  };
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 */
export function detectLocatorIntentCandidates({ events, fixture, firstNavigate }) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const pageKeys = pageKeyByEventIndex(events, fixture, firstNavigate);
  const candidates = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isReplayCriticalClick(event, events, index)) continue;
    const locator = event.locator && typeof event.locator === "object" ? event.locator : {};
    const role = String(locator.role || event.role || "").toLowerCase();
    if (role !== "link" && role !== "button") continue;
    const actionText = String(locator.name || event.text || "").replace(/\s+/g, " ").trim();
    const semanticRegion = locator.semanticRegion && typeof locator.semanticRegion === "object"
      ? locator.semanticRegion
      : null;
    if (!needsSemanticIntentReview(actionText, semanticRegion, event, locator)) continue;
    candidates.push({
      kind: "generic-same-name-action",
      eventIndex: index,
      eventIndexes: [index],
      eventIndexRange: [index, index],
      pageKey: pageKeys[index] ?? derivePageKey(firstNavigate, fixture),
      actionText,
      pageUrl: String(event.url || ""),
      targetHref: String(event.href || locator.href || ""),
      sameNameCountPage: getSameNameCountPage(event, locator, semanticRegion),
      sameNameCountRegion: numberOrZero(semanticRegion?.sameNameCountRegion),
      semanticRegionSummary: summarizeSemanticRegion(semanticRegion),
      semanticRegion,
      replayPermission: {
        level: REPLAY_PERMISSION_LEVELS.CONFIRMED_EQUIVALENCE,
        reasonCode: semanticRegion
          ? "generic-action-needs-semantic-region"
          : isGenericAffordanceName(actionText)
            ? "generic-affordance-missing-semantic-region"
            : "weak-action-missing-semantic-region",
        decisionSource: "locator_intent_review",
        fallbackAllowed: true,
        proofRequired: false
      },
      recommendedAction: "confirm",
      summary: semanticRegion
        ? `Generic repeated action "${actionText || "<unnamed>"}" requires semantic region confirmation before replay`
        : `Weak repeated action "${actionText || "<unnamed>"}" has no semantic region and requires confirmation before replay`
    });
  }
  return candidates;
}

/**
 * @param {Array<Record<string, any>>} candidates
 */
function assignLocatorIntentIds(candidates) {
  return candidates.map((candidate, index) => ({
    ...candidate,
    candidateId: `li${index + 1}`
  }));
}

/**
 * @param {Record<string, any>} event
 * @param {Array<Record<string, any>>} events
 * @param {number} index
 */
function isReplayCriticalClick(event, events, index) {
  if (!event || event.type !== "click") return false;
  if (event.actionKind === "observation" || event.actionKind === "implementation-layer") return false;
  return Boolean(event.href || event.locator?.href || hasFollowingNavigationIntent(events, index));
}

/**
 * @param {string} actionText
 * @param {Record<string, any> | null} semanticRegion
 * @param {Record<string, any>} event
 * @param {Record<string, any>} locator
 */
function needsSemanticIntentReview(actionText, semanticRegion, event = {}, locator = {}) {
  if (!semanticRegion) {
    if (!isWeakActionName(actionText)) return false;
    if (getSameNameCountPage(event, locator, null) <= 1) return false;
    if (isGenericAffordanceName(actionText)) return true;
    return isShortDomainLabel(actionText) && !hasStableDisambiguatingSignals(locator);
  }
  const sameNameCountPage = numberOrZero(semanticRegion.sameNameCountPage);
  const sameNameCountRegion = numberOrZero(semanticRegion.sameNameCountRegion);
  const hasStableRegion = hasMeaningfulSemanticRegion(semanticRegion);
  return hasStableRegion && (
    sameNameCountPage > 1 ||
    (isWeakActionName(actionText) && sameNameCountRegion <= 1)
  );
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any>} locator
 * @param {Record<string, any> | null} semanticRegion
 */
function getSameNameCountPage(event, locator, semanticRegion) {
  const semanticCount = numberOrZero(semanticRegion?.sameNameCountPage);
  if (semanticCount > 0) return semanticCount;
  const locatorCount = numberOrZero(locator.sameNameCountPage ?? locator.sameNameCount);
  if (locatorCount > 0) return locatorCount;
  const siblingRoleCount = numberOrZero(event.siblings?.totalMatchingRole);
  const siblingSelectorCount = numberOrZero(event.siblings?.totalMatchingSelector);
  return Math.max(siblingRoleCount, siblingSelectorCount);
}

/**
 * Existing scorer coverage should still handle repeated names when the capture
 * carries non-secret stable identity beyond the weak accessible name.
 * @param {Record<string, any>} locator
 */
function hasStableDisambiguatingSignals(locator) {
  const href = String(locator.href || "").trim();
  const cleanId = String(locator.cleanId || "").trim();
  const neighbors = Array.isArray(locator.neighborTexts)
    ? locator.neighborTexts.map((text) => String(text || "").trim()).filter((text) => text && !isRedacted(text))
    : [];
  if (cleanId && !isRedacted(cleanId)) return true;
  return Boolean(href && neighbors.length > 0);
}

/**
 * @param {Record<string, any>} region
 */
function hasMeaningfulSemanticRegion(region) {
  const role = String(region.role || "").toLowerCase();
  const label = String(region.headingText || region.label || "").replace(/\s+/g, " ").trim();
  if (!label || isRedacted(label)) return false;
  return role !== "main" || label.length > 0;
}

/**
 * @param {string} value
 */
/**
 * @param {Record<string, any> | null} region
 */
export function summarizeSemanticRegion(region) {
  if (!region) return "";
  const label = String(region.headingText || region.label || "").replace(/\s+/g, " ").trim();
  const role = String(region.role || "").replace(/\s+/g, " ").trim();
  return [label, role].filter(Boolean).join(" ").trim();
}

/**
 * @param {unknown} value
 */
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {string} value
 */
function isRedacted(value) {
  return value.startsWith("<redacted") || value.startsWith("[redacted");
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {string} fixture
 * @param {string} firstNavigate
 */
function pageKeyByEventIndex(events, fixture, firstNavigate) {
  const pageKeys = [];
  let currentPageKey = derivePageKey(firstNavigate, fixture);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type === "navigate" && event.url && event.url !== "about:blank") {
      currentPageKey = derivePageKey(String(event.url), fixture);
    }
    pageKeys[index] = currentPageKey;
  }
  return pageKeys;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 */
function hasFollowingNavigationIntent(events, actionIndex) {
  const action = events[actionIndex];
  if (!action) return false;
  const fromUrl = typeof action.url === "string" ? action.url : "";
  const tabOrdinal = action.tabOrdinal ?? 0;
  for (let index = actionIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "click" || event.type === "submit" || event.type === "input") return false;
    if (event.type !== "navigate") continue;
    if ((event.tabOrdinal ?? 0) !== tabOrdinal) continue;
    const toUrl = typeof event.url === "string" ? event.url : "";
    if (toUrl && toUrl !== fromUrl && !/^about:blank(?:$|[?#])/.test(toUrl)) return true;
  }
  return false;
}
