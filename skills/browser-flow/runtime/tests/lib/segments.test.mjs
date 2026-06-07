import test from "node:test";
import assert from "node:assert/strict";
import { segmentByPageNode } from "../../scripts/lib/segments.mjs";

test("segmentByPageNode returns empty for empty steps", () => {
  assert.deepEqual(segmentByPageNode({ steps: [] }), []);
  assert.deepEqual(segmentByPageNode({}), []);
});

test("segmentByPageNode returns a single segment when all steps share pageKey", () => {
  const workflow = {
    steps: [
      { action: "goto", pageKey: "manual/x.com" },
      { action: "click", pageKey: "manual/x.com" },
      { action: "fill", pageKey: "manual/x.com" }
    ]
  };
  const segments = segmentByPageNode(workflow);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], {
    range: [0, 2],
    startPageKey: "manual/x.com",
    endPageKey: "manual/x.com"
  });
});

test("segmentByPageNode splits at every page-key change", () => {
  const workflow = {
    steps: [
      { action: "goto", pageKey: "manual/x.com" },
      { action: "click", pageKey: "manual/x.com" },
      { action: "click", pageKey: "manual/x.com/notebook/:id" },
      { action: "click", pageKey: "manual/x.com/notebook/:id" },
      { action: "click", pageKey: "manual/x.com" }
    ]
  };
  const segments = segmentByPageNode(workflow);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0].range, [0, 1]);
  assert.equal(segments[0].startPageKey, "manual/x.com");
  assert.deepEqual(segments[1].range, [2, 3]);
  assert.equal(segments[1].startPageKey, "manual/x.com/notebook/:id");
  assert.deepEqual(segments[2].range, [4, 4]);
  assert.equal(segments[2].startPageKey, "manual/x.com");
});

test("segmentByPageNode treats missing pageKey as empty string (lumps unkeyed steps)", () => {
  const workflow = {
    steps: [
      { action: "goto" },
      { action: "click" },
      { action: "click", pageKey: "manual/x.com" }
    ]
  };
  const segments = segmentByPageNode(workflow);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].startPageKey, "");
  assert.equal(segments[1].startPageKey, "manual/x.com");
});

test("segmentByPageNode handles a single step", () => {
  const segments = segmentByPageNode({ steps: [{ action: "goto", pageKey: "manual/x.com" }] });
  assert.deepEqual(segments, [{ range: [0, 0], startPageKey: "manual/x.com", endPageKey: "manual/x.com" }]);
});
