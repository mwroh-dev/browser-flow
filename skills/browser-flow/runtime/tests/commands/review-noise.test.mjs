import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";

test("review-noise briefs unresolved capture-noise candidates and applies keep/exclude verdicts", () => {
  const runId = `review-noise-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        eventIndexes: [1, 2, 3, 4],
        eventIndexRange: [1, 4],
        stableTargetKey: "xpath://*[@id='menu-toggle']",
        reason: "settled-oscillation",
        summary: "Repeated same-control toggle before destination action",
        recommendedAction: "exclude"
      }
    ]
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);
  assert.equal(briefing.status, "needs_review");
  assert.equal(briefing.unresolved.length, 1);
  assert.equal(briefing.unresolved[0].candidateId, "cn1");
  assert.match(briefing.message, /ambiguous capture noise/i);
  assert.match(briefing.unresolved[0].briefing, /cn1/);
  assert.match(briefing.unresolved[0].briefing, /ambiguous-prefix-toggle/);
  assert.match(briefing.unresolved[0].briefing, /events 1-4/);
  assert.match(briefing.unresolved[0].briefing, /Repeated same-control toggle/);

  const verdictPath = join(mkdtempSync(join(tmpdir(), "bf-review-")), "capture-noise-result.json");
  writeFileSync(verdictPath, JSON.stringify({
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }]
  }, null, 2), "utf8");

  const applied = runCli(["review-noise", "--run-id", runId, "--apply", verdictPath]);
  assert.equal(applied.status, "resolved");
  assert.equal(applied.decisions[0].candidateId, "cn1");
  assert.deepEqual(readJson(runPaths.captureNoiseResultPath), {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }]
  });
});

test("review-noise includes implementation-layer briefing fields", () => {
  const runId = `review-noise-implementation-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [4, 5],
        eventIndexRange: [4, 5],
        stableTargetKeys: ["shape:main>button|button||Internal"],
        reason: "interrupted-implementation-event",
        summary: "Implementation-layer click produced no replayable transition",
        recommendedAction: "keep",
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        actionKind: "implementation-layer",
        isTrusted: false,
        settleStatus: "interrupted"
      }
    ]
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);

  assert.equal(briefing.status, "needs_review");
  assert.equal(briefing.unresolved[0].kind, "ambiguous-implementation-layer-click");
  assert.equal(briefing.unresolved[0].actionKind, "implementation-layer");
  assert.equal(briefing.unresolved[0].isTrusted, false);
  assert.equal(briefing.unresolved[0].settleStatus, "interrupted");
  assert.match(briefing.unresolved[0].prompt, /provider-side state control surface/i);
  assert.match(briefing.unresolved[0].prompt, /state change is part of the route/i);
  assert.match(briefing.unresolved[0].briefing, /implementation-layer/);
  assert.match(briefing.unresolved[0].briefing, /provider: layered-control-surface\/canvas-tile\/state-proof-click\/group=visual-layer/);
  assert.match(briefing.unresolved[0].briefing, /interrupted/);
  assert.match(briefing.unresolved[0].briefing, /shape:main>button/);
  assert.match(briefing.unresolved[0].briefing, /keep is recommended because this provider-surface control/i);
});

