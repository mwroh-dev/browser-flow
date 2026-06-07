import test from "node:test";
import assert from "node:assert/strict";
import { coalesceGestureClicks } from "../../scripts/lib/gesture-coalescer.mjs";

test("coalesceGestureClicks keeps the actionable link over a same-gesture container click", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "#header", text: "", gestureId: "g1", timestamp: 1000 },
    { type: "click", selector: "a[href=\"/finance\"]", text: "증권", href: "/finance", role: "link", gestureId: "g1", timestamp: 1005 }
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].selector, "a[href=\"/finance\"]");
  assert.deepEqual(result.ignored, [
    {
      type: "coalesced-click",
      reason: "same-gesture-less-actionable-target",
      keptSelector: "a[href=\"/finance\"]",
      ignoredSelector: "#header",
      gestureId: "g1",
      ignoredText: ""
    }
  ]);
});

test("coalesceGestureClicks does not merge separate gestures", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "#header", gestureId: "g1", timestamp: 1000 },
    { type: "click", selector: "a[href=\"/finance\"]", text: "증권", href: "/finance", role: "link", gestureId: "g2", timestamp: 1005 }
  ]);

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.ignored, []);
});

test("coalesceGestureClicks does not merge different gesture ids even at the same point", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "button", text: "Open", role: "button", gestureId: "g1", clickX: 100, clickY: 50, timestamp: 1000 },
    { type: "click", selector: "button", text: "Open", role: "button", gestureId: "g2", clickX: 100, clickY: 50, timestamp: 1100 }
  ]);

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.ignored, []);
});

test("coalesceGestureClicks falls back to close coordinates and timestamp", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "div", text: "", clickX: 100, clickY: 50, timestamp: 1000 },
    { type: "click", selector: "button", text: "Open", role: "button", clickX: 102, clickY: 53, timestamp: 1100 }
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].selector, "button");
  assert.equal(result.ignored.length, 1);
});

test("coalesceGestureClicks keeps standalone header or ad clicks", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "#header", text: "Header", timestamp: 1000 },
    { type: "navigate", url: "https://example.test/", timestamp: 1005 },
    { type: "click", selector: "#ad", text: "Advertisement", timestamp: 2000 }
  ]);

  assert.equal(result.events.length, 3);
  assert.deepEqual(result.ignored, []);
});

test("coalesceGestureClicks drops action-diff entries associated with ignored duplicate clicks", () => {
  const result = coalesceGestureClicks([
    { type: "click", selector: "#header", text: "", role: "banner", gestureId: "g1", timestamp: 1000 },
    { type: "click", selector: "a[href=\"/finance\"]", text: "증권", href: "/finance", role: "link", gestureId: "g1", timestamp: 1005 },
    { type: "action-diff", refType: "click", beforeSkeleton: [{ structuralKey: "ignored-before" }], afterSkeleton: [{ structuralKey: "ignored-after" }] },
    { type: "action-diff", refType: "click", beforeSkeleton: [{ structuralKey: "kept-before" }], afterSkeleton: [{ structuralKey: "kept-after" }] },
    { type: "click", selector: "button", text: "Refresh", role: "button", gestureId: "g2", timestamp: 2000 },
    { type: "action-diff", refType: "click", beforeSkeleton: [{ structuralKey: "second-before" }], afterSkeleton: [{ structuralKey: "second-after" }] }
  ]);

  assert.deepEqual(
    result.events.map((event) => event.type === "action-diff" ? event.beforeSkeleton[0].structuralKey : event.selector),
    ["a[href=\"/finance\"]", "kept-before", "button", "second-before"]
  );
  assert.equal(result.ignored.filter((event) => event.type === "coalesced-action-diff").length, 1);
});

test("coalesceGestureClicks does not collapse all-hidden same-gesture controls into a fake winner", () => {
  const result = coalesceGestureClicks([
    {
      type: "click",
      selector: "button",
      text: "Layer A",
      role: "button",
      gestureId: "g-hidden",
      timestamp: 1000,
      clickX: 240,
      clickY: 96,
      locator: { box: { cx: 0, cy: 0, w: 0, h: 0 } },
      targetVisibility: { hasVisibleBox: false, rawBox: { cx: 0, cy: 0, w: 0, h: 0 } }
    },
    {
      type: "click",
      selector: "button",
      text: "Layer B",
      role: "button",
      gestureId: "g-hidden",
      timestamp: 1001,
      clickX: 240,
      clickY: 96,
      locator: { box: { cx: 0, cy: 0, w: 0, h: 0 } },
      targetVisibility: { hasVisibleBox: false, rawBox: { cx: 0, cy: 0, w: 0, h: 0 } }
    }
  ]);

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.text), ["Layer A", "Layer B"]);
  assert.equal(result.ignored.length, 0);
});
