import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStepLedger,
  protectedEventIndexesFromStepLedger
} from "../../scripts/analyze/step-ledger.mjs";

const MAP_URL = "https://weather.naver.com/map/09740660";

function parentVideoClick() {
  return {
    type: "click",
    selector: "button",
    text: "영상 위성",
    role: "button",
    url: MAP_URL,
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1001,
      captureWindowId: "cw-doc-map-1",
      documentId: "doc-map",
      tabOrdinal: 0,
    locator: {
      role: "button",
      name: "영상 위성",
      structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
      identityKey: "div>div|button|type=button|map_item_button|carrier",
      identityShape: "div>div|button|type=button|map_item_button|",
      controlKind: "carrier",
      textParts: ["영상", "위성"],
      neighborTexts: ["위성레이더강수예측"],
      box: { cx: 1149, cy: 198, w: 42, h: 46 }
    }
  };
}

function parentVideoDiff(settleStatus = "settled") {
  return {
    type: "action-diff",
    refType: "click",
    actionId: "a1",
    actionSeq: 1001,
    captureWindowId: "cw-doc-map-1",
    documentId: "doc-map",
    settleStatus,
    timestamp: 1040,
    beforeSkeleton: [
      { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" }
    ],
    afterSkeleton: [
      { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" },
      { role: "main", name: "예보 영상 위성 레이더 강수예측 관측", structuralKey: "body>div|div|role=main||예보 영상 위성 레이더 강수예측 관측" },
      { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
    ]
  };
}

function childRainClick(timestamp = 1100) {
  return {
    type: "click",
    selector: "button",
    text: "강수예측",
    role: "button",
    url: MAP_URL,
    timestamp,
    actionId: "a2",
    actionSeq: 1002,
    captureWindowId: "cw-doc-map-2",
    documentId: "doc-map",
    tabOrdinal: 0,
    locator: {
      role: "button",
      name: "강수예측",
      structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
      identityKey: "div>div|button|type=button|map_depth_button|option",
      identityShape: "div>div|button|type=button|map_depth_button|",
      controlKind: "option",
      textParts: ["강수예측"],
      neighborTexts: ["위성", "레이더"],
      box: { cx: 1150, cy: 300, w: 62, h: 32 }
    }
  };
}

function childRainDiff() {
  return {
    type: "action-diff",
    refType: "click",
    actionId: "a2",
    actionSeq: 1002,
    captureWindowId: "cw-doc-map-2",
    documentId: "doc-map",
    settleStatus: "settled",
    timestamp: 1160,
    beforeSkeleton: [
      { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" },
      { role: "button", name: "강수예측", structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측" }
    ],
    afterSkeleton: [
      { role: "button", name: "영상 강수예측", structuralKey: "div>div|button|type=button|map_item_button.type_maple|영상 강수예측" },
      { role: "button", name: "강수예측 선택됨", structuralKey: "div>div|button|type=button|map_depth_button.type_maple.is_selected|강수예측" }
    ]
  };
}

test("step ledger links layered parent opener to the child control it reveals", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    parentVideoClick(),
    parentVideoDiff(),
    childRainClick(),
    childRainDiff()
  ];
  const networkSummary = [
    {
      type: "network.request",
      url: "https://weather.naver.com/choiceApi/api?choiceQuery=%7B%22visualMapSrmImage%22%3A%7B%22photoType%22%3A%22maple%22%7D%7D",
      method: "GET",
      status: 0,
      timestamp: 1119
    },
    {
      type: "network.response",
      url: "https://weather.naver.com/choiceApi/api?choiceQuery=%7B%22visualMapSrmImage%22%3A%7B%22photoType%22%3A%22maple%22%7D%7D",
      method: "GET",
      status: 200,
      timestamp: 1120
    }
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary,
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps.length, 2);
  assert.equal(ledger.steps[0].action.text, "영상 위성");
  assert.equal(ledger.steps[1].action.text, "강수예측");
  assert.equal(ledger.steps[0].providerContext.controlGroup, "visual-layer");
  assert.equal(ledger.steps[0].postcondition.kind, "reveals-next-action");
  assert.equal(ledger.steps[0].postcondition.target.name, "강수예측");
  assert.equal(ledger.steps[0].postcondition.target.role, "button");
  assert.equal(ledger.steps[0].providerPostconditions[0].kind, "reveals-next-action");
  assert.equal(ledger.steps[1].preconditions[0].kind, "previous-step-postcondition");
  assert.equal(ledger.steps[1].preconditions[0].previousActionSeq, 1001);
  assert.equal(ledger.steps[1].networkDelta.length, 2);
  assert.match(ledger.steps[1].networkDelta[0].url, /maple/);
  assert.equal(ledger.steps[1].providerPostconditions[0].kind, "stateful-surface-proof");
  assert.equal(ledger.steps[1].providerPostconditions[0].control.name, "강수예측");
  assert.equal(ledger.steps[1].providerPostconditions[0].control.controlKind, "option");
  assert.equal(ledger.steps[1].providerPostconditions[0].control.identityShape, "div>div|button|type=button|map_depth_button|");
  assert.deepEqual(ledger.steps[1].providerPostconditions[0].control.textParts, ["강수예측"]);
  assert.equal(ledger.steps[1].providerPostconditions[0].resources.mode, "family-one-of");
  assert.deepEqual(
    ledger.steps[1].providerPostconditions[0].resources.candidates.map((candidate) => candidate.query).filter(Boolean),
    [[{ key: "photoType", value: "maple" }]]
  );
  assert.equal(ledger.steps[1].providerPostconditions.some((condition) => condition.kind === "rendered-surface-proof"), false);
  assert.deepEqual(protectedEventIndexesFromStepLedger(ledger), [1]);
});

test("step ledger does not use aggregate container text as a concrete button reveal target", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    parentVideoClick(),
    {
      ...parentVideoDiff(),
      afterSkeleton: [
        { role: "button", name: "영상 위성", structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성" },
        { role: "main", name: "예보 영상 위성 레이더 강수예측 관측", structuralKey: "body>div|div|role=main||예보 영상 위성 레이더 강수예측 관측" }
      ]
    },
    childRainClick(),
    childRainDiff()
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [],
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps[0].postcondition.kind, "none");
  assert.equal(ledger.steps[0].providerPostconditions.some((condition) => condition.kind === "reveals-next-action"), false);
  assert.equal(ledger.steps[1].preconditions.length, 0);
});

test("step ledger can use exact-name interactive reveal evidence when structural shape is unavailable", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    parentVideoClick(),
    {
      ...parentVideoDiff(),
      afterSkeleton: [
        { role: "main", name: "예보 영상 위성 레이더 강수예측 관측", structuralKey: "body>div|div|role=main||예보 영상 위성 레이더 강수예측 관측" },
        { role: "button", name: "강수예측", structuralKey: "" }
      ]
    },
    childRainClick(),
    childRainDiff()
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [],
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps[0].postcondition.kind, "reveals-next-action");
  assert.equal(ledger.steps[0].postcondition.target.role, "button");
  assert.equal(ledger.steps[0].postcondition.target.name, "강수예측");
});

