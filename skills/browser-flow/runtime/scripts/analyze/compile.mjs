import { URL } from "node:url";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { getRunPaths, getVerifySpecPaths, pagePaths, pageSnapshotPath } from "../lib/config.mjs";
import { readJson, writeJson, writeText } from "../lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { parsePathYamlArtifact, parseRecipeYamlArtifact } from "../lib/schemas.mjs";
import { derivePageKey } from "../lib/page-key.mjs";
import { deriveAtomicLocator, deriveAtomicSubmitter } from "../lib/atomic-fp.mjs";
import { segmentByPageNode } from "../lib/segments.mjs";
import { loadPatterns, applyPatterns, sanitizeWeights } from "../lib/pattern-match.mjs";
import { assertLocalUrl, assertLocalWorkflow } from "../security/local-only.mjs";
import { toYaml } from "../lib/yaml.mjs";
import { classifyIrreversible } from "../lib/safety-classify.mjs";
import { isSignalPoor } from "../lib/scope-gate.mjs";
import { diffSkeletons } from "../lib/mold-diff.mjs";
import { selectResolutionMethod } from "../lib/method-select.mjs";
import { coalesceGestureClicks } from "../lib/gesture-coalescer.mjs";
import { inferOrdinalListIntent } from "../lib/ordinal-list-intent.mjs";
import { deriveSurfaceContextForStep } from "../lib/surface-context.mjs";
import { deriveProviderContextForStep, isStateProofProviderContext } from "../lib/provider-context.mjs";
import { detectCaptureNoise, trimBacktrackedTrailingAction } from "./capture-noise.mjs";
import { createActionDiffMatcher } from "./action-diff-match.mjs";
import {
  buildStepLedger,
  postconditionsForWorkflowStep,
  preconditionsForWorkflowStep,
  protectedEventIndexesFromStepLedger
} from "./step-ledger.mjs";
import { detectLocatorIntent } from "./locator-intent.mjs";
import { detectRouteIntent, applyRouteIntentReview } from "./route-intent.mjs";
import { classifyReplayPermission, isSamePageStateControlLike } from "./replay-policy.mjs";
import { isSensitiveFieldName, looksLikeSecretValue } from "../security/redact.mjs";
import { readJournalEvents } from "../lib/capture-journal.mjs";

/**
 * @param {string} runId
 */
