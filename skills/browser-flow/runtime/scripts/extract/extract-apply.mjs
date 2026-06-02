// @ts-check
// Phase NNN: applyExtract — deterministic application of the scraping sub-agent's
// verdict onto a workflow step. Mirror of applyScope: the model produces the
// verdict, this code writes the step.extraction REFERENCE (pageKey + status +
// pagination). The extractor-config BODY itself is persisted separately by
// bf extract --apply (run artifact in Plan 2; knowledge/scraping in Plan 3).

/**
 * @param {Array<Record<string, any>>} steps
 * @param {{ stepIndex?: number, status?: string, pagination?: any, extractorConfig?: any, reason?: string }} scrapeResult
 * @returns {{ applied: boolean, stepIndex: number|undefined, pageKey: string }}
 */
export function applyExtract(steps, scrapeResult) {
  const stepIndex = scrapeResult ? scrapeResult.stepIndex : undefined;
  if (!scrapeResult) return { applied: false, stepIndex, pageKey: "" };
  const step = Array.isArray(steps) && typeof stepIndex === "number" ? steps[stepIndex] : undefined;
  if (!step) return { applied: false, stepIndex, pageKey: "" };

  const pageKey = step.pageKey || "";
  const status = scrapeResult.status === "extracted" ? "extracted" : "no-schema";
  step.extraction = {
    pageKey,
    status,
    pagination: scrapeResult.pagination || { kind: "none" }
  };
  return { applied: status === "extracted", stepIndex, pageKey };
}
