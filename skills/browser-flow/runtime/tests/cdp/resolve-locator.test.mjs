// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveLocator } from "../../scripts/cdp/locator-resolver.mjs";
import { withAssembledPackage } from "../helpers/assembled-package.mjs";

/**
 * Builds a fake session whose client.send() returns canned responses keyed by CDP method.
 * Tracks the order of CDP method calls for short-circuit assertions.
 *
 * @param {Record<string, unknown>} responses  method → canned response object
 * @returns {{ session: object, calls: string[] }}
 */
function buildFakeSession(responses) {
  /** @type {string[]} */
  const calls = [];

  const session = {
    sessionManager: {
      /** @param {string} _targetId */
      getSessionId(_targetId) { return "s1"; }
    },
    client: {
      /**
       * @param {string} method
       * @param {Record<string, unknown>} _params
       * @param {string} _sid
       */
      send(method, _params, _sid) {
        calls.push(method);
        if (Object.prototype.hasOwnProperty.call(responses, method)) {
          return Promise.resolve(responses[method]);
        }
        return Promise.reject(new Error(`Unexpected CDP method in fake: ${method}`));
      }
    }
  };

  return { session, calls };
}

// ---------------------------------------------------------------------------
// Scorer path: unambiguous candidate → returns backendNodeId, layerUsed:"score", confidence:"high"
// ---------------------------------------------------------------------------
test("resolveLocator — scorer path: unambiguous candidate returns score+high", async () => {
  // Candidate list: one element that perfectly matches the locator.
  // The scorer needs name (weight 1.5) and structuralKey (weight 1.5) to yield
  // high confidence: winner >= 0.6, margin >= 0.12, highWeightMass >= 0.55.
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "Submit",
        structuralKey: "body>div|button||bg-blue|Submit",
        relXPath: "//div/button",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "",
        alt: "",
        box: { cx: 100, cy: 200, w: 80, h: 30 }
      }
    }
  ];

  const { session, calls } = buildFakeSession({
    // First Runtime.evaluate call: __bfCollectCandidates()
    "Runtime.evaluate": { result: { value: candidates, type: "object" } },
    // Second Runtime.evaluate call: re-resolve winner by DOM index
    // We can't easily stub both calls differently here, so we use a counter approach.
    // Instead we override send to differentiate by call index.
    "DOM.describeNode": { node: { backendNodeId: 11 } }
  });

  // Override send to handle two Runtime.evaluate calls differently.
  let evalCallCount = 0;
  const anySession = /** @type {any} */ (session);
  const origSend = /** @type {Function} */ (anySession.client.send.bind(anySession.client));
  anySession.client.send = /** @param {string} method @param {any} params @param {any} sid */ function(method, params, sid) {
    if (method === "Runtime.evaluate") {
      evalCallCount++;
      if (evalCallCount === 1) {
        calls.push(method);
        return Promise.resolve({ result: { value: candidates, type: "object" } });
      } else {
        calls.push(method);
        return Promise.resolve({ result: { objectId: "obj-winner", type: "object" } });
      }
    }
    return origSend(method, params, sid);
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      locator: {
        role: "button",
        name: "Submit",
        structuralKey: "body>div|button||bg-blue|Submit"
      }
    }
  );

  assert.equal(result.backendNodeId, 11);
  assert.equal(result.layerUsed, "score");
  assert.equal(result.confidence, "high");

  // Must have called Runtime.evaluate twice and DOM.describeNode once.
  assert.equal(calls.filter((c) => c === "Runtime.evaluate").length, 2);
  assert.ok(calls.includes("DOM.describeNode"));
  // Must NOT have called any old rung methods.
  assert.ok(!calls.includes("Accessibility.queryAXTree"), "Accessibility.queryAXTree must not be called");
  assert.ok(!calls.includes("DOM.getNodeForLocation"), "DOM.getNodeForLocation must not be called");
  assert.ok(!calls.includes("DOM.getDocument"), "DOM.getDocument must not be called");
});