export function compileRun(runId) {
  const runPaths = getRunPaths(runId);
  const manifest = /** @type {{
   *   fixture: string,
   *   runId: string,
   *   startUrl?: string,
   *   unmasked?: boolean
   * }} */ (readJson(runPaths.manifestPath));
  // unmasked mode skips URL-boundary checks AND marks the
  // emitted workflow.json with security.localOnly=false so the
  // registry upsert site refuses to write the catalog entry.
  const unmasked = manifest.unmasked === true;
  const rawEvents = /** @type {Array<{
   *   type: string,
   *   timestamp?: number,
   *   url?: string,
   *   selector?: string,
   *   text?: string,
 *   href?: string,
 *   actionKind?: string,
 *   observedTextSummary?: string,
   *   role?: string,
   *   gestureId?: string,
   *   clickX?: number,
   *   clickY?: number,
   *   submitterSelector?: string,
   *   submitterText?: string,
   *   submitterHref?: string,
   *   formIdentitySelector?: string,
   *   formId?: string,
   *   formName?: string,
   *   formAction?: string,
   *   formMethod?: string,
   *   fieldName?: string,
   *   value?: string,
   *   secret?: boolean,
 *   contentEditable?: boolean,
 *   actionId?: string,
 *   actionSeq?: number,
 *   documentId?: string,
 *   locator?: Record<string, unknown>,
 *   targetVisibility?: Record<string, unknown>,
 *   visibleHitTarget?: Record<string, unknown>,
 *   visibleActionableAncestor?: Record<string, unknown>,
   *   pageSkeleton?: Array<{ role?: string, name?: string, structuralKey?: string }>,
   *   ancestors?: Array<{ tag?: string, id?: string, role?: string, ariaLabel?: string, dataBf?: string, dataTestid?: string }>,
   *   siblings?: { totalMatchingSelector?: number, totalMatchingRole?: number },
  *   tabOrdinal?: number,
   *   settleStatus?: string
   * }>} */ (readJson(runPaths.sanitizedEventsPath));
  const fixture = manifest.fixture ?? "manual";
  const navigateEvents = rawEvents.filter((event) => event.type === "navigate" && event.url);
  const realNavigates = navigateEvents.filter((event) => event.url && event.url !== "about:blank");
  const firstNavigate = realNavigates[0]?.url ?? manifest.startUrl ?? navigateEvents[0]?.url ?? "about:blank";
  const finalNavigate = realNavigates[realNavigates.length - 1]?.url ?? firstNavigate;
  const networkSummary = /** @type {Array<{ timestamp?: number, url?: string, method?: string, status?: number }>} */ (readJson(runPaths.networkSummaryPath));
  const journalEvents = readJournalEvents(runPaths.captureJournalPath);
  const stepLedger = buildStepLedger({
    events: rawEvents,
    journalEvents,
    networkSummary,
    fixture,
    firstNavigate,
    captureMode: String(/** @type {any} */ (manifest).captureMode || "normal")
  });
  writeJson(runPaths.stepLedgerPath, stepLedger);
  const captureNoise = readCaptureNoiseArtifacts(runPaths, rawEvents, fixture, firstNavigate, finalNavigate);
  const protectedLedgerEventIndexes = protectedEventIndexesForCompile(stepLedger, captureNoise);
  const reviewed = applyCaptureNoiseReview(rawEvents, captureNoise, {
    fixture,
    protectedEventIndexes: protectedLedgerEventIndexes,
    stepLedger
  });
  const locatorIntent = readLocatorIntentArtifacts(runPaths, rawEvents, fixture, firstNavigate);
  const locatorReview = applyLocatorIntentReview(rawEvents, locatorIntent);
  const confirmedLocatorIntentByEvent = locatorReview.confirmedByEvent;
  let events = reviewed.events;
  const keptCaptureNoiseReviewByEvent = reviewed.keptReviewByEvent;
  const ignoredEvents = [...reviewed.ignored];
  const coalesced = coalesceGestureClicks(events);
  events = coalesced.events;
  ignoredEvents.push(...coalesced.ignored);
  {
    const preliminaryNavigateEvents = events.filter((event) => event.type === "navigate" && event.url);
    const preliminaryRealNavigates = preliminaryNavigateEvents.filter((event) => event.url && event.url !== "about:blank");
    const preliminaryFirstNavigate = preliminaryRealNavigates[0]?.url ?? manifest.startUrl ?? preliminaryNavigateEvents[0]?.url ?? "about:blank";
    const preliminaryFinalNavigate = preliminaryRealNavigates[preliminaryRealNavigates.length - 1]?.url ?? preliminaryFirstNavigate;
    const backtracked = trimBacktrackedTrailingAction(events, fixture, preliminaryFirstNavigate, preliminaryFinalNavigate);
    events = backtracked.events;
    ignoredEvents.push(...backtracked.ignored);
  }
  enforceReplayEligibility(events, { fixture, keptReviewByEvent: keptCaptureNoiseReviewByEvent });
  writeJson(runPaths.ignoredEventsPath, {
    schemaVersion: 1,
    runId,
    ignored: ignoredEvents
  });
  const pageEvidence = /** @type {Array<{ selector?: string, text?: string, url?: string }>} */ (readJson(runPaths.pageEvidencePath));

  const compiledNavigateEvents = events.filter((event) => event.type === "navigate" && event.url);
  // Skip the initial/transient blank-tab navigations (the daemon opens about:blank
  // before navigating to the real start URL, and SPA/iframe churn can emit more).
  // Deriving start/final from the literal first/last navigate makes startUrl
  // "about:blank" — replay then can't start on the real page (drift-hold at step 1).
  const compiledRealNavigates = compiledNavigateEvents.filter((event) => event.url && event.url !== "about:blank");
  const compiledFirstNavigate = compiledRealNavigates[0]?.url ?? manifest.startUrl ?? compiledNavigateEvents[0]?.url ?? "about:blank";
  const compiledFinalNavigate = compiledRealNavigates[compiledRealNavigates.length - 1]?.url ?? compiledFirstNavigate;
  if (!unmasked) {
    assertLocalUrl(compiledFirstNavigate, "captured start url");
    assertLocalUrl(compiledFinalNavigate, "captured final url");
  }
  const actionTimestampEntries = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type !== "navigate" && event.type !== "action-diff" && typeof event.timestamp === "number")
    .map(({ event, index }) => ({ event, index, timestamp: /** @type {number} */ (event.timestamp) }));

  const matchActionDiff = createActionDiffMatcher(events, { fixture });
  /**
   * Pop the next recorded transition for an action type and reduce it to the
   * compact delta (appeared/disappeared/changed = the answer key). Returns null
   * when no diff was captured (older runs / capture without action-diff recorder).
   * @param {"click" | "input" | "submit"} refType
   * @param {number} actionIndex
   */
  const nextTransition = (refType, actionIndex) => {
    const matched = matchActionDiff(actionIndex, refType);
    const d = matched?.event ?? null;
    if (!d) return null;
    const before = /** @type {any} */ (Array.isArray(d.beforeSkeleton) ? d.beforeSkeleton : []);
    const after = /** @type {any} */ (Array.isArray(d.afterSkeleton) ? d.afterSkeleton : []);
    const { appeared, disappeared, changed } = diffSkeletons(before, after);
    return {
      refType,
      appeared,
      disappeared,
      changed,
      ...(typeof d.actionId === "string" && d.actionId ? { actionId: d.actionId } : {}),
      ...(typeof d.actionSeq === "number" ? { actionSeq: d.actionSeq } : {}),
      ...(typeof d.documentId === "string" && d.documentId ? { documentId: d.documentId } : {}),
      ...(typeof d.settleStatus === "string" && d.settleStatus ? { settleStatus: d.settleStatus } : {})
    };
  };
  const navigateTimestamps = compiledNavigateEvents
    .map((event) => event.timestamp)
    .filter((timestamp) => typeof timestamp === "number");
  const networkTimestamps = networkSummary
    .map((entry) => entry.timestamp)
    .filter((timestamp) => typeof timestamp === "number");
  const evidenceTimestamps = pageEvidence
    .map((entry) => /** @type {any} */ (entry).timestamp)
    .filter((timestamp) => typeof timestamp === "number");
  const maxObservedTimestamp = Math.max(
    0,
    ...navigateTimestamps,
    ...networkTimestamps,
    ...evidenceTimestamps,
    ...actionTimestampEntries.map((entry) => entry.timestamp)
  );

  // page-as-node. Derive pageKey for the starting page,
  // initialize the in-memory page-node accumulator, and tag every
  // step with the page where it occurs. Page transitions on navigate
  // events update `currentPageKey` and record an outgoing edge.
  const initialPageKey = derivePageKey(compiledFirstNavigate, fixture);
  let currentPageKey = initialPageKey;
  /** @type {Map<string, { selectors: Map<string, ReturnType<typeof newSelectorEntry>>, outgoing: Map<string, number> }>} */
  const pageNodes = new Map();
  /**
   * @param {string} pageKey
   */
  const ensurePageNode = (pageKey) => {
    let node = pageNodes.get(pageKey);
    if (!node) {
      node = { selectors: new Map(), outgoing: new Map() };
      pageNodes.set(pageKey, node);
    }
    return node;
  };
  ensurePageNode(currentPageKey);

  /** @type {Array<Record<string, unknown>>} */
  let steps = [
    {
      action: "goto",
      url: normalizeWorkflowUrl(compiledFirstNavigate, fixture),
      pageKey: initialPageKey,
      tabOrdinal: 0
    }
  ];

  /** @type {Record<string, unknown> | null} */
  let lastAction = null;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (event.type === "navigate") {
      if (event.url) {
        const newPageKey = derivePageKey(event.url, fixture);
        if (newPageKey !== currentPageKey) {
          const fromNode = ensurePageNode(currentPageKey);
          fromNode.outgoing.set(newPageKey, (fromNode.outgoing.get(newPageKey) ?? 0) + 1);
          ensurePageNode(newPageKey);
          currentPageKey = newPageKey;
        }
      }
      // pair a click's expectUrl only with a navigate on the SAME tab
      // (a tab-opening click does NOT navigate its own tab — the new tab's navigate
      // must not leak onto it) and never with a transient about:blank (iframe/ad
      // churn). Cross-tab/blank navigates are skipped without consuming lastAction,
      // so a later same-tab navigate can still pair; the next action clears it.
      if (
        lastAction &&
        event.url &&
        event.url !== "about:blank" &&
        (event.tabOrdinal ?? 0) === (/** @type {any} */ (lastAction).tabOrdinal ?? 0)
      ) {
        lastAction.expectUrl = normalizeWorkflowUrl(event.url, fixture);
        if (
          lastAction.action === "click" &&
          lastAction.locatorIntentReview &&
          typeof lastAction.href === "string" &&
          lastAction.href
        ) {
          lastAction.navigationFallback = {
            kind: "confirmed-link-navigation",
            checkpoint: "locator_intent_review",
            href: lastAction.href
          };
        }
        lastAction = null;
      }
      continue;
    }

    if (event.type === "input") {
      const stepPageKey = currentPageKey;
      // attach atomic-fp descriptor when sibling count proves
      // the bare selector is ambiguous. Pure pass-through of
      // recorder data through the analyze→generate boundary.
      const fillStep = /** @type {Record<string, unknown>} */ ({
        action: "fill",
        selector: event.selector ?? "",
        fieldName: event.fieldName ?? "",
        value: event.secret ? undefined : event.value ?? "",
        secret: Boolean(event.secret),
        pageKey: stepPageKey,
        tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0
      });
      if (typeof event.actionId === "string" && event.actionId) {
        fillStep.actionId = event.actionId;
      }
      if (typeof event.actionSeq === "number") {
        fillStep.actionSeq = event.actionSeq;
      }
      if (typeof event.documentId === "string" && event.documentId) {
        fillStep.documentId = event.documentId;
      }
      if (event.contentEditable) {
        fillStep.contentEditable = true;
      }
      // for a morphing fill target, prefer the PRE-typing host
      // identity (captured at focus) over the POST-typing/morphed locator — at
      // replay the field is empty (pre-morph), so the pre-typing identity is what
      // resolves. Keep the post-morph locator for debug/fallback.
      const preTyping = /** @type {any} */ (event).preTypingLocator;
      if (preTyping) {
        fillStep.locator = preTyping;
        if (event.locator) fillStep.postMorphLocator = event.locator;
      } else if (event.locator) {
        fillStep.locator = event.locator;
      }
      const fillAtomicFp = deriveAtomicLocator(event);
      if (fillAtomicFp) {
        fillStep.atomicFp = fillAtomicFp;
      }
      const fillTransition = nextTransition("input", eventIndex);
      if (fillTransition) {
        fillStep.transition = fillTransition;
      }
      steps.push(fillStep);
      accumulateSelector(ensurePageNode(stepPageKey), event, "fill");
      lastAction = null;
      continue;
    }

    if (event.type === "click" || event.type === "submit") {
      if (
        event.type === "submit" &&
        !event.submitterSelector &&
        !event.formId &&
        !event.formName &&
        !event.formAction &&
        (!event.selector || /^[a-z]+$/.test(event.selector))
      ) {
        throw new Error(`Unable to derive truthful submit identity for run ${runId}.`);
      }
      const stepPageKey = currentPageKey;
      lastAction = /** @type {Record<string, unknown>} */ ({
        action: event.type,
        selector: event.selector ?? "",
        text: event.text ?? "",
        href: event.href ?? "",
        submitterSelector: event.submitterSelector ?? "",
        submitterText: event.submitterText ?? "",
        submitterHref: event.submitterHref ?? "",
        formIdentitySelector: event.formIdentitySelector ?? "",
        formId: event.formId ?? "",
        formName: event.formName ?? "",
        formAction: event.formAction ?? "",
        formMethod: event.formMethod ?? "",
        pageKey: stepPageKey,
        tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0
      });
      if (typeof event.actionId === "string" && event.actionId) {
        lastAction.actionId = event.actionId;
      }
      if (typeof event.actionSeq === "number") {
        lastAction.actionSeq = event.actionSeq;
      }
      if (typeof event.documentId === "string" && event.documentId) {
        lastAction.documentId = event.documentId;
      }
      if (typeof event.actionKind === "string" && event.actionKind) {
        lastAction.actionKind = event.actionKind;
      }
      if (typeof event.observedTextSummary === "string" && event.observedTextSummary) {
        lastAction.observedTextSummary = event.observedTextSummary;
      }
      if (event.locator) {
        lastAction.locator = event.locator;
      }
      const confirmedLocatorIntent = confirmedLocatorIntentByEvent.get(event);
      if (confirmedLocatorIntent) {
        lastAction.locatorIntentReview = {
          candidateId: confirmedLocatorIntent.candidateId,
          checkpoint: "locator_intent_review",
          verdict: "confirm"
        };
      }
      const visibilityRisk = visibilityRiskForEvent(event);
      if (visibilityRisk) {
        lastAction.visibilityRisk = visibilityRisk;
      }
      const keptCaptureNoiseReview = keptCaptureNoiseReviewByEvent.get(event);
      if (keptCaptureNoiseReview?.kind === "ambiguous-implementation-layer-click") {
        lastAction.replayRisk = {
          kind: "reviewed-implementation-layer",
          candidateId: keptCaptureNoiseReview.candidateId,
          reason: keptCaptureNoiseReview.reason,
          actionKind: typeof event.actionKind === "string" ? event.actionKind : "",
          isTrusted: event.isTrusted === false ? false : event.isTrusted === true ? true : undefined
        };
      }
      if (event.type === "click") {
        const ordinalIntent = inferOrdinalListIntent(event);
        if (ordinalIntent) {
          lastAction.ordinalIntent = ordinalIntent;
          lastAction.textAtCapture = event.text ?? "";
          lastAction.hrefAtCapture = event.href ?? "";
          lastAction.text = "";
          lastAction.href = "";
          if (lastAction.locator && typeof lastAction.locator === "object") {
            const locator = /** @type {Record<string, any>} */ (lastAction.locator);
            locator.nameAtCapture = typeof locator.name === "string" ? locator.name : "";
            locator.hrefAtCapture = typeof locator.href === "string" ? locator.href : "";
            locator.name = "";
            locator.href = "";
            if (Array.isArray(locator.neighborTexts)) {
              locator.neighborTexts = [];
            }
            if (typeof locator.alt === "string") {
              locator.alt = "";
            }
            locator.disambiguation = locator.disambiguation || {};
            locator.disambiguation.resolutionMethod = "B";
            locator.disambiguation.ordinalHint = ordinalIntent.ordinal;
          }
        }
      }
      // atomic-fp for the primary selector + submitter (submit
      // events only). Submitter has no separate sibling fingerprint in
      // the recorder emit, so deriveAtomicSubmitter applies a narrower
      // rule (implicit-role + text only).
      const primaryAtomicFp = deriveAtomicLocator(event);
      if (primaryAtomicFp) {
        lastAction.atomicFp = primaryAtomicFp;
      }
      if (event.type === "submit") {
        const submitterAtomicFp = deriveAtomicSubmitter(event);
        if (submitterAtomicFp) {
          lastAction.submitterAtomicFp = submitterAtomicFp;
        }
      }
      const actionTransition = nextTransition(
        event.type === "submit" ? "submit" : "click",
        eventIndex
      );
      if (actionTransition) {
        lastAction.transition = actionTransition;
        if (
          lastAction.replayRisk &&
          typeof lastAction.replayRisk === "object" &&
          typeof actionTransition.settleStatus === "string"
        ) {
          /** @type {Record<string, unknown>} */ (lastAction.replayRisk).settleStatus = actionTransition.settleStatus;
        }
      }
      steps.push(lastAction);
      accumulateSelector(ensurePageNode(stepPageKey), event, event.type);
    }
  }

  applyProviderContextClassification(steps);
  attachStepLedgerMetadata(steps, stepLedger);
  attachProviderPrimerEvidence(steps, reviewed.providerPrimersByActionSeq);
  applyReplayIntentClassification(steps);
  applyReplayPermissionClassification(steps);

  // deterministic resolution-method first-pass. For each action step with a
  // locator, pick A (static anchor) vs B (action diff). Only freeze "B"
  // explicitly — A is the resolver's default — so older runs and anchor-rich
  // steps stay byte-identical. The model (scope-agent) may override.
  for (const step of steps) {
    const loc = /** @type {any} */ (step).locator;
    if (!loc) continue;
    const method = selectResolutionMethod(loc, /** @type {any} */ (step).transition);
    if (method === "B") {
      loc.disambiguation = loc.disambiguation || {};
      loc.disambiguation.resolutionMethod = "B";
      // carry the recorded same-key ordinal so the resolver can
      // break a pure margin-tie among N identical candidates by position.
      if (typeof loc.ordinal === "number") loc.disambiguation.ordinalHint = loc.ordinal;
    }
  }

  // persist per-page-node knowledge after event accumulation.
  // Read-merge-write so subsequent captures of the same page accumulate
  // (captureCount, fixtures list, selector history).
  // Also write affordance-skeleton mold.json per page-node,
  // derived from steps belonging to that page that have a locator.structuralKey.
  // Prefer the captured full affordance skeleton from skeleton-manifest.json
  // when available; fall back to touched-step derivation otherwise.
  const capturedSkeletons = readCapturedSkeletons(runPaths, fixture, events);
  for (const [pageKey, node] of pageNodes) {
    const pageSteps = steps.filter((s) => /** @type {any} */ (s).pageKey === pageKey);
    writePageNode(pageKey, node, fixture, pageSteps, capturedSkeletons.get(pageKey) ?? null);
  }

  // lift DOM snapshots (opt-in) from per-run artifacts into per-page-node
  // time-series knowledge. No-op when snapshot mode was off (manifest absent).
  liftSnapshotsToPageNodes(runPaths, fixture);

  const defaultBoundaryMs = 30_000;
  const transitionTimeoutMs = defaultBoundaryMs;
  const actionBoundaries = actionTimestampEntries.map((entry, index) => {
    const nextActionTimestamp = actionTimestampEntries[index + 1]?.timestamp;
    const nextNavigateAfterAction = navigateTimestamps.find((timestamp) => timestamp > entry.timestamp);
    let end = nextActionTimestamp ?? nextNavigateAfterAction ?? Math.max(maxObservedTimestamp, entry.timestamp + transitionTimeoutMs);
    if (end < entry.timestamp) {
      end = entry.timestamp + transitionTimeoutMs;
    }
    return {
      start: entry.timestamp,
      end,
      eventIndex: entry.index
    };
  });
  // transition-gate heuristic: prefer ordering rather than hard `/api/` filter
  // (a hard filter rejects real-site Google URLs). Preference order within an
  // action boundary (highest → fallback):
  //   1. `/api/` substring + non-GET method (preserves synthetic fixture's
  //      "POST /api/complete" pick — regression-safe)
  //   2. `/api/` substring (any method)
  //   3. Non-GET method (real-site XHR / fetch / form post)
  //   4. Any 200 within boundary (page navigation as fallback signal)
  const expectedNetworkCandidate = [...actionBoundaries]
    .reverse()
    .flatMap((boundary) => {
      const inBoundary = networkSummary.filter((entry) =>
        entry.status === 200 &&
        entry.url &&
        typeof entry.timestamp === "number" &&
        entry.timestamp >= boundary.start &&
        entry.timestamp <= boundary.end
      );
      const apiNonGet = inBoundary.find((entry) =>
        entry.url && entry.url.includes("/api/") && entry.method && entry.method !== "GET"
      );
      const apiAny = inBoundary.find((entry) => entry.url && entry.url.includes("/api/"));
      const nonGet = inBoundary.find((entry) => entry.method && entry.method !== "GET");
      const preferred = apiNonGet ?? apiAny ?? nonGet ?? inBoundary[0];
      return preferred ? [preferred] : [];
    })
    .at(0);
  const safeEvidence = pageEvidence.filter((entry) => entry.text && entry.text !== "<redacted-secret-text>");
  const finalUrl = normalizeWorkflowUrl(compiledFinalNavigate, fixture);
  const finalSafeEvidence = safeEvidence.filter((entry) =>
    entry.url && normalizeWorkflowUrl(entry.url, fixture) === finalUrl
  );
  const evidenceCandidates = finalSafeEvidence.length > 0 ? finalSafeEvidence : safeEvidence;
  const preferredSafeEvidence = pickPreferredEvidence(evidenceCandidates);
  // evidence-gate relaxation: collectPageEvidence's fixed selector set
  // ([data-bf-evidence],[role=status],[aria-live],h1,h2) yields no usable text
  // on content-creation SPAs — Google Keep returns an empty aria-live div, and
  // the note the user created lives in a contenteditable outside that set. The
  // truthful evidence of a create-content flow is "the text I typed is present
  // in the page", so fall back to the last non-secret fill value asserted
  // against body. Redaction sentinels are skipped (agent-blind). Only throw
  // when neither DOM evidence nor typed content exists.
  const typedEvidence = (() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      const value = typeof step.value === "string" ? step.value.replace(/\s+/g, " ").trim() : "";
      if (step.action === "fill" && value && !value.startsWith("<redacted")) {
        return { selector: "body", textIncludes: value.slice(0, 120) };
      }
    }
    return null;
  })();

  // Surface/provider context is also a state-action proof signal. Annotate before
  // proof derivation; the later loop remains a back-compat guard after
  // route-intent may rewrite steps.
  applySurfaceAndProviderContexts(steps);

  let expectedEvidence = preferredSafeEvidence
    ? expectedEvidenceFromEntry(preferredSafeEvidence)
    : typedEvidence;
  let expectedNetwork = expectedNetworkCandidate
    ? {
        url: normalizeWorkflowUrl(expectedNetworkCandidate.url ?? "", fixture),
        method: expectedNetworkCandidate.method ?? "GET",
        status: expectedNetworkCandidate.status ?? 200
      }
    : null;
  if (shouldSuppressAutoExpectedNetworkForStatefulProvider(steps, expectedNetworkCandidate)) {
    expectedNetwork = null;
  }
  let proofs = deriveProofSet({
    finalUrl,
    expectedNetwork,
    expectedEvidence,
    steps,
    runId
  });
  const routeIntent = readRouteIntentArtifacts(runPaths, {
    steps,
    proofs,
    finalUrl,
    allowStateRoute: unmasked
  });
  const routeReview = applyRouteIntentReview({
    steps,
    proofs,
    finalUrl,
    preview: routeIntent.preview,
    result: routeIntent.result
  });
  steps = routeReview.steps;
  proofs = routeReview.proofs;
  expectedNetwork = expectedNetworkFromProofs(proofs);
  expectedEvidence = expectedEvidenceFromProofs(proofs);
  const intentPlan = routeReview.intentPlan;

  // deterministic page-node-bounded segments[]. Populated here so that
  // downstream layers see a stable segment list. inputs[] is left unset
  // — the variable-agent sub-skill fills it during the analyze hook.
  const segments = segmentByPageNode({ steps });

  // tag each step.locator with element-type weightOverrides (deterministic,
  // agent-blind). Runtime stays LLM-free; resolveLocator merges these at replay.
  applyPatternsToSteps(steps, loadPatterns());

  // deterministic keyword classifier for irreversible steps.
  const irreversibleStepIndexes = classifyIrreversible(steps);

  // Reveal affordance classifier. A click that only changes same-page
  // affordances (no direct navigation) is either deterministically frozen when
  // the very next same-page click targets an appeared affordance, or queued for
  // reveal-agent review when the follow-up is ambiguous/missing.
  const revealCandidates = freezeRevealSemantics(steps);

  // same-page layered surface/provider hints. Additive-only: runner still
  // executes steps individually, but resolver/consumers can use this context to
  // avoid cross-group ambiguities on layered controls.
  applySurfaceAndProviderContexts(steps);

  // additive semantic grouping metadata for higher-level consumers. Runtime
  // replay still stays step-driven; these annotations only describe grouped
  // reveal/select interactions so later graph/compose layers can consume them.
  const compounds = deriveCompounds(steps);

  // additive workflow graph extension. V1 only emits reveal edges from
  // already-established compounds; other edge kinds are schema-legal but not
  // yet analyzer-produced.
  const workflowGraph = deriveWorkflowGraph(compounds);

  // count distinct tabs (max ordinal across steps + 1). Defaults to 1
  // for legacy single-tab captures where all steps have tabOrdinal 0.
  const tabCount = steps.reduce((m, s) => Math.max(m, (typeof s.tabOrdinal === "number" ? s.tabOrdinal : 0) + 1), 1);

  // signal-poor gate. Steps whose locator carries no distinguishing
  // signal (name/neighborTexts/cleanId/href all absent) can't be disambiguated
  // by the resolver — they are the scope-agent's targets (model reads the DOM
  // snapshot to define an identity region/anchor). Deterministic detection only;
  // the model dispatch + enrichment is the orchestrator's analyze-hook job.
  const scopeCandidates = steps
    .map((step, index) => ({ index, locator: step.locator }))
    .filter(({ locator }) => locator && isSignalPoor(/** @type {Record<string, unknown>} */ (locator)))
    .map(({ index }) => index);

  const workflow = {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: manifest.runId,
    fixture,
    startUrl: normalizeWorkflowUrl(compiledFirstNavigate, fixture),
    finalUrl: normalizeWorkflowUrl(compiledFinalNavigate, fixture),
    steps,
    segments,
    compounds,
    workflowGraph,
    ...(intentPlan ? { intentPlan } : {}),
    tabCount,
    revealCandidates,
    // indices of signal-poor steps needing scope-agent (model-defined
    // identity region). Empty for well-signposted captures (e.g. all fixtures).
    scopeCandidates,
    verification: {
      expectedFinalUrl: normalizeWorkflowUrl(compiledFinalNavigate, fixture),
      expectedNetwork,
      expectedEvidence,
      proofs
    },
    security: {
      // localOnly inverts under unmasked. The registry-write
      // site (workflow-registry.mjs) reads this and refuses to upsert
      // unmasked captures — that is where constitutional invariant
      // #1 (no non-local-only entries in the verified-flow catalog)
      // is enforced.
      localOnly: !unmasked,
      installScope: "project-local",
      targetScope: unmasked ? "external" : "local",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    // default safety scaffold so downstream phases (spec-agent,
    // teardown) mutate rather than create. teardown/preconditions are NOT
    // set here — those are filled by later phases.
    // populate irreversibleStepIndexes via deterministic keyword
    // classifier (conservative: flags payment/email/share/delete candidates).
    // Operator can un-flag during first-verify confirmation.
    safety: {
      irreversibleStepIndexes,
      consentRequired: irreversibleStepIndexes.length > 0,
      sandbox: { available: false, location: null }
    }
  };
  if (!unmasked) {
    assertLocalWorkflow(workflow);
  }

  // read verify-spec once and populate workflow.preconditions (login-required)
  // and workflow.safety.sandbox (sandbox-available) from the same answers object.
  // Both share a single existsSync + readJson call so the file is never read twice.
  //
  // login-required truthy set: "yes" | "y" | "true" | any non-empty string other
  //   than "no"/"n"/"false". Falsy: "no" | "n" | "false" | "" | undefined | null | false | 0
  //
  // sandbox-available falsy set same as login. location = answer minus leading
  //   "yes"/"y" token. If spec absent or answer falsy, keep scaffold
  //   {available:false, location:null}.
  const verifySpecPaths = getVerifySpecPaths(runId);
  if (existsSync(verifySpecPaths.perRunPath)) {
    const verifySpec = /** @type {{ schemaVersion?: number, answers?: Record<string, unknown> }} */ (
      readJson(verifySpecPaths.perRunPath)
    );
    const answers = verifySpec.answers ?? {};

    // preconditions from login-required
    if (isLoginRequiredTruthy(answers["login-required"])) {
      const site = deriveLoginSite(answers["site-url"], workflow.startUrl);
      if (site) {
        /** @type {any} */ (workflow).preconditions = [
          {
            kind: "login",
            site,
            authMode: "human-bootstrap+keychain-session",
            sessionRef: `verify:${site}`
          }
        ];
      }
    }

    // safety.sandbox from sandbox-available
    const sandboxResult = parseSandboxAnswer(answers["sandbox-available"]);
    if (sandboxResult.available) {
      /** @type {any} */ (workflow.safety).sandbox = sandboxResult;
    }
  }

  writeJson(runPaths.workflowJsonPath, workflow);
  const pathYamlDoc = parsePathYamlArtifact(
    {
      schemaVersion: SCHEMA_VERSIONS.pathYaml,
      id: workflow.id,
      fixture: workflow.fixture,
      startUrl: workflow.startUrl,
      finalUrl: workflow.finalUrl,
      steps: workflow.steps,
      verification: workflow.verification
    },
    runPaths.pathYamlPath
  );
  writeText(runPaths.pathYamlPath, toYaml(pathYamlDoc));
  const recipeYamlDoc = parseRecipeYamlArtifact(
    {
      schemaVersion: SCHEMA_VERSIONS.recipeYaml,
      id: workflow.id,
      fixture: workflow.fixture,
      localOnly: true,
      installScope: "project-local",
      targetScope: "local",
      artifacts: {
        path: "analysis/path.yaml",
        recipe: "analysis/recipe.yaml",
        runner: "generated/runner.mjs"
      },
      verification: {
        freshProfile: true,
        requiresActionPath: true,
        requiresTransition: true,
        requiresEvidence: true
      },
      security: workflow.security
    },
    runPaths.recipeYamlPath
  );
  writeText(runPaths.recipeYamlPath, toYaml(recipeYamlDoc));

  return workflow;
}

