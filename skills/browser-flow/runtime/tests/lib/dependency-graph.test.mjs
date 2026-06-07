import test from "node:test";
import assert from "node:assert/strict";
import { segmentInputs, buildDependencyGraph, affectedByHold } from "../../scripts/lib/dependency-graph.mjs";

const wf = {
  steps: [
    { action: "goto" },
    { action: "fill", valueRef: "{{input.itemName}}" },
    { action: "click" },
    { action: "fill", valueRef: "{{input.itemName}}" },
    { action: "fill", valueRef: "{{input.other}}" }
  ],
  segments: [ { range: [0, 1] }, { range: [2, 2] }, { range: [3, 3] }, { range: [4, 4] } ]
};

test("segmentInputs maps each segment to the inputs it references", () => {
  assert.deepEqual(segmentInputs(wf), [["itemName"], [], ["itemName"], ["other"]]);
});
test("buildDependencyGraph links segments sharing an input binding", () => {
  const g = buildDependencyGraph(wf);
  assert.ok(g.sharesInput(0, 2));
  assert.ok(!g.sharesInput(0, 1));
  assert.ok(!g.sharesInput(0, 3));
});
test("affectedByHold: held seg0 cascades downstream sharing its input (seg2), not independent (seg1, seg3)", () => {
  assert.deepEqual(affectedByHold(wf, 0).sort((a, b) => a - b), [0, 2]);
});
test("affectedByHold: held segment with no inputs affects only itself", () => {
  assert.deepEqual(affectedByHold(wf, 1), [1]);
});
test("tolerates missing segments (single implicit segment)", () => {
  assert.deepEqual(affectedByHold({ steps: [{ action: "goto" }] }, 0), [0]);
});
test("tolerates malformed input", () => {
  assert.deepEqual(segmentInputs({}), []);
  assert.deepEqual(affectedByHold({}, 0), [0]);
});
