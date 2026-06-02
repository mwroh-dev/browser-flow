import { derivePageKey } from "../lib/page-key.mjs";
import { deriveProviderContextForEvent, isStateProofProviderContext } from "../lib/provider-context.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { createActionDiffMatcher } from "./action-diff-match.mjs";
import { normalizeProviderProxyCandidate } from "./provider-proxy-evidence.mjs";
import { isSamePageStateControlLike } from "./replay-policy.mjs";

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string,
 *   finalNavigate: string
 * }} input
 */
export function detectBacktrackedTrailingAction(input) {
  const trimmed = trimBacktrackedTrailingAction(
    input.events,
    input.fixture,
    input.firstNavigate,
    input.finalNavigate
  );
  if (trimmed.ignored.length === 0) {
    return { schemaVersion: 1, status: "clean", suggestions: [] };
  }
  return {
    schemaVersion: 1,
    status: "auto_trim_available",
    suggestions: trimmed.ignored
      .filter((event) => event.reason === "backtracked-trailing-action")
      .map((event) => ({
        kind: "backtracked-trailing-action",
        actionText: event.actionText || event.ignoredText || "",
        actionUrl: event.ignoredUrl || "",
        keptFinalUrl: event.keptFinalUrl || input.finalNavigate || "",
        analyzerAction: "will_trim"
      }))
  };
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string,
 *   finalNavigate: string
 * }} input
 */
export function detectCaptureNoise(input) {
  const trailing = detectBacktrackedTrailingAction(input);
  const ambiguous = detectAmbiguousPrefixToggleCandidates(input);
  const implementationLayer = detectImplementationLayerCandidates(input);
  const hiddenBursts = detectHiddenControlBurstCandidates(input);
  const observations = detectObservationClickCandidates(input);
  const reviewCandidates = assignCandidateIds(
    dedupeReviewCandidates(input.events, [...ambiguous, ...implementationLayer, ...hiddenBursts, ...observations])
  );
  const intentGroups = buildIntentGroups(input.events, reviewCandidates, input.fixture, input.firstNavigate);
  if (reviewCandidates.length > 0) {
    return {
      schemaVersion: SCHEMA_VERSIONS.captureNoisePreview,
      status: "needs_review",
      suggestions: [...reviewCandidates, ...trailing.suggestions],
      ...(intentGroups.length > 0 ? { intentGroups } : {})
    };
  }
  if (trailing.status === "auto_trim_available") {
    return {
      schemaVersion: SCHEMA_VERSIONS.captureNoisePreview,
      status: "auto_trim_available",
      suggestions: trailing.suggestions
    };
  }
  return {
    schemaVersion: SCHEMA_VERSIONS.captureNoisePreview,
    status: "clean",
    suggestions: []
  };
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 * @returns {Array<Record<string, any>>}
 */
function detectImplementationLayerCandidates({ events, fixture, firstNavigate }) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const pageKeys = pageKeyByEventIndex(events, fixture, firstNavigate);
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  /** @type {Array<Record<string, any>>} */
  const candidates = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isClick(event) || !isImplementationLayerClick(event)) continue;
    const matched = matchActionDiff(index, "click");
    const diff = matched?.event ?? null;
    const hasReplayIntent = hasExplicitReplayIntent(event) || hasFollowingNavigationIntent(events, index);
    if (!isReplayAmbiguousImplementationClick(event, diff, hasReplayIntent)) continue;
    const eventIndexes = matched?.index == null ? [index] : [index, matched.index];
    const settleStatus = typeof diff?.settleStatus === "string" ? diff.settleStatus : "";
    const pageKey = pageKeys[index] ?? derivePageKey(firstNavigate, fixture);
    const providerContext = deriveProviderContextForEvent(event, { pageKey, fixture, firstNavigate });
    const providerStateControl = isStateProofProviderContext(providerContext);
    const candidate = {
      kind: "ambiguous-implementation-layer-click",
      pageKey,
      eventIndexes,
      eventIndexRange: [Math.min(...eventIndexes), Math.max(...eventIndexes)],
      stableTargetKeys: [toggleTargetKey(event)].filter(Boolean),
      visibleSummary: summarizeVisibleIntent([event]),
      reason: implementationLayerReason(event, diff, hasReplayIntent),
      summary: `Implementation-layer or untrusted click produced no replayable user-intent transition (${summarizeVisibleIntent([event])})`,
      recommendedAction: providerStateControl ? "keep" : "exclude",
      effect: providerStateControl ? implementationStateEffect(event) : implementationNoiseEffect(event),
      actionKind: typeof event.actionKind === "string" ? event.actionKind : "",
      isTrusted: event.isTrusted === false ? false : event.isTrusted === true ? true : undefined,
      settleStatus,
      ...(providerContext ? { providerContext } : {})
    };
    candidates.push(normalizeProviderProxyCandidate(candidate, events, { fixture, firstNavigate }));
  }

  return candidates;
}