/**
 * @param {Array<{ selector?: string, text?: string, url?: string }>} entries
 */
function pickPreferredEvidence(entries) {
  return entries.find((entry) => entry.selector?.startsWith("[data-bf-evidence")) ??
    entries.find((entry) => entry.selector?.includes("status")) ??
    entries[0];
}

/**
 * @param {{ selector?: string, text?: string, url?: string }} entry
 */
function expectedEvidenceFromEntry(entry) {
  const selector = entry.selector ?? "";
  return {
    selector: isGenericEvidenceSelector(selector) ? "body" : selector,
    textIncludes: entry.text ?? ""
  };
}

/**
 * @param {string} selector
 */
function isGenericEvidenceSelector(selector) {
  return /^(body|main|section|article|div|span|p|h[1-6])$/i.test(selector.trim());
}

/**
 * @param {{
 *   finalUrl: string,
 *   expectedNetwork: { url: string, method: string, status: number } | null,
 *   expectedEvidence: { selector: string, textIncludes: string } | null,
 *   steps: Array<Record<string, unknown>>,
 *   runId: string
 * }} input
 */
function deriveProofSet(input) {
  /** @type {Array<Record<string, any>>} */
  const proofs = [
    {
      kind: "final-url",
      expectedUrl: input.finalUrl,
      required: true
    }
  ];
  const urlStateParams = deriveUrlStateParams(input.finalUrl);
  if (urlStateParams.length > 0) {
    proofs.push({
      kind: "url-state",
      expectedUrl: input.finalUrl,
      params: urlStateParams,
      required: true
    });
  }
  if (input.expectedNetwork) {
    proofs.push({
      kind: "network",
      ...input.expectedNetwork,
      required: true
    });
  }
  if (input.expectedEvidence) {
    proofs.push({
      kind: "dom-evidence",
      ...input.expectedEvidence,
      required: true
    });
  }
  for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex += 1) {
    const step = input.steps[stepIndex];
    const transition = /** @type {any} */ (step).transition;
    if (!hasMeaningfulTransition(transition)) {
      continue;
    }
    proofs.push({
      kind: "action-transition",
      stepIndex,
      transition,
      required: true
    });
  }
  proofs.push(...deriveStateControlProofs(input.steps, {
    expectedNetwork: input.expectedNetwork,
    expectedEvidence: input.expectedEvidence
  }));
  proofs.push(...deriveProviderTransactionProofs(input.steps));
  if (!proofs.some((proof) => proof.kind !== "final-url")) {
    throw new Error(`Unable to derive sufficient verification proof set for run ${input.runId}.`);
  }
  return proofs;
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
function deriveProviderTransactionProofs(steps) {
  return steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => Array.isArray(step.postconditions) && step.postconditions.length > 0)
    .map(({ step, stepIndex }) => ({
      kind: "provider-transaction",
      stepIndex,
      postconditions: /** @type {Array<Record<string, unknown>>} */ (step.postconditions),
      ...(step.providerContext ? { providerContext: step.providerContext } : {}),
      required: true
    }));
}

