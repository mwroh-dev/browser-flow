// Phase NNN: golden liveness probe (decision ② of the scraping spec). Pure
// function. Maps raw extractor facts to a 3-state verdict so chained flows
// (A→B) never treat a silently-empty result as valid data
// (direction-maintenance: a consistent empty JSON is a false reliability
// signal). The user's capture is ground truth — `golden` carries the
// known-good cardinality so a structure-intact zero (confident-zero) is
// distinguished from a structure-broken zero (drift).

// >= this fraction drop vs golden cardinality flags a suspicious result as drift.
export const CARDINALITY_DROP_THRESHOLD = 0.5;

/**
 * @param {{ rows: Record<string, unknown>[], cardinality: number, containerResolved: boolean }} extraction
 * @param {{ cardinality?: number }|null|undefined} golden
 * @returns {{ status: "data"|"confident-zero"|"drift", rows: Record<string, unknown>[], reason?: string }}
 */
export function classify(extraction, golden) {
  const { rows, cardinality, containerResolved } = extraction;

  if (cardinality > 0) {
    if (golden && typeof golden.cardinality === "number" && golden.cardinality > 0) {
      const drop = (golden.cardinality - cardinality) / golden.cardinality;
      if (drop >= CARDINALITY_DROP_THRESHOLD) {
        return {
          status: "drift",
          rows,
          reason: `cardinality ${cardinality} dropped >=${CARDINALITY_DROP_THRESHOLD * 100}% from golden ${golden.cardinality}`
        };
      }
    }
    return { status: "data", rows };
  }

  if (containerResolved) {
    return { status: "confident-zero", rows: [] };
  }
  return { status: "drift", rows: [], reason: "container selector resolved 0 elements (structure absent)" };
}
