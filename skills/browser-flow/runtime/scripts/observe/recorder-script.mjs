import { SECRET_FIELD_PATTERN } from "../security/patterns.mjs";

import { locatorCaptureSource } from "./locator-capture.mjs";

export const recorderInitScript =
  "(() => {\n" +
  "  if (window.__browserFlowRecorderInstalled) { return; }\n" +
  "  window.__browserFlowRecorderInstalled = true;\n" +
  locatorCaptureSource + "\n" +
  // Inject the shared pattern so the page-context copy can never drift
  // from security/patterns.mjs.
  "  const SECRET_FIELD_PATTERN = " + SECRET_FIELD_PATTERN.toString() + ";\n" +
  String.raw`

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function selectorFor(element) {
    if (!element || !(element instanceof Element)) {
      return "";
    }
    if (element.dataset && element.dataset.bf) {
      return '[data-bf="' + element.dataset.bf + '"]';
    }
    if (element.dataset && element.dataset.testid) {
      return '[data-testid="' + element.dataset.testid + '"]';
    }
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }
    const name = element.getAttribute("name");
    if (name) {
      return element.tagName.toLowerCase() + '[name="' + name + '"]';
    }
    const aria = element.getAttribute("aria-label");
    if (aria) {
      return element.tagName.toLowerCase() + '[aria-label="' + aria + '"]';
    }
    return element.tagName.toLowerCase();
  }

  function summarizeEventPath(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path
      .filter((entry) => entry instanceof Element)
      .slice(0, 8)
      .map((entry) => ({
        tag: entry.tagName.toLowerCase(),
        selector: selectorFor(entry),
        role: entry.getAttribute("role") || implicitRoleOf(entry)
      }));
  }

  function formSignatureFor(form) {
    return {
      formIdentitySelector: selectorFor(form),
      formId: form.id || "",
      formName: form.getAttribute("name") || "",
      formAction: form.getAttribute("action") || "",
      formMethod: String(form.getAttribute("method") || form.method || "GET").toUpperCase()
    };
  }

  // ancestor chain + sibling fingerprint per click/input/submit.
  // Class deliberately excluded (classes are volatile under CSS-in-JS /
  // state-driven changes). Depth capped at 5 — typical
  // landmark → form → fieldset → label → control hierarchy. Revisit if
  // a real-site fixture exposes deeper meaningful nesting.

  function implicitRoleOf(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return element.hasAttribute("href") ? "link" : "";
    if (tag === "form") return "form";
    if (tag === "header") return "banner";
    if (tag === "main") return "main";
    if (tag === "nav") return "navigation";
    if (tag === "footer") return "contentinfo";
    if (tag === "section") return "region";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "image" || type === "reset") return "button";
      return "textbox";
    }
    return "";
  }

  function accessibleNameOf(element) {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria.replace(/\s+/g, " ").trim().slice(0, 80);
    const text = (element.innerText || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 80);
  }

  function collectAncestors(element) {
    const ancestors = [];
    let cursor = element.parentElement;
    let depth = 0;
    while (cursor && depth < 5 && cursor !== document.documentElement) {
      ancestors.unshift({
        tag: cursor.tagName.toLowerCase(),
        id: cursor.id || "",
        role: cursor.getAttribute("role") || implicitRoleOf(cursor),
        ariaLabel: cursor.getAttribute("aria-label") || "",
        dataBf: (cursor.dataset && cursor.dataset.bf) || "",
        dataTestid: (cursor.dataset && cursor.dataset.testid) || ""
      });
      cursor = cursor.parentElement;
      depth += 1;
    }
    return ancestors;
  }

  function countSiblings(element, selector) {
    let totalMatchingSelector = 0;
    if (selector) {
      try {
        totalMatchingSelector = document.querySelectorAll(selector).length;
      } catch (queryError) {
        totalMatchingSelector = 0;
      }
    }
    const role = element.getAttribute("role") || implicitRoleOf(element);
    const name = accessibleNameOf(element);
    let totalMatchingRole = 0;
    if (role && name) {
      const explicit = Array.prototype.slice.call(document.querySelectorAll('[role="' + role + '"]'));
      let implicit = [];
      if (role === "button") implicit = Array.prototype.slice.call(document.querySelectorAll("button,input[type=submit],input[type=button],input[type=reset],input[type=image]"));
      else if (role === "link") implicit = Array.prototype.slice.call(document.querySelectorAll("a[href]"));
      else if (role === "textbox") implicit = Array.prototype.slice.call(document.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=url],input[type=search],input[type=password],input[type=number],textarea'));
      const seen = new Set();
      for (const candidate of explicit.concat(implicit)) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        if (accessibleNameOf(candidate) === name) {
          totalMatchingRole += 1;
        }
      }
    }
    return { totalMatchingSelector, totalMatchingRole };
  }

  function emit(payload) {
    if (typeof window.__browserFlowRecord !== "function") {
      return;
    }
    window.__browserFlowRecord(JSON.stringify({
      ...payload,
      timestamp: Date.now(),
      timestampMonotonic: typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : undefined,
      url: location.href
    }));
  }

  // per-action before/after affordance-skeleton capture (method-B "answer key").
  // Snapshot the affordance skeleton synchronously at action time (before the
  // action's DOM effect), then poll until the skeleton settles. If another
  // interactive action starts first, mark the pending capture as interrupted
  // instead of emitting a misleading zero-diff as if it were stable truth.
  var __bfActionCounter = 0;
  var __bfCaptureWindowCounter = 0;
  var __bfDocumentId = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var __bfLatestActionOrdinal = 0;
  var __bfStrictCapture = window.__bfCaptureMode === "strict";
  var __bfActionSettlePollMs = 50;
  var __bfActionStableForMs = __bfStrictCapture ? 500 : 150;
  var __bfActionSettleTimeoutMs = __bfStrictCapture ? 5000 : 1500;
  function nextCaptureWindowId() {
    return __bfDocumentId + ":cw" + (++__bfCaptureWindowCounter);
  }
  function scheduleActionDiff(refType, captureWindowId) {
    var before;
    try { before = __bfAffordanceSkeleton(); } catch (_e) {
      return { actionId: "", actionSeq: 0, documentId: __bfDocumentId, captureWindowId: captureWindowId || nextCaptureWindowId() };
    }
    var actionId = "a" + (++__bfActionCounter);
    var actionSeq = Date.now() * 1000 + __bfActionCounter;
    var windowId = captureWindowId || nextCaptureWindowId();
    var myOrdinal = ++__bfLatestActionOrdinal;
    var lastSignature = "";
    var stableMs = 0;
    var startedAt = Date.now();
    function finish(settleStatus, afterSkeleton) {
      emit({
        type: "action-diff",
        refType: refType,
        actionId: actionId,
        actionSeq: actionSeq,
        captureWindowId: windowId,
        documentId: __bfDocumentId,
        settleStatus: settleStatus,
        beforeSkeleton: before,
        afterSkeleton: afterSkeleton
      });
    }
    function poll() {
      var after;
      try { after = __bfAffordanceSkeleton(); } catch (_e2) { return; }
      if (__bfLatestActionOrdinal !== myOrdinal) {
        finish("interrupted", after);
        return;
      }
      var signature = "";
      try { signature = JSON.stringify(after); } catch (_e3) { signature = ""; }
      if (signature === lastSignature) {
        stableMs += __bfActionSettlePollMs;
      } else {
        lastSignature = signature;
        stableMs = 0;
      }
      if (stableMs >= __bfActionStableForMs || (Date.now() - startedAt) >= __bfActionSettleTimeoutMs) {
        finish("settled", after);
        return;
      }
      setTimeout(poll, __bfActionSettlePollMs);
    }
    setTimeout(poll, __bfActionSettlePollMs);
    return { actionId: actionId, actionSeq: actionSeq, documentId: __bfDocumentId, captureWindowId: windowId };
  }

  function safePageSkeleton() {
    try { return __bfAffordanceSkeleton(); } catch (_e) { return []; }
  }

  let lastUrl = "";
  function recordNavigation(kind) {
    // main-frame only. This script is injected into every frame, so
    // cross-origin telemetry/auth iframes (e.g. Keep loads notes-pa / ogs /
    // feedback proxies) would each emit their own navigate event as noise,
    // polluting start/final URL derivation. Subframe navigations are not
    // workflow pages.
    if (window.top !== window.self) {
      return;
    }
    if (location.href === lastUrl && kind !== "load") {
      return;
    }
    lastUrl = location.href;
    emit({
      type: "navigate",
      text: document.title,
      navigationKind: kind
    });
  }

  const pushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    const result = pushState(...args);
    queueMicrotask(() => recordNavigation("pushState"));
    return result;
  };

  const replaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    const result = replaceState(...args);
    queueMicrotask(() => recordNavigation("replaceState"));
    return result;
  };

  window.addEventListener("popstate", () => recordNavigation("popstate"));
  window.addEventListener("load", () => recordNavigation("load"), { once: true });

  // index of the element among same-structuralKey candidates in
  // document order. The only stable discriminator for N identical/anonymous
  // elements (method-B ordinal tie-break uses this at replay).
  function __bfSameKeyOrdinal(el, key) {
    try {
      var all = document.querySelectorAll("a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]");
      var ord = 0;
      for (var i = 0; i < all.length; i++) {
        if (all[i] === el) return ord;
        try { if (__bfBuildStructuralKey(__bfDescriptorFromElement(all[i])) === key) ord++; } catch (_e) { /* skip */ }
      }
    } catch (_e2) { /* fall through */ }
    return 0;
  }
  function bfLocator(el) {
    var d = __bfDescriptorFromElement(el);
    var replay = __bfReplayIdentity(el);
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left:0, top:0, width:0, height:0 };
    var sk = __bfBuildStructuralKey(d);
    return {
      role: el.getAttribute("role") || implicitRoleOf(el),
      name: replay.name,
      structuralKey: sk,
      elementKey: __bfBuildElementKey(d),
      identityKey: replay.identityKey,
      identityShape: replay.identityShape,
      controlKind: replay.controlKind,
      textParts: replay.textParts,
      relXPath: __bfBuildRelXPath(__bfChainFromElement(el)),
      box: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height },
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      href: (el.getAttribute("href") || ""),
      neighborTexts: __bfNeighborTexts(el),
      cleanId: (el.id && !__bfIsDynamicId(el.id)) ? el.id : "",
      type: (el.getAttribute("type") || ""),
      alt: (el.getAttribute("alt") || ""),
      ordinal: __bfSameKeyOrdinal(el, sk)
    };
  }

  function boxForElement(el) {
    if (!el || !el.getBoundingClientRect) {
      return { cx: 0, cy: 0, w: 0, h: 0 };
    }
    var rect = el.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }

  function viewportIntersectionRatio(el) {
    if (!el || !el.getBoundingClientRect) return 0;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;
    var left = Math.max(0, rect.left);
    var top = Math.max(0, rect.top);
    var right = Math.min(window.innerWidth || 0, rect.right);
    var bottom = Math.min(window.innerHeight || 0, rect.bottom);
    var visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    return visibleArea / Math.max(1, rect.width * rect.height);
  }

  function computedVisibility(el) {
    try {
      var style = window.getComputedStyle(el);
      return {
        display: style.display || "",
        visibility: style.visibility || "",
        opacity: Number(style.opacity || 0),
        pointerEvents: style.pointerEvents || ""
      };
    } catch (_e) {
      return { display: "", visibility: "", opacity: 0, pointerEvents: "" };
    }
  }

  function targetSummary(el) {
    if (!el || !(el instanceof Element)) return undefined;
    var box = boxForElement(el);
    return {
      tag: el.tagName.toLowerCase(),
      selector: selectorFor(el),
      role: el.getAttribute("role") || implicitRoleOf(el),
      name: cleanText(__bfComputedName(el) || el.innerText || el.getAttribute("aria-label") || el.getAttribute("value")),
      href: el instanceof HTMLAnchorElement ? el.getAttribute("href") || "" : "",
      box
    };
  }

  function targetVisibilityFor(rawEl, visibleEl) {
    var rawBox = boxForElement(rawEl);
    var visibleBox = boxForElement(visibleEl || rawEl);
    var computed = rawEl ? computedVisibility(rawEl) : { display: "", visibility: "", opacity: 0, pointerEvents: "" };
    var ratio = rawEl ? viewportIntersectionRatio(rawEl) : 0;
    var hasVisibleBox = rawBox.w > 0 &&
      rawBox.h > 0 &&
      ratio > 0 &&
      computed.display !== "none" &&
      computed.visibility !== "hidden" &&
      computed.visibility !== "collapse" &&
      computed.opacity > 0;
    return {
      hasVisibleBox,
      rawBox,
      visibleBox,
      viewportIntersectionRatio: ratio,
      computed
    };
  }

  const REPLAY_INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "switch",
    "checkbox",
    "radio",
    "combobox",
    "textbox",
    "searchbox",
    "option",
    "listbox",
    "slider",
    "spinbutton"
  ]);
  const OBSERVATION_CONTEXT_SELECTOR = [
    "main",
    "article",
    "section",
    "header",
    "footer",
    "nav",
    "[role='main']",
    "[role='banner']",
    "[role='region']",
    "[role='article']",
    "[role='section']",
    "[role='contentinfo']",
    "[role='navigation']",
    "[role='complementary']",
    "[role='search']",
    "div[role]"
  ].join(",");

  function hasReplayActionableSignal(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el instanceof HTMLAnchorElement && el.hasAttribute("href")) return true;
    if (el instanceof HTMLButtonElement) return true;
    if (el instanceof HTMLInputElement && (el.getAttribute("type") || "text").toLowerCase() !== "hidden") return true;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    if (el instanceof HTMLLabelElement) return true;
    if (el.tagName.toLowerCase() === "summary") return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role") || implicitRoleOf(el);
    if (REPLAY_INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute("onclick") || el.hasAttribute("jsaction")) return true;
    if (el.hasAttribute("tabindex")) return true;
    if (el.hasAttribute("data-bf-action") || el.hasAttribute("data-action") || el.hasAttribute("data-testid-action")) return true;
    return false;
  }

  function closestReplayActionable(start) {
    let cursor = start instanceof Element ? start : null;
    while (cursor && cursor !== document.documentElement) {
      if (hasReplayActionableSignal(cursor)) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  function closestObservationContext(start) {
    if (!(start instanceof Element)) return null;
    const strongContext = start.closest("main,[role='main'],article,[role='article'],header,[role='banner'],footer,[role='contentinfo']");
    return strongContext || start.closest(OBSERVATION_CONTEXT_SELECTOR) || start;
  }

  function isZeroBoxLike(box) {
    return !!box && typeof box.w === "number" && typeof box.h === "number" && (box.w <= 0 || box.h <= 0);
  }

  function targetConflictsWithVisibleIntent(target, visibleIntent) {
    if (!target || !visibleIntent) return false;
    if (target === visibleIntent) return false;
    if (target.contains(visibleIntent) || visibleIntent.contains(target)) return false;
    return true;
  }

  function actionKindFor(target, replayActionable, visibleIntent, visibility) {
    if (
      visibility && (
        visibility.hasVisibleBox === false ||
        isZeroBoxLike(visibility.rawBox) ||
        targetConflictsWithVisibleIntent(target, visibleIntent)
      )
    ) {
      return "implementation-layer";
    }
    return replayActionable ? "interactive" : "observation";
  }

  function observedTextSummaryFor(target, visibleHit, rawTarget) {
    return cleanText(
      (visibleHit && (visibleHit.innerText || visibleHit.textContent)) ||
      (rawTarget && (rawTarget.innerText || rawTarget.textContent)) ||
      (target && (target.innerText || target.textContent)) ||
      ""
    );
  }

  let bfGestureCounter = 0;
  const bfPointerGestures = new Map();
  let bfLastPointerGesture = null;
  document.addEventListener("pointerdown", (event) => {
    const pointerId = typeof event.pointerId === "number" ? event.pointerId : 0;
    const target = event.target instanceof Element ? event.target : null;
    const actionable = closestReplayActionable(target);
    const windowId = nextCaptureWindowId();
    const gesture = {
      gestureId: "g" + (++bfGestureCounter),
      captureWindowId: windowId,
      pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      pointerTimestamp: Date.now(),
      targetSelector: target ? selectorFor(target) : "",
      actionableSelector: actionable ? selectorFor(actionable) : ""
    };
    bfPointerGestures.set(pointerId, gesture);
    bfLastPointerGesture = gesture;
    emit({
      type: "action-window",
      lane: "hot-journal",
      captureWindowId: windowId,
      documentId: __bfDocumentId,
      gestureId: gesture.gestureId,
      pointerId,
      pointer: { x: event.clientX, y: event.clientY },
      targetSelector: target ? selectorFor(target) : "",
      actionableSelector: actionable ? selectorFor(actionable) : "",
      hitTarget: targetSummary(actionable || target),
      locator: actionable ? bfLocator(actionable) : undefined
    });
  }, true);

  document.addEventListener("click", (event) => {
    const rawTarget = event.target instanceof Element ? event.target : null;
    const replayActionable = closestReplayActionable(rawTarget);
    const target = replayActionable || closestObservationContext(rawTarget);
    if (!target) {
      return;
    }
    if (
      (target instanceof HTMLButtonElement && target.form && (target.type === "submit" || target.type === "")) ||
      (target instanceof HTMLInputElement && target.form && (target.type === "submit" || target.type === "image"))
    ) {
      return;
    }
    const clickSelector = selectorFor(target);
    const clickLocator = bfLocator(target);
    const pointerId = typeof event.pointerId === "number" ? event.pointerId : (bfLastPointerGesture ? bfLastPointerGesture.pointerId : 0);
    const gesture = bfPointerGestures.get(pointerId) || bfLastPointerGesture || null;
    const visibleHitRaw = document.elementFromPoint(event.clientX, event.clientY);
    const visibleHit = visibleHitRaw instanceof Element ? visibleHitRaw : null;
    const visibleActionable = closestReplayActionable(visibleHit);
    const visibility = targetVisibilityFor(target, visibleActionable || visibleHit);
    const actionKind = actionKindFor(target, replayActionable, visibleActionable || visibleHit, visibility);
    var actionMeta = scheduleActionDiff("click", gesture ? gesture.captureWindowId : "");
    emit({
      type: "click",
      actionKind,
      actionId: actionMeta.actionId,
      actionSeq: actionMeta.actionSeq,
      captureWindowId: actionMeta.captureWindowId,
      documentId: actionMeta.documentId,
      selector: clickSelector,
      gestureId: gesture ? gesture.gestureId : "",
      pointerId,
      isTrusted: event.isTrusted,
      clickX: event.clientX,
      clickY: event.clientY,
      pointer: { x: event.clientX, y: event.clientY },
      targetSelector: rawTarget ? selectorFor(rawTarget) : "",
      actionableSelector: clickSelector,
      rawTarget: targetSummary(rawTarget),
      actionableTarget: targetSummary(target),
      visibleHitTarget: targetSummary(visibleHit),
      visibleActionableAncestor: targetSummary(visibleActionable),
      targetVisibility: visibility,
      eventPath: summarizeEventPath(event),
      observedTextSummary: actionKind === "observation" ? observedTextSummaryFor(target, visibleHit, rawTarget) : undefined,
      text: cleanText(target.innerText || target.getAttribute("aria-label") || target.getAttribute("value")),
      href: target instanceof HTMLAnchorElement ? target.getAttribute("href") || "" : "",
      role: target.getAttribute("role") || implicitRoleOf(target),
      ancestors: collectAncestors(target),
      siblings: countSiblings(target, clickSelector),
      locator: clickLocator,
      coords: { x: event.clientX, y: event.clientY },
      pageSkeleton: safePageSkeleton()
    });
  }, true);

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const fieldName = target.name || target.id || target.getAttribute("aria-label") || "";
    const inputSelector = selectorFor(target);
    var inputActionMeta = scheduleActionDiff("input");
    emit({
      type: "input",
      actionId: inputActionMeta.actionId,
      actionSeq: inputActionMeta.actionSeq,
      captureWindowId: inputActionMeta.captureWindowId,
      documentId: inputActionMeta.documentId,
      selector: inputSelector,
      fieldName,
      secret: target.type === "password" || SECRET_FIELD_PATTERN.test(fieldName),
      value: cleanText(target.value),
      role: target.getAttribute("role") || implicitRoleOf(target),
      ancestors: collectAncestors(target),
      siblings: countSiblings(target, inputSelector),
      locator: bfLocator(target),
      pageSkeleton: safePageSkeleton()
    });
  }, true);

  // snapshot a contentEditable host's PRE-typing identity on focus.
  // The note body morphs as content is entered (empty <p role=presentation> →
  // <div role=textbox>); the focusout event below captures the POST-typing
  // (morphed) locator, which won't match the empty replay state. The focus-time
  // snapshot of the (stable, focusable) editing host is the identity replay needs.
  var bfPreTyping = new WeakMap();
  document.addEventListener("focusin", (event) => {
    const t = event.target;
    if (!(t instanceof Element)) {
      return;
    }
    const ce = t.closest('[contenteditable=""],[contenteditable="true"]');
    if (ce) {
      try { bfPreTyping.set(ce, bfLocator(ce)); } catch (_e) { /* best-effort */ }
    }
  }, true);

  document.addEventListener("focusout", (event) => {
    const t = event.target;
    if (!(t instanceof Element) || !t.isContentEditable) {
      return;
    }
    const ce = t.closest('[contenteditable=""],[contenteditable="true"]') || t;
    const ceFieldName = ce.getAttribute("aria-label") || ce.getAttribute("name") || ce.id || "";
    const ceSelector = selectorFor(ce);
    const prePayload = bfPreTyping.get(ce);
    var contentEditableActionMeta = scheduleActionDiff("input");
    emit({
      type: "input",
      actionId: contentEditableActionMeta.actionId,
      actionSeq: contentEditableActionMeta.actionSeq,
      captureWindowId: contentEditableActionMeta.captureWindowId,
      documentId: contentEditableActionMeta.documentId,
      selector: ceSelector,
      fieldName: ceFieldName,
      contentEditable: true,
      role: ce.getAttribute("role") || "textbox",
      secret: SECRET_FIELD_PATTERN.test(ceFieldName),
      value: cleanText(ce.innerText || ce.textContent),
      ancestors: collectAncestors(ce),
      siblings: countSiblings(ce, ceSelector),
      locator: bfLocator(ce),
      // pre-typing host identity (undefined if focus wasn't seen).
      ...(prePayload ? { preTypingLocator: prePayload } : {})
    });
  }, true);

  document.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) {
      return;
    }
    const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    const submitSelector = selectorFor(target);
    var submitActionMeta = scheduleActionDiff("submit");
    emit({
      type: "submit",
      actionId: submitActionMeta.actionId,
      actionSeq: submitActionMeta.actionSeq,
      captureWindowId: submitActionMeta.captureWindowId,
      documentId: submitActionMeta.documentId,
      selector: submitSelector,
      ...formSignatureFor(target),
      submitterSelector: submitter ? selectorFor(submitter) : "",
      submitterText: submitter ? cleanText(submitter.innerText || submitter.getAttribute("aria-label") || submitter.getAttribute("value")) : "",
      submitterHref: submitter instanceof HTMLAnchorElement ? submitter.getAttribute("href") || "" : "",
      ancestors: collectAncestors(target),
      siblings: countSiblings(target, submitSelector),
      pageSkeleton: safePageSkeleton()
    });
  }, true);
})();
`;