/**
 * @param {Array<Record<string, unknown>>} steps
 * @param {{ expectedNetwork: { url: string, method: string, status: number } | null, expectedEvidence: { selector: string, textIncludes: string } | null }} context
 */
function deriveStateControlProofs(steps, context) {
  if (!context.expectedNetwork && !context.expectedEvidence) return [];
  return steps
    .map((step, stepIndex) => ({ step, stepIndex }))
    .filter(({ step }) => step.replayIntent === "state_action")
    .map(({ step, stepIndex }) => ({
      kind: "state-control",
      stepIndex,
      controlText: stringValue(step.text) || stringValue(/** @type {any} */ (step.locator)?.name),
      controlRole: stringValue(step.role) || stringValue(/** @type {any} */ (step.locator)?.role),
      stateSignals: stateSignalsForStep(step),
      ...(context.expectedNetwork ? { networkHints: [context.expectedNetwork] } : {}),
      ...(context.expectedEvidence ? { domEvidence: context.expectedEvidence } : {}),
      ...(step.surfaceContext ? { surfaceContext: step.surfaceContext } : {}),
      ...(step.providerContext ? { providerContext: step.providerContext } : {}),
      required: true
    }));
}

/**
 * @param {Record<string, unknown>} step
 */
function stateSignalsForStep(step) {
  const transition = /** @type {any} */ (step.transition);
  return {
    ...(typeof transition?.settleStatus === "string" ? { settleStatus: transition.settleStatus } : {}),
    ...(step.actionSemantics ? { actionSemantics: step.actionSemantics } : {}),
    ...(step.surfaceContext ? { surfaceContext: step.surfaceContext } : {}),
    ...(step.providerContext ? { providerContext: step.providerContext } : {})
  };
}

/**
 * @param {Array<Record<string, any>>} proofs
 * @returns {{ url: string, method: string, status: number } | null}
 */
function expectedNetworkFromProofs(proofs) {
  const proof = proofs.find((entry) => entry?.kind === "network");
  if (!proof) return null;
  return {
    url: String(proof.url || ""),
    method: String(proof.method || "GET"),
    status: typeof proof.status === "number" ? proof.status : 200
  };
}

/**
 * @param {Array<Record<string, any>>} proofs
 * @returns {{ selector: string, textIncludes: string } | null}
 */
function expectedEvidenceFromProofs(proofs) {
  const proof = proofs.find((entry) => entry?.kind === "dom-evidence");
  if (!proof) return null;
  return {
    selector: String(proof.selector || ""),
    textIncludes: String(proof.textIncludes || "")
  };
}

/**
 * @param {Array<Record<string, unknown>>} steps
 * @param {{ method?: string } | undefined} expectedNetworkCandidate
 */
function shouldSuppressAutoExpectedNetworkForStatefulProvider(steps, expectedNetworkCandidate) {
  if (!expectedNetworkCandidate) return false;
  const method = String(expectedNetworkCandidate.method || "GET").toUpperCase();
  if (method !== "GET") return false;
  return steps.some((step) => stepHasRequiredStatefulSurfaceProof(/** @type {Record<string, any>} */ (step)));
}

/**
 * @param {Record<string, any>} step
 */
function stepHasRequiredStatefulSurfaceProof(step) {
  const conditions = [
    ...(Array.isArray(step.postconditions) ? step.postconditions : []),
    ...(Array.isArray(step.providerPostconditions) ? step.providerPostconditions : [])
  ];
  return conditions.some((condition) => {
    if (!condition || typeof condition !== "object") return false;
    if (condition.kind !== "stateful-surface-proof") return false;
    const provider = condition.providerContext && typeof condition.providerContext === "object"
      ? condition.providerContext
      : (step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {});
    return providerContextIsHighConfidenceStatefulSurface(provider);
  });
}

/**
 * @param {Record<string, any>} provider
 */
function providerContextIsHighConfidenceStatefulSurface(provider) {
  if (!provider || typeof provider !== "object") return false;
  const pattern = String(provider.pattern || "");
  if (pattern !== "layered-control-surface" && pattern !== "rendered-data-surface") return false;
  if (String(provider.replayStrategy || "") !== "state-proof-click") return false;
  if (String(provider.confidence || "") !== "high") return false;
  return Boolean(provider.surfaceKey && provider.controlGroup);
}

/**
 * @param {unknown} transition
 */
function hasMeaningfulTransition(transition) {
  if (!transition || typeof transition !== "object") {
    return false;
  }
  const t = /** @type {{ appeared?: unknown[], disappeared?: unknown[], changed?: unknown[] }} */ (transition);
  return [t.appeared, t.disappeared, t.changed].some((items) => Array.isArray(items) && items.length > 0);
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
function applyProviderContextClassification(steps) {
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "submit") continue;
    const providerContext = deriveProviderContextForStep(/** @type {Record<string, any>} */ (step));
    if (providerContext) {
      step.providerContext = providerContext;
    }
  }
}

/**
 * @param {Record<string, any>} stepLedger
 * @param {{ preview?: Record<string, any> | null, result?: Record<string, any> | null }} [captureNoise]
 * @returns {Set<number>}
 */
function protectedEventIndexesForCompile(stepLedger, captureNoise = {}) {
  const protectedIndexes = new Set(protectedEventIndexesFromStepLedger(stepLedger));
  for (const eventIndex of excludedCaptureNoiseIndexes(captureNoise)) {
    protectedIndexes.delete(eventIndex);
  }
  for (const step of Array.isArray(stepLedger?.steps) ? stepLedger.steps : []) {
    if (step?.postcondition?.kind !== "reveals-next-action") continue;
    if (!isStateProofProviderContext(step.providerContext)) continue;
    if (Number.isInteger(step.diffEventIndex)) {
      protectedIndexes.add(step.diffEventIndex);
    }
  }
  return protectedIndexes;
}

/**
 * @param {{ preview?: Record<string, any> | null, result?: Record<string, any> | null }} captureNoise
 * @returns {Set<number>}
 */
function excludedCaptureNoiseIndexes(captureNoise) {
  const preview = captureNoise.preview;
  const result = captureNoise.result;
  const indexes = new Set();
  if (!preview || preview.status !== "needs_review") return indexes;
  const decisions = new Map(
    Array.isArray(result?.decisions)
      ? result.decisions
        .filter((entry) => entry && typeof entry.candidateId === "string" && entry.verdict === "exclude")
        .map((entry) => [entry.candidateId, true])
      : []
  );
  if (decisions.size === 0) return indexes;
  const candidates = Array.isArray(preview.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
  for (const candidate of candidates) {
    if (!decisions.has(candidate.candidateId)) continue;
    if (candidate.evidenceRole !== "provider-timeline-auto") continue;
    const eventIndexes = Array.isArray(candidate.eventIndexes)
      ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
      : [];
    for (const eventIndex of eventIndexes) indexes.add(Number(eventIndex));
  }
  return indexes;
}

/**
 * @param {Array<Record<string, unknown>>} steps
 * @param {Record<string, any>} stepLedger
 */
function attachStepLedgerMetadata(steps, stepLedger) {
  const byActionSeq = new Map();
  for (const ledgerStep of Array.isArray(stepLedger?.steps) ? stepLedger.steps : []) {
    if (typeof ledgerStep.actionSeq === "number") {
      byActionSeq.set(ledgerStep.actionSeq, ledgerStep);
    }
  }
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "submit" && step.action !== "fill") continue;
    const actionSeq = typeof step.actionSeq === "number" ? step.actionSeq : null;
    if (actionSeq === null || !byActionSeq.has(actionSeq)) continue;
    const ledgerStep = byActionSeq.get(actionSeq);
    step.stepLedgerRef = {
      stepIndex: ledgerStep.stepIndex,
      eventIndex: ledgerStep.eventIndex,
      actionSeq: ledgerStep.actionSeq,
      timing: ledgerStep.timing
    };
    const preconditions = preconditionsForWorkflowStep(ledgerStep);
    if (preconditions.length > 0) {
      step.preconditions = preconditions;
    }
    const postconditions = postconditionsForWorkflowStep(ledgerStep);
    if (postconditions.length > 0) {
      step.postconditions = postconditions;
    }
    if (Array.isArray(ledgerStep.providerPostconditions) && ledgerStep.providerPostconditions.length > 0) {
      step.providerPostconditions = ledgerStep.providerPostconditions.map((entry) => ({ ...entry }));
    }
    if (Array.isArray(ledgerStep.networkDelta) && ledgerStep.networkDelta.length > 0) {
      step.networkDelta = ledgerStep.networkDelta;
    }
  }
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
function applySurfaceAndProviderContexts(steps) {
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "submit") continue;
    const surfaceContext = deriveSurfaceContextForStep(/** @type {Record<string, any>} */ (step));
    if (surfaceContext) {
      step.surfaceContext = surfaceContext;
    }
    const providerContext = deriveProviderContextForStep(/** @type {Record<string, any>} */ (step));
    if (providerContext) {
      step.providerContext = providerContext;
    }
  }
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
function applyReplayIntentClassification(steps) {
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "submit") continue;
    step.replayIntent = classifyReplayIntent(step);
  }
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
function applyReplayPermissionClassification(steps) {
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "submit") continue;
    step.replayPermission = classifyReplayPermission(/** @type {Record<string, any>} */ (step));
  }
}

/**
 * @param {Record<string, unknown>} step
 * @returns {"navigation_action" | "state_action" | "observation_action" | "implementation_layer_action"}
 */
function classifyReplayIntent(step) {
  const rawKind = String(step.actionKind || "").toLowerCase();
  if (rawKind === "observation") return "observation_action";
  if (isReplayStateControlStep(step)) return "state_action";
  if (rawKind === "implementation-layer" || step.replayRisk) return "implementation_layer_action";
  if (isReplayNavigationStep(step)) return "navigation_action";
  return "navigation_action";
}

/**
 * @param {Record<string, unknown>} step
 */
function isReplayNavigationStep(step) {
  return Boolean(
    stringValue(step.href) ||
    stringValue(step.submitterHref) ||
    stringValue(step.formAction) ||
    stringValue(step.expectUrl)
  ) && !isReplayStateControlStep(step);
}

/**
 * @param {Record<string, unknown>} step
 */
function isReplayStateControlStep(step) {
  return isSamePageStateControlLike(/** @type {Record<string, any>} */ (step));
}

/**
 * @param {unknown} value
 */
function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} rawUrl
 * @returns {Array<{ key: string, value: string }>}
 */
function deriveUrlStateParams(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, "http://browser-flow.local");
  } catch {
    return [];
  }
  /** @type {Array<{ key: string, value: string }>} */
  const params = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (isSafeUrlStateParam(key, value)) {
      params.push({ key, value });
    }
  }
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash) {
    const hashParams = hash.startsWith("?") ? new URLSearchParams(hash.slice(1)) : null;
    if (hashParams) {
      for (const [key, value] of hashParams.entries()) {
        if (isSafeUrlStateParam(key, value)) {
          params.push({ key: `#${key}`, value });
        }
      }
    } else if (isSafeUrlStateParam("#", hash)) {
      params.push({ key: "#", value: hash });
    }
  }
  return params;
}

