import { installAccessibilityWatchdog } from "./watchdogs/accessibility.mjs";
import { locatorCaptureSource } from "../observe/locator-capture.mjs";
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS, pickByOrdinal } from "../lib/resolver-score.mjs";
import { deriveSemanticSlotForSignals } from "../lib/semantic-slot.mjs";
import { classifyWeatherMapControlGroup } from "../lib/surface-context.mjs";
import { providerSurfaceControlGroup } from "../lib/provider-context.mjs";

/**
 * @typedef {{ selector: string, atomicFp?: { strategy: string, role?: string, name?: string, scopeSelector?: string } }} AtomicFpStep
 */

/**
 * @typedef {{
 *   role?: string,
 *   name?: string,
 *   structuralKey?: string,
 *   elementKey?: string,
 *   relXPath?: string,
 *   cleanId?: string,
 *   neighborTexts?: string[],
 *   href?: string,
 *   box?: { cx: number, cy: number, w: number, h: number },
 *   viewport?: { w: number, h: number, dpr?: number },
 *   disambiguation?: { weightOverrides?: Record<string, number>, scopeRule?: { ancestorUp?: number, includeAncestorSiblingText?: boolean, anchorRole?: string }, resolutionMethod?: "A" | "B", ordinalHint?: number }
 * }} LocatorFingerprint
 */

/**
 * @typedef {{ selector?: string, locator?: LocatorFingerprint, atomicFp?: AtomicFpStep["atomicFp"] }} LocatorStep
 */

/**
 * @typedef {{ backendNodeId: number, layerUsed: string, confidence: "high" | "medium" | "low" }} ResolveLocatorResult
 */

/** Selector must equal the one used inside __bfCollectCandidates in locator-capture.mjs */
const CANDIDATE_SELECTOR = "a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]";

/**
 * Resolves the CDP backendNodeId for a step using atomic-fp strategy hints.
 *
 * Three strategies (in order):
 * 1. strategy === "role" + role + name → AX tree lookup via Accessibility domain
 * 2. strategy === "ancestor-scope" + scopeSelector → DOM.querySelector chain (scope → child)
 * 3. Fallback → DOM.querySelector with step.selector alone
 *
 * @param {import("./browser-session.mjs").CdpSession} session
 * @param {string} targetId
 * @param {AtomicFpStep} step
 * @returns {Promise<{ backendNodeId: number, strategyUsed: string }>}
 */
export async function resolveAtomicFpLocator(session, targetId, step) {
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(`resolveAtomicFpLocator: no sessionId for targetId ${targetId}`);

  const fp = step.atomicFp;

  // Strategy 1: role via AX tree
  if (fp?.strategy === "role" && fp.role && fp.name) {
    const ax = await installAccessibilityWatchdog(session);
    try {
      const backendNodeId = await ax.findBackendNodeId(targetId, fp.role, fp.name);
      if (backendNodeId != null) {
        return { backendNodeId, strategyUsed: "role" };
      }
    } finally {
      await ax.dispose();
    }
    // Role strategy explicitly requested but nothing found — fall through to next strategies
  }

  // Strategy 2: ancestor-scope via DOM.querySelector chain
  // doc is fetched here and reused in Strategy 3 to avoid a redundant CDP round-trip.
  /** @type {any} */
  let cachedDoc = null;
  if (fp?.strategy === "ancestor-scope" && fp.scopeSelector) {
    cachedDoc = await session.client.send("DOM.getDocument", { depth: -1, pierce: true }, sid);
    const scope = /** @type {any} */ (await session.client.send("DOM.querySelector", {
      nodeId: cachedDoc.root.nodeId,
      selector: fp.scopeSelector
    }, sid));
    if (scope.nodeId) {
      const child = /** @type {any} */ (await session.client.send("DOM.querySelector", {
        nodeId: scope.nodeId,
        selector: step.selector
      }, sid));
      if (child.nodeId) {
        const desc = /** @type {any} */ (await session.client.send("DOM.describeNode", { nodeId: child.nodeId }, sid));
        return { backendNodeId: desc.node.backendNodeId, strategyUsed: "ancestor-scope" };
      }
    }
  }

  // Strategy 3: fallback — raw selector (reuse doc from Strategy 2 if available)
  const doc = cachedDoc ?? /** @type {any} */ (await session.client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
  const found = /** @type {any} */ (await session.client.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: step.selector
  }, sid));
  if (!found.nodeId) {
    throw new Error(`resolveAtomicFpLocator: no element matched selector "${step.selector}"`);
  }
  const desc = /** @type {any} */ (await session.client.send("DOM.describeNode", { nodeId: found.nodeId }, sid));
  return { backendNodeId: desc.node.backendNodeId, strategyUsed: "selector-fallback" };
}

