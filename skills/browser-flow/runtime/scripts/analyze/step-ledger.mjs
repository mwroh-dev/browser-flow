import { derivePageKey } from "../lib/page-key.mjs";
import { deriveProviderContextForEvent } from "../lib/provider-context.mjs";
import { diffSkeletons } from "../lib/mold-diff.mjs";
import { createActionDiffMatcher } from "./action-diff-match.mjs";

/**
 * @param {{
 *   events: Array<Record<string, any>>,
 *   journalEvents?: Array<Record<string, any>>,
 *   networkSummary?: Array<Record<string, any>>,
 *   fixture: string,
 *   firstNavigate: string,
 *   captureMode?: "normal" | "strict" | string
 * }} input
 */
export function buildStepLedger(input) {
  const events = Array.isArray(input.events) ? input.events : [];
  const journalEvents = Array.isArray(input.journalEvents) ? input.journalEvents : [];
  const networkSummary = Array.isArray(input.networkSummary) ? input.networkSummary : [];
  const fixture = input.fixture || "manual";
  const firstNavigate = input.firstNavigate || "about:blank";
  const pageKeyByIndex = pageKeyByEventIndex(events, fixture, firstNavigate);
  const actionEntries = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => isUserAction(event));
  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  const enrichment = collectEnrichmentRecords(events, journalEvents);

  /** @type {Array<Record<string, any>>} */
  const steps = actionEntries.map(({ event, index }, ordinal) => {
    const nextAction = actionEntries[ordinal + 1] ?? null;
    const matched = matchActionDiff(index, actionDiffRefType(event));
    const diff = matched?.event ?? null;
    const beforeSkeleton = skeletonFrom(diff?.beforeSkeleton ?? event.pageSkeleton);
    const afterSkeleton = skeletonFrom(diff?.afterSkeleton ?? event.pageSkeleton);
    const transition = diff ? transitionFromDiff(diff) : null;
    const actionTimestamp = numberOrNull(event.timestamp);
    const nextActionTimestamp = nextAction ? numberOrNull(nextAction.event.timestamp) : null;
    const diffTimestamp = diff ? numberOrNull(diff.timestamp) : null;
    const timing = timingForStep(diff, actionTimestamp, nextActionTimestamp, diffTimestamp);
    const pageKey = pageKeyByIndex[index] ?? derivePageKey(firstNavigate, fixture);
    const providerContext = deriveProviderContextForEvent(event, { pageKey, fixture, firstNavigate });
    const stepEnrichments = enrichment.records.filter((record) => enrichmentMatchesAction(record.event, event));
    for (const record of stepEnrichments) enrichment.usedIndexes.add(record.index);
    const beforeEnrichment = stepEnrichments.filter((record) => record.event.stage === "before").map((record) => enrichmentPayload(record.event));
    const afterEnrichment = stepEnrichments.filter((record) => record.event.stage !== "before").map((record) => enrichmentPayload(record.event));
    const mutationDelta = stepEnrichments.flatMap((record) => mutationBatchFrom(record.event));

    return {
      schemaVersion: 1,
      stepIndex: ordinal,
      eventIndex: index,
      diffEventIndex: matched?.index,
      actionId: stringOrUndefined(event.actionId),
      actionSeq: typeof event.actionSeq === "number" ? event.actionSeq : undefined,
      captureWindowId: stringOrUndefined(event.captureWindowId),
      documentId: stringOrUndefined(event.documentId),
      frameId: stringOrUndefined(event.frameId),
      backendNodeId: typeof event.backendNodeId === "number" ? event.backendNodeId : undefined,
      timing,
      before: {
        url: String(event.url || firstNavigate || ""),
        pageKey,
        tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0,
        affordances: beforeSkeleton,
        ...(beforeEnrichment.length > 0 ? { enrichment: beforeEnrichment } : {})
      },
      action: {
        type: String(event.type || ""),
        selector: String(event.selector || ""),
        text: String(event.text || event.locator?.name || ""),
        role: String(event.role || event.locator?.role || ""),
        actionKind: String(event.actionKind || ""),
        captureWindowId: stringOrUndefined(event.captureWindowId),
        backendNodeId: typeof event.backendNodeId === "number" ? event.backendNodeId : undefined,
        locator: event.locator && typeof event.locator === "object" ? event.locator : undefined,
        pointer: event.pointer || event.coords || undefined
      },
      after: {
        url: String(event.url || firstNavigate || ""),
        pageKey,
        tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0,
        affordances: afterSkeleton,
        ...(afterEnrichment.length > 0 ? { enrichment: afterEnrichment } : {}),
        ...(transition ? { transition } : {})
      },
      networkDelta: networkDeltaForAction(networkSummary, actionTimestamp, nextActionTimestamp),
      mutationDelta,
      preconditions: /** @type {Array<Record<string, any>>} */ ([]),
      postcondition: /** @type {Record<string, any>} */ ({ kind: "none" }),
      providerPostconditions: /** @type {Array<Record<string, any>>} */ ([]),
      ...(providerContext ? { providerContext } : {})
    };
  });

  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    const revealed = revealedNextAction(current, next);
    if (!revealed) continue;
    current.postcondition = {
      kind: "reveals-next-action",
      target: revealed,
      nextActionSeq: next.actionSeq,
      nextStepIndex: next.stepIndex
    };
    current.providerPostconditions.push({
      kind: "reveals-next-action",
      target: revealed,
      nextActionSeq: next.actionSeq,
      nextStepIndex: next.stepIndex,
      providerContext: current.providerContext
    });
    next.preconditions.push({
      kind: "previous-step-postcondition",
      previousActionSeq: current.actionSeq,
      previousStepIndex: current.stepIndex,
      target: revealed
    });
  }

  const provenResourceFamilies = new Set();
  for (const step of steps) {
    if (isStatefulSurfaceProviderStep(step)) {
      const statefulSurfaceProof = statefulSurfaceProofForStep(step, provenResourceFamilies);
      if (statefulSurfaceProof) {
        step.providerPostconditions.push(statefulSurfaceProof);
        for (const candidate of statefulSurfaceProof.resources?.candidates ?? []) {
          provenResourceFamilies.add(resourceFamilyScopeKey(step, candidate));
        }
      }
      continue;
    }
    const surfaceProof = renderedSurfaceProofForStep(step);
    if (surfaceProof) step.providerPostconditions.push(surfaceProof);
  }

  return {
    schemaVersion: 1,
    captureMode: input.captureMode || "normal",
    fixture,
    firstNavigate,
    steps,
    orphanEvidence: enrichment.records
      .filter((record) => !enrichment.usedIndexes.has(record.index))
      .map((record) => ({
        reason: enrichmentHasCorrelationKey(record.event) ? "no-matching-step" : "missing-correlation-key",
        evidence: enrichmentPayload(record.event)
      })),
    causalLinks: steps
      .filter((step) => step.postcondition?.kind === "reveals-next-action")
      .map((step) => ({
        kind: "reveals-next-action",
        fromStepIndex: step.stepIndex,
        toStepIndex: step.postcondition.nextStepIndex,
        target: step.postcondition.target
      }))
  };
}

