import test from "node:test";
import assert from "node:assert/strict";

import { buildComposeProjectedView } from "../../scripts/compose/projected-view.mjs";

test("buildComposeProjectedView keeps only role-scoped compose fields", () => {
  const request = {
    intent: "compose a workflow from reusable segments",
    target: "search then extract"
  };

  const workflow = {
    id: "wf-compose-1",
    inputs: [{ name: "query", kind: "text" }],
    segments: [{ id: "search" }, { id: "extract" }],
    compounds: [{ kind: "reveal-select", range: [1, 2] }],
    workflowGraph: { edges: [{ kind: "reveal", fromStepIndex: 1, toStepIndex: 2 }] },
    steps: [
      { action: "goto" },
      {
        action: "click",
        surfaceContext: {
          kind: "weather",
          surfaceKey: "forecast-map",
          controlGroup: "map-layer-toggle"
        }
      }
    ],
    history: [{ phase: "capture" }, { phase: "verify" }],
    rawTrace: { eventsPath: "artifacts/runs/r-1/raw/events.jsonl" },
    tracePointers: ["artifacts/runs/r-1/raw/trace.zip"]
  };

  const pageGraphSummary = {
    pageKey: "search-results",
    nodes: [{ structuralKey: "main>list" }]
  };

  const registrySummary = [{ workflowId: "existing-flow", segments: ["search"] }];

  assert.deepEqual(
    buildComposeProjectedView({ request, workflow, pageGraphSummary, registrySummary }),
    {
      schemaVersion: 1,
      request,
      workflowSummary: {
        id: "wf-compose-1",
        inputs: [{ name: "query", kind: "text" }],
        segments: [{ id: "search" }, { id: "extract" }],
        compounds: [{ kind: "reveal-select", range: [1, 2] }],
        workflowGraph: { edges: [{ kind: "reveal", fromStepIndex: 1, toStepIndex: 2 }] },
        surfaceContexts: [
          {
            stepIndex: 1,
            kind: "weather",
            surfaceKey: "forecast-map",
            controlGroup: "map-layer-toggle"
          }
        ]
      },
      pageGraphSummary,
      registrySummary
    }
  );
});

test("buildComposeProjectedView excludes workflow history and raw trace pointers", () => {
  const projected = buildComposeProjectedView({
    request: { intent: "compose" },
    workflow: {
      id: "wf-compose-2",
      inputs: [],
      segments: [],
      steps: [{ action: "type" }],
      fullWorkflowSteps: [{ action: "submit" }],
      rawTrace: { eventsPath: "artifacts/raw/events.jsonl" },
      rawTracePointers: ["artifacts/raw/trace.zip"]
    },
    pageGraphSummary: { pageKey: "compose-page" }
  });

  assert.deepEqual(Object.keys(projected).sort(), [
    "pageGraphSummary",
    "registrySummary",
    "request",
    "schemaVersion",
    "workflowSummary"
  ]);
  assert.equal(projected.schemaVersion, 1);
  assert.deepEqual(projected.registrySummary, []);
  assert.deepEqual(
    Object.keys(projected.workflowSummary).sort(),
    ["compounds", "id", "inputs", "segments", "surfaceContexts", "workflowGraph"]
  );
  assert.equal("steps" in projected.workflowSummary, false);
  assert.equal("fullWorkflowSteps" in projected.workflowSummary, false);
  assert.equal("rawTrace" in projected.workflowSummary, false);
  assert.equal("rawTracePointers" in projected.workflowSummary, false);
  assert.deepEqual(projected.workflowSummary.surfaceContexts, []);
});

test("buildComposeProjectedView normalizes missing inputs and segments to bounded arrays", () => {
  const projected = buildComposeProjectedView({
    request: { intent: "compose with sparse scaffold" },
    workflow: {
      id: "wf-compose-3",
      inputs: undefined,
      segments: null,
      history: [{ phase: "capture" }],
      rawTrace: { eventsPath: "artifacts/raw/events.jsonl" }
    },
    pageGraphSummary: { pageKey: "compose-page-2" }
  });

  assert.deepEqual(projected.workflowSummary, {
    id: "wf-compose-3",
    inputs: [],
    segments: [],
    compounds: [],
    surfaceContexts: [],
    workflowGraph: { edges: [] }
  });
});
