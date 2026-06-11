import { sanitizeEvidenceText, sanitizeHeaders, sanitizeText, sanitizeUrl } from "../security/redact.mjs";
import { fieldNameIsForbidden } from "../security/scan-artifacts.mjs";

/**
 * @typedef {{ tag: string, id: string, role: string, ariaLabel: string, dataBf: string, dataTestid: string }} AncestorEntry
 *
 * @typedef {{ totalMatchingSelector: number, totalMatchingRole: number }} SiblingFingerprint
 *
 * @typedef {{
 *   type: string,
 *   timestamp?: number,
 *   url?: string,
 *   selector?: string,
 *   text?: string,
 *   href?: string,
 *   actionKind?: string,
 *   observedTextSummary?: string,
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
 *   role?: string,
 *   actionId?: string,
 *   actionSeq?: number,
 *   captureWindowId?: string,
 *   documentId?: string,
 *   frameId?: string,
 *   backendNodeId?: number,
 *   timestampMonotonic?: number,
 *   gestureId?: string,
 *   pointerId?: number,
 *   isTrusted?: boolean,
 *   clickX?: number,
 *   clickY?: number,
 *   pointer?: { x?: number, y?: number },
 *   targetSelector?: string,
 *   actionableSelector?: string,
 *   rawTarget?: Record<string, unknown>,
 *   actionableTarget?: Record<string, unknown>,
 *   visibleHitTarget?: Record<string, unknown>,
 *   visibleActionableAncestor?: Record<string, unknown>,
 *   targetVisibility?: Record<string, unknown>,
 *   eventPath?: Array<{ tag?: string, selector?: string, role?: string }>,
 *   coords?: { x?: number, y?: number },
 *   pageSkeleton?: Array<{ role?: string, name?: string, structuralKey?: string }>,
 *   contentEditable?: boolean,
 *   method?: string,
 *   status?: number,
 *   headers?: Record<string, string>,
 *   ancestors?: AncestorEntry[],
 *   siblings?: SiblingFingerprint,
 *   locator?: Record<string, unknown>,
 *   preTypingLocator?: Record<string, unknown>,
 *   tabOrdinal?: number
 *   settleStatus?: string,
 * }} RawEvent
 */

/**
 * `options.unmasked` propagates to `sanitizeUrl` so external
 * URLs are preserved in real-site (`--unmasked`) captures.
 *
 * @param {RawEvent} event
 * @param {{ unmasked?: boolean }} [options]
 */