test("resolveLocator — JSON candidate transport resolves targets after 400 earlier candidates", async () => {
  const candidates = Array.from({ length: 450 }, (_, i) => ({
    i,
    signals: {
      role: "link",
      name: `Earlier ${i}`,
      structuralKey: `body>nav|a||earlier|Earlier ${i}`,
      identityShape: "body>nav|a||earlier|",
      controlKind: "option",
      relXPath: `//nav/a[${i + 1}]`,
      href: "",
      neighborTexts: [],
      cleanId: "",
      type: "",
      alt: "",
      actionable: true,
      box: { cx: 10, cy: 10, w: 20, h: 20 }
    }
  }));
  candidates.push({
    i: 450,
    signals: {
      role: "button",
      name: "Late Target",
      structuralKey: "main>section|button|type=button|late_target|Late Target",
      identityShape: "main>section|button|type=button|late_target|",
      controlKind: "option",
      relXPath: "//main/section/button",
      href: "",
      neighborTexts: [],
      cleanId: "",
      type: "button",
      alt: "",
      actionable: true,
      box: { cx: 100, cy: 200, w: 80, h: 30 }
    }
  });

  const { session, calls } = buildFakeSession({
    "DOM.describeNode": { node: { backendNodeId: 451 } }
  });
  let evalCallCount = 0;
  const anySession = /** @type {any} */ (session);
  anySession.client.send = /** @param {string} method @param {any} params */ function(method, params) {
    calls.push(method);
    if (method === "Runtime.evaluate") {
      evalCallCount++;
      if (evalCallCount === 1) {
        assert.match(String(params.expression || ""), /JSON\.stringify\(__bfCollectCandidates/);
        return Promise.resolve({ result: { value: JSON.stringify(candidates), type: "string" } });
      }
      assert.match(String(params.expression || ""), /\[450\]/);
      return Promise.resolve({ result: { objectId: "obj-late-target", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 451 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method in fake: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      action: "click",
      locator: {
        role: "button",
        name: "Late Target",
        structuralKey: "main>section|button|type=button|late_target|Late Target",
        identityShape: "main>section|button|type=button|late_target|",
        controlKind: "option"
      }
    }
  );

  assert.equal(result.backendNodeId, 451);
  assert.equal(result.layerUsed, "identity-shape");
  assert.equal(result.confidence, "high");
  assert.equal(calls.filter((call) => call === "Runtime.evaluate").length, 2);
});

test("resolveLocator — malformed JSON candidate transport fails closed", async () => {
  const { session } = buildFakeSession({
    "Runtime.evaluate": { result: { value: "{not-json", type: "string" } }
  });

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        action: "click",
        locator: {
          role: "button",
          name: "Missing",
          structuralKey: "main|button||missing|Missing",
          identityShape: "main|button||missing|",
          controlKind: "option"
        }
      }
    ),
    /resolveLocator: no candidates on page/
  );
});

// ---------------------------------------------------------------------------
// Back-compat: step without rich locator → falls through to atomic-fp
// ---------------------------------------------------------------------------
test("resolveLocator — no rich locator falls through to atomic-fp (selector-fallback)", async () => {
  const { session, calls } = buildFakeSession({
    "DOM.getDocument": { root: { nodeId: 1 } },
    "DOM.querySelector": { nodeId: 5 },
    "DOM.describeNode": { node: { backendNodeId: 77 } }
  });

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    { selector: "button.submit" }
  );

  // layerUsed starts with "atomic-fp:" for the fallback path.
  assert.ok(result.layerUsed.startsWith("atomic-fp:"), `Expected layerUsed to start with "atomic-fp:", got: ${result.layerUsed}`);
  assert.equal(result.confidence, "medium");
  assert.equal(result.backendNodeId, 77);

  // The scorer Runtime.evaluate must NOT have been called (no rich locator → skip scorer).
  assert.ok(!calls.includes("Runtime.evaluate"), "Runtime.evaluate must not be called for atomic-fp path");
});

