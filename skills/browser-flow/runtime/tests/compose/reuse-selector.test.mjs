import test from "node:test";
import assert from "node:assert/strict";
import { buildComposeCandidateIndex } from "../../scripts/compose/candidate-index.mjs";
import { selectReusablePrefix } from "../../scripts/compose/reuse-selector.mjs";

test("buildComposeCandidateIndex indexes workflow segments and preserves candidate sources", () => {
  const registry = [{ id: "known-workflow" }];
  const pageGraph = [{ pageKey: "example/page" }];
  const result = buildComposeCandidateIndex({
    workflow: {
      segments: [
        { name: "root", reusable: true },
        { name: "market", reusable: true }
      ]
    },
    registry,
    pageGraph
  });

  assert.deepEqual(result.segments, [
    { index: 0, name: "root", reusable: true },
    { index: 1, name: "market", reusable: true }
  ]);
  assert.equal(result.registry, registry);
  assert.equal(result.pageGraph, pageGraph);
});

test("buildComposeCandidateIndex returns empty segments when workflow is missing or malformed", () => {
  assert.deepEqual(buildComposeCandidateIndex({}).segments, []);
  assert.deepEqual(buildComposeCandidateIndex({ workflow: null }).segments, []);
  assert.deepEqual(buildComposeCandidateIndex({ workflow: { segments: "not-an-array" } }).segments, []);
});

test("buildComposeCandidateIndex normalizes incoming segment indexes", () => {
  const result = buildComposeCandidateIndex({
    workflow: {
      segments: [{ index: 99, name: "x" }]
    }
  });

  assert.equal(result.segments[0].index, 0);
});

test("selectReusablePrefix prefers the longest valid prefix", () => {
  const result = selectReusablePrefix({
    segments: [
      { index: 0, name: "root", reusable: true },
      { index: 1, name: "market", reusable: true },
      { index: 2, name: "news", reusable: false }
    ]
  });

  assert.equal(result.reusedUntilSegment, 1);
  assert.equal(result.gapStartsAtSegment, 2);
});

test("selectReusablePrefix uses array position when segment index is missing", () => {
  const result = selectReusablePrefix({
    segments: [
      { name: "root", reusable: true },
      { name: "market", reusable: true },
      { name: "news", reusable: false }
    ]
  });

  assert.equal(result.reusedUntilSegment, 1);
  assert.equal(result.gapStartsAtSegment, 2);
});

test("selectReusablePrefix reports no gap when every segment is reusable", () => {
  const result = selectReusablePrefix({
    segments: [
      { index: 0, reusable: true },
      { index: 1, reusable: true },
      { index: 2, reusable: true }
    ]
  });

  assert.equal(result.reusedUntilSegment, 2);
  assert.equal(result.gapStartsAtSegment, null);
});