export function sanitizeEvent(event, options = {}) {
  const sanitizeOpts = { unmasked: options.unmasked === true };
  const base = {
    type: event.type,
    timestamp: event.timestamp ?? Date.now(),
    url: event.url ? sanitizeUrl(event.url, sanitizeOpts) : undefined,
    tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : undefined,
    actionSeq: typeof event.actionSeq === "number" ? event.actionSeq : undefined,
    captureWindowId: typeof event.captureWindowId === "string" && event.captureWindowId ? event.captureWindowId : undefined,
    documentId: typeof event.documentId === "string" && event.documentId ? event.documentId : undefined,
    frameId: typeof event.frameId === "string" && event.frameId ? event.frameId : undefined,
    backendNodeId: typeof event.backendNodeId === "number" ? event.backendNodeId : undefined,
    timestampMonotonic: typeof event.timestampMonotonic === "number" ? event.timestampMonotonic : undefined
  };

  if (event.type === "navigate") {
    return {
      ...base,
      title: sanitizeText(event.text)
    };
  }

  if (event.type === "click" || event.type === "submit") {
    return {
      ...base,
      selector: event.selector ?? "",
      text: sanitizeText(event.text),
      href: event.href ? sanitizeUrl(event.href, sanitizeOpts) : undefined,
      submitterSelector: event.submitterSelector ?? undefined,
      submitterText: event.submitterText ? sanitizeText(event.submitterText) : undefined,
      submitterHref: event.submitterHref ? sanitizeUrl(event.submitterHref, sanitizeOpts) : undefined,
      formIdentitySelector: sanitizeFieldLike(event.formIdentitySelector, "<redacted-form-selector>"),
      formId: sanitizeFieldLike(event.formId, "<redacted-form-id>"),
      formName: sanitizeFieldLike(event.formName, "<redacted-form-name>"),
      formAction: event.formAction ? sanitizeUrl(event.formAction, sanitizeOpts) : undefined,
      formMethod: event.formMethod ?? undefined,
      // preserve the element's ARIA role (structural, not PII) so
      // atomic-fp can build role+name locators for role-less SPA elements.
      role: typeof event.role === "string" && event.role ? event.role : undefined,
      actionKind: sanitizeActionKind(event.actionKind),
      observedTextSummary: typeof event.observedTextSummary === "string" && event.observedTextSummary
        ? sanitizeText(event.observedTextSummary)
        : undefined,
      actionId: typeof event.actionId === "string" && event.actionId ? event.actionId : undefined,
      gestureId: typeof event.gestureId === "string" && event.gestureId ? event.gestureId : undefined,
      pointerId: typeof event.pointerId === "number" ? event.pointerId : undefined,
      isTrusted: typeof event.isTrusted === "boolean" ? event.isTrusted : undefined,
      clickX: typeof event.clickX === "number" ? event.clickX : undefined,
      clickY: typeof event.clickY === "number" ? event.clickY : undefined,
      pointer: sanitizePoint(event.pointer),
      targetSelector: sanitizeSelectorLike(event.targetSelector, "<redacted-target-selector>"),
      actionableSelector: sanitizeSelectorLike(event.actionableSelector, "<redacted-actionable-selector>"),
      rawTarget: sanitizeVisibleTarget(event.rawTarget, sanitizeOpts),
      actionableTarget: sanitizeVisibleTarget(event.actionableTarget, sanitizeOpts),
      visibleHitTarget: sanitizeVisibleTarget(event.visibleHitTarget, sanitizeOpts),
      visibleActionableAncestor: sanitizeVisibleTarget(event.visibleActionableAncestor, sanitizeOpts),
      targetVisibility: sanitizeTargetVisibility(event.targetVisibility),
      eventPath: sanitizeEventPath(event.eventPath),
      coords: sanitizePoint(event.coords),
      ancestors: sanitizeAncestors(event.ancestors),
      siblings: event.siblings ?? undefined,
      pageSkeleton: sanitizeOptionalSkeleton(event.pageSkeleton),
      // preserve locator fingerprint (structural metadata).
      locator: sanitizeLocator(event.locator, sanitizeOpts)
    };
  }

  if (event.type === "input") {
    const secret = event.secret || (event.fieldName ? fieldNameIsForbidden(event.fieldName) : false);
    return {
      ...base,
      selector: event.selector ?? "",
      fieldName: secret ? "<redacted-field>" : event.fieldName ?? "",
      secret,
      value: secret ? "<redacted-secret>" : sanitizeText(event.value),
      // preserve role + contentEditable so the runner replays
      // contenteditable fills via atomic-fp + Input.insertText (not selector+.value).
      role: typeof event.role === "string" && event.role ? event.role : undefined,
      actionId: typeof event.actionId === "string" && event.actionId ? event.actionId : undefined,
      contentEditable: event.contentEditable === true ? true : undefined,
      ancestors: sanitizeAncestors(event.ancestors),
      siblings: event.siblings ?? undefined,
      pageSkeleton: sanitizeOptionalSkeleton(event.pageSkeleton),
      // preserve locator fingerprint (structural metadata).
      locator: sanitizeLocator(event.locator, sanitizeOpts),
      // pre-typing host identity for morphing fill targets —
      // sanitized like any locator (agent-blind). Undefined when not captured.
      preTypingLocator: event.preTypingLocator ? sanitizeLocator(event.preTypingLocator, sanitizeOpts) : undefined
    };
  }

  if (event.type === "network.request" || event.type === "network.response" || event.type === "network.loadingFinished") {
    return {
      ...base,
      // Session attribution for multi-tab runs — CDP requestIds are only
      // unique per session, so consumers need this to join events safely.
      // Opaque runtime id, same disclosure class as frameId in `base`.
      sessionId: typeof event.sessionId === "string" && event.sessionId ? event.sessionId : undefined,
      method: event.method ?? "GET",
      status: event.status ?? 0,
      headers: sanitizeHeaders(event.headers ?? {})
    };
  }

  if (event.type === "page-evidence") {
    return {
      ...base,
      selector: event.selector ?? "",
      text: sanitizeEvidenceText(event.text)
    };
  }

  // action-diff (method-B answer key). before/after affordance
  // skeletons carry accessible `name` text → redact each entry's name like a
  // locator name (agent-blind); role/structuralKey are structural, pass through.
  if (event.type === "action-diff") {
    const ad = /** @type {any} */ (event);
    return {
      ...base,
      refType: ad.refType ?? "",
      actionId: typeof ad.actionId === "string" && ad.actionId ? ad.actionId : undefined,
      settleStatus: typeof ad.settleStatus === "string" && ad.settleStatus ? ad.settleStatus : undefined,
      beforeSkeleton: sanitizeSkeleton(ad.beforeSkeleton),
      afterSkeleton: sanitizeSkeleton(ad.afterSkeleton)
    };
  }

  if (event.type === "action-window") {
    const aw = /** @type {any} */ (event);
    return {
      ...base,
      lane: aw.lane === "hot-journal" ? "hot-journal" : undefined,
      actionId: typeof aw.actionId === "string" && aw.actionId ? aw.actionId : undefined,
      gestureId: typeof aw.gestureId === "string" && aw.gestureId ? aw.gestureId : undefined,
      pointerId: typeof aw.pointerId === "number" ? aw.pointerId : undefined,
      pointer: sanitizePoint(aw.pointer),
      targetSelector: sanitizeSelectorLike(aw.targetSelector, "<redacted-target-selector>"),
      actionableSelector: sanitizeSelectorLike(aw.actionableSelector, "<redacted-actionable-selector>"),
      hitTarget: sanitizeVisibleTarget(aw.hitTarget, sanitizeOpts),
      locator: sanitizeLocator(aw.locator, sanitizeOpts)
    };
  }

  if (event.type === "action-enrichment") {
    const ae = /** @type {any} */ (event);
    return {
      ...base,
      lane: ae.lane === "snapshot-enrichment" ? "snapshot-enrichment" : undefined,
      stage: ae.stage === "before" || ae.stage === "after" ? ae.stage : undefined,
      budgetMs: typeof ae.budgetMs === "number" ? ae.budgetMs : undefined,
      affordances: sanitizeOptionalSkeleton(ae.affordances),
      before: sanitizeEnrichmentSnapshot(ae.before, sanitizeOpts),
      after: sanitizeEnrichmentSnapshot(ae.after, sanitizeOpts),
      axSubtree: sanitizeOptionalSkeleton(ae.axSubtree),
      domSlice: sanitizeDomSlice(ae.domSlice),
      screenshotCrop: sanitizeScreenshotCrop(ae.screenshotCrop),
      providerHints: sanitizeProviderHints(ae.providerHints),
      canvasTileHints: sanitizeCanvasTileHints(ae.canvasTileHints),
      mutationBatch: sanitizeMutationBatch(ae.mutationBatch)
    };
  }

  return base;
}

