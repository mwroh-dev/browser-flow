import test from "node:test";
import assert from "node:assert/strict";
import {
  detectBacktrackedTrailingAction,
  detectCaptureNoise,
  trimBacktrackedTrailingAction
} from "../../scripts/analyze/capture-noise.mjs";

const events = [
  { type: "navigate", url: "https://news.example/section/101", timestamp: 1 },
  {
    type: "click",
    selector: "a.headline",
    text: "Top headline",
    locator: { href: "/article/1", name: "Top headline" },
    tabOrdinal: 0,
    timestamp: 2
  },
  { type: "navigate", url: "https://news.example/article/1", tabOrdinal: 0, timestamp: 3 },
  { type: "navigate", url: "https://news.example/section/101", tabOrdinal: 0, timestamp: 4 }
];

test("detectBacktrackedTrailingAction reports an auto-trimmable trailing detour", () => {
  const result = detectBacktrackedTrailingAction({
    events,
    fixture: "manual",
    firstNavigate: "https://news.example/section/101",
    finalNavigate: "https://news.example/section/101"
  });

  assert.equal(result.status, "auto_trim_available");
  assert.equal(result.suggestions[0].kind, "backtracked-trailing-action");
  assert.equal(result.suggestions[0].actionText, "Top headline");
  assert.equal(result.suggestions[0].analyzerAction, "will_trim");
});

test("trimBacktrackedTrailingAction removes only the trailing detour suffix", () => {
  const result = trimBacktrackedTrailingAction(
    events,
    "manual",
    "https://news.example/section/101",
    "https://news.example/section/101"
  );

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, "navigate");
  assert.equal(result.events[1].type, "navigate");
  assert.equal(result.ignored[0].reason, "backtracked-trailing-action");
});

test("detectCaptureNoise treats provider proxy events as exclude when trusted layer actions follow", () => {
  const mapUrl = "https://weather.naver.com/map/09740660?visualMapType=sat";
  const result = detectCaptureNoise({
    fixture: "manual",
    firstNavigate: mapUrl,
    finalNavigate: mapUrl,
    events: [
      { type: "navigate", url: mapUrl, timestamp: 1 },
      {
        type: "click",
        url: mapUrl,
        timestamp: 2,
        role: "button",
        text: "위성",
        actionKind: "implementation-layer",
        isTrusted: false,
        actionSeq: 1,
        locator: {
          role: "button",
          name: "위성",
          structuralKey: "div>button|button|map_depth_button.type_sat|위성"
        }
      },
      {
        type: "action-diff",
        refType: "click",
        timestamp: 3,
        actionSeq: 1,
        settleStatus: "settled",
        beforeSkeleton: [{ role: "button", name: "영상 위성" }],
        afterSkeleton: [{ role: "button", name: "영상 위성" }]
      },
      {
        type: "click",
        url: mapUrl,
        timestamp: 4,
        role: "button",
        text: "영상 위성",
        actionKind: "interactive",
        isTrusted: true,
        actionSeq: 2,
        locator: {
          role: "button",
          name: "영상 위성",
          structuralKey: "div>button|button|map_item_button.type_sat|영상 위성"
        }
      },
      {
        type: "action-diff",
        refType: "click",
        timestamp: 5,
        actionSeq: 2,
        settleStatus: "settled",
        beforeSkeleton: [{ role: "button", name: "영상 위성" }],
        afterSkeleton: [{ role: "button", name: "영상 위성" }]
      },
      {
        type: "click",
        url: mapUrl,
        timestamp: 6,
        role: "button",
        text: "강수예측",
        actionKind: "interactive",
        isTrusted: true,
        actionSeq: 3,
        locator: {
          role: "button",
          name: "강수예측",
          structuralKey: "div>button|button|map_depth_button.type_maple|강수예측"
        }
      },
      {
        type: "action-diff",
        refType: "click",
        timestamp: 7,
        actionSeq: 3,
        settleStatus: "settled",
        beforeSkeleton: [{ role: "button", name: "영상 위성" }],
        afterSkeleton: [{ role: "button", name: "영상 강수예측" }]
      }
    ]
  });

  assert.equal(result.status, "needs_review");
  const satelliteProxy = result.suggestions.find((candidate) => candidate.effect?.targetText === "위성");
  assert.equal(satelliteProxy?.kind, "ambiguous-implementation-layer-click");
  assert.equal(satelliteProxy?.recommendedAction, "exclude");
  assert.equal(satelliteProxy?.effect?.kind, "implementation-noise");
  assert.equal(satelliteProxy?.evidenceRole, "provider-proxy-before-trusted-action");
});