/**
 * When the operator accidentally clicks into a detail page and returns before
 * ending capture, the raw event log should remain intact but the replay path
 * should settle on the final data page. Detect only a trailing action suffix:
 * the last user action starts on the final page, navigates away, and a later
 * navigation returns to that same final page with no further user action.
 *
 * @param {Array<Record<string, any>>} events
 * @param {string} fixture
 * @param {string} firstNavigate
 * @param {string} finalNavigate
 * @returns {{ events: Array<Record<string, any>>, ignored: Array<Record<string, any>> }}
 */
export function trimBacktrackedTrailingAction(events, fixture, firstNavigate, finalNavigate) {
  if (!Array.isArray(events) || events.length === 0 || !finalNavigate || finalNavigate === "about:blank") {
    return { events, ignored: [] };
  }

  const finalPageKey = derivePageKey(finalNavigate, fixture);
  let currentPageKey = derivePageKey(firstNavigate, fixture);
  /** @type {{ index: number, event: Record<string, any>, pageKey: string } | null} */
  let lastInteractive = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (isRealNavigateEvent(event)) {
      currentPageKey = derivePageKey(String(event.url), fixture);
      continue;
    }
    if (isInteractiveEvent(event)) {
      lastInteractive = { index, event, pageKey: currentPageKey };
    }
  }

  if (
    !lastInteractive ||
    !isNavigationActionEvent(lastInteractive.event) ||
    lastInteractive.pageKey !== finalPageKey
  ) {
    return { events, ignored: [] };
  }

  const actionTabOrdinal = typeof lastInteractive.event.tabOrdinal === "number"
    ? lastInteractive.event.tabOrdinal
    : 0;
  let firstAwayIndex = -1;
  let returnIndex = -1;

  for (let index = lastInteractive.index + 1; index < events.length; index += 1) {
    const event = events[index];
    if (isInteractiveEvent(event)) {
      return { events, ignored: [] };
    }
    if (!isRealNavigateEvent(event) || !sameTab(event, actionTabOrdinal)) {
      continue;
    }
    const pageKey = derivePageKey(String(event.url), fixture);
    if (firstAwayIndex < 0) {
      if (pageKey !== finalPageKey) {
        firstAwayIndex = index;
      }
      continue;
    }
    if (pageKey === finalPageKey) {
      returnIndex = index;
      break;
    }
  }

  if (firstAwayIndex < 0 || returnIndex < 0) {
    return { events, ignored: [] };
  }

  const kept = events.filter((_, index) => index < lastInteractive.index || index >= returnIndex);
  const ignored = events
    .slice(lastInteractive.index, returnIndex)
    .map((event) => ignoredBacktrackedEvent(event, finalNavigate, lastInteractive.event));
  return { events: kept, ignored };
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
function isInteractiveEvent(event) {
  return event && (event.type === "click" || event.type === "submit" || event.type === "input");
}

/**
 * @param {Record<string, any>} event
 */
function isNavigationActionEvent(event) {
  return event && (event.type === "click" || event.type === "submit");
}

/**
 * @param {Record<string, any>} event
 * @param {number} actionTabOrdinal
 */
function sameTab(event, actionTabOrdinal) {
  return typeof event.tabOrdinal === "number" ? event.tabOrdinal === actionTabOrdinal : true;
}

/**
 * @param {Record<string, any>} event
 * @param {string} finalNavigate
 * @param {Record<string, any>} actionEvent
 */