/**
 * Redact accessible-name text in an affordance skeleton (array of
 * { role, name, structuralKey }) the same way locator names are redacted.
 * structuralKey embeds the name segment too, so re-redact it conservatively.
 * @param {unknown} skeleton
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeSkeleton(skeleton) {
  if (!Array.isArray(skeleton)) return [];
  return skeleton.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const e = /** @type {Record<string, unknown>} */ ({ ...entry });
    if (typeof e.name === "string" && e.name) {
      e.name = fieldNameIsForbidden(e.name) ? "<redacted-field>" : sanitizeText(e.name);
    }
    return e;
  });
}

/**
 * @param {unknown} skeleton
 * @returns {Array<Record<string, unknown>> | undefined}
 */
function sanitizeOptionalSkeleton(skeleton) {
  if (!Array.isArray(skeleton)) return undefined;
  return sanitizeSkeleton(skeleton);
}

/**
 * @param {unknown} value
 * @param {{ unmasked?: boolean }} opts
 */
function sanitizeEnrichmentSnapshot(value, opts) {
  if (!value || typeof value !== "object") return undefined;
  const source = /** @type {Record<string, unknown>} */ (value);
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof source.url === "string") out.url = sanitizeUrl(source.url, opts);
  if (Array.isArray(source.affordances)) out.affordances = sanitizeSkeleton(source.affordances);
  if (source.screenshotCrop && typeof source.screenshotCrop === "object") {
    out.screenshotCrop = sanitizeScreenshotCrop(source.screenshotCrop);
  }
  if (Array.isArray(source.providerHints)) out.providerHints = sanitizeProviderHints(source.providerHints);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {unknown} value
 */