// ---------------------------------------------------------------------------
// Ambiguous: two similar candidates → resolveLocator THROWS
// ---------------------------------------------------------------------------
test("resolveLocator — ambiguous candidates throw with low-confidence reason", async () => {
  // Two candidates with identical signals → scorer cannot distinguish → low confidence.
  const sharedSignals = {
    role: "button",
    name: "Click",
    structuralKey: "body|button||",
    relXPath: "//button",
    href: "",
    neighborTexts: [],
    cleanId: "",
    type: "",
    alt: "",
    box: { cx: 50, cy: 50, w: 60, h: 24 }
  };
  const candidates = [
    { i: 0, signals: { ...sharedSignals } },
    { i: 1, signals: { ...sharedSignals } }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      { locator: { role: "button", name: "Click", structuralKey: "body|button||" } }
    ),
    (/** @type {Error} */ err) => {
      assert.ok(err.message.includes("ambiguous locator"), `Expected "ambiguous locator" in: ${err.message}`);
      return true;
    }
  );
});

test("resolveLocator — weather-map surfaceContext breaks same-name cross-group ambiguity", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "레이더",
        structuralKey: "div>div|button|type=button|map_depth_button.type_rdr|레이더",
        relXPath: "//div[1]/button",
        href: "",
        neighborTexts: ["위성"],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 80, h: 30 }
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "레이더",
        structuralKey: "div>div|button|type=button|point_overlay_button|레이더",
        relXPath: "//div[2]/button",
        href: "",
        neighborTexts: ["관측"],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 150, cy: 50, w: 80, h: 30 }
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 11 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        locator: {
          role: "button",
          name: "레이더"
        }
      }
    ),
    /ambiguous locator/
  );

  let evalCount = 0;
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) {
        return Promise.resolve({ result: { value: candidates, type: "object" } });
      }
      return Promise.resolve({ result: { objectId: "obj-weather", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 11 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      surfaceContext: {
        kind: "weather-map",
        surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
        controlGroup: "visual-layer"
      },
      locator: {
        role: "button",
        name: "레이더"
      }
    }
  );

  assert.equal(result.backendNodeId, 11);
  assert.equal(result.confidence, "high");

  evalCount = 0;
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) {
        return Promise.resolve({ result: { value: candidates, type: "object" } });
      }
      return Promise.resolve({ result: { objectId: "obj-provider", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 11 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const providerResult = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      providerContext: {
        pattern: "layered-control-surface",
        stateCarrier: "canvas-tile",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
        controlGroup: "visual-layer",
        confidence: "high"
      },
      locator: {
        role: "button",
        name: "레이더"
      }
    }
  );

  assert.equal(providerResult.backendNodeId, 11);
  assert.equal(providerResult.layerUsed, "provider-context");
  assert.equal(providerResult.confidence, "high");
});

test("resolveLocator — carrier replay identity tolerates display-name drift by identityShape", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "영상"],
        relXPath: "//div/button[1]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 42, h: 46 }
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["강수예측"],
        relXPath: "//div/button[2]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 140, cy: 50, w: 80, h: 30 }
      }
    }
  ];

  let evalCount = 0;
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-carrier", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 31 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      providerContext: {
        pattern: "layered-control-surface",
        stateCarrier: "canvas-tile",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
        controlGroup: "visual-layer",
        confidence: "high"
      },
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "위성"]
      }
    }
  );

  assert.equal(result.backendNodeId, 31);
  assert.equal(result.layerUsed, "identity-shape");
  assert.equal(result.confidence, "high");
});