/**
 * @param {string} key
 * @param {string} value
 */
function isSafeUrlStateParam(key, value) {
  return !isSensitiveFieldName(key) && !looksLikeSecretValue(value) && value !== "<redacted>";
}

/**
 * Determine whether the login-required answer is truthy.
 *
 * Truthy: "yes" | "y" | "true" | any non-empty string that is not "no"/"n"/"false"
 * Falsy:  "no" | "n" | "false" | "" | null | undefined | false | 0
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isLoginRequiredTruthy(value) {
  if (value == null || value === false || value === 0) return false;
  const s = String(value).trim().toLowerCase();
  if (s === "" || s === "no" || s === "n" || s === "false") return false;
  return s.length > 0;
}

/**
 * Derive the login site hostname from the operator's site-url answer
 * (which may be a sentence like "https://x 에서 작업") or fall back to the
 * workflow startUrl host. Returns null if neither can be parsed — in that case
 * the caller silently skips setting preconditions.
 *
 * @param {unknown} siteAnswer
 * @param {string} startUrl
 * @returns {string | null}
 */
function deriveLoginSite(siteAnswer, startUrl) {
  // Try to extract a URL from the answer (handles "https://foo.com 에서 작업" etc.)
  if (siteAnswer != null && siteAnswer !== "") {
    const match = String(siteAnswer).match(/(https?:\/\/[^\s]+)/);
    if (match) {
      try {
        return new URL(match[1]).host;
      } catch {
        // fall through to startUrl fallback
      }
    }
  }
  // Fallback: host of the compiled workflow startUrl
  try {
    return new URL(startUrl).host;
  } catch {
    return null;
  }
}

/**
 * Parse the verify-spec sandbox-available answer into a typed
 * sandbox descriptor that matches WorkflowSafety.sandbox
 * ({available:boolean, location:string|null}).
 *
 * Falsy set (case-insensitive, trimmed): no | n | false | "" | null | undefined
 * Truthy: any other non-empty string. Location is the answer with a leading
 * "yes" or "y" token (and optional colon/space separator) stripped, then
 * trimmed — or null when nothing remains after stripping.
 *
 * @param {unknown} value
 * @returns {{ available: boolean, location: string | null }}
 */
function parseSandboxAnswer(value) {
  if (value == null || value === false || value === 0) return { available: false, location: null };
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (lower === "" || lower === "no" || lower === "n" || lower === "false") {
    return { available: false, location: null };
  }
  // Strip leading "yes" or "y" token (optionally followed by ":" and/or whitespace)
  const stripped = s.replace(/^(yes|y)\s*:?\s*/i, "").trim();
  return { available: true, location: stripped.length > 0 ? stripped : null };
}

/**
 * Deterministically tag each step.locator with element-type weightOverrides
 * (disambiguation) so replay weights the decisive signal. Mutates steps in place.
 * Skips steps without a locator and locators that already carry a disambiguation
 * (model output / prior pass wins). Pure w.r.t. the page — no live browser.
 * @param {Array<Record<string,unknown>>} steps
 * @param {Array<any>} patterns
 */
export function applyPatternsToSteps(steps, patterns) {
  for (const s of steps || []) {
    if (s && s.locator && typeof s.locator === "object") {
      const tagged = applyPatterns(/** @type {Record<string,unknown>} */ (s.locator), patterns);
      if (tagged.disambiguation) s.locator = tagged;
    }
  }
}

/**
 * Apply a scoring-agent (or synthetic) result onto the target step.locator.
 * weightOverrides are whitelisted + clamped (sanitizeWeights). The model decides the
 * criteria; this apply stays deterministic. Mutates steps in place. No-op if the step,
 * its locator, or the disambiguation is missing.
 * Intentionally OVERWRITES any existing disambiguation: scoring-agent output is the
 * model verdict and has highest precedence (model > pattern > seed). This is the
 * deliberate asymmetry vs applyPatterns(), which preserves an existing disambiguation.
 * @param {Array<Record<string,any>>} steps
 * @param {Record<string,any>} result
 */
export function applyScoringResult(steps, result) {
  const i = result && result.stepIndex;
  const step = Array.isArray(steps) ? steps[i] : undefined;
  if (!step || !step.locator || !result.disambiguation) return;
  step.locator.disambiguation = {
    weightOverrides: sanitizeWeights(result.disambiguation.weightOverrides || {}),
    ...(result.disambiguation.note ? { note: result.disambiguation.note } : {})
  };
}

/**
 * Mutates clear reveal controls in-place and returns ambiguous reveal candidate
 * step indexes. Purely artifact-based: no DOM/browser reads.
 *
 * @param {Array<Record<string, any>>} steps
 * @returns {number[]}
 */
function freezeRevealSemantics(steps) {
  /** @type {number[]} */
  const candidates = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!isRevealLikeClick(step)) continue;
    const followupIndex = matchingImmediateFollowupIndex(steps, index);
    if (followupIndex == null) {
      candidates.push(index);
      continue;
    }
    step.actionSemantics = {
      kind: "stateful-affordance",
      verification: "transition",
      hrefPolicy: "ignore",
      followupStepIndex: followupIndex
    };
  }
  return candidates;
}

/**
 * @param {Record<string, any>} step
 */
function isRevealLikeClick(step) {
  if (!step || step.action !== "click") return false;
  if (typeof step.expectUrl === "string" && step.expectUrl.length > 0) return false;
  if (step.actionSemantics) return false;
  const transition = step.transition;
  if (!transition || typeof transition !== "object") return false;
  if (transition.settleStatus === "interrupted") return false;
  return transitionAffordances(transition).length > 0;
}

/**
 * @param {Array<Record<string, any>>} steps
 * @param {number} index
 * @returns {number | null}
 */
function matchingImmediateFollowupIndex(steps, index) {
  const step = steps[index];
  const nextIndex = index + 1;
  const next = steps[nextIndex];
  if (!next || next.action !== "click") return null;
  if ((next.pageKey ?? "") !== (step.pageKey ?? "")) return null;
  const matches = transitionAffordances(step.transition).filter((affordance) =>
    affordanceMatchesStep(affordance, next)
  );
  return matches.length === 1 ? nextIndex : null;
}

/**
 * @param {Record<string, any>} transition
 * @returns {Array<Record<string, any>>}
 */
function transitionAffordances(transition) {
  const appeared = Array.isArray(transition?.appeared) ? transition.appeared : [];
  const changedLive = (Array.isArray(transition?.changed) ? transition.changed : [])
    .map((entry) => entry?.live)
    .filter((entry) => entry && typeof entry === "object");
  return [...appeared, ...changedLive];
}

/**
 * @param {Record<string, any>} affordance
 * @param {Record<string, any>} step
 */
function affordanceMatchesStep(affordance, step) {
  const locator = step.locator && typeof step.locator === "object" ? step.locator : {};
  const affordanceKey = cleanSignal(affordance.structuralKey);
  const stepKey = cleanSignal(locator.structuralKey ?? step.structuralKey);
  if (affordanceKey && stepKey && affordanceKey === stepKey) return true;

  const affordanceName = normalizeSignal(affordance.name);
  const stepName = normalizeSignal(locator.name ?? step.text);
  const affordanceRole = normalizeSignal(affordance.role);
  const stepRole = normalizeSignal(locator.role ?? step.role);
  if (affordanceName && stepName && affordanceName === stepName) {
    return !affordanceRole || !stepRole || affordanceRole === stepRole;
  }

  const affordanceHref = cleanSignal(affordance.href);
  const stepHref = cleanSignal(locator.href ?? step.href);
  return Boolean(affordanceHref && stepHref && affordanceHref === stepHref);
}

/**
 * @param {unknown} value
 */
function cleanSignal(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 */
function normalizeSignal(value) {
  return cleanSignal(value).replace(/\s+/g, " ").toLowerCase();
}

/**
 * @param {Array<Record<string, any>>} steps
 * @returns {Array<Record<string, any>>}
 */
function deriveCompounds(steps) {
  /** @type {Array<Record<string, any>>} */
  const compounds = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const semantics = step?.actionSemantics;
    if (!semantics || semantics.kind !== "stateful-affordance") continue;
    const followupStepIndex = semantics.followupStepIndex;
    if (typeof followupStepIndex !== "number") continue;
    const followup = steps[followupStepIndex];
    if (!followup || followup.action !== "click") continue;
    if ((followup.pageKey ?? "") !== (step.pageKey ?? "")) continue;
    const pageKey = typeof step.pageKey === "string" ? step.pageKey : "";
    compounds.push({
      kind: "reveal-select",
      range: [index, followupStepIndex],
      pageKey,
      surfaceKey: `${pageKey || "surface"}#reveal:${index}`,
      triggerStepIndex: index,
      followupStepIndex
    });
  }
  return compounds;
}

/**
 * @param {Array<Record<string, any>>} compounds
 * @returns {{ edges: Array<Record<string, any>> }}
 */
function deriveWorkflowGraph(compounds) {
  return {
    edges: compounds.flatMap((compound) => {
      if (compound.kind !== "reveal-select") return [];
      return [{
        kind: "reveal",
        fromStepIndex: compound.triggerStepIndex,
        toStepIndex: compound.followupStepIndex,
        pageKey: compound.pageKey,
        surfaceKey: compound.surfaceKey
      }];
    })
  };
}

/**
 * @param {string} rawUrl
 * @param {string} fixture
 */