function ignoredBacktrackedEvent(event, finalNavigate, actionEvent) {
  return {
    type: `backtracked-${String(event.type || "event")}`,
    reason: "backtracked-trailing-action",
    ignoredSelector: String(event.selector || ""),
    ignoredText: String(event.text || event.locator?.name || ""),
    ignoredUrl: String(event.url || event.href || event.locator?.href || ""),
    keptFinalUrl: String(finalNavigate || ""),
    actionSelector: String(actionEvent.selector || ""),
    actionText: String(actionEvent.text || actionEvent.locator?.name || "")
  };
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 * @returns {Array<Record<string, any>>}
 */
function detectAmbiguousPrefixToggleCandidates({ events, fixture, firstNavigate }) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const initialPageKey = derivePageKey(firstNavigate, fixture);
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  let currentPageKey = initialPageKey;
  /** @type {Array<Record<string, any>>} */
  const candidates = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (isRealNavigateEvent(event)) {
      currentPageKey = derivePageKey(String(event.url), fixture);
      continue;
    }
    if (!isClick(event)) continue;

    const key = toggleTargetKey(event);
    if (!key) continue;
    /** @type {Array<{ clickIndex: number, event: Record<string, any>, diffIndex: number | null, diff: Record<string, any> | null }>} */
    const chain = [];
    let cursor = index;
    while (cursor < events.length) {
      const current = events[cursor];
      if (isRealNavigateEvent(current)) break;
      if (!isClick(current)) {
        cursor += 1;
        continue;
      }
      if (toggleTargetKey(current) !== key) break;
      const matched = matchActionDiff(cursor, "click");
      const diff = matched?.event ?? null;
      const diffIndex = matched?.index ?? null;
      chain.push({ clickIndex: cursor, event: current, diffIndex, diff });
      cursor += 1;
      while (cursor < events.length && !isClick(events[cursor]) && !isRealNavigateEvent(events[cursor])) {
        cursor += 1;
      }
    }

    if (chain.length < 2) continue;
    const oscillationPrefix = settledOscillationPrefix(chain);
    if (oscillationPrefix.length >= 2) {
      const first = oscillationPrefix[0];
      const eventIndexes = oscillationPrefix.flatMap((entry) =>
        entry.diffIndex == null ? [entry.clickIndex] : [entry.clickIndex, entry.diffIndex]
      );
      candidates.push({
        kind: "ambiguous-prefix-toggle",
        pageKey: currentPageKey,
        eventIndexes,
        eventIndexRange: [Math.min(...eventIndexes), Math.max(...eventIndexes)],
        stableTargetKey: key,
        reason: "settled-oscillation",
        summary: `Repeated same-control toggle prefix on ${toggleSummaryKey(first.event)} before the final captured state`,
        recommendedAction: "exclude"
      });
      index = oscillationPrefix.at(-1)?.clickIndex ?? index;
      continue;
    }

    const interruptedPrefix = [];
    for (const entry of chain) {
      if (entry.diff?.settleStatus === "interrupted") {
        interruptedPrefix.push(entry);
        continue;
      }
      break;
    }
    if (interruptedPrefix.length === 0) continue;
    const trailingSettled = chain[interruptedPrefix.length];
    const shouldExcludePrefix = trailingSettled && trailingSettled.diff?.settleStatus === "settled";
    const prefixEntries = shouldExcludePrefix ? interruptedPrefix : chain;
    const eventIndexes = prefixEntries.flatMap((entry) =>
      entry.diffIndex == null ? [entry.clickIndex] : [entry.clickIndex, entry.diffIndex]
    );
    const first = prefixEntries[0];
    const last = prefixEntries[prefixEntries.length - 1];
    const recommendation = shouldExcludePrefix ? "exclude" : "recapture";
    candidates.push({
      kind: "ambiguous-prefix-toggle",
      pageKey: currentPageKey,
      eventIndexes,
      eventIndexRange: [Math.min(...eventIndexes), Math.max(...eventIndexes)],
      stableTargetKey: key,
      reason: "interrupted-prefix",
      summary: `Rapid toggle prefix on ${toggleSummaryKey(first.event)} before ${shouldExcludePrefix ? "a final settled state" : "navigation intent"}`,
      recommendedAction: recommendation
    });
    index = shouldExcludePrefix && trailingSettled ? trailingSettled.clickIndex : last.clickIndex;
  }

  return candidates;
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 * @returns {Array<Record<string, any>>}
 */