/**
 * @param {Record<string, any>} ledger
 * @returns {number[]}
 */
export function protectedEventIndexesFromStepLedger(ledger) {
  return (Array.isArray(ledger?.steps) ? ledger.steps : [])
    .filter((step) =>
      step?.postcondition?.kind === "reveals-next-action" &&
      protectsCausalProviderStep(step)
    )
    .map((step) => step.eventIndex)
    .filter((index) => Number.isInteger(index))
    .sort((left, right) => left - right);
}

/**
 * @param {Record<string, any>} step
 */
function isStatefulSurfaceProviderStep(step) {
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  return provider.pattern === "layered-control-surface" || provider.pattern === "rendered-data-surface";
}

/**
 * @param {Record<string, any>} step
 */
export function postconditionsForWorkflowStep(step) {
  if (!step) return [];
  const conditions = [];
  if (step.postcondition?.kind === "reveals-next-action") {
    conditions.push({
      kind: "reveals-next-action",
      target: step.postcondition.target,
      nextStepIndex: step.postcondition.nextStepIndex,
      nextActionSeq: step.postcondition.nextActionSeq
    });
  }
  for (const condition of Array.isArray(step.providerPostconditions) ? step.providerPostconditions : []) {
    if (!condition || typeof condition !== "object") continue;
    if (
      condition.kind === "reveals-next-action" &&
      conditions.some((entry) =>
        entry.kind === "reveals-next-action" &&
        entry.nextStepIndex === condition.nextStepIndex &&
        entry.nextActionSeq === condition.nextActionSeq
      )
    ) {
      continue;
    }
    conditions.push({ ...condition });
  }
  return conditions;
}