test("resolveLocator — carrier identityShape tolerates live controlKind projection drift", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityKey: "div>div|button|type=button|map_item_button|option",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        textParts: ["영상"],
        relXPath: "//div/button[1]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 42, h: 46 }
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
        identityKey: "div>div|button|type=button|map_depth_button|option",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        textParts: ["강수예측"],
        relXPath: "//div/button[2]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 140, cy: 50, w: 80, h: 30 }
      }
    }
  ];

  let evalCount = 0;
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-carrier", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 33 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      providerContext: {
        pattern: "layered-control-surface",
        stateCarrier: "canvas-tile",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
        controlGroup: "visual-layer",
        confidence: "high"
      },
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "위성"]
      }
    }
  );

  assert.equal(result.backendNodeId, 33);
  assert.equal(result.layerUsed, "identity-shape");
  assert.equal(result.confidence, "high");
});

test("resolveLocator — provider-context click prefers actionable candidate over zero-area same group", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        type: "button",
        box: { cx: 0, cy: 0, w: 0, h: 0 },
        actionable: false,
        display: "flex",
        visibility: "visible",
        pointerEvents: "auto"
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button|영상 위성",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        type: "button",
        box: { cx: 60, cy: 60, w: 48, h: 46 },
        actionable: true,
        display: "flex",
        visibility: "visible",
        pointerEvents: "auto"
      }
    }
  ];

  let evalCount = 0;
  const evalExpressions = [];
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} params @param {any} _sid */ function(method, params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      evalExpressions.push(String(params.expression || ""));
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-actionable", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 41 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      action: "click",
      providerContext: {
        pattern: "layered-control-surface",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
        controlGroup: "visual-layer",
        confidence: "high"
      },
      locator: {
        role: "button",
        name: "영상 위성",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "위성"]
      }
    }
  );

  assert.equal(result.backendNodeId, 41);
  assert.equal(result.layerUsed, "provider-context");
  assert.match(evalExpressions[1], /\[1\]/);
});

test("resolveLocator — identity-shape click prefers actionable candidate over zero-area same identity", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        textParts: ["영상"],
        type: "button",
        box: { cx: 0, cy: 0, w: 0, h: 0 },
        actionable: false
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        textParts: ["영상"],
        type: "button",
        box: { cx: 70, cy: 70, w: 48, h: 46 },
        actionable: true
      }
    }
  ];

  let evalCount = 0;
  const evalExpressions = [];
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} params @param {any} _sid */ function(method, params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      evalExpressions.push(String(params.expression || ""));
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-visible-identity", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 42 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      action: "click",
      providerContext: {
        pattern: "layered-control-surface",
        replayStrategy: "state-proof-click",
        confidence: "high"
      },
      locator: {
        role: "button",
        name: "영상 위성",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "위성"]
      }
    }
  );

  assert.equal(result.backendNodeId, 42);
  assert.equal(result.layerUsed, "identity-shape");
  assert.match(evalExpressions[1], /\[1\]/);
});

test("resolveLocator — all non-actionable click candidates fail closed", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        type: "button",
        box: { cx: 0, cy: 0, w: 0, h: 0 },
        actionable: false
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        action: "click",
        providerContext: {
          pattern: "layered-control-surface",
          replayStrategy: "state-proof-click",
          confidence: "high"
        },
        locator: {
          role: "button",
          name: "영상 위성",
          identityShape: "div>div|button|type=button|map_item_button|",
          controlKind: "carrier",
          textParts: ["영상", "위성"]
        }
      }
    ),
    /not actionable/
  );
});