test("step ledger preserves text containment reveal fallback for legacy weak targets", () => {
  const events = [
    { type: "navigate", url: "https://app.example.test", text: "App", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "Open details",
      role: "button",
      url: "https://app.example.test",
      timestamp: 1000,
      actionId: "open",
      actionSeq: 1,
      captureWindowId: "cw-open",
      documentId: "doc-open",
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "Open details",
        structuralKey: "main|button|type=button|details|Open details"
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "open",
      actionSeq: 1,
      captureWindowId: "cw-open",
      documentId: "doc-open",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [],
      afterSkeleton: [
        { role: "region", name: "Revenue details panel", structuralKey: "main|section|role=region|panel|Revenue details panel" }
      ]
    },
    {
      type: "click",
      selector: "div",
      text: "Revenue",
      role: "",
      url: "https://app.example.test",
      timestamp: 1100,
      actionId: "legacy",
      actionSeq: 2,
      captureWindowId: "cw-legacy",
      documentId: "doc-open",
      tabOrdinal: 0
    }
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [],
    fixture: "manual",
    firstNavigate: "https://app.example.test",
    captureMode: "normal"
  }));

  assert.equal(ledger.steps[0].postcondition.kind, "reveals-next-action");
  assert.equal(ledger.steps[0].postcondition.target.name, "Revenue details panel");
});

