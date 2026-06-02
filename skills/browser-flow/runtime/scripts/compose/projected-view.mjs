const COMPOSE_PROJECTED_VIEW_SCHEMA_VERSION = 1;

function buildSurfaceContextsSummary(steps) {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.flatMap((step, stepIndex) => {
    const surfaceContext = step?.surfaceContext;
    if (!surfaceContext || typeof surfaceContext !== "object") {
      return [];
    }

    return [{
      stepIndex,
      kind: surfaceContext.kind,
      surfaceKey: surfaceContext.surfaceKey,
      controlGroup: surfaceContext.controlGroup
    }];
  });
}

export function buildComposeProjectedView({
  request,
  workflow,
  pageGraphSummary,
  registrySummary = []
}) {
  return {
    schemaVersion: COMPOSE_PROJECTED_VIEW_SCHEMA_VERSION,
    request,
    workflowSummary: {
      id: workflow.id,
      inputs: Array.isArray(workflow.inputs) ? workflow.inputs : [],
      segments: Array.isArray(workflow.segments) ? workflow.segments : [],
      compounds: Array.isArray(workflow.compounds) ? workflow.compounds : [],
      surfaceContexts: buildSurfaceContextsSummary(workflow.steps),
      workflowGraph: workflow.workflowGraph && typeof workflow.workflowGraph === "object"
        ? workflow.workflowGraph
        : { edges: [] }
    },
    pageGraphSummary,
    registrySummary
  };
}