test("resolveLocator — disabled and pointer-events none click candidates do not win over actionable peers", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "Layer",
        structuralKey: "body|button|type=button|layer|Layer",
        identityShape: "body|button|type=button|layer|",
        controlKind: "carrier",
        type: "button",
        box: { cx: 40, cy: 40, w: 80, h: 30 },
        disabled: true,
        pointerEvents: "auto"
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "Layer",
        structuralKey: "body|button|type=button|layer|Layer",
        identityShape: "body|button|type=button|layer|",
        controlKind: "carrier",
        type: "button",
        box: { cx: 140, cy: 40, w: 80, h: 30 },
        disabled: false,
        pointerEvents: "none"
      }
    },
    {
      i: 2,
      signals: {
        role: "button",
        name: "Layer",
        structuralKey: "body|button|type=button|layer|Layer",
        identityShape: "body|button|type=button|layer|",
        controlKind: "carrier",
        type: "button",
        box: { cx: 240, cy: 40, w: 80, h: 30 },
        disabled: false,
        pointerEvents: "auto"
      }
    }
  ];

  let evalCount = 0;
  const evalExpressions = [];
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} params @param {any} _sid */ function(method, params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      evalExpressions.push(String(params.expression || ""));
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-enabled", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 43 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      action: "click",
      locator: {
        role: "button",
        name: "Layer",
        identityShape: "body|button|type=button|layer|",
        controlKind: "carrier"
      }
    }
  );

  assert.equal(result.backendNodeId, 43);
  assert.match(evalExpressions[1], /\[2\]/);
});

test("resolveLocator — non-click probes keep hidden identity behavior unchanged", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "Hidden",
        structuralKey: "body|button|type=button|hidden|Hidden",
        identityShape: "body|button|type=button|hidden|",
        controlKind: "carrier",
        type: "button",
        box: { cx: 0, cy: 0, w: 0, h: 0 },
        actionable: false
      }
    }
  ];

  let evalCount = 0;
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-hidden-probe", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 44 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      action: "probe",
      locator: {
        role: "button",
        name: "Hidden",
        identityShape: "body|button|type=button|hidden|",
        controlKind: "carrier"
      }
    }
  );

  assert.equal(result.backendNodeId, 44);
  assert.equal(result.layerUsed, "identity-shape");
});

test("resolveLocator — carrier controlKind projection drift requires state-proof context", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityKey: "div>div|button|type=button|map_item_button|option",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        textParts: ["영상"],
        relXPath: "//div/button[1]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 42, h: 46 }
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        locator: {
          role: "button",
          name: "영상 위성",
          structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
          identityKey: "div>div|button|type=button|map_item_button|carrier",
          identityShape: "div>div|button|type=button|map_item_button|",
          controlKind: "carrier",
          textParts: ["영상", "위성"]
        }
      }
    ),
    /ambiguous locator/
  );
});

test("resolveLocator — carrier projection drift rejects different identityShape child option", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button|강수예측",
        identityShape: "div>div|button|type=button|map_depth_button|",
        controlKind: "option",
        type: "button",
        box: { cx: 120, cy: 50, w: 80, h: 30 },
        actionable: true
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        action: "click",
        providerContext: {
          pattern: "layered-control-surface",
          replayStrategy: "state-proof-click",
          confidence: "high"
        },
        locator: {
          role: "button",
          name: "영상 위성",
          identityShape: "div>div|button|type=button|map_item_button|",
          controlKind: "carrier",
          textParts: ["영상", "위성"]
        }
      }
    ),
    /replay identity produced no candidates/
  );
});

test("resolveLocator — multiple actionable same-shape carrier projection drift candidates fail closed", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        type: "button",
        box: { cx: 50, cy: 50, w: 42, h: 46 },
        actionable: true
      }
    },
    {
      i: 1,
      signals: {
        role: "button",
        name: "영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "option",
        type: "button",
        box: { cx: 150, cy: 50, w: 42, h: 46 },
        actionable: true
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        action: "click",
        providerContext: {
          pattern: "layered-control-surface",
          replayStrategy: "state-proof-click",
          confidence: "high"
        },
        locator: {
          role: "button",
          name: "영상 위성",
          structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성",
          identityShape: "div>div|button|type=button|map_item_button|",
          controlKind: "carrier",
          textParts: ["영상", "위성"]
        }
      }
    ),
    /ambiguous locator: carrier projection drift matched multiple candidates/
  );
});