/**
 * @param {Record<string, any>} step
 */
export function preconditionsForWorkflowStep(step) {
  return Array.isArray(step?.preconditions)
    ? step.preconditions.map((entry) => ({ ...entry }))
    : [];
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Array<Record<string, any>>} journalEvents
 */
function collectEnrichmentRecords(events, journalEvents) {
  const merged = [...journalEvents, ...events];
  const records = merged
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event?.type === "action-enrichment" || event?.kind === "enrichment");
  return {
    records,
    usedIndexes: new Set()
  };
}

/**
 * @param {Record<string, any>} enrichment
 * @param {Record<string, any>} action
 */
function enrichmentMatchesAction(enrichment, action) {
  if (!enrichmentHasCorrelationKey(enrichment)) return false;
  if (
    typeof enrichment.captureWindowId === "string" &&
    enrichment.captureWindowId &&
    typeof action.captureWindowId === "string" &&
    enrichment.captureWindowId === action.captureWindowId
  ) {
    return true;
  }
  if (
    typeof enrichment.actionSeq === "number" &&
    typeof action.actionSeq === "number" &&
    enrichment.actionSeq === action.actionSeq
  ) {
    if (
      enrichment.documentId &&
      action.documentId &&
      String(enrichment.documentId) !== String(action.documentId)
    ) {
      return false;
    }
    if (
      typeof enrichment.tabOrdinal === "number" &&
      typeof action.tabOrdinal === "number" &&
      enrichment.tabOrdinal !== action.tabOrdinal
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * @param {Record<string, any>} enrichment
 */
function enrichmentHasCorrelationKey(enrichment) {
  return Boolean(
    (typeof enrichment.captureWindowId === "string" && enrichment.captureWindowId) ||
    typeof enrichment.actionSeq === "number"
  );
}

/**
 * @param {Record<string, any>} enrichment
 */
function enrichmentPayload(enrichment) {
  const payload = /** @type {Record<string, any>} */ ({
    lane: String(enrichment.lane || "snapshot-enrichment"),
    stage: String(enrichment.stage || "after")
  });
  for (const key of ["captureWindowId", "documentId", "frameId"]) {
    if (typeof enrichment[key] === "string" && enrichment[key]) payload[key] = enrichment[key];
  }
  for (const key of ["actionSeq", "tabOrdinal", "timestamp", "timestampMonotonic", "budgetMs"]) {
    if (typeof enrichment[key] === "number") payload[key] = enrichment[key];
  }
  if (Array.isArray(enrichment.affordances)) payload.affordances = skeletonFrom(enrichment.affordances);
  if (enrichment.before && typeof enrichment.before === "object") payload.before = { ...enrichment.before };
  if (enrichment.after && typeof enrichment.after === "object") payload.after = { ...enrichment.after };
  if (enrichment.screenshotCrop && typeof enrichment.screenshotCrop === "object") payload.screenshotCrop = { ...enrichment.screenshotCrop };
  if (Array.isArray(enrichment.providerHints)) payload.providerHints = enrichment.providerHints.map((hint) => ({ ...hint }));
  if (Array.isArray(enrichment.canvasTileHints)) payload.canvasTileHints = enrichment.canvasTileHints.map((hint) => ({ ...hint }));
  if (Array.isArray(enrichment.mutationBatch)) payload.mutationBatch = enrichment.mutationBatch.map((entry) => ({ ...entry }));
  return payload;
}

/**
 * @param {Record<string, any>} enrichment
 */
function mutationBatchFrom(enrichment) {
  return Array.isArray(enrichment.mutationBatch)
    ? enrichment.mutationBatch.map((entry) => ({ ...entry }))
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
    if (event?.type === "navigate" && event.url && event.url !== "about:blank") {
      currentPageKey = derivePageKey(String(event.url), fixture);
    }
    pageKeys[index] = currentPageKey;
  }
  return pageKeys;
}

/**
 * @param {Record<string, any>} event
 */
function isUserAction(event) {
  return event && (event.type === "click" || event.type === "input" || event.type === "submit");
}

/**
 * @param {Record<string, any>} event
 * @returns {"click" | "input" | "submit"}
 */
function actionDiffRefType(event) {
  if (event.type === "input") return "input";
  if (event.type === "submit") return "submit";
  return "click";
}

/**
 * @param {unknown} skeleton
 */
function skeletonFrom(skeleton) {
  return Array.isArray(skeleton)
    ? skeleton.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry }))
    : [];
}

