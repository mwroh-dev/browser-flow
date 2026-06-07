import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS, STABLE_TIER } from "../../scripts/lib/resolver-score.mjs";

const viewport = { w: 1000, h: 800 };
const target = { role:"link", name:"지리", structuralKey:"k-anchor", href:"/#지리", neighborTexts:["대한민국 개요"], cleanId:"", type:"", alt:"", relXPath:"//a[1]", box:{cx:10,cy:10}, viewport };
const candAnchor = { ...target };
const candArticle = { role:"link", name:"지리", structuralKey:"k-article", href:"/wiki/지리", neighborTexts:["지리학 문서"], cleanId:"", type:"", alt:"", relXPath:"//a[9]", box:{cx:400,cy:600}, viewport };

test("score-best picks the right same-name candidate via href+neighbor+structuralKey", () => {
  const scored = scoreCandidates(target, [candArticle, candAnchor], DEFAULT_WEIGHTS, viewport);
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "high", d.reason);
  assert.equal(scored[d.pick].cand.structuralKey, "k-anchor");
});

test("tie -> low confidence (fail-safe), no pick", () => {
  const t = { role:"link", name:"X", structuralKey:"k", neighborTexts:["same"], href:"/p" };
  const a = { role:"link", name:"X", structuralKey:"k", neighborTexts:["same"], href:"/p" };
  const scored = scoreCandidates(t, [a, { ...a }], DEFAULT_WEIGHTS, viewport);
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "low");          // identical twins -> margin 0
  assert.equal(d.pick, -1);
});

test("no stable signal present -> low confidence", () => {
  const t = { role:"link", relXPath:"//a[1]", box:{cx:1,cy:1} };  // only weak signals
  const scored = scoreCandidates(t, [{ role:"link", relXPath:"//a[1]", box:{cx:1,cy:1} }], DEFAULT_WEIGHTS, viewport);
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "low");          // decided on weak signals only
});

test("redacted signals are treated as absent (rely on surviving signals like structuralKey)", () => {
  // The 'secret' fixture case: name + neighborTexts redacted by the sanitizer, structuralKey survives.
  const target = { role: "button", name: "<redacted-field>", structuralKey: "btn-key", neighborTexts: ["<redacted-field>"], href: "", type: "button" };
  const cand = { role: "button", name: "Run Secret Flow", structuralKey: "btn-key", neighborTexts: ["Password"], href: "", type: "button" };
  const scored = scoreCandidates(target, [cand], DEFAULT_WEIGHTS, { w: 1000, h: 800 });
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "high", "redacted name/neighbor must not tank confidence — structuralKey carries it: " + d.reason);
  assert.equal(d.pick, 0);
});

test("STABLE_TIER exported = 1.5", () => { assert.equal(STABLE_TIER, 1.5); });

test("mass: default weights keep the 4 stable signals as the mass set (regression)", () => {
  const target = { name: "Talk", structuralKey: "k1" };
  const scored = scoreCandidates(target, [{ name: "Talk", structuralKey: "k1" }], DEFAULT_WEIGHTS);
  const d = decideConfidence(scored);
  assert.equal(d.highWeightMass, 1, `name+structuralKey both 1.0 -> mass 1.0, got ${d.highWeightMass}`);
});

test("mass: weightOverride promotes href into the mass set; brittle structuralKey demoted out", () => {
  const target = { name: "Talk", structuralKey: "stale", href: "/navtab/talk" };
  const cand = { name: "Talk", structuralKey: "live-differs", href: "/navtab/talk" };
  const sib = { name: "Talk", structuralKey: "live-differs", href: "/navtab/home" };

  const dDefault = decideConfidence(scoreCandidates(target, [cand, sib], DEFAULT_WEIGHTS));
  assert.ok(dDefault.highWeightMass < 0.55, `default mass must be sub-threshold, got ${dDefault.highWeightMass}`);
  assert.equal(dDefault.confidence, "low");

  const w = { ...DEFAULT_WEIGHTS, href: 1.5, structuralKey: 0.5 };
  const dOver = decideConfidence(scoreCandidates(target, [cand, sib], w), { weights: w });
  assert.ok(dOver.highWeightMass >= 0.55, `override mass must clear threshold, got ${dOver.highWeightMass}`);
  assert.equal(dOver.confidence, "high");
  assert.equal(dOver.pick, 0, "the /navtab/talk candidate must win");
});

test("hidden zero-box captured target is penalized out of high confidence", () => {
  const hiddenTarget = {
    role: "button",
    name: "Layer A",
    structuralKey: "panel>button|role=button||Layer A",
    box: { cx: 0, cy: 0, w: 0, h: 0 },
    viewport,
    targetVisibility: { hasVisibleBox: false }
  };
  const candidate = {
    role: "button",
    name: "Layer A",
    structuralKey: "panel>button|role=button||Layer A",
    box: { cx: 240, cy: 96, w: 120, h: 32 }
  };

  const scored = scoreCandidates(hiddenTarget, [candidate], DEFAULT_WEIGHTS, viewport);
  const d = decideConfidence(scored);

  assert.equal(d.confidence, "low");
  assert.ok(d.winner < 0.6, `hidden target should not clear winner floor, got ${d.winner}`);
});