function detectHiddenControlBurstCandidates({ events, fixture, firstNavigate }) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const pageKeys = pageKeyByEventIndex(events, fixture, firstNavigate);
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  /** @type {Array<Record<string, any>>} */
  const candidates = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isClick(event) || !isHiddenControlClick(event) || hasExplicitReplayIntent(event) || hasFollowingNavigationIntent(events, index)) continue;
    const pageKey = pageKeys[index] ?? derivePageKey(firstNavigate, fixture);
    const firstTimestamp = Number(event.timestamp || 0);
    const tabOrdinal = typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0;
    /** @type {Array<{ clickIndex: number, event: Record<string, any>, diffIndex: number | null, diff: Record<string, any> | null }>} */
    const group = [];
    let cursor = index;
    while (cursor < events.length) {
      const current = events[cursor];
      if (isRealNavigateEvent(current)) break;
      if (!isClick(current)) {
        cursor += 1;
        continue;
      }
      const currentPageKey = pageKeys[cursor] ?? pageKey;
      const currentTab = typeof current.tabOrdinal === "number" ? current.tabOrdinal : 0;
      const timestamp = Number(current.timestamp || 0);
      if (
        currentPageKey !== pageKey ||
        currentTab !== tabOrdinal ||
        Math.abs(timestamp - firstTimestamp) > 750 ||
        !isHiddenControlClick(current) ||
        hasExplicitReplayIntent(current) ||
        hasFollowingNavigationIntent(events, cursor)
      ) {
        break;
      }
      const matched = matchActionDiff(cursor, "click");
      group.push({
        clickIndex: cursor,
        event: current,
        diffIndex: matched?.index ?? null,
        diff: matched?.event ?? null
      });
      cursor += 1;
    }

    const singletonHiddenNoop = group.length === 1 && isNoopTransition(group[0].diff);
    if ((group.length < 2 && !singletonHiddenNoop) || !hasUnsettledOrEmptyTransition(group)) {
      continue;
    }
    const eventIndexes = group.flatMap((entry) =>
      entry.diffIndex == null ? [entry.clickIndex] : [entry.clickIndex, entry.diffIndex]
    );
    const hiddenTargets = group.map((entry) =>
      String(entry.event.text || entry.event.locator?.name || entry.event.selector || "hidden control")
    );
    const visibleSummary = summarizeVisibleIntent(group.map((entry) => entry.event));
    candidates.push({
      kind: "ambiguous-hidden-control-burst",
      pageKey,
      eventIndexes,
      eventIndexRange: [Math.min(...eventIndexes), Math.max(...eventIndexes)],
      stableTargetKeys: [...new Set(group.map((entry) => toggleTargetKey(entry.event)).filter(Boolean))],
      hiddenTargets,
      visibleSummary,
      reason: singletonHiddenNoop
        ? "hidden-zero-box-noop"
        : group.some((entry) => entry.diff?.settleStatus === "interrupted")
        ? "interrupted-hidden-control"
        : "hidden-zero-box-burst",
      summary: `Hidden or zero-box controls fired in one layered gesture before the visible flow continued (${visibleSummary})`,
      recommendedAction: "exclude",
      effect: implementationNoiseEffect(event)
    });
    index = group.at(-1)?.clickIndex ?? index;
  }
  return candidates;
}

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string
 * }} input
 * @returns {Array<Record<string, any>>}
 */
function detectObservationClickCandidates({ events, fixture, firstNavigate }) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const pageKeys = pageKeyByEventIndex(events, fixture, firstNavigate);
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  /** @type {Array<Record<string, any>>} */
  const candidates = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isClick(event)) continue;
    if (hasSameGestureActionableNeighbor(events, index)) continue;
    const matched = matchActionDiff(index, "click");
    if (!isObservationNoopClick(event, matched?.event ?? null)) continue;
    const eventIndexes = matched?.index == null ? [index] : [index, matched.index];
    const observedTextSummary = String(event.observedTextSummary || event.text || event.locator?.name || "").replace(/\s+/g, " ").trim();
    const stableTargetKeys = [toggleTargetKey(event)].filter(Boolean);
    const pageKey = pageKeys[index] ?? derivePageKey(firstNavigate, fixture);
    const providerContext = deriveProviderContextForEvent(event, { pageKey, fixture, firstNavigate });
    candidates.push({
      kind: "ambiguous-observation-click",
      pageKey,
      eventIndexes,
      eventIndexRange: [Math.min(...eventIndexes), Math.max(...eventIndexes)],
      stableTargetKeys,
      visibleSummary: summarizeVisibleIntent([event]),
      observedTextSummary,
      reason: "content-observation-noop",
      summary: `Content-area click produced no page transition and appears observational${observedTextSummary ? ` (${observedTextSummary})` : ""}`,
      recommendedAction: "exclude",
      effect: {
        kind: "observation",
        fromUrl: String(event.url || ""),
        toUrl: "",
        targetText: observedTextSummary || String(event.text || event.locator?.name || ""),
        targetHref: String(event.href || event.locator?.href || ""),
        dependentRoute: false
      },
      ...(providerContext ? { providerContext } : {})
    });
  }

  return candidates;
}

/**
 * @param {Array<Record<string, any>>} candidates
 */
function assignCandidateIds(candidates) {
  return candidates.map((candidate, index) => ({
    ...candidate,
    candidateId: `cn${index + 1}`
  }));
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Array<Record<string, any>>} candidates
 * @param {string} fixture
 * @param {string} firstNavigate
 */
