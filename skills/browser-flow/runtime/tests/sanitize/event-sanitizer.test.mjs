import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeEvent } from "../../scripts/sanitize/event-sanitizer.mjs";

// Agent-blind sanitization for new locator signals.
// neighborTexts and alt are redacted via the SAME mechanism as locator.name:
//   fieldNameIsForbidden(text) → "<redacted-field>"  (SECRET_FIELD_PATTERN match)
//   else sanitizeText(text)    → "<redacted-secret>" (HIGH_ENTROPY_PATTERN match)
// href is sanitized via sanitizeUrl (strips credentials + secret query params;
// external URLs become "<non-local-url>" in default/masked mode).

test("locator neighborTexts containing SECRET_FIELD_PATTERN tokens are redacted", () => {
  // "letmein-supersecret-token" contains "secret" and "token" →
  // fieldNameIsForbidden returns true → "<redacted-field>"
  const ev = sanitizeEvent({
    type: "click",
    selector: "a",
    locator: {
      role: "link",
      name: "ok",
      neighborTexts: ["letmein-supersecret-token", "normal label"]
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize");
  const s = JSON.stringify(loc.neighborTexts);
  assert.ok(!s.includes("letmein-supersecret-token"), "neighborTexts secret must be redacted");
  assert.equal(loc.neighborTexts[0], "<redacted-field>", "secret item replaced with <redacted-field>");
  assert.equal(loc.neighborTexts[1], "normal label", "benign neighbor text must pass through");
});

test("locator alt containing SECRET_FIELD_PATTERN token is redacted", () => {
  // "token=secret-image-alt" contains "token" and "secret" →
  // fieldNameIsForbidden returns true → "<redacted-field>"
  const ev = sanitizeEvent({
    type: "click",
    selector: "img",
    locator: {
      role: "img",
      name: "photo",
      alt: "token=secret-image-alt"
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize");
  assert.ok(!JSON.stringify(loc).includes("token=secret-image-alt"), "alt secret must be redacted");
  assert.equal(loc.alt, "<redacted-field>", "alt replaced with <redacted-field>");
});

test("locator href with secret query param is sanitized", () => {
  // In default (masked) mode, external URLs become "<non-local-url>",
  // so the raw query value cannot appear in the output.
  const ev = sanitizeEvent({
    type: "click",
    selector: "a",
    locator: {
      role: "link",
      name: "go",
      href: "https://x.com/p?token=SECRETVALUE123"
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize");
  assert.ok(!JSON.stringify(loc).includes("SECRETVALUE123"), "href token must be sanitized");
});

test("combined event — no raw secret survives in any new locator field", () => {
  const ev = sanitizeEvent({
    type: "click",
    selector: "a",
    locator: {
      role: "link",
      name: "ok",
      neighborTexts: ["letmein-supersecret-token", "normal label"],
      alt: "password=hunter2",
      href: "https://x.com/p?token=SECRETVALUE123"
    }
  });
  const s = JSON.stringify(ev);
  assert.ok(!s.includes("letmein-supersecret-token"), "neighborTexts secret must be redacted");
  assert.ok(!s.includes("password=hunter2"), "alt secret must be redacted");
  assert.ok(!s.includes("SECRETVALUE123"), "href token must be sanitized");
});

test("locator cleanId and type pass through unchanged (structural fields)", () => {
  const ev = sanitizeEvent({
    type: "click",
    selector: "button",
    locator: {
      role: "button",
      name: "Submit",
      cleanId: "submit-btn",
      type: "submit"
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize");
  assert.equal(loc.cleanId, "submit-btn", "cleanId must pass through");
  assert.equal(loc.type, "submit", "type must pass through");
});

test("benign neighborTexts pass through unchanged", () => {
  // Strings without forbidden-field-name substrings and below entropy
  // threshold are preserved (same contract as locator.name passthrough).
  const ev = sanitizeEvent({
    type: "click",
    selector: "button",
    locator: {
      role: "button",
      name: "Save",
      neighborTexts: ["Cancel", "Next step"]
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.deepStrictEqual(loc.neighborTexts, ["Cancel", "Next step"], "benign neighborTexts must pass through");
});

test("click gesture provenance survives sanitization for analyzer coalescing", () => {
  const ev = /** @type {any} */ (sanitizeEvent({
    type: "click",
    selector: "a[href=\"/finance\"]",
    text: "증권",
    href: "/finance",
    role: "link",
    gestureId: "g7",
    pointerId: 3,
    isTrusted: true,
    clickX: 101,
    clickY: 52,
    targetSelector: "#password-ad",
    actionableSelector: "a[href=\"/finance\"]",
    eventPath: [
      { tag: "a", selector: "a[href=\"/finance\"]", role: "link" },
      { tag: "header", selector: "#password-header", role: "banner" }
    ],
    coords: { x: 120, y: 64 }
  }));

  assert.equal(ev.gestureId, "g7");
  assert.equal(ev.pointerId, 3);
  assert.equal(ev.isTrusted, true);
  assert.equal(ev.clickX, 101);
  assert.equal(ev.clickY, 52);
  assert.equal(ev.actionableSelector, "a[href=\"/finance\"]");
  assert.equal(ev.targetSelector, "<redacted-target-selector>");
  assert.deepEqual(ev.coords, { x: 120, y: 64 });
  assert.equal(ev.eventPath[0].selector, "a[href=\"/finance\"]");
  assert.equal(ev.eventPath[1].selector, "<redacted-event-path-selector>");
});

test("click visible intent metadata survives sanitization for layered UI review", () => {
  const ev = /** @type {any} */ (sanitizeEvent({
    type: "click",
    actionKind: "implementation-layer",
    selector: "button",
    text: "Hidden control",
    clickX: 240,
    clickY: 96,
    pointer: { x: 240, y: 96 },
    rawTarget: { selector: "button#token-hidden", role: "button", name: "Hidden control" },
    actionableTarget: { selector: "button#token-hidden", role: "button", name: "Hidden control" },
    visibleHitTarget: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
    visibleActionableAncestor: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
    targetVisibility: {
      hasVisibleBox: false,
      rawBox: { cx: 0, cy: 0, w: 0, h: 0 },
      visibleBox: { cx: 240, cy: 96, w: 120, h: 32 },
      viewportIntersectionRatio: 0,
      computed: { display: "none", visibility: "hidden", opacity: 0, pointerEvents: "none" }
    }
  }));

  assert.equal(ev.actionKind, "implementation-layer");
  assert.deepEqual(ev.pointer, { x: 240, y: 96 });
  assert.equal(ev.rawTarget.selector, "<redacted-visible-selector>");
  assert.equal(ev.rawTarget.role, "button");
  assert.equal(ev.rawTarget.name, "Hidden control");
  assert.equal(ev.visibleHitTarget.selector, "[data-testid=\"visible-proxy\"]");
  assert.equal(ev.visibleHitTarget.name, "Visible proxy");
  assert.equal(ev.targetVisibility.hasVisibleBox, false);
  assert.equal(ev.targetVisibility.rawBox.w, 0);
  assert.equal(ev.targetVisibility.computed.display, "none");
});

test("click observation metadata survives sanitization", () => {
  const ev = /** @type {any} */ (sanitizeEvent({
    type: "click",
    actionKind: "observation",
    selector: "#container",
    text: "Weather data panel",
    role: "main",
    observedTextSummary: "Today sunrise 05:15 sunset 19:44",
    pointer: { x: 500, y: 320 },
    rawTarget: { selector: "#sunset-row", role: "", name: "sunset 19:44" },
    actionableTarget: { selector: "#container", role: "main", name: "Weather data panel" },
    visibleHitTarget: { selector: "#sunset-row", role: "", name: "sunset 19:44" },
    targetVisibility: {
      hasVisibleBox: true,
      rawBox: { cx: 500, cy: 320, w: 240, h: 48 },
      visibleBox: { cx: 500, cy: 320, w: 240, h: 48 },
      viewportIntersectionRatio: 1,
      computed: { display: "block", visibility: "visible", opacity: 1, pointerEvents: "auto" }
    }
  }));

  assert.equal(ev.actionKind, "observation");
  assert.equal(ev.observedTextSummary, "Today sunrise 05:15 sunset 19:44");
  assert.equal(ev.visibleHitTarget.name, "sunset 19:44");
  assert.equal(ev.targetVisibility.hasVisibleBox, true);
});

test("click pageSkeleton is sanitized for mold fallback", () => {
  const ev = /** @type {any} */ (sanitizeEvent({
    type: "click",
    selector: "a",
    pageSkeleton: [
      { role: "link", name: "Open", structuralKey: "main|a||Open" },
      { role: "textbox", name: "password-token", structuralKey: "main|input||password-token" }
    ]
  }));

  assert.deepEqual(ev.pageSkeleton, [
    { role: "link", name: "Open", structuralKey: "main|a||Open" },
    { role: "textbox", name: "<redacted-field>", structuralKey: "main|input||password-token" }
  ]);
});

test("locator href on input event is also sanitized", () => {
  // sanitizeLocator is called for both click and input events.
  const ev = sanitizeEvent({
    type: "input",
    selector: "input",
    fieldName: "username",
    value: "alice",
    locator: {
      role: "textbox",
      name: "username",
      href: "https://evil.com?session=abc123"
    }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize on input event");
  assert.ok(!JSON.stringify(loc).includes("abc123"), "href session param must be sanitized on input event");
});