function sanitizeDomSlice(value) {
  if (!value || typeof value !== "object") return undefined;
  const source = /** @type {Record<string, unknown>} */ (value);
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof source.selector === "string") out.selector = sanitizeSelectorLike(source.selector, "<redacted-dom-slice-selector>");
  if (typeof source.text === "string") out.text = sanitizeEvidenceText(source.text);
  if (typeof source.hash === "string") out.hash = sanitizeText(source.hash);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {unknown} value
 */
function sanitizeScreenshotCrop(value) {
  if (!value || typeof value !== "object") return undefined;
  const source = /** @type {Record<string, unknown>} */ (value);
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof source.source === "string") out.source = sanitizeText(source.source);
  if (source.box && typeof source.box === "object") out.box = sanitizeBox(source.box);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {unknown} hints
 */
function sanitizeProviderHints(hints) {
  if (!Array.isArray(hints)) return undefined;
  return hints
    .filter((hint) => hint && typeof hint === "object")
    .map((hint) => {
      const source = /** @type {Record<string, unknown>} */ (hint);
      const out = /** @type {Record<string, unknown>} */ ({});
      for (const key of ["pattern", "stateCarrier", "replayStrategy", "surfaceKey", "controlGroup", "confidence"]) {
        if (typeof source[key] === "string") out[key] = sanitizeText(/** @type {string} */ (source[key]));
      }
      return out;
    })
    .filter((hint) => Object.keys(hint).length > 0);
}

/**
 * @param {unknown} hints
 */
function sanitizeCanvasTileHints(hints) {
  if (!Array.isArray(hints)) return undefined;
  return hints
    .filter((hint) => hint && typeof hint === "object")
    .map((hint) => {
      const source = /** @type {Record<string, unknown>} */ (hint);
      const out = /** @type {Record<string, unknown>} */ ({});
      for (const key of ["kind", "url", "tileKey", "state"]) {
        if (typeof source[key] === "string") out[key] = sanitizeText(/** @type {string} */ (source[key]));
      }
      return out;
    })
    .filter((hint) => Object.keys(hint).length > 0);
}

/**
 * @param {unknown} mutations
 */
function sanitizeMutationBatch(mutations) {
  if (!Array.isArray(mutations)) return undefined;
  return mutations
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const source = /** @type {Record<string, unknown>} */ (entry);
      const out = /** @type {Record<string, unknown>} */ ({});
      if (typeof source.kind === "string") out.kind = sanitizeText(source.kind);
      if (typeof source.target === "string") out.target = sanitizeSelectorLike(source.target, "<redacted-mutation-target>");
      if (typeof source.added === "number") out.added = source.added;
      if (typeof source.removed === "number") out.removed = source.removed;
      return out;
    })
    .filter((entry) => Object.keys(entry).length > 0);
}

/**
 * @param {{ selector?: string }[]} items
 */
export function buildSelectorInventory(items) {
  return [...new Set(items.map((item) => item.selector).filter(Boolean))];
}

