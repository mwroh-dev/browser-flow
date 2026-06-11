import { segmentByPageNode } from "../lib/segments.mjs";

function deriveFinalUrl(sourceWorkflow, steps) {
  const lastStep = steps.at(-1);
  if (!lastStep || typeof lastStep !== "object") {
    return sourceWorkflow.finalUrl;
  }
  if (typeof lastStep.expectUrl === "string" && lastStep.expectUrl.length > 0) {
    return lastStep.expectUrl;
  }
  if (typeof lastStep.href === "string" && /^https?:\/\//.test(lastStep.href)) {
    return lastStep.href;
  }
  if (typeof lastStep.url === "string" && lastStep.url.length > 0) {
    return lastStep.url;
  }
  return sourceWorkflow.finalUrl;
}

export function assembleComposedWorkflow({
  sourceWorkflow,
  primaryRunId,
  derivedRunId,
  selectedSteps,
  learnedSteps = []
}) {
  const workflow = structuredClone(sourceWorkflow);
  const steps = structuredClone([...selectedSteps, ...learnedSteps]);
  const finalUrl = deriveFinalUrl(workflow, steps);
  const verification = workflow.verification && typeof workflow.verification === "object"
    ? structuredClone(workflow.verification)
    : undefined;
  if (verification && typeof finalUrl === "string" && finalUrl.length > 0) {
    verification.expectedFinalUrl = finalUrl;
    if (
      verification.expectedNetwork &&
      typeof verification.expectedNetwork === "object" &&
      typeof verification.expectedNetwork.method === "string" &&
      verification.expectedNetwork.method.toUpperCase() === "GET"
    ) {
      // Only update the expectedNetwork URL when the pathname matches the
      // derived finalUrl — a different pathname means a distinct API endpoint
      // that should not be silently overwritten by the new finalUrl.
      const existingNetUrl = typeof verification.expectedNetwork.url === "string"
        ? verification.expectedNetwork.url : "";
      let samePathname = true;
      try {
        samePathname = new URL(existingNetUrl).pathname === new URL(finalUrl).pathname;
      } catch (_) {
        // non-parseable URL — keep conservative default (do not overwrite)
        samePathname = false;
      }
      if (samePathname) {
        verification.expectedNetwork = {
          ...verification.expectedNetwork,
          url: finalUrl
        };
      }
    }
  }
  return {
    ...workflow,
    id: derivedRunId,
    primaryRunId,
    sourceRuns: [primaryRunId],
    finalUrl,
    steps,
    segments: segmentByPageNode({ steps }),
    verification
  };
}
