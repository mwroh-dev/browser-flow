import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS, pickByOrdinal } from "../../scripts/lib/resolver-score.mjs";

// method B = morph-resilient resolution. When an element morphs
// (empty p[role=presentation] → filled div[role=textbox]), its role AND
// structuralKey flip. Under default weights structuralKey is STABLE-tier (in the
// confidence mass gate), so the morph drops the correct candidate below the mass
// floor → drift-hold. Method B down-weights role→0 and structuralKey→0.25 (below
// STABLE_TIER), removing them from the gate so the boundary anchor (neighborTexts)
// carries the identity across the morph. The confidence gate still applies (fail-safe).

const TARGET = {
  role: "presentation",                       // pre-morph role
  structuralKey: "div>p|p|role=presentation||", // pre-morph structure
  neighborTexts: ["메모 작성…"],               // stable boundary anchor (survives morph)
  box: { cx: 100, cy: 100, w: 200, h: 20 },
  viewport: { w: 1000, h: 1000 }
};
const CANDIDATES = [
  // the SAME logical element, post-morph: role + structuralKey both changed.
  { role: "textbox", structuralKey: "div>div|div|role=textbox|IZ65Hb", neighborTexts: ["메모 작성…"], box: { cx: 101, cy: 100, w: 200, h: 21 } },
  // an unrelated distractor.
  { role: "button", structuralKey: "nav>button|button||", neighborTexts: ["다른 메뉴"], box: { cx: 820, cy: 40, w: 40, h: 20 } }
];

test("default weights drift-hold on a morphed element (structuralKey gate)", () => {
  const scored = scoreCandidates(TARGET, CANDIDATES, DEFAULT_WEIGHTS, { w: 1000, h: 1000 });
  const d = decideConfidence(scored, { weights: DEFAULT_WEIGHTS });
  assert.equal(d.confidence, "low", "default weights must NOT confidently resolve the morphed element");
  assert.equal(d.pick, -1);
});

test("method-B weights resolve the morphed element via the boundary anchor", () => {
  const weightsB = { ...DEFAULT_WEIGHTS, role: 0, structuralKey: 0.25 };
  const scored = scoreCandidates(TARGET, CANDIDATES, weightsB, { w: 1000, h: 1000 });
  const d = decideConfidence(scored, { weights: weightsB });
  assert.equal(d.confidence, "high", "method-B weights must resolve across the morph");
  assert.equal(d.pick, 0, "must pick the morphed body (candidate 0), not the distractor");
});

test("method-B stays fail-safe — no anchor + morph → still drift-hold", () => {
  // Anonymous + morphed + no matching anchor anywhere → method B must NOT guess.
  const anonTarget = { role: "presentation", structuralKey: "k-old", box: { cx: 100, cy: 100, w: 10, h: 10 }, viewport: { w: 1000, h: 1000 } };
  const anonCands = [
    { role: "textbox", structuralKey: "k-a", box: { cx: 400, cy: 400, w: 10, h: 10 } },
    { role: "textbox", structuralKey: "k-b", box: { cx: 410, cy: 400, w: 10, h: 10 } }
  ];
  const weightsB = { ...DEFAULT_WEIGHTS, role: 0, structuralKey: 0.25 };
  const d = decideConfidence(scoreCandidates(anonTarget, anonCands, weightsB, { w: 1000, h: 1000 }), { weights: weightsB });
  assert.equal(d.confidence, "low", "method B must drift-hold when nothing distinguishes the candidates");
});

// ordinal tie-break — N identical/anonymous candidates that tie
// on score are disambiguated by the recorded same-key ordinal (DOM order).
test("pickByOrdinal selects the recorded ordinal among tied identical candidates", () => {
  const scored = [{ score: 0.9 }, { score: 0.9 }, { score: 0.9 }, { score: 0.3 }];
  const candidates = [
    { i: 20, signals: { structuralKey: "K" } },
    { i: 5, signals: { structuralKey: "K" } },
    { i: 12, signals: { structuralKey: "K" } },
    { i: 2, signals: { structuralKey: "OTHER" } }
  ];
  // DOM order among key "K": i=5 (ord0), i=12 (ord1), i=20 (ord2).
  assert.equal(pickByOrdinal(scored, candidates, "K", 0), 1, "ordinal 0 → lowest DOM index (i=5)");
  assert.equal(pickByOrdinal(scored, candidates, "K", 1), 2, "ordinal 1 → i=12");
  assert.equal(pickByOrdinal(scored, candidates, "K", 2), 0, "ordinal 2 → i=20");
  assert.equal(pickByOrdinal(scored, candidates, "K", 3), -1, "out-of-range ordinal → no pick (fail-safe)");
});

test("pickByOrdinal returns -1 when there is no real tie group (nothing to disambiguate)", () => {
  const scored = [{ score: 0.9 }, { score: 0.4 }];
  const candidates = [{ i: 1, signals: { structuralKey: "K" } }, { i: 2, signals: { structuralKey: "K" } }];
  assert.equal(pickByOrdinal(scored, candidates, "K", 0), -1);
});