function buildIntentGroups(events, candidates, fixture, firstNavigate) {
  if (!Array.isArray(events) || !Array.isArray(candidates)) return [];
  const groups = [];
  for (const candidate of candidates) {
    if (candidate.kind !== "ambiguous-prefix-toggle") continue;
    const group = buildToggleRevealIntentGroup(events, candidate, fixture, firstNavigate, groups.length + 1);
    if (group) groups.push(group);
  }
  return groups;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Record<string, any>} candidate
 * @param {string} fixture
 * @param {string} firstNavigate
 * @param {number} ordinal
 */
function buildToggleRevealIntentGroup(events, candidate, fixture, firstNavigate, ordinal) {
  const startIndex = candidateStart(candidate);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= events.length) return null;
  const stableTargetKey = String(candidate.stableTargetKey || "");
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  const entries = [];
  let cursor = startIndex;
  while (cursor < events.length) {
    const event = events[cursor];
    if (isRealNavigateEvent(event)) break;
    if (!isClick(event)) {
      cursor += 1;
      continue;
    }
    const key = toggleTargetKey(event);
    if (!key || (stableTargetKey && key !== stableTargetKey)) break;
    const matched = matchActionDiff(cursor, "click");
    entries.push({
      clickIndex: cursor,
      event,
      diffIndex: matched?.index ?? null,
      diff: matched?.event ?? null
    });
    cursor += 1;
    while (cursor < events.length && !isClick(events[cursor]) && !isRealNavigateEvent(events[cursor])) {
      cursor += 1;
    }
  }
  if (entries.length < 2) return null;
  const finalEntry = entries.findLast((entry) => entry.diff?.settleStatus === "settled") ?? entries.at(-1);
  if (!finalEntry) return null;
  const rawEventIndexes = uniqueIndexes(entries.flatMap((entry) =>
    entry.diffIndex == null ? [entry.clickIndex] : [entry.clickIndex, entry.diffIndex]
  ));
  const keepEventIndexes = uniqueIndexes(
    finalEntry.diffIndex == null ? [finalEntry.clickIndex] : [finalEntry.clickIndex, finalEntry.diffIndex]
  );
  const keep = new Set(keepEventIndexes);
  const excludeEventIndexes = rawEventIndexes.filter((index) => !keep.has(index));
  const first = entries[0]?.event;
  const last = finalEntry.event;
  return {
    intentGroupId: `ig${ordinal}`,
    intentKind: "toggle-reveal",
    summary: `${toggleSummaryKey(first)} toggle sequence canonicalizes to final ${toggleSummaryKey(last)} before the follow-up action`,
    rawEventIndexes,
    candidateIds: [candidate.candidateId].filter(Boolean),
    canonicalReplay: {
      keepEventIndexes,
      excludeEventIndexes,
      hrefPolicy: hasHrefBearingToggle(entries) ? "ignore" : "",
      reason: "Keep only the final settled reveal action; drop earlier toggle oscillation so replay follows the intended open state."
    },
    risk: hasHrefBearingToggle(entries) ? "href-bearing-interrupted-toggle" : "interrupted-toggle",
    pageKey: candidate.pageKey || derivePageKey(firstNavigate, fixture)
  };
}

/**
 * @param {Array<number>} indexes
 */
function uniqueIndexes(indexes) {
  return [...new Set(indexes.filter((index) => Number.isInteger(index)))].sort((left, right) => left - right);
}

/**
 * @param {Array<{ event: Record<string, any> }>} entries
 */
function hasHrefBearingToggle(entries) {
  return entries.some(({ event }) => Boolean(event.href || event.locator?.href));
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Array<Record<string, any>>} candidates
 */
function dedupeReviewCandidates(events, candidates) {
  const sorted = [...candidates].sort((left, right) => {
    const priorityDelta = candidatePriority(right) - candidatePriority(left);
    if (priorityDelta !== 0) return priorityDelta;
    return candidateStart(left) - candidateStart(right);
  });
  const coveredClickIndexes = new Set();
  /** @type {Array<Record<string, any>>} */
  const kept = [];
  for (const candidate of sorted) {
    const clickIndexes = candidateClickIndexes(events, candidate);
    if (clickIndexes.length > 0 && clickIndexes.some((index) => coveredClickIndexes.has(index))) {
      continue;
    }
    kept.push(candidate);
    for (const index of clickIndexes) {
      coveredClickIndexes.add(index);
    }
  }
  return kept.sort((left, right) => candidateStart(left) - candidateStart(right));
}