/**
 * Pass through locator structural metadata, redacting only the
 * `name` field (accessible name — may contain user text).
 * `neighborTexts` and `alt` are redacted like `name` (fieldNameIsForbidden
 * check + sanitizeText); `href` is sanitized via sanitizeUrl (same unmasked
 * flag the outer sanitizeEvent call threads); `cleanId` and `type` are
 * structural/enum-ish and passed through unchanged.
 *
 * @param {Record<string, unknown> | undefined} locator
 * @param {{ unmasked?: boolean }} [opts]
 * @returns {Record<string, unknown> | undefined}
 */
function sanitizeLocator(locator, opts = {}) {
  if (!locator || typeof locator !== "object") return undefined;
  const out = { ...locator };
  if (typeof out.name === "string") {
    out.name = fieldNameIsForbidden(out.name) ? "<redacted-field>" : sanitizeText(out.name);
  }
  // neighborTexts — redact each element the same way name is redacted.
  if (Array.isArray(out.neighborTexts)) {
    out.neighborTexts = out.neighborTexts.map((t) =>
      typeof t === "string"
        ? fieldNameIsForbidden(t)
          ? "<redacted-field>"
          : sanitizeText(t)
        : t
    );
  }
  if (Array.isArray(out.textParts)) {
    out.textParts = out.textParts.map((t) =>
      typeof t === "string"
        ? fieldNameIsForbidden(t)
          ? "<redacted-field>"
          : sanitizeText(t)
        : t
    );
  }
  if (out.semanticRegion && typeof out.semanticRegion === "object") {
    out.semanticRegion = sanitizeSemanticRegion(
      /** @type {Record<string, unknown>} */ (out.semanticRegion)
    );
  }
  // alt — redact like name.
  if (typeof out.alt === "string") {
    out.alt = fieldNameIsForbidden(out.alt) ? "<redacted-field>" : sanitizeText(out.alt);
  }
  // href — sanitize via sanitizeUrl (strips credentials + secret query params).
  if (typeof out.href === "string") {
    out.href = sanitizeUrl(out.href, opts);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} region
 */
function sanitizeSemanticRegion(region) {
  const out = { ...region };
  for (const key of ["label", "headingText", "regionText"]) {
    if (typeof out[key] === "string") {
      out[key] = fieldNameIsForbidden(/** @type {string} */ (out[key]))
        ? "<redacted-field>"
        : sanitizeText(/** @type {string} */ (out[key]));
    }
  }
  if (typeof out.selector === "string") {
    out.selector = sanitizeSelectorLike(out.selector, "<redacted-region-selector>");
  }
  return out;
}

/**
 * @param {string | undefined} value
 * @param {string} replacement
 */
function sanitizeFieldLike(value, replacement) {
  if (!value) {
    return undefined;
  }
  if (fieldNameIsForbidden(value)) {
    return replacement;
  }
  return sanitizeText(value);
}

/**
 * @param {string | undefined} value
 * @param {string} replacement
 */
function sanitizeSelectorLike(value, replacement) {
  if (!value) {
    return undefined;
  }
  if (fieldNameIsForbidden(value)) {
    return replacement;
  }
  return sanitizeText(value);
}

/**
 * @param {Array<{ tag?: string, selector?: string, role?: string }> | undefined} eventPath
 * @returns {Array<{ tag: string, selector: string, role: string }> | undefined}
 */
function sanitizeEventPath(eventPath) {
  if (!Array.isArray(eventPath) || eventPath.length === 0) {
    return undefined;
  }
  return eventPath.map((entry) => ({
    tag: typeof entry.tag === "string" ? sanitizeText(entry.tag) : "",
    selector: sanitizeSelectorLike(entry.selector, "<redacted-event-path-selector>") ?? "",
    role: typeof entry.role === "string" ? sanitizeText(entry.role) : ""
  }));
}

/**
 * @param {{ x?: number, y?: number } | undefined} point
 * @returns {{ x: number, y: number } | undefined}
 */
function sanitizePoint(point) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    return undefined;
  }
  return { x: point.x, y: point.y };
}

/**
 * @param {Record<string, unknown> | undefined} target
 * @param {{ unmasked?: boolean }} opts
 * @returns {Record<string, unknown> | undefined}
 */