test("review-noise briefs the full user journey before unresolved candidates", () => {
  const runId = `review-noise-journey-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.test/", timestamp: 1000 },
    {
      type: "click",
      url: "https://example.test/",
      timestamp: 1010,
      selector: "a",
      text: "Weather",
      href: "https://example.test/weather",
      role: "link"
    },
    { type: "navigate", url: "https://example.test/weather", timestamp: 1020 },
    {
      type: "click",
      url: "https://example.test/weather",
      timestamp: 1030,
      selector: "a",
      text: "Details",
      href: "https://example.test/map",
      role: "link"
    },
    { type: "navigate", url: "https://example.test/map", timestamp: 1040 },
    {
      type: "click",
      url: "https://example.test/map",
      timestamp: 1050,
      selector: "button",
      text: "Rain",
      role: "button"
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 1051,
      settleStatus: "settled",
      beforeSkeleton: [{ role: "button", name: "Rain" }],
      afterSkeleton: [{ role: "button", name: "Rain selected" }]
    }
  ]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-hidden-control-burst",
        eventIndexes: [3],
        eventIndexRange: [3, 3],
        reason: "hidden-zero-box-noop",
        summary: "Details looked hidden but navigated",
        recommendedAction: "keep",
        effect: {
          kind: "navigation",
          fromUrl: "https://example.test/weather",
          toUrl: "https://example.test/map",
          targetText: "Details",
          targetHref: "https://example.test/map",
          dependentRoute: true
        }
      },
      {
        candidateId: "cn2",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [6],
        eventIndexRange: [6, 6],
        reason: "implementation-noop",
        summary: "Incidental pause event",
        recommendedAction: "exclude",
        effect: { kind: "implementation-noise", targetText: "Pause" }
      }
    ]
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);

  assert.equal(Array.isArray(briefing.journey.events), true);
  assert.deepEqual(
    briefing.journey.events.map((entry) => [entry.kind, entry.text, entry.toUrl || ""]),
    [
      ["navigation", "Weather", "https://example.test/weather"],
      ["navigation", "Details", "https://example.test/map"],
      ["state-change", "Rain", ""]
    ]
  );
  assert.equal(briefing.unresolved[0].candidateId, "cn1");
  assert.equal(briefing.unresolved[0].recommendedAction, "keep");
  assert.match(briefing.unresolved[0].briefing, /moved.*https:\/\/example\.test\/weather.*https:\/\/example\.test\/map/i);
  assert.equal(briefing.unresolved[1].recommendedAction, "exclude");
});

test("review-noise briefs toggle intent groups before raw event candidates", () => {
  const runId = `review-noise-intent-group-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.test/", timestamp: 1000 },
    { type: "click", url: "https://example.test/", timestamp: 1010, selector: "a", text: "Open menu", href: "/", role: "button", actionSeq: 1 },
    { type: "action-diff", refType: "click", timestamp: 1011, actionSeq: 1, settleStatus: "interrupted" },
    { type: "click", url: "https://example.test/", timestamp: 1020, selector: "a", text: "Close menu", href: "/", role: "button", actionSeq: 2 },
    { type: "action-diff", refType: "click", timestamp: 1021, actionSeq: 2, settleStatus: "interrupted" },
    { type: "click", url: "https://example.test/", timestamp: 1030, selector: "a", text: "Open menu", href: "/", role: "button", actionSeq: 3 },
    { type: "action-diff", refType: "click", timestamp: 1031, actionSeq: 3, settleStatus: "settled" },
    { type: "click", url: "https://example.test/", timestamp: 1040, selector: "a", text: "Weather", href: "https://example.test/weather", role: "link" },
    { type: "navigate", url: "https://example.test/weather", timestamp: 1050 }
  ]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        reason: "interrupted-prefix",
        summary: "Menu was toggled repeatedly before Weather",
        recommendedAction: "exclude"
      }
    ],
    intentGroups: [
      {
        intentGroupId: "ig1",
        intentKind: "toggle-reveal",
        summary: "Open/close/open menu before Weather",
        rawEventIndexes: [1, 2, 3, 4, 5, 6],
        candidateIds: ["cn1"],
        canonicalReplay: {
          keepEventIndexes: [5, 6],
          excludeEventIndexes: [1, 2, 3, 4],
          hrefPolicy: "ignore",
          reason: "Keep only the final settled menu open."
        },
        risk: "href-bearing-interrupted-toggle"
      }
    ]
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);

  assert.equal(Array.isArray(briefing.journey.intentGroups), true);
  assert.equal(briefing.journey.intentGroups[0].intentGroupId, "ig1");
  assert.equal(briefing.journey.intentGroups[0].intentKind, "toggle-reveal");
  assert.match(briefing.journey.intentGroups[0].humanSummary, /Open\/close\/open menu before Weather/);
  assert.deepEqual(briefing.journey.intentGroups[0].recommendedReplayPlan.keepEventIndexes, [5, 6]);
  assert.deepEqual(briefing.journey.intentGroups[0].recommendedReplayPlan.excludeEventIndexes, [1, 2, 3, 4]);
  assert.match(briefing.journey.intentGroups[0].question, /canonical replay/i);
});

test("review-noise apply rejects risky prefix keep without strict risk acknowledgement", () => {
  const runId = `review-noise-risky-keep-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        reason: "interrupted-prefix",
        summary: "Risky href-bearing prefix toggle",
        recommendedAction: "exclude"
      }
    ],
    intentGroups: [
      {
        intentGroupId: "ig1",
        intentKind: "toggle-reveal",
        rawEventIndexes: [1, 2, 3, 4, 5, 6],
        candidateIds: ["cn1"],
        canonicalReplay: {
          keepEventIndexes: [5, 6],
          excludeEventIndexes: [1, 2, 3, 4],
          hrefPolicy: "ignore",
          reason: "Keep only final reveal."
        },
        risk: "href-bearing-interrupted-toggle"
      }
    ]
  });
  const verdictPath = join(mkdtempSync(join(tmpdir(), "bf-review-risky-")), "capture-noise-result.json");
  writeFileSync(verdictPath, JSON.stringify({
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "keep" }]
  }, null, 2), "utf8");

  assert.throws(
    () => runCli(["review-noise", "--run-id", runId, "--apply", verdictPath]),
    /risky keep.*cn1.*strict.*riskAcknowledged/i
  );
});

test("review-noise briefs cross-tab navigation as new-tab-navigation", () => {
  const runId = `review-noise-new-tab-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.test/", timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: "https://example.test/",
      timestamp: 1010,
      selector: "a",
      text: "Weather",
      href: "https://example.test/weather",
      role: "link",
      tabOrdinal: 0
    },
    { type: "navigate", url: "about:blank", timestamp: 1011, tabOrdinal: 1 },
    { type: "navigate", url: "https://example.test/weather", timestamp: 1020, tabOrdinal: 1 },
    {
      type: "click",
      url: "https://example.test/weather",
      timestamp: 1030,
      selector: "button",
      text: "Rain",
      role: "button",
      tabOrdinal: 1
    }
  ]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "clean",
    suggestions: []
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);

  assert.deepEqual(briefing.journey.events.slice(0, 2).map((entry) => [entry.kind, entry.text, entry.toUrl || "", entry.toTabOrdinal]), [
    ["new-tab-navigation", "Weather", "https://example.test/weather", 1],
    ["state-change", "Rain", "", undefined]
  ]);
});