/**
 * Coverage-aware scorer resolver using the `step.locator` fingerprint.
 *
 * Collects all candidate element signals in-page, scores them against the
 * captured locator fingerprint, and picks the winner ONLY when confidence is
 * "high". Throws on ambiguity (→ runner drift-hold).
 *
 * Back-compat: steps without a rich locator fall through to resolveAtomicFpLocator.
 *
 * @param {import("./browser-session.mjs").CdpSession} session
 * @param {string} targetId
 * @param {LocatorStep} step
 * @returns {Promise<ResolveLocatorResult>}
 */
export async function resolveLocator(session, targetId, step) {
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(`resolveLocator: no sessionId for targetId ${targetId}`);

  const loc = step.locator;
  const hasLocator = loc && (
    loc.name ||
    loc.structuralKey ||
    loc.relXPath ||
    loc.cleanId ||
    (loc.neighborTexts && loc.neighborTexts.length) ||
    loc.href
  );

  // Back-compat: steps without a rich locator → legacy atomic-fp/selector resolver.
  if (!hasLocator) {
    const fb = await resolveAtomicFpLocator(session, targetId, /** @type {AtomicFpStep} */ (step));
    return { backendNodeId: fb.backendNodeId, layerUsed: "atomic-fp:" + fb.strategyUsed, confidence: "medium" };
  }

  // Scorer path: collect candidate signals in-page. Thread the
  // scope-agent's scopeRule so each candidate's neighborTexts is harvested from
  // the SAME identity region the model defined for the target (symmetry — else
  // the target's model-set anchors would never match the candidates).
  const scopeRule = (loc.disambiguation && loc.disambiguation.scopeRule) ? loc.disambiguation.scopeRule : null;
  const collectExpr = locatorCaptureSource + "\n(function(){ return JSON.stringify(__bfCollectCandidates(" + JSON.stringify(scopeRule) + ")); })()";
  const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: collectExpr, returnByValue: true }, sid));
  const candidates = parseCandidatePayload(r && r.result ? r.result.value : null);
  if (candidates.length === 0) throw new Error("resolveLocator: no candidates on page");

  const providerContext = /** @type {any} */ (step).providerContext;
  const surfaceContext = /** @type {any} */ (step).surfaceContext;
  const providerControlGroup = providerSurfaceControlGroup(providerContext);
  const surfaceControlGroup = surfaceContext?.kind === "weather-map" ? surfaceContext.controlGroup : "";
  const targetControlGroup = providerControlGroup || surfaceControlGroup;
  const narrowedCandidates = targetControlGroup
    ? candidates.filter((candidate) => classifyWeatherMapControlGroup(/** @type {Record<string, any>} */ (candidate.signals)) === targetControlGroup)
    : candidates;
  const groupedCandidates = narrowedCandidates.length > 0 ? narrowedCandidates : candidates;
  const effectiveCandidates = preferActionableCandidatesWithFallback(
    groupedCandidates,
    candidates,
    /** @type {any} */ (step),
    "provider-context"
  );
  if (targetControlGroup && effectiveCandidates.length === 1) {
    const backendNodeId = await reResolveCandidateBackendNodeId(session, sid, effectiveCandidates[0].i, "weather-map");
    return { backendNodeId, layerUsed: providerControlGroup ? "provider-context" : "surface-context", confidence: "high" };
  }

  const identityNarrowing = narrowCandidatesByReplayIdentity(effectiveCandidates, loc, /** @type {any} */ (step));
  const identityCandidates = preferActionableCandidates(identityNarrowing.candidates, /** @type {any} */ (step), "replay-identity");
  if (identityCandidates.length === 0) {
    throw new Error("ambiguous locator: replay identity produced no candidates");
  }
  if (identityNarrowing.carrierProjectionDrift && identityCandidates.length > 1) {
    throw new Error("ambiguous locator: carrier projection drift matched multiple candidates");
  }
  if (identityNarrowing.matchedIdentityShape && identityCandidates.length === 1) {
    const backendNodeId = await reResolveCandidateBackendNodeId(session, sid, identityCandidates[0].i, "identity-shape");
    return { backendNodeId, layerUsed: "identity-shape", confidence: "high" };
  }
  const scoredCandidates = identityCandidates;

  const locAny = /** @type {any} */ (loc);
  const slotProbe = deriveSemanticSlotForSignals({
    pageKey: typeof /** @type {any} */ (step).pageKey === "string" ? /** @type {any} */ (step).pageKey : "",
    role: loc?.role,
    name: loc?.name || /** @type {any} */ (step).text || locAny?.nameAtCapture,
    text: /** @type {any} */ (step).text,
    href: loc?.href || /** @type {any} */ (step).href || locAny?.hrefAtCapture || /** @type {any} */ (step).hrefAtCapture,
    structuralKey: loc?.structuralKey
  });
  if (slotProbe) {
    const slotCandidates = scoredCandidates.filter((candidate) => {
      const slot = deriveSemanticSlotForSignals({
        pageKey: typeof /** @type {any} */ (step).pageKey === "string" ? /** @type {any} */ (step).pageKey : "",
        role: /** @type {any} */ (candidate.signals).role,
        name: /** @type {any} */ (candidate.signals).name,
        href: /** @type {any} */ (candidate.signals).href,
        structuralKey: /** @type {any} */ (candidate.signals).structuralKey
      });
      return slot?.slotKey === slotProbe.slotKey;
    });
    if (slotCandidates.length === 1) {
      const backendNodeId = await reResolveCandidateBackendNodeId(session, sid, slotCandidates[0].i, "semantic-slot");
      return { backendNodeId, layerUsed: "semantic-slot", confidence: "high" };
    }
  }

  // method B (morphing/anonymous element). The element's OWN role/tag-structure
  // is volatile across the morph (empty p[role=presentation] ↔ filled
  // div[role=textbox]), so identity must rest on the boundary/context
  // (neighbor anchors + position), not on role/structuralKey. Down-weight those
  // two to ~0; the confidence gate (decideConfidence) still applies → fail-safe.
  const methodB = !!(loc.disambiguation && loc.disambiguation.resolutionMethod === "B");
  const baseWeights = methodB
    ? { ...DEFAULT_WEIGHTS, role: 0, structuralKey: 0.25 }
    : DEFAULT_WEIGHTS;
  // Score + decide. Merge weightOverrides defensively from loc.disambiguation.
  const weights = (loc.disambiguation && loc.disambiguation.weightOverrides)
    ? { ...baseWeights, ...loc.disambiguation.weightOverrides }
    : baseWeights;
  const vp = loc.viewport ? { w: loc.viewport.w, h: loc.viewport.h } : undefined;
  const scored = scoreCandidates(
    /** @type {Record<string, unknown>} */ (loc),
    scoredCandidates.map((c) => c.signals),
    weights,
    vp
  );
  const d = decideConfidence(scored, { weights });
  let pickIdx = d.pick;
  let layerUsed = methodB ? "score-B" : "score";
  if (pickIdx < 0) {
    // method-B ordinal tie-break. Only when the failure is
    // purely a margin tie (winner cleared the absolute + mass gates) and an
    // ordinalHint was recorded — pick the targeted one among N identical
    // candidates by DOM order. Otherwise stay drift-held (fail-safe).
    const ordinalHint = methodB && loc.disambiguation ? loc.disambiguation.ordinalHint : undefined;
    const marginTie = d.winner >= 0.6 && d.highWeightMass >= 0.55 && d.margin < 0.12;
    if (methodB && typeof ordinalHint === "number" && marginTie) {
        const op = pickByOrdinal(scored, scoredCandidates, loc.structuralKey, ordinalHint);
      if (op >= 0) {
        pickIdx = op;
        layerUsed = "score-B-ordinal";
      }
    }
  }
  if (pickIdx < 0) {
    throw new Error("ambiguous locator: low-confidence resolution (" + d.reason + ")");
  }
  const winnerDomIndex = scoredCandidates[pickIdx].i; // index into querySelectorAll(CANDIDATE_SELECTOR)

  // Re-resolve the winning element to a backendNodeId.
  const reExpr = "document.querySelectorAll(" + JSON.stringify(CANDIDATE_SELECTOR) + ")[" + winnerDomIndex + "]";
  const rr = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: reExpr, returnByValue: false }, sid));
  if (!rr || !rr.result || !rr.result.objectId) throw new Error("resolveLocator: winner re-resolve failed");
  const d2 = /** @type {any} */ (await session.client.send("DOM.describeNode", { objectId: rr.result.objectId }, sid));
  const backendNodeId = d2 && d2.node ? /** @type {number} */ (d2.node.backendNodeId) : undefined;
  if (!backendNodeId) throw new Error("resolveLocator: no backendNodeId for winner");
  return { backendNodeId, layerUsed, confidence: "high" };
}