function sanitizeVisibleTarget(target, opts) {
  if (!target || typeof target !== "object") {
    return undefined;
  }
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof target.tag === "string") out.tag = sanitizeText(target.tag);
  if (typeof target.selector === "string") out.selector = sanitizeSelectorLike(target.selector, "<redacted-visible-selector>") ?? "";
  if (typeof target.role === "string") out.role = sanitizeText(target.role);
  if (typeof target.name === "string") out.name = fieldNameIsForbidden(target.name) ? "<redacted-field>" : sanitizeText(target.name);
  if (typeof target.href === "string") out.href = sanitizeUrl(target.href, opts);
  if (target.box && typeof target.box === "object") out.box = sanitizeBox(target.box);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {Record<string, unknown> | undefined} visibility
 * @returns {Record<string, unknown> | undefined}
 */
function sanitizeTargetVisibility(visibility) {
  if (!visibility || typeof visibility !== "object") {
    return undefined;
  }
  const out = /** @type {Record<string, unknown>} */ ({});
  if (typeof visibility.hasVisibleBox === "boolean") out.hasVisibleBox = visibility.hasVisibleBox;
  if (visibility.rawBox && typeof visibility.rawBox === "object") out.rawBox = sanitizeBox(visibility.rawBox);
  if (visibility.visibleBox && typeof visibility.visibleBox === "object") out.visibleBox = sanitizeBox(visibility.visibleBox);
  if (typeof visibility.viewportIntersectionRatio === "number") out.viewportIntersectionRatio = visibility.viewportIntersectionRatio;
  if (visibility.computed && typeof visibility.computed === "object") {
    const computed = /** @type {Record<string, unknown>} */ (visibility.computed);
    out.computed = {
      display: typeof computed.display === "string" ? sanitizeText(computed.display) : "",
      visibility: typeof computed.visibility === "string" ? sanitizeText(computed.visibility) : "",
      opacity: typeof computed.opacity === "number" ? computed.opacity : Number(computed.opacity ?? 0),
      pointerEvents: typeof computed.pointerEvents === "string" ? sanitizeText(computed.pointerEvents) : ""
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {unknown} value
 * @returns {"interactive" | "observation" | "implementation-layer" | undefined}
 */
function sanitizeActionKind(value) {
  return value === "interactive" || value === "observation" || value === "implementation-layer"
    ? value
    : undefined;
}

/**
 * @param {unknown} box
 * @returns {{ cx?: number, cy?: number, w?: number, h?: number }}
 */
function sanitizeBox(box) {
  const source = /** @type {Record<string, unknown>} */ (box && typeof box === "object" ? box : {});
  const out = /** @type {{ cx?: number, cy?: number, w?: number, h?: number }} */ ({});
  for (const key of ["cx", "cy", "w", "h"]) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[/** @type {"cx"|"cy"|"w"|"h"} */ (key)] = value;
    }
  }
  return out;
}

/**
 * Ancestor chain passthrough. Each entry is structural metadata
 * (tag/id/role/ariaLabel/dataBf/dataTestid) with no PII surface — class is
 * deliberately excluded recorder-side. Passthrough preserves shape; any
 * fieldName-forbidden id strings are redacted to keep the secret-name rule
 * uniform with sanitizeFieldLike above.
 *
 * @param {AncestorEntry[] | undefined} ancestors
 * @returns {AncestorEntry[] | undefined}
 */
function sanitizeAncestors(ancestors) {
  if (!Array.isArray(ancestors) || ancestors.length === 0) {
    return undefined;
  }
  return ancestors.map((entry) => ({
    tag: typeof entry.tag === "string" ? entry.tag : "",
    id: entry.id && fieldNameIsForbidden(entry.id) ? "<redacted-id>" : entry.id ?? "",
    role: typeof entry.role === "string" ? entry.role : "",
    ariaLabel: typeof entry.ariaLabel === "string" ? sanitizeText(entry.ariaLabel) : "",
    dataBf: typeof entry.dataBf === "string" ? entry.dataBf : "",
    dataTestid: typeof entry.dataTestid === "string" ? entry.dataTestid : ""
  }));
}
