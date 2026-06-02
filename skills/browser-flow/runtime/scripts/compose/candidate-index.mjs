export function buildComposeCandidateIndex({ workflow, registry = [], pageGraph = [] }) {
  const sourceSegments = Array.isArray(workflow?.segments) ? workflow.segments : [];
  return {
    segments: sourceSegments.map((segment, index) => ({ ...segment, index })),
    registry,
    pageGraph
  };
}
