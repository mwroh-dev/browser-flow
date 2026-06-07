import test from "node:test";
import assert from "node:assert/strict";
import { assembleComposedWorkflow } from "../../scripts/compose/workflow-assembler.mjs";

test("assembleComposedWorkflow stamps provenance on the derived workflow", () => {
  const sourceWorkflow = {
    id: "r1",
    finalUrl: "https://example.com/done",
    steps: [{ action: "goto", url: "https://example.com/root", pageKey: "root" }],
    verification: {
      expectedFinalUrl: "https://example.com/done",
      expectedNetwork: { url: "https://example.com/done", method: "GET", status: 200 }
    }
  };
  const workflow = assembleComposedWorkflow({
    sourceWorkflow,
    primaryRunId: "r1",
    derivedRunId: "compose-123",
    selectedSteps: sourceWorkflow.steps,
    learnedSteps: [{ action: "click", href: "https://example.com/next", pageKey: "next" }]
  });

  assert.equal(workflow.id, "compose-123");
  assert.equal(workflow.primaryRunId, "r1");
  assert.deepEqual(workflow.sourceRuns, ["r1"]);
  assert.equal(workflow.finalUrl, "https://example.com/next");
  assert.equal(workflow.verification.expectedFinalUrl, "https://example.com/next");
  assert.equal(workflow.verification.expectedNetwork.url, "https://example.com/next");
  assert.deepEqual(workflow.steps, [
    { action: "goto", url: "https://example.com/root", pageKey: "root" },
    { action: "click", href: "https://example.com/next", pageKey: "next" }
  ]);
  assert.deepEqual(workflow.segments, [
    { range: [0, 0], startPageKey: "root", endPageKey: "root" },
    { range: [1, 1], startPageKey: "next", endPageKey: "next" }
  ]);

  workflow.steps[0].action = "mutated";
  workflow.verification.expectedFinalUrl = "/changed";
  assert.deepEqual(sourceWorkflow.steps, [{ action: "goto", url: "https://example.com/root", pageKey: "root" }]);
  assert.deepEqual(sourceWorkflow.verification, {
    expectedFinalUrl: "https://example.com/done",
    expectedNetwork: { url: "https://example.com/done", method: "GET", status: 200 }
  });
});
