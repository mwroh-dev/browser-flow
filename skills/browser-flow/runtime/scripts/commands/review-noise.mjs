import { mkdirSync, writeFileSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { derivePageKey } from "../lib/page-key.mjs";
import { deriveProviderContextForEvent, isStateProofProviderContext } from "../lib/provider-context.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { normalizeProviderProxyCandidate } from "../analyze/provider-proxy-evidence.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export async function reviewNoiseCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("review-noise requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  const applyPath = getStringOption(options, "apply", undefined);
  if (applyPath) {
    return applyReviewNoiseResult(runPaths, applyPath);
  }
  return briefReviewNoise(runPaths);
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
export function briefReviewNoise(runPaths) {
  const preview = readPreview(runPaths);
  const events = readOptionalEvents(runPaths);
  const candidates = normalizeReviewCandidates(reviewCandidates(preview), events);
  const result = readOptionalResult(runPaths);
  const resolved = new Set(
    Array.isArray(result?.decisions)
      ? result.decisions.map((entry) => entry?.candidateId).filter(Boolean)
      : []
  );
  const unresolved = candidates
    .filter((candidate) => !resolved.has(candidate.candidateId))
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      reason: candidate.reason ?? "",
      eventIndexRange: candidate.eventIndexRange ?? [],
      stableTargetKey: candidate.stableTargetKey ?? "",
      stableTargetKeys: Array.isArray(candidate.stableTargetKeys) ? candidate.stableTargetKeys : undefined,
      hiddenTargets: Array.isArray(candidate.hiddenTargets) ? candidate.hiddenTargets : undefined,
      visibleSummary: candidate.visibleSummary ?? undefined,
      observedTextSummary: candidate.observedTextSummary ?? undefined,
      evidenceRole: candidate.evidenceRole ?? undefined,
      linkedTrustedAction: candidate.linkedTrustedAction ?? undefined,
      actionKind: candidate.actionKind ?? undefined,
      isTrusted: typeof candidate.isTrusted === "boolean" ? candidate.isTrusted : undefined,
      settleStatus: candidate.settleStatus ?? undefined,
      briefing: captureNoiseBriefing(candidate),
      prompt: promptForCandidate(candidate),
      recommendedAction: candidate.recommendedAction ?? "exclude",
      summary: candidate.summary ?? ""
    }));
  const journey = buildJourney(preview, candidates, events);
  return {
    schemaVersion: SCHEMA_VERSIONS.captureNoisePreview,
    status: unresolved.length > 0 ? "needs_review" : preview.status ?? "clean",
    message: unresolved.length > 0
      ? "Review the captured user journey first, then choose keep or exclude for each ambiguous capture noise candidate group."
      : "No unresolved capture noise review candidates.",
    journey,
    unresolved
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {string} applyPath
 */
function applyReviewNoiseResult(runPaths, applyPath) {
  const preview = readPreview(runPaths);
  const candidates = reviewCandidates(preview);
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const input = /** @type {Record<string, any>} */ (readJson(applyPath));
  if (input.schemaVersion !== SCHEMA_VERSIONS.captureNoiseResult) {
    throw new Error(`capture-noise-result schemaVersion must be ${SCHEMA_VERSIONS.captureNoiseResult}.`);
  }
  if (input.runId !== runPaths.runId) {
    throw new Error(`capture-noise-result runId ${JSON.stringify(input.runId)} does not match ${JSON.stringify(runPaths.runId)}.`);
  }
  if (!Array.isArray(input.decisions)) {
    throw new Error("capture-noise-result decisions must be an array.");
  }
  const decisions = input.decisions.map((entry) => {
    const candidateId = typeof entry?.candidateId === "string" ? entry.candidateId : "";
    const verdict = typeof entry?.verdict === "string" ? entry.verdict : "";
    if (!candidateIds.has(candidateId)) {
      throw new Error(`Unknown capture noise candidateId: ${candidateId || "<missing>"}.`);
    }
    if (verdict !== "keep" && verdict !== "exclude") {
      throw new Error(`Invalid capture noise verdict for ${candidateId}: ${verdict || "<missing>"}. Expected keep or exclude.`);
    }
    return { candidateId, verdict };
  });
  const intentResolutions = validateIntentResolutions(preview, input.intentResolutions);
  validateRiskyKeepDecisions(preview, decisions, intentResolutions);
  validateCanonicalIntentDecisions(preview, decisions, intentResolutions);
  const resolved = new Set(decisions.map((decision) => decision.candidateId));
  const unresolved = candidates.filter((candidate) => !resolved.has(candidate.candidateId));
  const output = {
    schemaVersion: SCHEMA_VERSIONS.captureNoiseResult,
    runId: runPaths.runId,
    decisions,
    ...(intentResolutions.length > 0 ? { intentResolutions } : {})
  };
  mkdirSync(runPaths.analysisDir, { recursive: true });
  writeFileSync(runPaths.captureNoiseResultPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  return {
    schemaVersion: SCHEMA_VERSIONS.captureNoiseResult,
    status: unresolved.length === 0 ? "resolved" : "partial",
    decisions,
    ...(intentResolutions.length > 0 ? { intentResolutions } : {}),
    unresolved: unresolved.map((candidate) => candidate.candidateId)
  };
}

/**
 * @param {Record<string, any>} preview
 * @param {unknown} inputResolutions
 */
function validateIntentResolutions(preview, inputResolutions) {
  if (!Array.isArray(inputResolutions)) return [];
  const groups = intentGroups(preview);
  const groupIds = new Set(groups.map((group) => group.intentGroupId));
  return inputResolutions.map((entry) => {
    const intentGroupId = typeof entry?.intentGroupId === "string" ? entry.intentGroupId : "";
    const resolution = typeof entry?.resolution === "string" ? entry.resolution : "";
    if (!groupIds.has(intentGroupId)) {
      throw new Error(`Unknown capture noise intentGroupId: ${intentGroupId || "<missing>"}.`);
    }
    if (resolution !== "canonical" && resolution !== "strict") {
      throw new Error(`Invalid intent resolution for ${intentGroupId}: ${resolution || "<missing>"}. Expected canonical or strict.`);
    }
    return {
      intentGroupId,
      resolution,
      ...(entry.riskAcknowledged === true ? { riskAcknowledged: true } : {})
    };
  });
}

/**
 * @param {Record<string, any>} preview
 * @param {Array<{ candidateId: string, verdict: string }>} decisions
 * @param {Array<{ intentGroupId: string, resolution: string, riskAcknowledged?: boolean }>} intentResolutions
 */
function validateRiskyKeepDecisions(preview, decisions, intentResolutions) {
  const groups = intentGroups(preview);
  const groupByCandidateId = new Map();
  for (const group of groups) {
    for (const candidateId of Array.isArray(group.candidateIds) ? group.candidateIds : []) {
      groupByCandidateId.set(candidateId, group);
    }
  }
  const strictAcknowledged = new Set(
    intentResolutions
      .filter((entry) => entry.resolution === "strict" && entry.riskAcknowledged === true)
      .map((entry) => entry.intentGroupId)
  );
  for (const decision of decisions) {
    if (decision.verdict !== "keep") continue;
    const candidate = reviewCandidates(preview).find((entry) => entry.candidateId === decision.candidateId);
    const group = groupByCandidateId.get(decision.candidateId);
    const risky = candidate?.kind === "ambiguous-prefix-toggle" || Boolean(group?.risk);
    if (!risky) continue;
    if (group && strictAcknowledged.has(group.intentGroupId)) continue;
    throw new Error(
      `risky keep for ${decision.candidateId} requires intentResolutions[].resolution "strict" with riskAcknowledged:true.`
    );
  }
}

/**
 * @param {Record<string, any>} preview
 * @param {Array<{ candidateId: string, verdict: string }>} decisions
 * @param {Array<{ intentGroupId: string, resolution: string }>} intentResolutions
 */
function validateCanonicalIntentDecisions(preview, decisions, intentResolutions) {
  const decisionByCandidateId = new Map(decisions.map((decision) => [decision.candidateId, decision.verdict]));
  const canonicalIds = new Set(
    intentResolutions
      .filter((entry) => entry.resolution === "canonical")
      .map((entry) => entry.intentGroupId)
  );
  for (const group of intentGroups(preview)) {
    if (!canonicalIds.has(group.intentGroupId)) continue;
    for (const candidateId of Array.isArray(group.candidateIds) ? group.candidateIds : []) {
      if (decisionByCandidateId.get(candidateId) !== "exclude") {
        throw new Error(`canonical intent ${group.intentGroupId} requires candidate ${candidateId} to be excluded.`);
      }
    }
  }
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readPreview(runPaths) {
  return /** @type {Record<string, any>} */ (readJson(runPaths.captureNoisePreviewPath));
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readOptionalResult(runPaths) {
  try {
    return /** @type {Record<string, any>} */ (readJson(runPaths.captureNoiseResultPath));
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readOptionalEvents(runPaths) {
  try {
    return /** @type {Array<Record<string, any>>} */ (readJson(runPaths.sanitizedEventsPath));
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any>} preview
 */
function reviewCandidates(preview) {
  return Array.isArray(preview?.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
}

/**
 * @param {Array<Record<string, any>>} candidates
 * @param {Array<Record<string, any>> | null} events
 */
function normalizeReviewCandidates(candidates, events) {
  if (!Array.isArray(events)) return candidates;
  return candidates.map((candidate) =>
    normalizeProviderProxyCandidate(candidate, events, { fixture: "manual", firstNavigate: firstRealNavigate(events) })
  );
}

/**
 * @param {Record<string, any>} candidate
 */
function captureNoiseBriefing(candidate) {
  const eventRange = Array.isArray(candidate.eventIndexRange) && candidate.eventIndexRange.length >= 2
    ? `events ${candidate.eventIndexRange[0]}-${candidate.eventIndexRange[1]}`
    : "events unknown";
  const keys = [
    candidate.stableTargetKey,
    ...(Array.isArray(candidate.stableTargetKeys) ? candidate.stableTargetKeys : [])
  ].filter(Boolean);
  const signals = [
    candidate.visibleSummary ? `visible: ${candidate.visibleSummary}` : "",
    candidate.observedTextSummary ? `observed: ${candidate.observedTextSummary}` : "",
    candidate.providerContext ? `provider: ${formatProviderContext(candidate.providerContext)}` : "",
    candidate.evidenceRole ? `evidenceRole: ${candidate.evidenceRole}` : "",
    candidate.linkedTrustedAction ? `linked trusted action: ${formatLinkedTrustedAction(candidate.linkedTrustedAction)}` : "",
    candidate.actionKind ? `actionKind: ${candidate.actionKind}` : "",
    typeof candidate.isTrusted === "boolean" ? `isTrusted: ${candidate.isTrusted}` : "",
    candidate.settleStatus ? `settleStatus: ${candidate.settleStatus}` : "",
    keys.length > 0 ? `target keys: ${keys.join(", ")}` : ""
  ].filter(Boolean);
  return [
    `${candidate.candidateId}: ${candidate.kind || "capture-noise"} (${eventRange})`,
    `reason: ${candidate.reason || ""}`,
    `summary: ${candidate.summary || ""}`,
    effectBriefing(candidate),
    `signals: ${signals.join("; ") || "none"}`,
    decisionGuidance(candidate)
  ].join("\n");
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {Array<Record<string, any>>} candidates
 */
function buildJourney(preview, candidates, events) {
  if (!Array.isArray(events)) {
    return {
      intentGroups: intentGroups(preview).map((group) => intentGroupBriefing(group, [])),
      events: []
    };
  }
  return {
    intentGroups: intentGroups(preview).map((group) => intentGroupBriefing(group, events)),
    events: buildJourneyEvents(events, candidates)
  };
}

/**
 * @param {Record<string, any>} preview
 */
function intentGroups(preview) {
  return Array.isArray(preview?.intentGroups)
    ? preview.intentGroups.filter((entry) => entry && typeof entry.intentGroupId === "string")
    : [];
}

/**
 * @param {Record<string, any>} group
 * @param {Array<Record<string, any>>} events
 */
function intentGroupBriefing(group, events) {
  const plan = group.canonicalReplay && typeof group.canonicalReplay === "object" ? group.canonicalReplay : {};
  return {
    intentGroupId: group.intentGroupId,
    intentKind: group.intentKind || "unknown",
    humanSummary: group.summary || "",
    rawEvents: (Array.isArray(group.rawEventIndexes) ? group.rawEventIndexes : [])
      .filter((index) => Number.isInteger(index))
      .map((index) => ({
        eventIndex: index,
        type: events[index]?.type || "",
        text: String(events[index]?.text || events[index]?.locator?.name || ""),
        url: String(events[index]?.url || ""),
        href: String(events[index]?.href || events[index]?.locator?.href || "")
      })),
    recommendedReplayPlan: {
      keepEventIndexes: Array.isArray(plan.keepEventIndexes) ? plan.keepEventIndexes : [],
      excludeEventIndexes: Array.isArray(plan.excludeEventIndexes) ? plan.excludeEventIndexes : [],
      hrefPolicy: typeof plan.hrefPolicy === "string" ? plan.hrefPolicy : "",
      reason: typeof plan.reason === "string" ? plan.reason : ""
    },
    risk: group.risk || "",
    question: group.intentKind === "toggle-reveal"
      ? "This looks like a reveal/toggle journey. Use the canonical replay plan, or choose strict only if you need every raw toggle replayed despite drift risk."
      : "Confirm whether this intent group should use the recommended replay plan."
  };
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Array<Record<string, any>>} candidates
 */
function buildJourneyEvents(events, candidates) {
  if (!Array.isArray(events)) return [];
  const candidateByEventIndex = new Map();
  for (const candidate of candidates) {
    const indexes = Array.isArray(candidate.eventIndexes)
      ? candidate.eventIndexes
      : Array.isArray(candidate.eventIndexRange)
      ? candidate.eventIndexRange
      : [];
    for (const index of indexes) {
      if (Number.isInteger(index) && !candidateByEventIndex.has(index)) {
        candidateByEventIndex.set(index, candidate);
      }
    }
  }
  const journey = [];
  let currentUrl = firstRealNavigate(events);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (isRealNavigate(event)) {
      currentUrl = String(event.url || currentUrl || "");
      continue;
    }
    if (!isClick(event)) continue;
    const navigation = followingNavigation(events, index);
    const diff = followingActionDiff(events, index);
    const candidate = candidateByEventIndex.get(index);
    const text = String(event.text || event.locator?.name || event.selector || "");
    if (navigation) {
      journey.push({
        eventIndex: index,
        kind: navigation.kind,
        text,
        fromUrl: String(event.url || currentUrl || ""),
        toUrl: navigation.toUrl,
        ...(navigation.toTabOrdinal !== undefined ? { toTabOrdinal: navigation.toTabOrdinal } : {}),
        pageKey: derivePageKey(String(event.url || currentUrl || ""), "manual"),
        recommendedAction: candidate?.recommendedAction ?? "keep",
        candidateId: candidate?.candidateId
      });
      continue;
    }
    if (event.actionKind === "observation") {
      journey.push({
        eventIndex: index,
        kind: "observation",
        text,
        fromUrl: String(event.url || currentUrl || ""),
        toUrl: "",
        pageKey: derivePageKey(String(event.url || currentUrl || ""), "manual"),
        recommendedAction: candidate?.recommendedAction ?? "exclude",
        candidateId: candidate?.candidateId
      });
      continue;
    }
    if (event.actionKind === "implementation-layer" || event.isTrusted === false) {
      journey.push({
        eventIndex: index,
        kind: "implementation-noise",
        text,
        fromUrl: String(event.url || currentUrl || ""),
        toUrl: "",
        pageKey: derivePageKey(String(event.url || currentUrl || ""), "manual"),
        recommendedAction: candidate?.recommendedAction ?? "exclude",
        candidateId: candidate?.candidateId
      });
      continue;
    }
    const pageKey = derivePageKey(String(event.url || currentUrl || ""), "manual");
    const providerContext = deriveProviderContextForEvent(event, {
      pageKey,
      fixture: "manual",
      firstNavigate: firstRealNavigate(events)
    });
    if (isTrustedStateProofProviderClick(event, providerContext) || isStateChangeClick(event, diff)) {
      journey.push({
        eventIndex: index,
        kind: "state-change",
        text,
        fromUrl: String(event.url || currentUrl || ""),
        toUrl: "",
        pageKey,
        recommendedAction: candidate?.recommendedAction ?? "keep",
        candidateId: candidate?.candidateId,
        ...(providerContext ? { providerContext } : {})
      });
    }
  }
  return journey;
}

/**
 * @param {Array<Record<string, any>>} events
 */
function firstRealNavigate(events) {
  return String(events.find((event) => isRealNavigate(event))?.url || "");
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
function isRealNavigate(event) {
  return event && event.type === "navigate" && event.url && event.url !== "about:blank";
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 */
function followingNavigation(events, actionIndex) {
  const action = events[actionIndex];
  const fromUrl = String(action?.url || "");
  const tabOrdinal = action?.tabOrdinal ?? 0;
  let crossTabNavigation = null;
  for (let index = actionIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "click" || event.type === "input" || event.type === "submit") return crossTabNavigation;
    if (!isRealNavigate(event)) continue;
    const toUrl = String(event.url || "");
    if (!toUrl || toUrl === fromUrl) continue;
    const eventTabOrdinal = event.tabOrdinal ?? tabOrdinal;
    if (eventTabOrdinal === tabOrdinal) return { index, toUrl, kind: "navigation" };
    if (!crossTabNavigation) {
      crossTabNavigation = { index, toUrl, kind: "new-tab-navigation", toTabOrdinal: eventTabOrdinal };
    }
  }
  return crossTabNavigation;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 */
function followingActionDiff(events, actionIndex) {
  const action = events[actionIndex];
  for (let index = actionIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "click" || event.type === "input" || event.type === "submit" || event.type === "navigate") return null;
    if (event.type !== "action-diff") continue;
    if (action?.actionSeq != null && event.actionSeq != null && action.actionSeq !== event.actionSeq) continue;
    if (action?.actionId && event.actionId && action.actionId !== event.actionId) continue;
    return event;
  }
  return null;
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | null} diff
 */
function isStateChangeClick(event, diff) {
  const role = String(event.role || event.locator?.role || "").toLowerCase();
  if (!["button", "tab", "switch", "checkbox", "radio", "menuitem", "option"].includes(role)) return false;
  if (!diff) return true;
  const appeared = Array.isArray(diff.appeared) ? diff.appeared : [];
  const disappeared = Array.isArray(diff.disappeared) ? diff.disappeared : [];
  const changed = Array.isArray(diff.changed) ? diff.changed : [];
  const before = Array.isArray(diff.beforeSkeleton) ? JSON.stringify(diff.beforeSkeleton) : "";
  const after = Array.isArray(diff.afterSkeleton) ? JSON.stringify(diff.afterSkeleton) : "";
  return appeared.length > 0 || disappeared.length > 0 || changed.length > 0 || before !== after;
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | undefined} providerContext
 */
function isTrustedStateProofProviderClick(event, providerContext) {
  return isClick(event) &&
    event.actionKind !== "implementation-layer" &&
    event.isTrusted !== false &&
    isStateProofProviderContext(providerContext);
}

/**
 * @param {Record<string, any>} candidate
 */
function effectBriefing(candidate) {
  const effect = candidate.effect && typeof candidate.effect === "object" ? candidate.effect : null;
  if (!effect) return "effect: unknown";
  if (effect.kind === "navigation") {
    return `effect: moved from ${effect.fromUrl || "<unknown>"} to ${effect.toUrl || "<unknown>"} via ${effect.targetText || candidate.summary || "click"}`;
  }
  if (effect.kind === "state-change") {
    return `effect: changed same-page UI state via ${effect.targetText || candidate.summary || "click"}`;
  }
  if (effect.kind === "observation") {
    return `effect: observation/no page transition${effect.targetText ? ` (${effect.targetText})` : ""}`;
  }
  if (effect.kind === "implementation-noise") {
    return `effect: implementation/noise candidate${effect.targetText ? ` (${effect.targetText})` : ""}`;
  }
  return `effect: ${effect.kind || "unknown"}`;
}

/**
 * @param {Record<string, any>} candidate
 */
function promptForCandidate(candidate) {
  if (candidate.evidenceRole === "provider-proxy-before-trusted-action" || candidate.evidenceRole === "provider-proxy-after-trusted-action") {
    return "This provider-side event is linked to a trusted visible provider action in the same surface. Exclude the proxy event and replay the trusted action.";
  }
  if (candidate.evidenceRole === "provider-timeline-auto") {
    return "This provider timeline event fired as an automatic observation. Exclude it from replay unless the user explicitly clicked the visible timeline control.";
  }
  if (candidate.providerContext?.replayStrategy === "state-proof-click") {
    return "This event matches a provider-side state control surface. Keep it if that state change is part of the route; exclude it only if incidental.";
  }
  if (candidate.effect?.kind === "navigation") {
    return "This click navigated to another page used by later replay steps. Keep it unless you intentionally want to abandon that route and recapture.";
  }
  if (candidate.effect?.kind === "state-change") {
    return "This click changed same-page UI state. Keep it if that state change is part of the goal; exclude it only if incidental.";
  }
  if (candidate.kind === "ambiguous-implementation-layer-click") {
    return "This click was captured as an untrusted or implementation-layer browser event. If it corresponds to a state-changing control you intentionally used, keep it; if it was incidental, exclude it from replay.";
  }
  if (candidate.kind === "ambiguous-observation-click") {
    return "This click looks like a content-area observation with no page change. Exclude it from replay?";
  }
  if (candidate.kind === "ambiguous-hidden-control-burst") {
    return "Hidden or implementation-layer controls fired without a stable visible transition. If this group represents controls needed for the route, keep it; if it was incidental, exclude it from replay.";
  }
  if (candidate.kind === "ambiguous-prefix-toggle") {
    return "The same physical control was toggled repeatedly before the visible destination action. Exclude the prefix toggles from replay?";
  }
  return "Review this ambiguous capture noise candidate before replay. Keep or exclude it?";
}

/**
 * @param {Record<string, any>} candidate
 */
function decisionGuidance(candidate) {
  if (candidate.evidenceRole === "provider-proxy-before-trusted-action" || candidate.evidenceRole === "provider-proxy-after-trusted-action") {
    return "decision: exclude is recommended because a trusted provider action captures the user intent";
  }
  if (candidate.evidenceRole === "provider-timeline-auto") {
    return "decision: exclude is recommended because this is provider timeline auto-observation";
  }
  if (candidate.providerContext?.replayStrategy === "state-proof-click") {
    return "decision: keep is recommended because this provider-surface control should replay as a state-proof click";
  }
  if (candidate.effect?.kind === "navigation") {
    return "decision: keep is recommended because later route steps may depend on this destination";
  }
  if (candidate.effect?.kind === "state-change") {
    return "decision: keep it if the state change is part of the intended route; exclude it only if incidental";
  }
  if (
    candidate.kind === "ambiguous-implementation-layer-click" ||
    candidate.kind === "ambiguous-hidden-control-burst"
  ) {
    return "decision: keep it if it was part of the intended route or state change; exclude it only if it was incidental capture noise";
  }
  return `recommended: ${candidate.recommendedAction || "exclude"}`;
}

/**
 * @param {Record<string, any>} providerContext
 */
function formatProviderContext(providerContext) {
  return [
    providerContext.pattern,
    providerContext.stateCarrier,
    providerContext.replayStrategy,
    providerContext.controlGroup ? `group=${providerContext.controlGroup}` : ""
  ].filter(Boolean).join("/");
}

/**
 * @param {Record<string, any>} action
 */
function formatLinkedTrustedAction(action) {
  return [
    action.text ? String(action.text) : "",
    Number.isInteger(action.eventIndex) ? `event=${action.eventIndex}` : "",
    action.actionSeq != null ? `seq=${action.actionSeq}` : "",
    action.controlGroup ? `group=${action.controlGroup}` : ""
  ].filter(Boolean).join("/");
}