/**
 * @param {Record<string, any>} diff
 */
function transitionFromDiff(diff) {
  const before = skeletonFrom(diff.beforeSkeleton);
  const after = skeletonFrom(diff.afterSkeleton);
  const delta = diffSkeletons(before, after);
  return {
    refType: String(diff.refType || ""),
    appeared: delta.appeared,
    disappeared: delta.disappeared,
    changed: delta.changed,
    ...(typeof diff.actionId === "string" && diff.actionId ? { actionId: diff.actionId } : {}),
    ...(typeof diff.actionSeq === "number" ? { actionSeq: diff.actionSeq } : {}),
    ...(typeof diff.documentId === "string" && diff.documentId ? { documentId: diff.documentId } : {}),
    ...(typeof diff.settleStatus === "string" && diff.settleStatus ? { settleStatus: diff.settleStatus } : {})
  };
}

/**
 * @param {Record<string, any> | null} diff
 * @param {number | null} actionTimestamp
 * @param {number | null} nextActionTimestamp
 * @param {number | null} diffTimestamp
 */
function timingForStep(diff, actionTimestamp, nextActionTimestamp, diffTimestamp) {
  if (diff?.settleStatus === "interrupted") return "fast-chain";
  if (
    actionTimestamp !== null &&
    nextActionTimestamp !== null &&
    diffTimestamp !== null &&
    nextActionTimestamp < diffTimestamp
  ) {
    return "overlapped";
  }
  if (diff?.settleStatus === "settled") return "settled";
  return "unknown";
}

/**
 * @param {Array<Record<string, any>>} networkSummary
 * @param {number | null} actionTimestamp
 * @param {number | null} nextActionTimestamp
 */
function networkDeltaForAction(networkSummary, actionTimestamp, nextActionTimestamp) {
  if (actionTimestamp === null) return [];
  const end = nextActionTimestamp === null ? actionTimestamp + 5_000 : nextActionTimestamp;
  return networkSummary.filter((entry) => {
    const timestamp = numberOrNull(entry.timestamp);
    return timestamp !== null &&
      timestamp >= actionTimestamp &&
      timestamp <= end &&
      String(entry.url || "");
  }).map((entry) => ({
    url: String(entry.url || ""),
    method: String(entry.method || "GET"),
    status: typeof entry.status === "number" ? entry.status : 0,
      timestamp: entry.timestamp
  }));
}

/**
 * @param {Record<string, any>} step
 */
function renderedSurfaceProofForStep(step) {
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  if (provider.pattern !== "layered-control-surface" && provider.pattern !== "rendered-data-surface") {
    return null;
  }
  if (isTransientSurfaceControl(provider)) return null;
  const hits = (Array.isArray(step.networkDelta) ? step.networkDelta : [])
    .filter((entry) => renderedSurfaceNetworkEvidence(entry, step));
  const hit = hits.find((entry) => typeof entry.status === "number" && entry.status > 0) ?? hits[0];
  if (!hit) return null;
  return {
    kind: "rendered-surface-proof",
    proof: "network",
    network: {
      url: String(hit.url || ""),
      method: String(hit.method || "GET"),
      status: typeof hit.status === "number" ? hit.status : 0
    },
    providerContext: provider
  };
}