/**
 * @param {Array<{i: number, signals: Record<string, unknown>}>} candidates
 * @param {LocatorStep & Record<string, any>} step
 * @param {string} stage
 * @returns {Array<{i: number, signals: Record<string, unknown>}>}
 */
function preferActionableCandidates(candidates, step, stage) {
  if (!isPhysicalClickResolution(step)) return candidates;
  const actionable = candidates.filter((candidate) => candidateIsActionableForClick(candidate.signals));
  if (actionable.length > 0) return actionable;
  if (candidates.length > 0) {
    throw new Error(`ambiguous locator: ${stage} candidates are not actionable for click`);
  }
  return candidates;
}

/**
 * @param {Array<{i: number, signals: Record<string, unknown>}>} candidates
 * @param {Array<{i: number, signals: Record<string, unknown>}>} fallbackCandidates
 * @param {LocatorStep & Record<string, any>} step
 * @param {string} stage
 * @returns {Array<{i: number, signals: Record<string, unknown>}>}
 */
function preferActionableCandidatesWithFallback(candidates, fallbackCandidates, step, stage) {
  if (!isPhysicalClickResolution(step)) return candidates;
  const actionable = candidates.filter((candidate) => candidateIsActionableForClick(candidate.signals));
  if (actionable.length > 0) return actionable;
  if (fallbackCandidates !== candidates) {
    return preferActionableCandidates(fallbackCandidates, step, `${stage}-fallback`);
  }
  return preferActionableCandidates(candidates, step, stage);
}

