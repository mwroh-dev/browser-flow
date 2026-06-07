import test from "node:test";
import assert from "node:assert/strict";
import { selectCaptureFinalTarget } from "../../scripts/observe/capture-target.mjs";

test("selectCaptureFinalTarget prefers the last trusted user action target over the first tab", () => {
  const selected = selectCaptureFinalTarget({
    targets: [
      { targetId: "home-tab", url: "https://example.test/home", type: "page", title: "Home" },
      { targetId: "work-tab", url: "https://example.test/work/final", type: "page", title: "Final" }
    ],
    lastUserActionTargetId: "work-tab",
    lastUserActionTabOrdinal: 1,
    lastRealNavigateTargetId: "work-tab",
    finalUrl: "https://example.test/work/final",
    tabOrdinalForTarget: (targetId) => targetId === "work-tab" ? 1 : 0
  });

  assert.equal(selected?.targetId, "work-tab");
  assert.equal(selected?.tabOrdinal, 1);
  assert.equal(selected?.targetUrl, "https://example.test/work/final");
  assert.equal(selected?.reason, "last-user-action");
});

test("selectCaptureFinalTarget falls back to the final navigation target before non-blank tabs", () => {
  const selected = selectCaptureFinalTarget({
    targets: [
      { targetId: "home-tab", url: "https://example.test/home", type: "page", title: "Home" },
      { targetId: "work-tab", url: "https://example.test/work/final", type: "page", title: "Final" }
    ],
    lastUserActionTargetId: "",
    lastUserActionTabOrdinal: 0,
    lastRealNavigateTargetId: "work-tab",
    finalUrl: "https://example.test/work/final",
    tabOrdinalForTarget: (targetId) => targetId === "work-tab" ? 1 : 0
  });

  assert.equal(selected?.targetId, "work-tab");
  assert.equal(selected?.tabOrdinal, 1);
  assert.equal(selected?.reason, "last-real-navigation");
});

test("selectCaptureFinalTarget uses live target URLs instead of falling back to the first cached tab", () => {
  const selected = selectCaptureFinalTarget({
    targets: [
      { targetId: "blank-tab", url: "about:blank", type: "page", title: "" },
      { targetId: "work-tab", url: "about:blank", liveUrl: "https://example.test/work/final", type: "page", title: "Final" }
    ],
    lastUserActionTargetId: "work-tab",
    lastUserActionTabOrdinal: 1,
    lastRealNavigateTargetId: "work-tab",
    finalUrl: "https://example.test/work/final",
    tabOrdinalForTarget: (targetId) => targetId === "work-tab" ? 1 : 0
  });

  assert.equal(selected?.targetId, "work-tab");
  assert.equal(selected?.tabOrdinal, 1);
  assert.equal(selected?.targetUrl, "https://example.test/work/final");
  assert.equal(selected?.reason, "last-user-action");
});