const CONTROL_STATE_CANDIDATES = Object.freeze([
  "aria-selected",
  "aria-pressed",
  "checked",
  "aria-current",
  "selected",
  "class:is-selected",
  "class:active",
  "class:on"
]);

/**
 * @param {Record<string, any>} step
 * @param {Set<string>} provenResourceFamilies
 */
function statefulSurfaceProofForStep(step, provenResourceFamilies = new Set()) {
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  if (provider.pattern !== "layered-control-surface" && provider.pattern !== "rendered-data-surface") {
    return null;
  }
  if (isTransientSurfaceControl(provider)) return null;
  const resources = resourceFamilyCandidatesForStep(step)
    .filter((candidate) => !provenResourceFamilies.has(resourceFamilyScopeKey(step, candidate)));
  const surface = surfaceRenderEvidenceForStep(step);
  if (resources.length === 0 && (!surface.changed || !Array.isArray(surface.targets) || surface.targets.length === 0)) {
    return null;
  }
  const locator = step.action?.locator && typeof step.action.locator === "object" ? step.action.locator : {};
  return {
    kind: "stateful-surface-proof",
    control: {
      role: String(locator.role || step.action?.role || ""),
      name: String(locator.name || step.action?.text || ""),
      structuralKey: String(locator.structuralKey || ""),
      ...(typeof locator.identityKey === "string" && locator.identityKey ? { identityKey: locator.identityKey } : {}),
      ...(typeof locator.identityShape === "string" && locator.identityShape ? { identityShape: locator.identityShape } : {}),
      ...(typeof locator.controlKind === "string" && locator.controlKind ? { controlKind: locator.controlKind } : {}),
      ...(Array.isArray(locator.textParts) ? { textParts: locator.textParts.map((part) => String(part || "")).filter(Boolean) } : {}),
      states: [...CONTROL_STATE_CANDIDATES]
    },
    surface,
    resources: {
      mode: "family-one-of",
      candidates: resources
    },
    providerContext: provider
  };
}

/**
 * @param {Record<string, any>} step
 */
function surfaceRenderEvidenceForStep(step) {
  const transition = step.after?.transition && typeof step.after.transition === "object" ? step.after.transition : {};
  const changed = nonEmptyArray(transition.appeared) ||
    nonEmptyArray(transition.disappeared) ||
    nonEmptyArray(transition.changed) ||
    nonEmptyArray(step.mutationDelta);
  const targets = [...skeletonFrom(transition.appeared), ...skeletonFrom(transition.changed)]
    .filter((entry) => entry.name || entry.structuralKey)
    .slice(0, 5);
  return {
    changed,
    ...(targets.length > 0 ? { targets } : {})
  };
}

/**
 * @param {Record<string, any>} step
 */
function resourceFamilyCandidatesForStep(step) {
  const seen = new Set();
  const candidates = [];
  for (const entry of Array.isArray(step.networkDelta) ? step.networkDelta : []) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.status !== "number" || entry.status <= 0) continue;
    const candidate = resourceFamilyCandidate(entry);
    if (!candidate) continue;
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * @param {Record<string, any>} step
 * @param {Record<string, any>} candidate
 */
function resourceFamilyScopeKey(step, candidate) {
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  const surfaceKey = String(provider.surfaceKey || step.after?.pageKey || step.before?.pageKey || "");
  return `${surfaceKey}:${JSON.stringify(candidate)}`;
}

/**
 * @param {Record<string, any>} entry
 */
function resourceFamilyCandidate(entry) {
  let parsed;
  try {
    parsed = new URL(String(entry.url || ""));
  } catch {
    return null;
  }
  const method = String(entry.method || "GET");
  const status = typeof entry.status === "number" ? entry.status : 0;
  const host = parsed.host;
  const pathPrefix = pathFamilyPrefix(parsed.pathname);
  const query = semanticQueryPairs(parsed);
  if (query.length > 0) {
    return { method, status, host, pathPrefix, query };
  }
  const filePrefix = fileFamilyPrefix(parsed.pathname);
  if (filePrefix) {
    return { method, status, host, pathPrefix, filePrefix };
  }
  return null;
}