test("resolveLocator — legacy structuralKey derives identityShape for carrier name drift", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        relXPath: "//div/button[1]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 42, h: 46 }
      }
    }
  ];

  let evalCount = 0;
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve({ result: { value: candidates, type: "object" } });
      return Promise.resolve({ result: { objectId: "obj-legacy-carrier", type: "object" } });
    }
    if (method === "DOM.describeNode") {
      return Promise.resolve({ node: { backendNodeId: 32 } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  const result = await resolveLocator(
    /** @type {any} */ (session),
    "target-1",
    {
      locator: {
        role: "button",
        name: "영상 위성",
        structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성"
      }
    }
  );

  assert.equal(result.backendNodeId, 32);
  assert.equal(result.layerUsed, "identity-shape");
  assert.equal(result.confidence, "high");
});

test("resolveLocator — option replay identity cannot resolve to a carrier", async () => {
  const candidates = [
    {
      i: 0,
      signals: {
        role: "button",
        name: "영상 영상",
        structuralKey: "div>div|button|type=button|map_item_button|영상 영상",
        identityKey: "div>div|button|type=button|map_item_button|carrier",
        identityShape: "div>div|button|type=button|map_item_button|",
        controlKind: "carrier",
        textParts: ["영상", "영상"],
        relXPath: "//div/button[1]",
        href: "",
        neighborTexts: [],
        cleanId: "",
        type: "button",
        alt: "",
        box: { cx: 50, cy: 50, w: 42, h: 46 }
      }
    }
  ];

  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: candidates, type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      {
        locator: {
          role: "button",
          name: "강수예측",
          structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측",
          identityKey: "div>div|button|type=button|map_depth_button|option",
          identityShape: "div>div|button|type=button|map_depth_button|",
          controlKind: "option",
          textParts: ["강수예측"]
        }
      }
    ),
    /ambiguous locator/
  );
});

// ---------------------------------------------------------------------------
// Empty candidate list → throws
// ---------------------------------------------------------------------------
test("resolveLocator — empty candidate list throws", async () => {
  const { session } = buildFakeSession({});
  /** @type {any} */ (session).client.send = /** @param {string} method @param {any} _params @param {any} _sid */ function(method, _params, _sid) {
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: [], type: "object" } });
    }
    return Promise.reject(new Error(`Unexpected CDP method: ${method}`));
  };

  await assert.rejects(
    () => resolveLocator(
      /** @type {any} */ (session),
      "target-1",
      { locator: { name: "Submit", structuralKey: "body|button||" } }
    ),
    /no candidates on page/
  );
});

// ---------------------------------------------------------------------------
// No sessionId → throws immediately
// ---------------------------------------------------------------------------
test("resolveLocator — no sessionId throws immediately", async () => {
  const session = {
    sessionManager: { getSessionId: (/** @type {string} */ _targetId) => /** @type {string|null} */ (null) },
    client: { send: (/** @type {any} */ _m, /** @type {any} */ _p, /** @type {any} */ _s) => Promise.reject(new Error("should not be called")) }
  };

  await assert.rejects(
    () => resolveLocator(/** @type {any} */ (session), "target-x", { locator: { name: "X" } }),
    /no sessionId/
  );
});

test("assembled runtime mirrors weather-map surface-aware resolver support", async () => {
  const { readFile } = await import("node:fs/promises");
  await withAssembledPackage(async ({ packageRoot }) => {
    const bundledResolver = await readFile(resolve(packageRoot, "runtime/scripts/cdp/locator-resolver.mjs"), "utf8");
    const bundledCompile = await readFile(resolve(packageRoot, "runtime/scripts/analyze/compile.mjs"), "utf8");
    const bundledSchemas = await readFile(resolve(packageRoot, "runtime/scripts/lib/schemas.mjs"), "utf8");

    assert.match(bundledResolver, /surfaceContext/);
    assert.match(bundledResolver, /weather-map/);
    assert.match(bundledCompile, /deriveSurfaceContextForStep/);
    assert.match(bundledCompile, /workflowGraph/);
    assert.match(bundledSchemas, /surfaceContext/);
    assert.match(bundledSchemas, /weather-map/);
  });
});