test("step ledger derives generic stateful surface resource families from capture evidence", () => {
  const events = [
    { type: "navigate", url: "https://app.example.test/dashboard", text: "Dashboard", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "Revenue",
      role: "button",
      url: "https://app.example.test/dashboard",
      timestamp: 1000,
      actionId: "metric-1",
      actionSeq: 2001,
      captureWindowId: "cw-generic-1",
      documentId: "doc-generic",
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "Revenue",
        structuralKey: "section>div|button|type=button|metric_button.metric_revenue|Revenue",
        neighborTexts: ["Users", "Revenue", "Retention"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "metric-1",
      actionSeq: 2001,
      captureWindowId: "cw-generic-1",
      documentId: "doc-generic",
      settleStatus: "settled",
      timestamp: 1060,
      beforeSkeleton: [
        { role: "button", name: "Users 선택됨", structuralKey: "section>div|button|type=button|metric_button.is-selected.metric_users|Users" },
        { role: "button", name: "Revenue", structuralKey: "section>div|button|type=button|metric_button.metric_revenue|Revenue" }
      ],
      afterSkeleton: [
        { role: "button", name: "Users", structuralKey: "section>div|button|type=button|metric_button.metric_users|Users" },
        { role: "button", name: "Revenue 선택됨", structuralKey: "section>div|button|type=button|metric_button.is-selected.metric_revenue|Revenue" },
        { role: "img", name: "Revenue chart", structuralKey: "section>div|img||chart_surface|Revenue chart" }
      ]
    }
  ];
  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [
      {
        type: "network.response",
        url: "https://cdn.example.test/assets/charts/revenue_20260603.png",
        method: "GET",
        status: 200,
        timestamp: 1010
      },
      {
        type: "network.response",
        url: "https://api.example.test/data?metric=revenue&range=1d",
        method: "GET",
        status: 200,
        timestamp: 1020
      }
    ],
    fixture: "manual",
    firstNavigate: "https://app.example.test/dashboard",
    captureMode: "normal"
  }));

  const proof = ledger.steps[0].providerPostconditions.find((condition) => condition.kind === "stateful-surface-proof");
  assert.equal(proof.control.name, "Revenue");
  assert.deepEqual(proof.control.states, ["aria-selected", "aria-pressed", "checked", "aria-current", "selected", "class:is-selected", "class:active", "class:on"]);
  assert.equal(proof.surface.changed, true);
  assert.deepEqual(proof.resources.candidates, [
    {
      method: "GET",
      status: 200,
      host: "cdn.example.test",
      pathPrefix: "/assets/charts/",
      filePrefix: "revenue_"
    },
    {
      method: "GET",
      status: 200,
      host: "api.example.test",
      pathPrefix: "/data",
      query: [{ key: "metric", value: "revenue" }]
    }
  ]);
});