export function normalizeWorkflowUrl(rawUrl, fixture) {
  if (!rawUrl) {
    return "about:blank";
  }

  if (fixture === "synthetic" || fixture === "docs" || fixture === "stateful" || fixture === "submit" || fixture === "secret" || fixture === "noanchor" || fixture === "selfclean" || fixture === "signals" || fixture === "samename" || fixture === "urlstate") {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search}`;
  }

  return rawUrl;
}

// Build a Map from pageKey to captured full affordance skeleton entries,
// sourced from the per-run skeleton-manifest.json.
// Returns an empty Map when the manifest is absent or malformed.

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {string} fixture
 * @param {Array<{ url?: string, pageSkeleton?: Array<{ role?: string, name?: string, structuralKey?: string }> }>} [events]
 * @returns {Map<string, Array<{role: string, name: string, structuralKey: string}>>}
 */
function readCapturedSkeletons(runPaths, fixture, events = []) {
  const manifest = /** @type {{ schemaVersion?: number, entries?: Array<{ url?: string, skeleton?: Array<{ role?: string, name?: string, structuralKey?: string }> }> } | null} */ (
    readJsonIfExists(runPaths.skeletonManifestPath)
  );
  /** @type {Map<string, Array<{role: string, name: string, structuralKey: string}>>} */
  const byPageKey = new Map();
  /**
   * @param {string | undefined} url
   * @param {Array<{ role?: string, name?: string, structuralKey?: string }> | undefined} skeleton
   */
  const addSkeleton = (url, skeleton) => {
    if (typeof url !== "string" || !Array.isArray(skeleton)) return;
    const pageKey = derivePageKey(url, fixture);
    if (!pageKey || pageKey === "<invalid-url>") return;
    const existing = byPageKey.get(pageKey) ?? [];
    const seen = new Set(existing.map((entry) => entry.structuralKey).filter(Boolean));
    for (const s of skeleton) {
      const structuralKey = typeof s.structuralKey === "string" ? s.structuralKey : "";
      if (!structuralKey || seen.has(structuralKey)) continue;
      seen.add(structuralKey);
      existing.push({
        role: typeof s.role === "string" ? s.role : "",
        name: typeof s.name === "string" ? s.name : "",
        structuralKey
      });
    }
    byPageKey.set(pageKey, existing);
  };
  if (manifest && Array.isArray(manifest.entries)) {
    for (const entry of manifest.entries) {
      addSkeleton(entry?.url, entry?.skeleton);
    }
  }
  for (const event of events) {
    addSkeleton(event.url, event.pageSkeleton);
  }
  return byPageKey;
}

// lift snapshots from artifacts/runs/<id>/snapshots/ into
// knowledge/pages/<pageKey>/snapshots/<timestampMs>.html.gz. Copy
// semantics (artifacts retain the per-run audit trail; knowledge
// accumulates the cross-run time-series). No-op when snapshot mode
// was off.

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {string} fixture
 */
function liftSnapshotsToPageNodes(runPaths, fixture) {
  if (!existsSync(runPaths.snapshotsManifestPath)) {
    return;
  }
  const manifest = /** @type {{ entries?: Array<{ url?: string, timestamp?: number, filename?: string }> }} */ (
    readJsonIfExists(runPaths.snapshotsManifestPath)
  );
  if (!manifest || !Array.isArray(manifest.entries)) {
    return;
  }
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.url !== "string" || typeof entry.filename !== "string" || typeof entry.timestamp !== "number") {
      continue;
    }
    const pageKey = derivePageKey(entry.url, fixture);
    if (!pageKey || pageKey === "<invalid-url>") {
      continue;
    }
    const sourcePath = resolvePath(runPaths.snapshotsDir, entry.filename);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const destinationPath = pageSnapshotPath(pageKey, entry.timestamp);
    mkdirSync(pagePaths(pageKey).snapshotsDir, { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }
}

// page-node helpers. Accumulate per-selector data per page-node during
// the event walk, then read-merge-write the
// knowledge/pages/<pageKey>/ tree once the run is fully processed.

/**
 * @param {string} selector
 */
function newSelectorEntry(selector) {
  return {
    selector,
    actions: /** @type {Set<string>} */ (new Set()),
    /** @type {Array<Record<string, unknown>>} */
    ancestors: [],
    /** @type {{ totalMatchingSelector?: number, totalMatchingRole?: number } | null} */
    siblings: null,
    fieldName: "",
    text: "",
    captureCount: 0
  };
}

/**
 * @param {{ selectors: Map<string, ReturnType<typeof newSelectorEntry>> }} node
 * @param {Record<string, unknown>} event
 * @param {string} actionName
 */
function accumulateSelector(node, event, actionName) {
  const selector = /** @type {string} */ (event.selector ?? "");
  let entry = node.selectors.get(selector);
  if (!entry) {
    entry = newSelectorEntry(selector);
    node.selectors.set(selector, entry);
  }
  entry.actions.add(actionName);
  if (Array.isArray(event.ancestors)) {
    entry.ancestors = /** @type {Array<Record<string, unknown>>} */ (event.ancestors);
  }
  if (event.siblings && typeof event.siblings === "object") {
    entry.siblings = /** @type {{ totalMatchingSelector?: number, totalMatchingRole?: number }} */ (event.siblings);
  }
  if (typeof event.fieldName === "string" && event.fieldName.length > 0) {
    entry.fieldName = event.fieldName;
  }
  if (typeof event.text === "string" && event.text.length > 0) {
    entry.text = event.text;
  }
  entry.captureCount += 1;
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {Array<Record<string, any>>} events
 * @param {string} fixture
 * @param {string} firstNavigate
 * @param {string} finalNavigate
 */
function readCaptureNoiseArtifacts(runPaths, events, fixture, firstNavigate, finalNavigate) {
  const persistedPreview = /** @type {Record<string, any> | null} */ (
    readJsonIfExists(runPaths.captureNoisePreviewPath)
  );
  const freshPreview = detectCaptureNoise({ events, fixture, firstNavigate, finalNavigate });
  const preview = freshPreview.status === "needs_review" && persistedPreview?.status !== "needs_review"
    ? freshPreview
    : persistedPreview ?? freshPreview;
  const result = /** @type {Record<string, any> | null} */ (
    readJsonIfExists(runPaths.captureNoiseResultPath)
  ) ?? null;
  return { preview, result };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {Array<Record<string, any>>} events
 * @param {string} fixture
 * @param {string} firstNavigate
 */
function readLocatorIntentArtifacts(runPaths, events, fixture, firstNavigate) {
  const persistedPreview = /** @type {Record<string, any> | null} */ (
    readJsonIfExists(runPaths.locatorIntentPreviewPath)
  );
  const freshPreview = detectLocatorIntent({ events, fixture, firstNavigate });
  const preview = freshPreview.status === "needs_review" && persistedPreview?.status !== "needs_review"
    ? freshPreview
    : persistedPreview ?? freshPreview;
  const result = /** @type {Record<string, any> | null} */ (
    readJsonIfExists(runPaths.locatorIntentResultPath)
  ) ?? null;
  return { preview, result };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {{
 *   steps: Array<Record<string, any>>,
 *   proofs: Array<Record<string, any>>,
 *   finalUrl: string,
 *   allowStateRoute?: boolean
 * }} input
 */
function readRouteIntentArtifacts(runPaths, input) {
  const freshPreview = detectRouteIntent(input);
  writeJson(runPaths.routeIntentPreviewPath, freshPreview);
  const result = /** @type {Record<string, any> | null} */ (
    readJsonIfExists(runPaths.routeIntentResultPath)
  ) ?? null;
  return { preview: freshPreview, result };
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {{ preview?: Record<string, any> | null, result?: Record<string, any> | null }} captureNoise
 * @param {{ fixture: string, protectedEventIndexes?: Set<number> }} options
 * @returns {{
 *   events: Array<Record<string, any>>,
 *   ignored: Array<Record<string, any>>,
 *   keptReviewByEvent: WeakMap<Record<string, any>, Record<string, any>>
 * }}
 */
function applyCaptureNoiseReview(events, captureNoise, options = { fixture: "manual" }) {
  const preview = captureNoise.preview;
  const result = captureNoise.result;
  const keptReviewByEvent = new WeakMap();
  const protectedEventIndexes = options.protectedEventIndexes ?? new Set();
  if (!preview || preview.status !== "needs_review") {
    return { events, ignored: [], keptReviewByEvent };
  }
  const reviewCandidates = Array.isArray(preview.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
  const decisions = new Map(
    Array.isArray(result?.decisions)
      ? result.decisions
        .filter((entry) => entry && typeof entry.candidateId === "string" && typeof entry.verdict === "string")
        .map((entry) => [entry.candidateId, entry.verdict])
      : []
  );
  const intentResolutionByGroup = new Map(
    Array.isArray(result?.intentResolutions)
      ? result.intentResolutions
        .filter((entry) => entry && typeof entry.intentGroupId === "string" && typeof entry.resolution === "string")
        .map((entry) => [entry.intentGroupId, entry])
      : []
  );
  const unresolved = reviewCandidates.filter((entry) => !decisions.has(entry.candidateId));
  if (unresolved.length > 0) {
    const ids = unresolved.map((entry) => entry.candidateId).join(", ");
    throw new Error(`capture noise review required before analyze: unresolved candidate(s) ${ids}`);
  }
  const excludedIndexes = new Set();
  /** @type {Array<Record<string, any>>} */
  const ignored = [];
  /** @type {Map<number, Array<Record<string, any>>>} */
  const providerPrimersByActionSeq = new Map();
  for (const group of captureNoiseIntentGroups(preview)) {
    const resolution = intentResolutionByGroup.get(group.intentGroupId);
    if (!resolution) continue;
    if (resolution.resolution === "canonical") {
      for (const candidateId of Array.isArray(group.candidateIds) ? group.candidateIds : []) {
        if (decisions.get(candidateId) !== "exclude") {
          throw new Error(`canonical capture intent ${group.intentGroupId} requires candidate ${candidateId} to be excluded.`);
        }
      }
      const canonicalReplay = group.canonicalReplay && typeof group.canonicalReplay === "object" ? group.canonicalReplay : {};
      const candidateId = Array.isArray(group.candidateIds) ? String(group.candidateIds[0] || "") : "";
      const candidate = reviewCandidates.find((entry) => entry.candidateId === candidateId) ?? {
        candidateId,
        kind: "ambiguous-prefix-toggle",
        summary: String(group.summary || "")
      };
      for (const eventIndex of Array.isArray(canonicalReplay.excludeEventIndexes) ? canonicalReplay.excludeEventIndexes : []) {
        if (protectedEventIndexes.has(eventIndex)) continue;
        addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate, "user-excluded-canonical-toggle-prefix");
      }
      continue;
    }
    if (resolution.resolution === "strict" && resolution.riskAcknowledged !== true) {
      throw new Error(`strict capture intent ${group.intentGroupId} requires riskAcknowledged:true.`);
    }
  }
  for (const candidate of reviewCandidates) {
    if (decisions.get(candidate.candidateId) === "keep") {
      if (isReplayableStateProofProviderProxy(candidate)) {
        const linkedActionSeq = linkedTrustedActionSeq(candidate);
        if (!linkedActionSeq || !linkedTrustedActionHasProviderProof(candidate, options.stepLedger)) {
          const eventIndexes = Array.isArray(candidate.eventIndexes)
            ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
            : [];
          for (const eventIndex of eventIndexes) {
            if (protectedEventIndexes.has(eventIndex)) continue;
            addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate, "user-kept-provider-proxy-without-linked-proof");
          }
          continue;
        }
        if (!isPhysicalReplayableProviderProxy(candidate, events)) {
          const eventIndexes = Array.isArray(candidate.eventIndexes)
            ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
            : [];
          for (const eventIndex of eventIndexes) {
            addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate, "provider-primer-evidence-only");
          }
          const primers = providerPrimersByActionSeq.get(linkedActionSeq) ?? [];
          primers.push(providerPrimerEvidence(candidate, events));
          providerPrimersByActionSeq.set(linkedActionSeq, primers);
          continue;
        }
      }
      const nonReplayableKeepReason = nonReplayableProviderKeepReason(candidate);
      if (nonReplayableKeepReason) {
        const eventIndexes = Array.isArray(candidate.eventIndexes)
          ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
          : [];
        for (const eventIndex of eventIndexes) {
          if (protectedEventIndexes.has(eventIndex)) continue;
          addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate, nonReplayableKeepReason);
        }
        continue;
      }
      const group = captureNoiseIntentGroups(preview).find((entry) =>
        Array.isArray(entry.candidateIds) && entry.candidateIds.includes(candidate.candidateId)
      );
      const resolution = group ? intentResolutionByGroup.get(group.intentGroupId) : null;
      if ((candidate.kind === "ambiguous-prefix-toggle" || group?.risk) && !(resolution?.resolution === "strict" && resolution?.riskAcknowledged === true)) {
        throw new Error(`risky keep for ${candidate.candidateId} requires strict intent resolution with riskAcknowledged:true.`);
      }
      const eventIndexes = Array.isArray(candidate.eventIndexes)
        ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
        : [];
      for (const eventIndex of eventIndexes) {
        const event = events[eventIndex];
        if (!event || typeof event !== "object") continue;
        keptReviewByEvent.set(event, {
          candidateId: candidate.candidateId,
          kind: candidate.kind,
          reason: candidate.reason ?? ""
        });
      }
      continue;
    }
    if (decisions.get(candidate.candidateId) !== "exclude") continue;
    const eventIndexes = Array.isArray(candidate.eventIndexes)
      ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
      : [];
    for (const eventIndex of eventIndexes) {
      if (protectedEventIndexes.has(eventIndex)) continue;
      addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate);
    }
  }
  validateIntentGroupIntegrity(preview, excludedIndexes);
  validateExcludedRouteContinuity(events, excludedIndexes, options.fixture);
  return {
    events: events.filter((_, index) => !excludedIndexes.has(index)),
    ignored,
    keptReviewByEvent,
    providerPrimersByActionSeq
  };
}

/**
 * @param {Array<Record<string, unknown>>} steps
 * @param {Map<number, Array<Record<string, any>>> | undefined} providerPrimersByActionSeq
 */
function attachProviderPrimerEvidence(steps, providerPrimersByActionSeq) {
  if (!providerPrimersByActionSeq || providerPrimersByActionSeq.size === 0) return;
  for (const step of steps) {
    const actionSeq = typeof step.actionSeq === "number" ? step.actionSeq : null;
    if (actionSeq === null) continue;
    const primers = providerPrimersByActionSeq.get(actionSeq);
    if (!primers || primers.length === 0) continue;
    step.providerPrimerEvidence = primers.map((entry) => ({ ...entry }));
  }
}

/**
 * Provider evidence can be useful evidence that a later trusted action was
 * surfaced, but not every provider-owned control is a replayable workflow step.
 *
 * @param {Record<string, any>} candidate
 * @returns {string}
 */
function nonReplayableProviderKeepReason(candidate) {
  const evidenceRole = String(candidate.evidenceRole || "");
  if (evidenceRole === "provider-timeline-auto") {
    return "user-kept-nonreplayable-provider-timeline-auto";
  }
  if (evidenceRole !== "provider-proxy-before-trusted-action" && evidenceRole !== "provider-proxy-after-trusted-action") {
    return "";
  }
  if (isReplayableStateProofProviderProxy(candidate)) {
    return "";
  }
  if (
    candidate.kind === "ambiguous-implementation-layer-click" &&
    candidate.reason === "implementation-noop" &&
    candidate.linkedTrustedAction
  ) {
    return "user-kept-nonreplayable-provider-proxy";
  }
  return isStateProofProviderContext(candidate.providerContext)
    ? ""
    : "user-kept-nonreplayable-provider-proxy";
}

/**
 * @param {Record<string, any>} candidate
 */
function isReplayableStateProofProviderProxy(candidate) {
  if (candidate.evidenceRole !== "provider-proxy-before-trusted-action") return false;
  const providerContext = candidate.providerContext && typeof candidate.providerContext === "object"
    ? candidate.providerContext
    : {};
  const linkedTrustedAction = candidate.linkedTrustedAction && typeof candidate.linkedTrustedAction === "object"
    ? candidate.linkedTrustedAction
    : {};
  if (providerContext.pattern !== "layered-control-surface") return false;
  if (providerContext.replayStrategy !== "state-proof-click") return false;
  if (providerContext.confidence !== "high") return false;
  if (!providerContext.surfaceKey || !providerContext.controlGroup) return false;
  if (linkedTrustedAction.surfaceKey !== providerContext.surfaceKey) return false;
  if (linkedTrustedAction.controlGroup !== providerContext.controlGroup) return false;
  return true;
}

/**
 * @param {Record<string, any>} candidate
 * @returns {number | null}
 */
function linkedTrustedActionSeq(candidate) {
  const linkedTrustedAction = candidate.linkedTrustedAction && typeof candidate.linkedTrustedAction === "object"
    ? candidate.linkedTrustedAction
    : {};
  return typeof linkedTrustedAction.actionSeq === "number" ? linkedTrustedAction.actionSeq : null;
}

/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any> | undefined} stepLedger
 * @returns {boolean}
 */
function linkedTrustedActionHasProviderProof(candidate, stepLedger) {
  const actionSeq = linkedTrustedActionSeq(candidate);
  if (!actionSeq) return false;
  const steps = Array.isArray(stepLedger?.steps) ? stepLedger.steps : [];
  const linkedStep = steps.find((step) => step && step.actionSeq === actionSeq);
  if (!linkedStep) return false;
  return Array.isArray(linkedStep.providerPostconditions) && linkedStep.providerPostconditions.some((condition) =>
    condition && (condition.kind === "reveals-next-action" || condition.kind === "stateful-surface-proof")
  );
}

/**
 * @param {Record<string, any>} candidate
 * @param {Array<Record<string, any>>} events
 * @returns {boolean}
 */
function isPhysicalReplayableProviderProxy(candidate, events) {
  const eventIndexes = Array.isArray(candidate.eventIndexes)
    ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
    : [];
  const actionEvents = eventIndexes
    .map((eventIndex) => events[Number(eventIndex)])
    .filter((event) => event && event.type === "click");
  if (actionEvents.length === 0) return false;
  return actionEvents.every((event) => isPhysicalReplayableProviderProxyEvent(event));
}

/**
 * @param {Record<string, any>} event
 * @returns {boolean}
 */
function isPhysicalReplayableProviderProxyEvent(event) {
  if (event.actionKind === "implementation-layer") return false;
  if (event.isTrusted === false) return false;
  if (event.targetVisibility && typeof event.targetVisibility === "object" && event.targetVisibility.hasVisibleBox === false) {
    return false;
  }
  const locator = event.locator && typeof event.locator === "object" ? event.locator : {};
  const box = locator.box && typeof locator.box === "object" ? locator.box : null;
  if (!box || !positiveNumber(box.w) || !positiveNumber(box.h)) return false;
  if (typeof locator.identityShape !== "string" || !locator.identityShape) return false;
  if (typeof locator.controlKind !== "string" || !locator.controlKind) return false;
  return true;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * @param {Record<string, any>} candidate
 * @param {Array<Record<string, any>>} events
 * @returns {Record<string, any>}
 */
function providerPrimerEvidence(candidate, events) {
  const eventIndexes = Array.isArray(candidate.eventIndexes)
    ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value)).map(Number)
    : [];
  const firstActionEvent = eventIndexes.map((eventIndex) => events[eventIndex]).find((event) => event && event.type === "click") || {};
  const providerContext = candidate.providerContext && typeof candidate.providerContext === "object" ? candidate.providerContext : {};
  return {
    kind: "provider-proxy-primer",
    candidateId: candidate.candidateId,
    evidenceRole: candidate.evidenceRole,
    text: String(firstActionEvent.text || candidate.effect?.targetText || ""),
    eventIndexes,
    providerContext: {
      pattern: providerContext.pattern,
      replayStrategy: providerContext.replayStrategy,
      surfaceKey: providerContext.surfaceKey,
      controlGroup: providerContext.controlGroup,
      confidence: providerContext.confidence
    }
  };
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Set<number>} excludedIndexes
 * @param {Array<Record<string, any>>} ignored
 * @param {unknown} eventIndex
 * @param {Record<string, any>} candidate
 * @param {string} [reasonOverride]
 */
function addExcludedCaptureNoiseEvent(events, excludedIndexes, ignored, eventIndex, candidate, reasonOverride = "") {
  if (!Number.isInteger(eventIndex)) return;
  const resolvedIndex = Number(eventIndex);
  if (excludedIndexes.has(resolvedIndex)) return;
  excludedIndexes.add(resolvedIndex);
  const event = events[resolvedIndex];
  if (!event) return;
  ignored.push({
    type: `excluded-${String(event.type || "event")}`,
    reason: reasonOverride || ignoredReasonForCaptureNoiseCandidate(candidate),
    candidateId: candidate.candidateId,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    ignoredSelector: String(event.selector || ""),
    ignoredText: String(event.text || event.locator?.name || ""),
    ignoredUrl: String(event.url || event.href || event.locator?.href || "")
  });
}

/**
 * @param {Record<string, any> | null | undefined} preview
 */
function captureNoiseIntentGroups(preview) {
  return Array.isArray(preview?.intentGroups)
    ? preview.intentGroups.filter((entry) => entry && typeof entry.intentGroupId === "string")
    : [];
}

/**
 * @param {Record<string, any> | null | undefined} preview
 * @param {Set<number>} excludedIndexes
 */
function validateIntentGroupIntegrity(preview, excludedIndexes) {
  for (const group of captureNoiseIntentGroups(preview)) {
    if (group.intentKind !== "toggle-reveal") continue;
    const raw = integerIndexes(group.rawEventIndexes);
    if (raw.length === 0) continue;
    const excludedCount = raw.filter((index) => excludedIndexes.has(index)).length;
    if (excludedCount === 0 || excludedCount === raw.length) continue;
    const canonical = group.canonicalReplay && typeof group.canonicalReplay === "object" ? group.canonicalReplay : {};
    const canonicalExclude = new Set(
      integerIndexes(canonical.excludeEventIndexes)
    );
    const canonicalKeep = new Set(
      integerIndexes(canonical.keepEventIndexes)
    );
    const validCanonicalShape = raw.every((index) => canonicalExclude.has(index) || canonicalKeep.has(index));
    if (validCanonicalShape) continue;
    throw new Error(`capture intent ${group.intentGroupId} was partially excluded; use canonical or strict resolution.`);
  }
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function integerIndexes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((index) => Number.isInteger(index))
    .map((index) => Number(index));
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {Set<number>} excludedIndexes
 * @param {string} fixture
 */
function validateExcludedRouteContinuity(events, excludedIndexes, fixture) {
  for (const eventIndex of excludedIndexes) {
    const event = events[eventIndex];
    if (!event || event.type !== "click") continue;
    const navigation = followingNavigationAfterAction(events, eventIndex);
    if (!navigation) continue;
    if (!hasLaterStepOnDestination(events, navigation.index, navigation.toUrl, navigation.tabOrdinal, excludedIndexes, fixture)) {
      continue;
    }
    const text = String(event.text || event.locator?.name || event.selector || "click");
    throw new Error(
      `Cannot exclude navigation click "${text}" to ${navigation.toUrl}; later replay steps depend on that destination. Keep it or recapture with an alternate route.`
    );
  }
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} actionIndex
 * @returns {{ index: number, toUrl: string, tabOrdinal: number } | null}
 */
function followingNavigationAfterAction(events, actionIndex) {
  const action = events[actionIndex];
  if (!action) return null;
  const fromUrl = String(action.url || "");
  const tabOrdinal = typeof action.tabOrdinal === "number" ? action.tabOrdinal : 0;
  let crossTabNavigation = null;
  for (let index = actionIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (isReplayActionEvent(event)) return crossTabNavigation;
    if (event.type !== "navigate") continue;
    const toUrl = String(event.url || "");
    if (!toUrl || toUrl === fromUrl || /^about:blank(?:$|[?#])/.test(toUrl)) continue;
    const eventTabOrdinal = typeof event.tabOrdinal === "number" ? event.tabOrdinal : tabOrdinal;
    if (eventTabOrdinal === tabOrdinal) {
      return { index, toUrl, tabOrdinal };
    }
    if (!crossTabNavigation) {
      crossTabNavigation = { index, toUrl, tabOrdinal: eventTabOrdinal };
    }
  }
  return crossTabNavigation;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {number} navigationIndex
 * @param {string} destinationUrl
 * @param {number} tabOrdinal
 * @param {Set<number>} excludedIndexes
 * @param {string} fixture
 */
function hasLaterStepOnDestination(events, navigationIndex, destinationUrl, tabOrdinal, excludedIndexes, fixture) {
  const destinationPageKey = derivePageKey(destinationUrl, fixture);
  let currentPageKey = destinationPageKey;
  for (let index = navigationIndex + 1; index < events.length; index += 1) {
    if (excludedIndexes.has(index)) continue;
    const event = events[index];
    if (!event) continue;
    const eventTabOrdinal = typeof event.tabOrdinal === "number" ? event.tabOrdinal : tabOrdinal;
    if (eventTabOrdinal !== tabOrdinal) continue;
    if (event.type === "navigate" && event.url && event.url !== "about:blank") {
      currentPageKey = derivePageKey(String(event.url), fixture);
      if (currentPageKey !== destinationPageKey) return false;
      continue;
    }
    if (event.type === "action-diff") continue;
    if (isReplayActionEvent(event) && currentPageKey === destinationPageKey) return true;
  }
  return false;
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {{ preview?: Record<string, any> | null, result?: Record<string, any> | null }} locatorIntent
 * @returns {{ confirmedByEvent: WeakMap<Record<string, any>, Record<string, any>> }}
 */
function applyLocatorIntentReview(events, locatorIntent) {
  const preview = locatorIntent.preview;
  const result = locatorIntent.result;
  const confirmedByEvent = new WeakMap();
  if (!preview || preview.status !== "needs_review") {
    return { confirmedByEvent };
  }
  const reviewCandidates = Array.isArray(preview.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
  const decisions = new Map(
    Array.isArray(result?.decisions)
      ? result.decisions
        .filter((entry) => entry && typeof entry.candidateId === "string" && typeof entry.verdict === "string")
        .map((entry) => [entry.candidateId, entry.verdict])
      : []
  );
  const unresolved = reviewCandidates.filter((entry) => !decisions.has(entry.candidateId));
  if (unresolved.length > 0) {
    const ids = unresolved.map((entry) => entry.candidateId).join(", ");
    throw new Error(`locator intent review required before analyze: unresolved candidate(s) ${ids}`);
  }
  const recapture = reviewCandidates.filter((entry) => decisions.get(entry.candidateId) === "recapture");
  if (recapture.length > 0) {
    const ids = recapture.map((entry) => entry.candidateId).join(", ");
    throw new Error(`locator intent review requested recapture: candidate(s) ${ids}`);
  }
  for (const candidate of reviewCandidates) {
    if (decisions.get(candidate.candidateId) !== "confirm") continue;
    const eventIndexes = Array.isArray(candidate.eventIndexes)
      ? candidate.eventIndexes.filter((/** @type {unknown} */ value) => Number.isInteger(value))
      : [candidate.eventIndex].filter((/** @type {unknown} */ value) => Number.isInteger(value));
    for (const eventIndex of eventIndexes) {
      const event = events[eventIndex];
      if (!event || typeof event !== "object") continue;
      confirmedByEvent.set(event, {
        candidateId: candidate.candidateId,
        kind: candidate.kind,
        semanticRegionSummary: candidate.semanticRegionSummary ?? ""
      });
    }
  }
  return { confirmedByEvent };
}

/**
 * @param {Record<string, any>} candidate
 */
function ignoredReasonForCaptureNoiseCandidate(candidate) {
  if (candidate.kind === "ambiguous-implementation-layer-click") {
    return "user-excluded-implementation-layer-click";
  }
  if (candidate.kind === "ambiguous-observation-click") {
    return "user-excluded-observation-click";
  }
  if (candidate.kind === "ambiguous-hidden-control-burst") {
    return candidate.reason === "hidden-zero-box-noop"
      ? "user-excluded-hidden-control-noop"
      : "user-excluded-hidden-control-burst";
  }
  return "user-excluded-capture-noise";
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {{ fixture: string, keptReviewByEvent: WeakMap<Record<string, any>, Record<string, any>> }} options
 */
function enforceReplayEligibility(events, options) {
  const matchActionDiff = createActionDiffMatcher(events, { fixture: options.fixture });
  const failures = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isReplayActionEvent(event)) continue;
    const matched = matchActionDiff(index, event.type === "submit" ? "submit" : event.type === "input" ? "input" : "click");
    const diff = matched?.event ?? null;
    const risk = replayEligibilityRisk(event, diff, events, index);
    if (!risk) continue;
    if (options.keptReviewByEvent.has(event)) continue;
    failures.push({
      index,
      text: String(event.text || event.locator?.name || event.selector || ""),
      risk
    });
  }
  if (failures.length === 0) return;
  const summary = failures
    .slice(0, 5)
    .map((entry) => `${entry.index}:${entry.risk}${entry.text ? `:${entry.text}` : ""}`)
    .join(", ");
  throw new Error(`replay eligibility review required before analyze: unresolved ineligible action(s) ${summary}`);
}

/**
 * @param {Record<string, any>} event
 */
function isReplayActionEvent(event) {
  return event && (event.type === "click" || event.type === "submit" || event.type === "input");
}

/**
 * @param {Record<string, any>} event
 * @param {Record<string, any> | null} diff
 * @param {Array<Record<string, any>>} [events]
 * @param {number} [eventIndex]
 */
function replayEligibilityRisk(event, diff, events = [], eventIndex = -1) {
  if (event.type !== "click") return null;
  const hasReplayIntent = hasExplicitReplayIntent(event) || hasFollowingNavigationIntent(events, eventIndex);
  if (event.isTrusted === false && !hasReplayIntent) return "untrusted-click";
  if (event.actionKind === "implementation-layer" && !hasReplayIntent) return "implementation-layer-click";
  if (isHiddenOrZeroBoxEvent(event) && isNoopTransition(diff)) return "hidden-noop-click";
  return null;
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
 * JS-navigation controls can be replayable even when capture marks the CDP
 * click untrusted and no href/form metadata exists.
 *
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
    if (isReplayActionEvent(event)) return false;
    if (event.type !== "navigate") continue;
    if ((event.tabOrdinal ?? 0) !== tabOrdinal) continue;
    const toUrl = typeof event.url === "string" ? event.url : "";
    if (toUrl && toUrl !== fromUrl && !/^about:blank(?:$|[?#])/.test(toUrl)) return true;
  }
  return false;
}

/**
 * @param {Record<string, any>} event
 */
function isHiddenOrZeroBoxEvent(event) {
  if (event.targetVisibility?.hasVisibleBox === false) return true;
  const rawBox = event.targetVisibility?.rawBox ?? event.locator?.box;
  return Boolean(rawBox && typeof rawBox === "object" &&
    (/** @type {any} */ (rawBox).w <= 0 || /** @type {any} */ (rawBox).h <= 0));
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
  if (appeared.length > 0 || disappeared.length > 0 || changed.length > 0) return false;
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * @param {Record<string, any>} event
 * @returns {Record<string, unknown> | null}
 */
function visibilityRiskForEvent(event) {
  if (!event || event.type !== "click") return null;
  const visibility = event.targetVisibility && typeof event.targetVisibility === "object"
    ? event.targetVisibility
    : null;
  const locatorBox = event.locator && typeof event.locator === "object" ? event.locator.box : null;
  const rawBox = visibility?.rawBox ?? locatorBox;
  const hasZeroBox = rawBox && typeof rawBox === "object" &&
    (/** @type {any} */ (rawBox).w <= 0 || /** @type {any} */ (rawBox).h <= 0);
  const visible = event.visibleActionableAncestor || event.visibleHitTarget;
  const selector = String(event.actionableSelector || event.selector || "");
  const visibleSelector = visible && typeof visible === "object" ? String(visible.selector || "") : "";
  const visibleTargetDiffers = event.isTrusted !== false &&
    isUsableVisibleSignal(visibleSelector) &&
    Boolean(selector && visibleSelector !== selector);
  if (visibility?.hasVisibleBox !== false && !hasZeroBox && !visibleTargetDiffers) {
    return null;
  }
  return {
    kind: "hidden-or-layered-target",
    hasVisibleBox: visibility?.hasVisibleBox,
    zeroBox: Boolean(hasZeroBox),
    visibleTargetDiffers,
    visibleSummary: visible && typeof visible === "object"
      ? [visible.role, visible.name, visible.selector].filter(Boolean).join(" ")
      : ""
  };
}

/**
 * @param {string} value
 */
function isUsableVisibleSignal(value) {
  return Boolean(value && !value.startsWith("<redacted") && !value.startsWith("[redacted"));
}

/**
 * @param {string} path
 */
function readJsonIfExists(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

/**
 * @param {string} pageKey
 * @param {{ selectors: Map<string, ReturnType<typeof newSelectorEntry>>, outgoing: Map<string, number> }} node
 * @param {string} fixture
 * @param {Array<Record<string, unknown>>} pageSteps
 * @param {Array<{role: string, name: string, structuralKey: string}> | null} capturedSkeleton
 */
function writePageNode(pageKey, node, fixture, pageSteps, capturedSkeleton) {
  const paths = pagePaths(pageKey);
  mkdirSync(paths.pageDir, { recursive: true });
  const nowIso = new Date().toISOString();

  const existingMeta = /** @type {{ firstSeen?: string, captureCount?: number, fixtures?: string[] }} */ (
    readJsonIfExists(paths.metaPath)
  ) ?? null;
  const fixtures = new Set(existingMeta?.fixtures ?? []);
  fixtures.add(fixture);
  writeJson(paths.metaPath, {
    schemaVersion: 1,
    pageKey,
    firstSeen: existingMeta?.firstSeen ?? nowIso,
    lastSeen: nowIso,
    captureCount: (existingMeta?.captureCount ?? 0) + 1,
    fixtures: Array.from(fixtures).sort()
  });

  const existingSelectorsDoc = /** @type {{ selectors?: Array<{
    selector: string,
    actions?: string[],
    ancestors?: Array<Record<string, unknown>>,
    siblings?: Record<string, unknown> | null,
    fieldName?: string,
    text?: string,
    captureCount?: number
  }> }} */ (readJsonIfExists(paths.selectorsPath)) ?? null;
  /** @type {Map<string, {
    selector: string,
    actions: string[],
    ancestors: Array<Record<string, unknown>>,
    siblings: Record<string, unknown> | null,
    fieldName: string,
    text: string,
    captureCount: number
  }>} */
  const mergedSelectors = new Map();
  for (const entry of existingSelectorsDoc?.selectors ?? []) {
    mergedSelectors.set(entry.selector, {
      selector: entry.selector,
      actions: Array.isArray(entry.actions) ? [...entry.actions] : [],
      ancestors: Array.isArray(entry.ancestors) ? entry.ancestors : [],
      siblings: entry.siblings ?? null,
      fieldName: typeof entry.fieldName === "string" ? entry.fieldName : "",
      text: typeof entry.text === "string" ? entry.text : "",
      captureCount: typeof entry.captureCount === "number" ? entry.captureCount : 0
    });
  }
  for (const [selector, entry] of node.selectors) {
    const prev = mergedSelectors.get(selector);
    const combinedActions = new Set([...(prev?.actions ?? []), ...Array.from(entry.actions)]);
    mergedSelectors.set(selector, {
      selector,
      actions: Array.from(combinedActions).sort(),
      ancestors: entry.ancestors.length > 0 ? entry.ancestors : (prev?.ancestors ?? []),
      siblings: entry.siblings ?? prev?.siblings ?? null,
      fieldName: entry.fieldName || prev?.fieldName || "",
      text: entry.text || prev?.text || "",
      captureCount: (prev?.captureCount ?? 0) + entry.captureCount
    });
  }
  writeJson(paths.selectorsPath, {
    schemaVersion: 1,
    pageKey,
    selectors: Array.from(mergedSelectors.values()).sort((a, b) => a.selector.localeCompare(b.selector))
  });

  const existingNeighborsDoc = /** @type {{ outgoing?: Array<{ to: string, transitionCount?: number }> }} */ (
    readJsonIfExists(paths.neighborsPath)
  ) ?? null;
  /** @type {Map<string, number>} */
  const mergedOutgoing = new Map();
  for (const out of existingNeighborsDoc?.outgoing ?? []) {
    if (typeof out.to === "string") {
      mergedOutgoing.set(out.to, typeof out.transitionCount === "number" ? out.transitionCount : 0);
    }
  }
  for (const [to, count] of node.outgoing) {
    mergedOutgoing.set(to, (mergedOutgoing.get(to) ?? 0) + count);
  }
  writeJson(paths.neighborsPath, {
    schemaVersion: 1,
    pageKey,
    outgoing: Array.from(mergedOutgoing, ([to, transitionCount]) => ({ to, transitionCount }))
      .sort((a, b) => a.to.localeCompare(b.to))
  });

  // affordance-skeleton mold.
  // when a captured full skeleton is available (from skeleton-manifest.json),
  // use it — dedupe by structuralKey (keep first), keep only entries with a non-empty key.
  // Fallback: derive from locator-bearing touched steps when no captured skeleton.
  /** @type {Map<string, { role: string, name: string, structuralKey: string }>} */
  const skeletonByKey = new Map();
  if (Array.isArray(capturedSkeleton) && capturedSkeleton.length > 0) {
    for (const entry of capturedSkeleton) {
      if (typeof entry.structuralKey === "string" && entry.structuralKey && !skeletonByKey.has(entry.structuralKey)) {
        skeletonByKey.set(entry.structuralKey, {
          role: entry.role ?? "",
          name: entry.name ?? "",
          structuralKey: entry.structuralKey
        });
      }
    }
  } else {
    for (const step of pageSteps) {
      const loc = /** @type {any} */ (step).locator;
      if (loc && typeof loc.structuralKey === "string" && loc.structuralKey) {
        if (!skeletonByKey.has(loc.structuralKey)) {
          skeletonByKey.set(loc.structuralKey, {
            role: typeof loc.role === "string" ? loc.role : "",
            name: typeof loc.name === "string" ? loc.name : "",
            structuralKey: loc.structuralKey
          });
        }
      }
    }
  }
  writeJson(paths.moldPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    pageKey,
    skeleton: Array.from(skeletonByKey.values())
  });
}