/**
 * @param {Record<string, any>} candidate
 */
function candidatePriority(candidate) {
  if (candidate.kind === "ambiguous-implementation-layer-click") return 40;
  if (candidate.kind === "ambiguous-hidden-control-burst") return 30;
  if (candidate.kind === "ambiguous-observation-click") return 20;
  if (candidate.kind === "ambiguous-prefix-toggle") return 10;
  return 0;
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
  return Number.MAX_SAFE_INTEGER;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Record<string, any>} candidate
 */
function candidateClickIndexes(events, candidate) {
  return Array.isArray(candidate.eventIndexes)
    ? candidate.eventIndexes.filter((index) => Number.isInteger(index) && events[index]?.type === "click")
    : [];
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
    if (isRealNavigateEvent(event)) {
      currentPageKey = derivePageKey(String(event.url), fixture);
    }
    pageKeys[index] = currentPageKey;
  }
  return pageKeys;
}

/**
 * @param {Record<string, any>} event
 */
function isHiddenControlClick(event) {
  if (!isClick(event)) return false;
  if (event.targetVisibility?.hasVisibleBox === false) return true;
  const rawBox = event.targetVisibility?.rawBox ?? event.locator?.box;
  if (isZeroBox(rawBox)) return true;
  const visible = event.visibleActionableAncestor || event.visibleHitTarget;
  if (event.isTrusted !== false && visible && typeof visible === "object") {
    const visibleSelector = String(visible.selector || "");
    const visibleName = String(visible.name || "");
    const selector = String(event.actionableSelector || event.selector || "");
    const name = String(event.text || event.locator?.name || "");
    if (
      (isUsableVisibleSignal(visibleSelector) && selector && visibleSelector !== selector) ||
      (isUsableVisibleSignal(visibleName) && name && !isRedactedSignal(name) && visibleName !== name)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Record<string, any>} event
 */
function isImplementationLayerClick(event) {
  return isClick(event) && (event.actionKind === "implementation-layer" || event.isTrusted === false);
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | null} diff
 */
function isReplayAmbiguousImplementationClick(event, diff, hasReplayIntent = hasExplicitReplayIntent(event)) {
  if (!isImplementationLayerClick(event)) return false;
  return !hasReplayIntent;
}

/**
 * @param {Record<string, any>} event
 */
function hasExplicitReplayIntent(event) {
  return Boolean(
    event.href ||
    event.locator?.href ||
    event.submitterHref ||
    event.formAction ||
    event.formIdentitySelector ||
    event.formId ||
    event.formName
  );
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | null} diff
 */
function implementationLayerReason(event, diff, hasReplayIntent = hasExplicitReplayIntent(event)) {
  if (diff?.settleStatus === "interrupted") return "interrupted-implementation-event";
  if (!hasReplayIntent) return "implementation-noop";
  return "untrusted-implementation-event";
}

/**
 * Some legitimate controls are JS-navigation widgets with no href/form
 * metadata. Treat a same-tab navigation before the next user action as
 * explicit replay intent instead of forcing capture-noise review.
 *
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 */
function hasFollowingNavigationIntent(events, actionIndex) {
  return Boolean(followingNavigationEffect(events, actionIndex));
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 * @returns {{ kind: "navigation", fromUrl: string, toUrl: string, targetText: string, targetHref: string, dependentRoute: boolean } | null}
 */
function followingNavigationEffect(events, actionIndex) {
  const action = events[actionIndex];
  if (!action) return null;
  const fromUrl = typeof action.url === "string" ? action.url : "";
  const tabOrdinal = action.tabOrdinal ?? 0;
  for (let index = actionIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (isInteractiveEvent(event)) return null;
    if (event.type !== "navigate") continue;
    if ((event.tabOrdinal ?? 0) !== tabOrdinal) continue;
    const toUrl = typeof event.url === "string" ? event.url : "";
    if (toUrl && toUrl !== fromUrl && !/^about:blank(?:$|[?#])/.test(toUrl)) {
      return {
        kind: "navigation",
        fromUrl,
        toUrl,
        targetText: String(action.text || action.locator?.name || action.selector || ""),
        targetHref: String(action.href || action.locator?.href || ""),
        dependentRoute: true
      };
    }
  }
  return null;
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

/**
 * @param {Record<string, any>} event
 */
function implementationStateEffect(event) {
  return {
    kind: "state-change",
    fromUrl: String(event.url || ""),
    toUrl: String(event.url || ""),
    targetText: String(event.text || event.locator?.name || event.selector || ""),
    targetHref: String(event.href || event.locator?.href || ""),
    dependentRoute: false
  };
}

/**
 * @param {string} value
 */
function isUsableVisibleSignal(value) {
  return Boolean(value && !isRedactedSignal(value));
}

/**
 * @param {string} value
 */
function isRedactedSignal(value) {
  return value.startsWith("<redacted") || value.startsWith("[redacted");
}

/**
 * @param {unknown} box
 */
function isZeroBox(box) {
  if (!box || typeof box !== "object") return false;
  const b = /** @type {Record<string, unknown>} */ (box);
  return typeof b.w === "number" && typeof b.h === "number" && (b.w <= 0 || b.h <= 0);
}

/**
 * @param {Array<{ diff: Record<string, any> | null }>} group
 */
function hasUnsettledOrEmptyTransition(group) {
  return group.some((entry) => isNoopTransition(entry.diff) || entry.diff?.settleStatus === "interrupted");
}

/**
 * @param {Record<string, any> | null | undefined} diff
 */
function isNoopTransition(diff) {
  if (!diff) return true;
  if (diff.settleStatus === "interrupted") return true;
  const before = Array.isArray(diff.beforeSkeleton) ? diff.beforeSkeleton : [];
  const after = Array.isArray(diff.afterSkeleton) ? diff.afterSkeleton : [];
  if (before.length === 0 && after.length === 0) return true;
  const appeared = Array.isArray(diff.appeared) ? diff.appeared : [];
  const disappeared = Array.isArray(diff.disappeared) ? diff.disappeared : [];
  const changed = Array.isArray(diff.changed) ? diff.changed : [];
  if (appeared.length === 0 && disappeared.length === 0 && changed.length === 0 && !("beforeSkeleton" in diff) && !("afterSkeleton" in diff)) {
    return true;
  }
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | null} diff
 */
function isObservationNoopClick(event, diff) {
  if (!isClick(event)) return false;
  if (!isNoopTransition(diff)) return false;
  let score = 0;
  if (event.actionKind === "observation") score += 3;
  if (isStructuralContainerRole(event.role || event.locator?.role)) score += 2;
  if (isLargeContainerBox(event.targetVisibility?.rawBox ?? event.locator?.box)) score += 1;
  if (!event.href && !event.locator?.href && !event.formAction && !event.submitterHref) score += 1;
  if (String(event.observedTextSummary || "").trim()) score += 1;
  if (event.actionKind === "interactive") score -= 4;
  return score >= 3;
}

/**
 * Same physical gesture overlap with a clearly actionable click is handled by
 * the deterministic gesture coalescer, not by user-facing capture review.
 *
 * @param {Array<Record<string, any>>} events
 * @param {number} index
 */
function hasSameGestureActionableNeighbor(events, index) {
  const event = events[index];
  for (const neighborIndex of [index - 1, index + 1]) {
    const neighbor = events[neighborIndex];
    if (!isClick(neighbor)) continue;
    if (isSameGestureClick(event, neighbor) && isClearlyActionableClick(neighbor)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Record<string, any>} event
 */
function isClearlyActionableClick(event) {
  const role = String(event.role || event.locator?.role || "").toLowerCase();
  return event.actionKind === "interactive" ||
    isSamePageStateControlLike(event) ||
    Boolean(event.href || event.locator?.href) ||
    role === "link" ||
    role === "button";
}

/**
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 */
function isSameGestureClick(left, right) {
  if (left.gestureId && right.gestureId && left.gestureId === right.gestureId) return true;
  if (left.gestureId && right.gestureId) return false;
  const leftPoint = clickPoint(left);
  const rightPoint = clickPoint(right);
  if (!leftPoint || !rightPoint) return false;
  const dt = Math.abs(Number(right.timestamp || 0) - Number(left.timestamp || 0));
  const distance = Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y);
  return distance <= 4 && dt <= 250;
}

/**
 * @param {Record<string, any>} event
 */
function clickPoint(event) {
  if (typeof event.clickX === "number" && typeof event.clickY === "number") {
    return { x: event.clickX, y: event.clickY };
  }
  if (event.coords && typeof event.coords.x === "number" && typeof event.coords.y === "number") {
    return { x: event.coords.x, y: event.coords.y };
  }
  return null;
}

/**
 * @param {unknown} role
 */
function isStructuralContainerRole(role) {
  return ["main", "banner", "region", "article", "section", "contentinfo", "navigation", "complementary", "search"]
    .includes(String(role || "").toLowerCase());
}

/**
 * @param {unknown} box
 */
function isLargeContainerBox(box) {
  if (!box || typeof box !== "object") return false;
  const b = /** @type {Record<string, unknown>} */ (box);
  const w = typeof b.w === "number" ? b.w : 0;
  const h = typeof b.h === "number" ? b.h : 0;
  return w >= 240 && h >= 120;
}

/**
 * @param {Array<Record<string, any>>} events
 */
function summarizeVisibleIntent(events) {
  for (const event of events) {
    const visible = event.visibleActionableAncestor || event.visibleHitTarget;
    if (!visible || typeof visible !== "object") continue;
    const name = String(visible.name || "").trim();
    const selector = String(visible.selector || "").trim();
    const role = String(visible.role || "").trim();
    const parts = [role, name, selector].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return "visible hit target unavailable";
}

/**
 * @param {Record<string, any>} event
 */
function isClick(event) {
  return event && event.type === "click";
}

/**
 * @param {Record<string, any>} event
 * @returns {string}
 */
function toggleTargetKey(event) {
  const locator = event?.locator && typeof event.locator === "object" ? event.locator : {};
  const relXPath = typeof locator.relXPath === "string" ? locator.relXPath : "";
  if (relXPath) return `xpath:${relXPath}`;
  const structuralKey = typeof locator.structuralKey === "string" ? locator.structuralKey : "";
  const structuralShape = structuralKeyShape(structuralKey);
  if (structuralShape) return `shape:${structuralShape}`;
  const selector = typeof event?.selector === "string" ? event.selector : "";
  const role = typeof event?.role === "string" ? event.role : typeof locator.role === "string" ? locator.role : "";
  const actionableSelector = typeof event?.actionableSelector === "string" ? event.actionableSelector : "";
  const ancestor = ancestorRegionKey(event);
  const box = coarseBoxKey(locator.box);
  const fallback = [actionableSelector || selector, role, ancestor, box].filter(Boolean).join("|");
  return fallback ? `fallback:${fallback}` : "";
}

/**
 * @param {Record<string, any>} event
 * @returns {string}
 */
function toggleSummaryKey(event) {
  return String(event?.text || event?.locator?.name || event?.selector || "toggle").trim();
}

/**
 * @param {string} structuralKey
 */
function structuralKeyShape(structuralKey) {
  if (!structuralKey) return "";
  const parts = structuralKey.split("|");
  if (parts.length >= 4) {
    return parts.slice(0, 4).join("|");
  }
  return structuralKey.replace(/\|[^|]*$/, "");
}

/**
 * @param {Record<string, any>} event
 */
function ancestorRegionKey(event) {
  const ancestors = Array.isArray(event?.ancestors) ? event.ancestors : [];
  const region = [...ancestors].reverse().find((entry) =>
    entry && (entry.id || entry.role || entry.dataBf || entry.dataTestid || entry.ariaLabel)
  );
  if (!region) return "";
  return [
    region.tag || "",
    region.id || "",
    region.role || "",
    region.dataBf || "",
    region.dataTestid || "",
    region.ariaLabel || ""
  ].join(":");
}

/**
 * @param {unknown} box
 */
function coarseBoxKey(box) {
  if (!box || typeof box !== "object") return "";
  const b = /** @type {Record<string, unknown>} */ (box);
  const cx = typeof b.cx === "number" ? Math.round(b.cx / 25) * 25 : null;
  const cy = typeof b.cy === "number" ? Math.round(b.cy / 25) * 25 : null;
  const w = typeof b.w === "number" ? Math.round(b.w / 25) * 25 : null;
  const h = typeof b.h === "number" ? Math.round(b.h / 25) * 25 : null;
  return [cx, cy, w, h].every((value) => value != null) ? `${cx},${cy},${w},${h}` : "";
}

/**
 * @param {Array<{ clickIndex: number, event: Record<string, any>, diffIndex: number | null, diff: Record<string, any> | null }>} chain
 */
function settledOscillationPrefix(chain) {
  if (chain.length < 3) return [];
  const [first, second, third] = chain;
  if (
    first.diff?.settleStatus !== "settled" ||
    second.diff?.settleStatus !== "settled" ||
    third.diff?.settleStatus !== "settled"
  ) {
    return [];
  }
  const firstState = toggleState(first.event);
  const secondState = toggleState(second.event);
  const thirdState = toggleState(third.event);
  if (!firstState || !secondState || firstState === secondState || firstState !== thirdState) {
    return [];
  }
  return [first, second];
}

/**
 * @param {Record<string, any>} event
 */
function toggleState(event) {
  return String(event?.text || event?.locator?.name || event?.href || "").replace(/\s+/g, " ").trim();
}