test("step ledger does not reuse an already-proven surface resource family as a later proof", () => {
  const events = [
    { type: "navigate", url: "https://app.example.test/dashboard", text: "Dashboard", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "Map",
      role: "button",
      url: "https://app.example.test/dashboard",
      timestamp: 1000,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-dashboard",
      locator: {
        role: "button",
        name: "Map",
        structuralKey: "div>button|button|layer_button.type_map|Map",
        neighborTexts: ["Map Chart"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-dashboard",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [{ role: "button", name: "Map", structuralKey: "div>button|button|layer_button.type_map|Map" }],
      afterSkeleton: [{ role: "button", name: "Map", structuralKey: "div>button|button|layer_button.type_map|Map" }]
    },
    {
      type: "click",
      selector: "button",
      text: "Map Video",
      role: "button",
      url: "https://app.example.test/dashboard",
      timestamp: 1100,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-dashboard",
      locator: {
        role: "button",
        name: "Map Video",
        structuralKey: "div>button|button|layer_button.type_map|Map Video",
        neighborTexts: ["Map Chart"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-dashboard",
      settleStatus: "settled",
      timestamp: 1140,
      beforeSkeleton: [{ role: "button", name: "Map Video", structuralKey: "div>button|button|layer_button.type_map|Map Video" }],
      afterSkeleton: [{ role: "button", name: "Map Video", structuralKey: "div>button|button|layer_button.type_map|Map Video" }]
    }
  ];
  const networkSummary = [
    {
      url: "https://cdn.example.test/assets/maps/map_20260604.png",
      method: "GET",
      status: 200,
      timestamp: 1010
    },
    {
      url: "https://cdn.example.test/assets/maps/map_20260604.png",
      method: "GET",
      status: 200,
      timestamp: 1110
    }
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary,
    fixture: "manual",
    firstNavigate: "https://app.example.test/dashboard",
    captureMode: "normal"
  }));

  const firstProof = ledger.steps[0].providerPostconditions.find((condition) => condition.kind === "stateful-surface-proof");
  assert.ok(firstProof);
  assert.deepEqual(firstProof.resources.candidates, [
    {
      method: "GET",
      status: 200,
      host: "cdn.example.test",
      pathPrefix: "/assets/maps/",
      filePrefix: "map_"
    }
  ]);
  assert.equal(
    ledger.steps[1].providerPostconditions.some((condition) => condition.kind === "stateful-surface-proof"),
    false
  );
});

test("step ledger does not require stateful surface proof for transient timeline controls", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "일시정지",
      role: "button",
      url: MAP_URL,
      timestamp: 1000,
      actionId: "timeline-1",
      actionSeq: 3001,
      captureWindowId: "cw-timeline-1",
      documentId: "doc-map",
      tabOrdinal: 0,
      locator: {
        role: "button",
        name: "일시정지",
        structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지",
        neighborTexts: ["00:10", "00:20"]
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "timeline-1",
      actionSeq: 3001,
      captureWindowId: "cw-timeline-1",
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1040,
      beforeSkeleton: [
        { role: "button", name: "일시정지", structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play.clicked|일시정지" }
      ],
      afterSkeleton: [
        { role: "button", name: "재생", structuralKey: "div>div|button|type=button|_playBtn.btn.btn_play|재생" }
      ]
    }
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [
      {
        type: "network.response",
        url: "https://static.example.test/frames/timeline_202606030010.png",
        method: "GET",
        status: 200,
        timestamp: 1010
      }
    ],
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps[0].providerContext.controlGroup, "timeline");
  assert.deepEqual(ledger.steps[0].providerPostconditions, []);
});

test("step ledger joins late enrichment by captureWindowId and isolates orphan evidence", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    parentVideoClick(),
    childRainClick(1020),
    parentVideoDiff("interrupted"),
    childRainDiff()
  ];
  const journalEvents = [
    {
      type: "action-enrichment",
      kind: "enrichment",
      lane: "snapshot-enrichment",
      stage: "after",
      captureWindowId: "cw-doc-map-1",
      actionSeq: 1001,
      documentId: "doc-map",
      tabOrdinal: 0,
      timestamp: 1150,
      timestampMonotonic: 1150.5,
      affordances: [
        { role: "button", name: "강수예측", structuralKey: "button|map_depth_button.type_maple|강수예측" }
      ],
      providerHints: [
        { pattern: "layered-control-surface", controlGroup: "visual-layer", confidence: "high" }
      ],
      mutationBatch: [
        { kind: "child-list", target: "weather-map-controls", added: 1, removed: 0 }
      ]
    },
    {
      type: "action-enrichment",
      kind: "enrichment",
      lane: "snapshot-enrichment",
      stage: "after",
      timestamp: 1170,
      affordances: [
        { role: "button", name: "unjoined", structuralKey: "button|unjoined" }
      ]
    }
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    journalEvents,
    networkSummary: [],
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps[0].after.enrichment.length, 1);
  assert.equal(ledger.steps[0].after.enrichment[0].affordances[0].name, "강수예측");
  assert.equal(ledger.steps[0].mutationDelta[0].target, "weather-map-controls");
  assert.equal(ledger.steps[0].providerPostconditions[0].kind, "reveals-next-action");
  assert.equal(ledger.orphanEvidence.length, 1);
  assert.equal(ledger.orphanEvidence[0].reason, "missing-correlation-key");
});

test("step ledger marks interrupted rapid chains without losing parent child causality", () => {
  const events = [
    { type: "navigate", url: MAP_URL, text: "NAVER Weather", timestamp: 900 },
    parentVideoClick(),
    childRainClick(1020),
    parentVideoDiff("interrupted"),
    childRainDiff()
  ];

  const ledger = /** @type {any} */ (buildStepLedger({
    events,
    networkSummary: [],
    fixture: "manual",
    firstNavigate: MAP_URL,
    captureMode: "normal"
  }));

  assert.equal(ledger.steps.length, 2);
  assert.equal(ledger.steps[0].timing, "fast-chain");
  assert.equal(ledger.steps[0].postcondition.kind, "reveals-next-action");
  assert.equal(ledger.steps[1].preconditions[0].previousActionSeq, 1001);
});
