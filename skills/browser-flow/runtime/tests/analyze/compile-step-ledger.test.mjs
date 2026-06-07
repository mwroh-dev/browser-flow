import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { compileRun } from "../../scripts/analyze/compile.mjs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";

const MAP_URL = "https://weather.naver.com/map/09740660";
const WEATHER_HOME_URL = "https://weather.naver.com/";
const LOCAL_WEATHER_HOME_URL = "http://127.0.0.1:59999/weather/";
const LOCAL_MAP_URL = "http://127.0.0.1:59999/weather/map?visualMapType=sat";

test("compile preserves a layered parent opener even when capture-noise review excludes it", () => {
  const runId = `compile-step-ledger-weather-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "영상 위성",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
        neighborTexts: ["위성레이더강수예측"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" }
      ],
      afterSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" },
        { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "강수예측",
      role: "button",
      url: MAP_URL,
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
        neighborTexts: ["위성", "레이더"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1160,
      beforeSkeleton: [
        { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
      ],
      afterSkeleton: [
        { role: "button", name: "영상 강수예측", structuralKey: "div>div|button|type=button|map_item_button.type_maple|영상 강수예측" }
      ]
    }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    captureMode: "normal",
    startUrl: MAP_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, [
    {
      url: "https://weather.naver.com/choiceApi/api?choiceQuery=%7B%22visualMapSrmImage%22%3A%7B%22photoType%22%3A%22maple%22%7D%7D",
      method: "GET",
      status: 200,
      timestamp: 1120
    }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "NAVER 날씨", url: MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-hidden-control-burst",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        summary: "provider activation noise before the trusted map parent action",
        evidenceRole: "provider-proxy-before-trusted-action",
        linkedTrustedAction: {
          eventIndex: 1,
          actionSeq: 1001,
          text: "영상 위성"
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["영상 위성", "강수예측"]);
  assert.equal(workflow.steps[1].postconditions[0].kind, "reveals-next-action");
  assert.equal(workflow.steps[2].preconditions[0].kind, "previous-step-postcondition");
  assert.equal(
    workflow.verification.proofs.some((proof) => proof.kind === "provider-transaction" && proof.stepIndex === 1),
    true
  );
  assert.equal(
    workflow.verification.expectedNetwork,
    null,
    "stateful surface provider proof should not also require a broad auto-derived exact network proof"
  );
  assert.equal(
    workflow.verification.proofs.some((proof) => proof.kind === "network"),
    false,
    "stateful surface provider proof should carry resource-family evidence instead of a duplicated exact network proof"
  );
  assert.equal(existsSync(runPaths.stepLedgerPath), true);
  assert.equal(readJson(runPaths.stepLedgerPath).steps.length, 2);
});

test("compile excludes kept implementation-proxy provider evidence from replay", () => {
  const runId = `compile-step-ledger-implementation-proxy-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: LOCAL_WEATHER_HOME_URL, text: "NAVER Weather", timestamp: 900 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      selector: "button",
      text: "위성",
      role: "button",
      url: LOCAL_WEATHER_HOME_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-weather-home",
      locator: {
        role: "button",
        name: "위성",
        structuralKey: "div>div|button|type=button|map_depth_button.type_sat|위성",
        neighborTexts: []
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-weather-home",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "위성", structuralKey: "div>div|button|type=button|map_depth_button.type_sat|위성" }
      ],
      afterSkeleton: [
        { role: "link", name: "자세히 보기", structuralKey: "div>div>h2|a||title_video_more|자세히 보기" }
      ]
    },
    {
      type: "click",
      selector: "a",
      text: "자세히 보기",
      role: "link",
      url: LOCAL_WEATHER_HOME_URL,
      href: "/map/09740660?visualMapType=sat",
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-weather-home",
      locator: {
        role: "link",
        name: "자세히 보기",
        structuralKey: "div>div>h2|a||title_more|자세히 보기",
        href: "/map/09740660?visualMapType=sat",
        neighborTexts: ["위성영상"]
      }
    },
    { type: "navigate", url: LOCAL_MAP_URL, text: "NAVER Weather Map", timestamp: 1150 }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    captureMode: "normal",
    startUrl: LOCAL_WEATHER_HOME_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "NAVER 날씨", url: LOCAL_MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        reason: "implementation-noop",
        summary: "Weather-home implementation proxy must not replay before map navigation",
        evidenceRole: "provider-proxy-before-trusted-action",
        linkedTrustedAction: {
          eventIndex: 3,
          actionSeq: 1002,
          text: "자세히 보기"
        },
        providerContext: {
          pattern: "implementation-proxy",
          stateCarrier: "none",
          replayStrategy: "needs-review",
          confidence: "medium"
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "keep" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);

  assert.deepEqual(clickTexts, ["자세히 보기"]);
  assert.equal(
    ignored.some((entry) =>
      entry.candidateId === "cn1" &&
      entry.ignoredText === "위성" &&
      entry.reason === "user-kept-nonreplayable-provider-proxy"
    ),
    true
  );
});