/**
 * @param {string} pathname
 */
function pathFamilyPrefix(pathname) {
  const path = String(pathname || "/");
  if (!path || path === "/") return "/";
  if (/\.[A-Za-z0-9]{2,5}$/.test(path)) {
    const slash = path.lastIndexOf("/");
    return slash >= 0 ? path.slice(0, slash + 1) : "/";
  }
  return path;
}

/**
 * @param {string} pathname
 */
function fileFamilyPrefix(pathname) {
  const file = String(pathname || "").split("/").pop() || "";
  const stem = file.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  const prefix = stem.replace(/(?:\d{4,}.*|[a-f0-9]{12,}.*)$/i, "");
  return prefix && prefix !== stem ? prefix : "";
}

/**
 * @param {URL} url
 */
function semanticQueryPairs(url) {
  const pairs = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (isStableSemanticValue(value)) {
      pairs.push({ key, value });
      continue;
    }
    const decoded = decodeURIComponent(value);
    const jsonPairs = semanticPairsFromJsonString(decoded);
    for (const pair of jsonPairs) pairs.push(pair);
  }
  return dedupePairs(pairs).slice(0, 3);
}

/**
 * @param {string} value
 */
function semanticPairsFromJsonString(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
  try {
    return collectSemanticPairs(JSON.parse(trimmed));
  } catch {
    return [];
  }
}

/**
 * @param {unknown} value
 * @param {string} [key]
 */
function collectSemanticPairs(value, key = "") {
  if (typeof value === "string" && key && isStableSemanticValue(value)) {
    return [{ key, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSemanticPairs(entry, key));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([entryKey, entryValue]) => collectSemanticPairs(entryValue, entryKey));
  }
  return [];
}

/**
 * @param {string} value
 */
function isStableSemanticValue(value) {
  const text = String(value || "");
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
}

/**
 * @param {Array<{key: string, value: string}>} pairs
 */