/**
 * @param {LocatorStep & Record<string, any>} step
 */
function isPhysicalClickResolution(step) {
  return !step || !step.action || step.action === "click";
}

/**
 * @param {Record<string, unknown>} signals
 */
function candidateIsActionableForClick(signals) {
  if (!signals || typeof signals !== "object") return false;
  if (signals.actionable === true) return true;
  if (signals.actionable === false) return false;
  const box = signals.box && typeof signals.box === "object" ? /** @type {{w?: unknown, h?: unknown}} */ (signals.box) : null;
  const width = Number(box?.w ?? 0);
  const height = Number(box?.h ?? 0);
  if (!(width > 0 && height > 0)) return false;
  if (signals.disabled === true) return false;
  if (signals.ariaDisabled === true || String(signals.ariaDisabled || "").toLowerCase() === "true") return false;
  if (signals.inert === true) return false;
  if (String(signals.pointerEvents || "").toLowerCase() === "none") return false;
  if (String(signals.display || "").toLowerCase() === "none") return false;
  if (String(signals.visibility || "").toLowerCase() === "hidden") return false;
  if (Number(signals.opacity ?? 1) === 0) return false;
  return true;
}

/**
 * @param {Array<{i: number, signals: Record<string, unknown>}>} candidates
 * @param {LocatorFingerprint | undefined} loc
 * @param {LocatorStep & Record<string, any>} [step]
 */
function narrowCandidatesByReplayIdentity(candidates, loc, step) {
  if (!loc || !Array.isArray(candidates) || candidates.length === 0) {
    return { candidates, matchedIdentityShape: false, carrierProjectionDrift: false };
  }
  let narrowed = candidates;
  let matchedIdentityShape = false;
  let carrierProjectionDrift = false;
  const controlKind = typeof /** @type {any} */ (loc).controlKind === "string" ? /** @type {any} */ (loc).controlKind : "";
  const identityShape = typeof /** @type {any} */ (loc).identityShape === "string" && /** @type {any} */ (loc).identityShape
    ? /** @type {any} */ (loc).identityShape
    : identityShapeFromStructuralKey(loc.structuralKey);

  if (controlKind === "option") {
    narrowed = narrowed.filter((candidate) => String(candidate.signals.controlKind || "") === controlKind);
  }

  if (identityShape && canTolerateCarrierProjectionDrift(loc, step, identityShape)) {
    const shapeMatches = narrowed.filter((candidate) => String(candidate.signals.identityShape || "") === identityShape);
    if (shapeMatches.length > 0) {
      narrowed = shapeMatches;
      matchedIdentityShape = true;
      carrierProjectionDrift = true;
      return { candidates: narrowed, matchedIdentityShape, carrierProjectionDrift };
    }
  }

  if (controlKind && controlKind !== "option") {
    narrowed = candidates.filter((candidate) => String(candidate.signals.controlKind || "") === controlKind);
  }

  if (identityShape) {
    const shapeMatches = narrowed.filter((candidate) => String(candidate.signals.identityShape || "") === identityShape);
    if (shapeMatches.length > 0) {
      narrowed = shapeMatches;
      matchedIdentityShape = true;
    }
  }
  return { candidates: narrowed, matchedIdentityShape, carrierProjectionDrift };
}

