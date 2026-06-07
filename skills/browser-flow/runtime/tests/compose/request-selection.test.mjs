import test from "node:test";
import assert from "node:assert/strict";
import { deriveDeterministicComposeDecision, selectComposeSteps } from "../../scripts/compose/request-selection.mjs";

test("deriveDeterministicComposeDecision omits the last segment for a Korean omit-last request", () => {
  const decision = deriveDeterministicComposeDecision({
    request: "마지막 1개를 빼고 다시 구성해",
    sourceWorkflow: {
      steps: [{ action: "goto" }, { action: "click" }, { action: "click" }],
      segments: [
        { range: [0, 0] },
        { range: [1, 1] },
        { range: [2, 2] }
      ]
    }
  });

  assert.deepEqual(decision.candidateHints, {
    preferredSegments: [0, 1]
  });
});

test("selectComposeSteps selects only preferred segments in source order", () => {
  const { selectedSteps, selectedSegmentIndexes, blockedReason } = selectComposeSteps(
    {
      steps: [
        { action: "goto", text: "a" },
        { action: "click", text: "b" },
        { action: "click", text: "c" }
      ],
      segments: [
        { range: [0, 0] },
        { range: [1, 1] },
        { range: [2, 2] }
      ]
    },
    { candidateHints: { preferredSegments: [0, 1] } }
  );

  assert.equal(blockedReason, null);
  assert.deepEqual(selectedSegmentIndexes, [0, 1]);
  assert.deepEqual(selectedSteps, [
    { action: "goto", text: "a" },
    { action: "click", text: "b" }
  ]);
});

test("selectComposeSteps inserts a goto bridge when selected segments restart from a known page", () => {
  const { selectedSteps, selectedSegmentIndexes, blockedReason } = selectComposeSteps(
    {
      steps: [
        { action: "goto", url: "https://example.com/home", pageKey: "manual/example.com/home" },
        { action: "click", text: "stock", href: "https://example.com/finance", pageKey: "manual/example.com/home" },
        {
          action: "click",
          text: "detail",
          expectUrl: "https://example.com/finance/detail",
          pageKey: "manual/example.com/finance"
        },
        { action: "click", text: "news", pageKey: "manual/example.com/home" }
      ],
      segments: [
        {
          range: [0, 1],
          startPageKey: "manual/example.com/home",
          endPageKey: "manual/example.com/home"
        },
        {
          range: [2, 2],
          startPageKey: "manual/example.com/finance",
          endPageKey: "manual/example.com/finance"
        },
        {
          range: [3, 3],
          startPageKey: "manual/example.com/home",
          endPageKey: "manual/example.com/home"
        }
      ]
    },
    { candidateHints: { preferredSegments: [0, 1, 2] } }
  );

  assert.equal(blockedReason, null);
  assert.deepEqual(selectedSegmentIndexes, [0, 1, 2]);
  assert.deepEqual(selectedSteps, [
    { action: "goto", url: "https://example.com/home", pageKey: "manual/example.com/home" },
    { action: "click", text: "stock", href: "https://example.com/finance", pageKey: "manual/example.com/home" },
    {
      action: "click",
      text: "detail",
      expectUrl: "https://example.com/finance/detail",
      pageKey: "manual/example.com/finance"
    },
    { action: "goto", url: "https://example.com/home", pageKey: "manual/example.com/home" },
    { action: "click", text: "news", pageKey: "manual/example.com/home" }
  ]);
});

test("selectComposeSteps reports graph_disconnect when no bridge goto exists", () => {
  const result = selectComposeSteps(
    {
      steps: [
        { action: "click", text: "stock", pageKey: "manual/example.com/home" },
        { action: "click", text: "detail", pageKey: "manual/example.com/finance" },
        { action: "click", text: "news", pageKey: "manual/example.com/home" }
      ],
      segments: [
        {
          range: [0, 0],
          startPageKey: "manual/example.com/home",
          endPageKey: "manual/example.com/home"
        },
        {
          range: [1, 1],
          startPageKey: "manual/example.com/finance",
          endPageKey: "manual/example.com/finance"
        },
        {
          range: [2, 2],
          startPageKey: "manual/example.com/home",
          endPageKey: "manual/example.com/home"
        }
      ]
    },
    { candidateHints: { preferredSegments: [0, 1, 2] } }
  );

  assert.equal(result.blockedReason, "graph_disconnect");
  assert.deepEqual(result.selectedSegmentIndexes, [0, 1, 2]);
  assert.deepEqual(result.selectedSteps, []);
});