test("compile keeps non-physical provider proxy primer as linked evidence only", () => {
  const runId = `compile-step-ledger-provider-proxy-primer-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather Map", timestamp: 900 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      selector: "button",
      text: "Satellite",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Satellite",
        structuralKey: "div>div|button|type=button|map_depth_button.type_sat|Satellite",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["Satellite"],
        neighborTexts: ["Radar", "Rain"],
        box: { cx: 0, cy: 0, w: 0, h: 0 }
      },
      targetVisibility: { hasVisibleBox: false }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" }
      ],
      afterSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" },
        { role: "button", name: "Rain", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "Video Satellite",
      role: "button",
      url: MAP_URL,
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Video Satellite",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["Video", "Satellite"],
        neighborTexts: ["SatelliteRadarRain"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1160,
      beforeSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" },
        { role: "button", name: "Rain", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain" }
      ],
      afterSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" },
        { role: "button", name: "Rain", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "Rain",
      role: "button",
      url: MAP_URL,
      timestamp: 1200,
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Rain",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["Rain"],
        neighborTexts: ["Satellite", "Radar"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1260,
      beforeSkeleton: [
        { role: "button", name: "Rain", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain" }
      ],
      afterSkeleton: [
        { role: "button", name: "Video Rain", structuralKey: "div>div|button|type=button|map_item_button.type_maple|Video Rain" }
      ]
    }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    captureMode: "normal",
    startUrl: MAP_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, [
    {
      url: "https://weather.example.test/choiceApi/api?choiceQuery=%7B%22visualMapSrmImage%22%3A%7B%22photoType%22%3A%22maple%22%7D%7D",
      method: "GET",
      status: 200,
      timestamp: 1220
    }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "Weather map", url: MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        reason: "implementation-noop",
        summary: "same-surface state primer before trusted carrier",
        evidenceRole: "provider-proxy-before-trusted-action",
        linkedTrustedAction: {
          eventIndex: 3,
          actionSeq: 1002,
          text: "Video Satellite",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer"
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "keep" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);

  assert.deepEqual(clickTexts, ["Video Satellite", "Rain"]);
  assert.equal(workflow.steps[1].providerPostconditions.some((condition) => condition.kind === "reveals-next-action"), true);
  assert.equal(workflow.steps[1].providerPrimerEvidence?.[0]?.text, "Satellite");
  assert.equal(workflow.steps[1].providerPrimerEvidence?.[0]?.providerContext?.controlGroup, "visual-layer");
  assert.equal(workflow.steps[2].providerPostconditions.some((condition) => condition.kind === "stateful-surface-proof"), true);
  assert.equal(
    ignored.some((entry) =>
      entry.candidateId === "cn1" &&
      entry.ignoredText === "Satellite" &&
      entry.reason === "provider-primer-evidence-only"
    ),
    true
  );
});

test("compile keeps visible provider proxy primer as a replay step", () => {
  const runId = `compile-step-ledger-provider-proxy-visible-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather Map", timestamp: 900 },
    {
      type: "click",
      actionKind: "interactive",
      isTrusted: true,
      selector: "button",
      text: "Satellite",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Satellite",
        structuralKey: "div>div|button|type=button|map_depth_button.type_sat|Satellite",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["Satellite"],
        neighborTexts: ["Radar", "Rain"],
        box: { cx: 40, cy: 60, w: 80, h: 32 }
      },
      targetVisibility: { hasVisibleBox: true }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" }
      ],
      afterSkeleton: [
        { role: "button", name: "Video Satellite", structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite" },
        { role: "button", name: "Rain", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "Video Satellite",
      role: "button",
      url: MAP_URL,
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Video Satellite",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|Video Satellite",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["Video", "Satellite"],
        neighborTexts: ["SatelliteRadarRain"]
      }
    },
    {
      type: "click",
      selector: "button",
      text: "Rain",
      role: "button",
      url: MAP_URL,
      timestamp: 1200,
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "Rain",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|Rain",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["Rain"],
        neighborTexts: ["Satellite", "Radar"]
      }
    }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    captureMode: "normal",
    startUrl: MAP_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, [
    {
      url: "https://weather.example.test/choiceApi/api?choiceQuery=%7B%22visualMapSrmImage%22%3A%7B%22photoType%22%3A%22maple%22%7D%7D",
      method: "GET",
      status: 200,
      timestamp: 1220
    }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "Weather map", url: MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        reason: "implementation-noop",
        summary: "visible same-surface state primer before trusted carrier",
        evidenceRole: "provider-proxy-before-trusted-action",
        linkedTrustedAction: {
          eventIndex: 3,
          actionSeq: 1002,
          text: "Video Satellite",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer"
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "keep" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Satellite", "Video Satellite", "Rain"]);
  assert.equal(workflow.steps[1].providerContext.controlGroup, "visual-layer");
});

test("compile excludes kept provider timeline auto evidence from replay", () => {
  const runId = `compile-step-ledger-timeline-auto-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather Map", timestamp: 900 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      selector: "button",
      text: "일시정지",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "일시정지",
        structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지",
        neighborTexts: ["과거", "재생"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "일시정지", structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지" }
      ],
      afterSkeleton: [
        { role: "button", name: "재생", structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play|재생" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "영상 위성",
      role: "button",
      url: MAP_URL,
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
        neighborTexts: ["위성레이더강수예측"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1160,
      beforeSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" }
      ],
      afterSkeleton: [
        { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "강수예측",
      role: "button",
      url: MAP_URL,
      timestamp: 1200,
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
        neighborTexts: ["위성", "레이더"]
      }
    }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    captureMode: "normal",
    startUrl: MAP_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "NAVER 날씨", url: MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        reason: "implementation-noise",
        summary: "provider timeline auto control should not replay as a user workflow step",
        evidenceRole: "provider-timeline-auto",
        linkedTrustedAction: {
          eventIndex: 3,
          actionSeq: 1002,
          text: "영상 위성"
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "timeline",
          confidence: "medium"
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "keep" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);

  assert.deepEqual(clickTexts, ["영상 위성", "강수예측"]);
  assert.equal(
    ignored.some((entry) =>
      entry.candidateId === "cn1" &&
      entry.ignoredText === "일시정지" &&
      entry.reason === "user-kept-nonreplayable-provider-timeline-auto"
    ),
    true
  );
});

test("compile exclusion removes reviewed provider noise from protected base before replay eligibility", () => {
  const runId = `compile-step-ledger-excluded-protected-provider-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather Map", timestamp: 900 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      selector: "button",
      text: "일시정지",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "일시정지",
        structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지",
        neighborTexts: ["영상 위성"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1001,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "일시정지", structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지" }
      ],
      afterSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "영상 위성",
      role: "button",
      url: MAP_URL,
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
        neighborTexts: ["위성레이더강수예측"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 1002,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1160,
      beforeSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" }
      ],
      afterSkeleton: [
        { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
      ]
    },
    {
      type: "click",
      selector: "button",
      text: "강수예측",
      role: "button",
      url: MAP_URL,
      timestamp: 1200,
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc-map",
      locator: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측"
      }
    }
  ];

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    captureMode: "normal",
    startUrl: MAP_URL
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "NAVER 날씨", url: MAP_URL }]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        recommendedAction: "exclude",
        reason: "implementation-noise",
        summary: "provider timeline auto control should not replay as a user workflow step",
        evidenceRole: "provider-timeline-auto",
        linkedTrustedAction: {
          eventIndex: 3,
          actionSeq: 1002,
          text: "영상 위성"
        },
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
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);

  assert.deepEqual(clickTexts, ["영상 위성", "강수예측"]);
  assert.equal(
    ignored.some((entry) =>
      entry.candidateId === "cn1" &&
      entry.ignoredText === "일시정지" &&
      entry.reason === "user-excluded-implementation-layer-click"
    ),
    true
  );
});
