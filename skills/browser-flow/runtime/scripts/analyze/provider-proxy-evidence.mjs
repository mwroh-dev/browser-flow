import { derivePageKey } from "../lib/page-key.mjs";
import { deriveProviderContextForEvent, isStateProofProviderContext } from "../lib/provider-context.mjs";

const TRUSTED_ACTION_WINDOW_MS = 4000;
const TRUSTED_ACTION_WINDOW_EVENTS = 8;

/**
 * @param {Record<string, any>} candidate
 * @param {Array<Record<string, any>>} events
 * @param {{ fixture?: string, firstNavigate?: string }} [options]
 */
export function normalizeProviderProxyCandidate(candidate, events, options = {}) {
  if (!candidate || candidate.kind !== "ambiguous-implementation-layer-click" || !Array.isArray(events)) {
    return candidate;
  }
  const eventIndex = candidateStart(candidate);
  const event = Number.isInteger(eventIndex) ? events[eventIndex] : null;
  if (!event || !isImplementationLayerEvent(event)) return candidate;

  const fixture = options.fixture || "manual";
  const firstNavigate = options.firstNavigate || "";
  const pageKey = candidate.pageKey ||
    derivePageKey(String(event.url || firstNavigate || "about:blank"), fixture);
  const providerContext = candidate.providerContext ||
    deriveProviderContextForEvent(event, { pageKey, fixture, firstNavigate });
  if (!isStateProofProviderContext(providerContext)) return candidate;

  const evidence = classifyProviderProxyEvidence(events, eventIndex, {
    fixture,
    firstNavigate,
    pageKey,
    providerContext
  });
  if (!evidence) return {
    ...candidate,
    ...(providerContext ? { providerContext } : {})
  };

  return {
    ...candidate,
    ...(providerContext ? { providerContext } : {}),
    recommendedAction: "exclude",
    effect: implementationNoiseEffect(event),
    evidenceRole: evidence.evidenceRole,
    ...(evidence.linkedTrustedAction ? { linkedTrustedAction: evidence.linkedTrustedAction } : {})
  };
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} eventIndex
 * @param {{
 *   fixture: string,
 *   firstNavigate: string,
 *   pageKey: string,
 *   providerContext: Record<string, any> | undefined
 * }} context
 */
function classifyProviderProxyEvidence(events, eventIndex, context) {
  const controlGroup = String(context.providerContext?.controlGroup || "");
  if (controlGroup === "timeline") {
    return {
      evidenceRole: "provider-timeline-auto",
      linkedTrustedAction: findTrustedProviderAction(events, eventIndex, {
        ...context,
        requireSameControlGroup: false
      })
    };
  }

  const linked = findTrustedProviderAction(events, eventIndex, {
    ...context,
    requireSameControlGroup: true
  });
  if (!linked) return null;
  return {
    evidenceRole: linked.eventIndex > eventIndex
      ? "provider-proxy-before-trusted-action"
      : "provider-proxy-after-trusted-action",
    linkedTrustedAction: linked
  };
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} eventIndex
 * @param {{
 *   fixture: string,
 *   firstNavigate: string,
 *   pageKey: string,
 *   providerContext: Record<string, any> | undefined,
 *   requireSameControlGroup: boolean
 * }} context
 */
function findTrustedProviderAction(events, eventIndex, context) {
  return searchTrustedProviderAction(events, eventIndex, 1, context) ||
    searchTrustedProviderAction(events, eventIndex, -1, context);
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} eventIndex
 * @param {1 | -1} direction
 * @param {{
 *   fixture: string,
 *   firstNavigate: string,
 *   pageKey: string,
 *   providerContext: Record<string, any> | undefined,
 *   requireSameControlGroup: boolean
 * }} context
 */
function searchTrustedProviderAction(events, eventIndex, direction, context) {
  const source = events[eventIndex];
  const sourceTimestamp = Number(source?.timestamp || 0);
  let visited = 0;
  for (let index = eventIndex + direction; index >= 0 && index < events.length; index += direction) {
    const event = events[index];
    if (!event) continue;
    if (isRealNavigateEvent(event)) break;
    visited += 1;
    if (visited > TRUSTED_ACTION_WINDOW_EVENTS) break;
    const timestamp = Number(event.timestamp || 0);
    if (sourceTimestamp && timestamp && Math.abs(timestamp - sourceTimestamp) > TRUSTED_ACTION_WINDOW_MS) break;
    if (!isTrustedProviderAction(event, context)) continue;
    const pageKey = derivePageKey(String(event.url || context.firstNavigate || "about:blank"), context.fixture);
    const providerContext = deriveProviderContextForEvent(event, {
      pageKey,
      fixture: context.fixture,
      firstNavigate: context.firstNavigate
    });
    return {
      eventIndex: index,
      actionSeq: event.actionSeq,
      text: String(event.text || event.locator?.name || event.selector || ""),
      controlGroup: String(providerContext?.controlGroup || ""),
      surfaceKey: String(providerContext?.surfaceKey || "")
    };
  }
  return null;
}

/**
 * @param {Record<string, any>} event
 * @param {{
 *   fixture: string,
 *   firstNavigate: string,
 *   pageKey: string,
 *   providerContext: Record<string, any> | undefined,
 *   requireSameControlGroup: boolean
 * }} context
 */
function isTrustedProviderAction(event, context) {
  if (!isClick(event) || isImplementationLayerEvent(event)) return false;
  const pageKey = derivePageKey(String(event.url || context.firstNavigate || "about:blank"), context.fixture);
  if (pageKey !== context.pageKey) return false;
  const providerContext = deriveProviderContextForEvent(event, {
    pageKey,
    fixture: context.fixture,
    firstNavigate: context.firstNavigate
  });
  if (!isStateProofProviderContext(providerContext)) return false;
  const sourceSurface = String(context.providerContext?.surfaceKey || "");
  const targetSurface = String(providerContext?.surfaceKey || "");
  if (sourceSurface && targetSurface && sourceSurface !== targetSurface) return false;
  if (!context.requireSameControlGroup) return true;
  const sourceGroup = String(context.providerContext?.controlGroup || "");
  const targetGroup = String(providerContext?.controlGroup || "");
  return !sourceGroup || !targetGroup || sourceGroup === targetGroup;
}

/**
 * @param {Record<string, any>} candidate
 */
function candidateStart(candidate) {
  if (Array.isArray(candidate.eventIndexRange) && Number.isInteger(candidate.eventIndexRange[0])) {
    return Number(candidate.eventIndexRange[0]);
  }
  if (Array.isArray(candidate.eventIndexes) && Number.isInteger(candidate.eventIndexes[0])) {
    return Number(candidate.eventIndexes[0]);
  }
  return Number.NaN;
}

/**
 * @param {Record<string, any>} event
 */
function isClick(event) {
  return event && event.type === "click";
}

/**
 * @param {Record<string, any>} event
 */
function isImplementationLayerEvent(event) {
  return isClick(event) && (event.actionKind === "implementation-layer" || event.isTrusted === false);
}

/**
 * @param {Record<string, any>} event
 */
function isRealNavigateEvent(event) {
  return event && event.type === "navigate" && event.url && event.url !== "about:blank";
}

/**
 * @param {Record<string, any>} event
 */
function implementationNoiseEffect(event) {
  return {
    kind: "implementation-noise",
    fromUrl: String(event.url || ""),
    toUrl: "",
    targetText: String(event.text || event.locator?.name || event.selector || ""),
    targetHref: String(event.href || event.locator?.href || ""),
    dependentRoute: false
  };
}