/**
 * Capture can classify a stateful visual carrier by its selected child label
 * segments, while replay candidates may expose the same stable button shape as
 * an option when those segments collapse. This one-way tolerance is allowed
 * only for state-proof controls; child options stay fail-closed.
 *
 * @param {LocatorFingerprint} loc
 * @param {(LocatorStep & Record<string, any>) | undefined} step
 * @param {string} identityShape
 */
function canTolerateCarrierProjectionDrift(loc, step, identityShape) {
  if (!identityShape) return false;
  if (!isPhysicalClickResolution(/** @type {LocatorStep & Record<string, any>} */ (step))) return false;
  const locAny = /** @type {any} */ (loc);
  if (locAny.controlKind !== "carrier") return false;
  if (!Array.isArray(locAny.textParts) || locAny.textParts.length < 2) return false;
  if (!/\|(button|a)\|/.test(identityShape) && !/\|role=(button|tab|switch)/.test(identityShape)) return false;

  const providerContext = step && typeof step.providerContext === "object" ? step.providerContext : null;
  const pattern = providerContext ? String(providerContext.pattern || "") : "";
  const strategy = providerContext ? String(providerContext.replayStrategy || "") : "";
  const confidence = providerContext ? String(providerContext.confidence || "") : "";
  return pattern === "layered-control-surface" &&
    strategy === "state-proof-click" &&
    confidence === "high";
}

/**
 * Derive the additive replay identity shape for pre-identity artifacts. This
 * mirrors the in-page identity projection: remove state/value classes and the
 * terminal display-name segment from the structural key.
 *
 * @param {unknown} value
 */
function identityShapeFromStructuralKey(value) {
  const key = typeof value === "string" ? value : "";
  if (!key) return "";
  const parts = key.split("|");
  if (parts.length < 5) return "";
  const classPart = parts[3] || "";
  const stableClasses = classPart
    .split(".")
    .filter(Boolean)
    .filter((entry) => !/^(is|has|selected|active|checked|current|on|type)[_-]/i.test(entry))
    .filter((entry) => !/^(selected|active|checked|current|on)$/i.test(entry))
    .sort()
    .join(".");
  return `${parts[0] || ""}|${parts[1] || ""}|${parts[2] || ""}|${stableClasses}|`;
}

/**
 * @param {import("./browser-session.mjs").CdpSession} session
 * @param {string} sid
 * @param {number} domIndex
 * @param {string} label
 */
async function reResolveCandidateBackendNodeId(session, sid, domIndex, label) {
  const reExpr = "document.querySelectorAll(" + JSON.stringify(CANDIDATE_SELECTOR) + ")[" + domIndex + "]";
  const rr = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: reExpr, returnByValue: false }, sid));
  if (!rr || !rr.result || !rr.result.objectId) throw new Error(`resolveLocator: ${label} re-resolve failed`);
  const d2 = /** @type {any} */ (await session.client.send("DOM.describeNode", { objectId: rr.result.objectId }, sid));
  const backendNodeId = d2 && d2.node ? /** @type {number} */ (d2.node.backendNodeId) : undefined;
  if (!backendNodeId) throw new Error(`resolveLocator: no backendNodeId for ${label} winner`);
  return backendNodeId;
}

/**
 * CDP by-value transport can truncate large arrays. The resolver now asks the
 * page to return a JSON string, but accepts legacy array values in tests and
 * older assembled runtimes.
 *
 * @param {unknown} value
 * @returns {Array<{i: number, signals: Record<string, unknown>}>}
 */
function parseCandidatePayload(value) {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > 25_000_000) return [];
    try {
      parsed = JSON.parse(value);
    } catch (_e) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) =>
    entry &&
    typeof entry === "object" &&
    Number.isFinite(Number(/** @type {any} */ (entry).i)) &&
    /** @type {any} */ (entry).signals &&
    typeof /** @type {any} */ (entry).signals === "object"
  );
}