test("review-noise surfaces trusted layered controls before provider proxy noise", () => {
  const runId = `review-noise-layered-provider-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const mapUrl = "https://weather.naver.com/map/09740660?visualMapType=sat";
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: mapUrl, timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: mapUrl,
      timestamp: 1010,
      selector: "button",
      text: "위성",
      role: "button",
      actionKind: "implementation-layer",
      isTrusted: false,
      actionSeq: 1,
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "위성",
        structuralKey: "div>button|button|map_depth_button.type_sat|위성"
      }
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 1011,
      actionSeq: 1,
      settleStatus: "settled",
      beforeSkeleton: [{ role: "button", name: "영상 위성" }],
      afterSkeleton: [{ role: "button", name: "영상 위성" }]
    },
    {
      type: "click",
      url: mapUrl,
      timestamp: 1020,
      selector: "button",
      text: "일시정지",
      role: "button",
      actionKind: "implementation-layer",
      isTrusted: false,
      actionSeq: 2,
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "일시정지",
        structuralKey: "div>button|button|map_control_playbtn|일시정지"
      }
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 1021,
      actionSeq: 2,
      settleStatus: "interrupted",
      beforeSkeleton: [{ role: "button", name: "영상 위성" }],
      afterSkeleton: [{ role: "button", name: "영상 위성" }]
    },
    {
      type: "click",
      url: mapUrl,
      timestamp: 1030,
      selector: "button",
      text: "영상 위성",
      role: "button",
      actionKind: "interactive",
      isTrusted: true,
      actionSeq: 3,
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>button|button|map_item_button.type_sat|영상 위성"
      }
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 1031,
      actionSeq: 3,
      settleStatus: "settled",
      beforeSkeleton: [{ role: "button", name: "영상 위성" }],
      afterSkeleton: [{ role: "button", name: "영상 위성" }]
    },
    {
      type: "click",
      url: mapUrl,
      timestamp: 1040,
      selector: "button",
      text: "강수예측",
      role: "button",
      actionKind: "interactive",
      isTrusted: true,
      actionSeq: 4,
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>button|button|map_depth_button.type_maple|강수예측"
      }
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 1041,
      actionSeq: 4,
      settleStatus: "settled",
      beforeSkeleton: [{ role: "button", name: "영상 위성" }],
      afterSkeleton: [{ role: "button", name: "영상 위성" }]
    }
  ]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        reason: "implementation-noop",
        summary: "Provider proxy reported satellite",
        recommendedAction: "keep",
        actionKind: "implementation-layer",
        isTrusted: false,
        effect: { kind: "state-change", targetText: "위성" },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      },
      {
        candidateId: "cn2",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [3, 4],
        eventIndexRange: [3, 4],
        reason: "interrupted-implementation-event",
        summary: "Provider timeline auto event",
        recommendedAction: "keep",
        actionKind: "implementation-layer",
        isTrusted: false,
        effect: { kind: "state-change", targetText: "일시정지" },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "timeline",
          confidence: "high"
        }
      }
    ]
  });

  const briefing = runCli(["review-noise", "--run-id", runId]);

  assert.deepEqual(
    briefing.journey.events.map((entry) => [entry.kind, entry.text, entry.recommendedAction, entry.candidateId]),
    [
      ["implementation-noise", "위성", "exclude", "cn1"],
      ["implementation-noise", "일시정지", "exclude", "cn2"],
      ["state-change", "영상 위성", "keep", undefined],
      ["state-change", "강수예측", "keep", undefined]
    ]
  );
  assert.equal(briefing.unresolved[0].recommendedAction, "exclude");
  assert.equal(briefing.unresolved[1].recommendedAction, "exclude");
  assert.match(briefing.unresolved[0].briefing, /trusted provider action/i);
  assert.match(briefing.unresolved[1].briefing, /provider timeline auto/i);
});