function dedupePairs(pairs) {
  const seen = new Set();
  const result = [];
  for (const pair of pairs) {
    const key = `${pair.key}\0${pair.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pair);
  }
  return result;
}

/**
 * @param {unknown} value
 */
function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * @param {Record<string, any>} provider
 */
function isTransientSurfaceControl(provider) {
  return String(provider.controlGroup || "") === "timeline";
}

/**
 * @param {Record<string, any>} entry
 * @param {Record<string, any>} step
 */
function renderedSurfaceNetworkEvidence(entry, step) {
  return Boolean(resourceFamilyCandidate(entry));
}

/**
 * @param {Record<string, any>} current
 * @param {Record<string, any>} next
 */
function revealedNextAction(current, next) {
  if (!sameTabAndPage(current, next)) return null;
  const target = nextActionTarget(next);
  if (!target.name && !target.structuralKey) return null;
  const afterAffordances = Array.isArray(current.after?.affordances) ? current.after.affordances : [];
  const transition = current.after?.transition || {};
  const appeared = Array.isArray(transition.appeared) ? transition.appeared : [];
  const changed = Array.isArray(transition.changed) ? transition.changed : [];
  const candidates = [...appeared, ...changed, ...afterAffordances];
  const match = bestRevealTargetCandidate(candidates, target);
  return match ? {
    role: String(match.role || target.role || ""),
    name: String(match.name || target.name || ""),
    structuralKey: String(match.structuralKey || target.structuralKey || "")
  } : null;
}

/**
 * @param {Record<string, any>} current
 * @param {Record<string, any>} next
 */
function sameTabAndPage(current, next) {
  return current.after?.pageKey === next.before?.pageKey &&
    (current.after?.tabOrdinal ?? 0) === (next.before?.tabOrdinal ?? 0);
}

/**
 * Capture-noise canonicalization can still compress ordinary toggle detours.
 * Only provider surfaces that require a parent opener for a later child
 * affordance are protected before replay proof.
 *
 * @param {Record<string, any>} step
 */
function protectsCausalProviderStep(step) {
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  return provider.pattern === "layered-control-surface" || provider.pattern === "rendered-data-surface";
}

/**
 * @param {Record<string, any>} step
 */
function nextActionTarget(step) {
  const locator = step.action?.locator && typeof step.action.locator === "object" ? step.action.locator : {};
  return {
    role: String(step.action?.role || locator.role || ""),
    name: String(step.action?.text || locator.name || ""),
    structuralKey: String(locator.structuralKey || ""),
    identityShape: String(locator.identityShape || ""),
    controlKind: String(locator.controlKind || "")
  };
}

/**
 * @param {Array<Record<string, any>>} candidates
 * @param {{ role: string, name: string, structuralKey: string, identityShape?: string, controlKind?: string }} target
 */
function bestRevealTargetCandidate(candidates, target) {
  let best = null;
  let bestScore = 0;
  for (const entry of candidates) {
    const score = revealTargetScore(entry, target);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {Record<string, any>} entry
 * @param {{ role: string, name: string, structuralKey: string, identityShape?: string, controlKind?: string }} target
 */
function revealTargetScore(entry, target) {
  const entryName = String(entry?.name || "");
  const targetName = String(target?.name || "");
  if (!entryName && !entry?.structuralKey) return 0;
  const entryKey = String(entry?.structuralKey || "");
  const entryShape = String(entry?.identityShape || "");
  if (target.identityShape && entryShape && entryShape === target.identityShape) return 120;
  if (target.structuralKey && entryKey && sameStructuralShape(entryKey, target.structuralKey)) return 110;
  if (targetName && entryName && entryName === targetName && revealRolesCompatible(entry, target)) return 90;
  if (targetName && entryName && entryName === targetName && !isAggregateContainerRole(entry?.role)) return 70;
  if (!isConcreteInteractiveTarget(target) && targetName && entryName && entryName.includes(targetName)) return 30;
  return 0;
}

/**
 * @param {Record<string, any>} entry
 * @param {{ role: string, structuralKey: string }} target
 */
function revealRolesCompatible(entry, target) {
  const targetRole = String(target?.role || "").toLowerCase();
  const entryRole = String(entry?.role || "").toLowerCase();
  if (targetRole && entryRole) return targetRole === entryRole;
  if (targetRole && entryStructuralKind(entry) && targetRole !== entryStructuralKind(entry)) return false;
  return true;
}

/**
 * @param {{ role?: string, structuralKey?: string }} target
 */
function isConcreteInteractiveTarget(target) {
  const role = String(target?.role || "").toLowerCase();
  if (INTERACTIVE_REVEAL_ROLES.has(role)) return true;
  const key = String(target?.structuralKey || "");
  return /\|(button|a|input|select|textarea)\|/.test(key) || /\|role=(button|link|menuitem|tab|switch|checkbox|radio)/.test(key);
}

/**
 * @param {Record<string, any>} entry
 */
function entryStructuralKind(entry) {
  const key = String(entry?.structuralKey || "");
  const match = key.match(/\|(button|a|input|select|textarea)\|/);
  if (!match) return "";
  if (match[1] === "a") return "link";
  return match[1];
}

/**
 * @param {unknown} role
 */
function isAggregateContainerRole(role) {
  return AGGREGATE_CONTAINER_ROLES.has(String(role || "").toLowerCase());
}

const INTERACTIVE_REVEAL_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "switch",
  "checkbox",
  "radio",
  "option"
]);

const AGGREGATE_CONTAINER_ROLES = new Set([
  "main",
  "region",
  "document",
  "group",
  "banner",
  "navigation",
  "menubar",
  "list",
  "listbox",
  "presentation"
]);

/**
 * @param {string} left
 * @param {string} right
 */
function sameStructuralShape(left, right) {
  if (left === right) return true;
  return stripStateClasses(left) === stripStateClasses(right);
}

/**
 * @param {string} key
 */
function stripStateClasses(key) {
  return key
    .replace(/\.is[_-]selected/gi, "")
    .replace(/\.selected/gi, "")
    .replace(/\|[^|]*$/, "");
}

/**
 * @param {unknown} value
 */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 */
function stringOrUndefined(value) {
  return typeof value === "string" && value ? value : undefined;
}
