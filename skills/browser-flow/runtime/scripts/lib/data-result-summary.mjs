import { SCHEMA_VERSIONS } from "./schema-versions.mjs";

const REPLAY_OUTCOMES = new Set(["passed", "held", "failed"]);
const DATA_MODES = new Set(["extract", "mixed"]);

/**
 * @param {unknown} value
 * @returns {"passed"|"held"|"failed"|"unknown"}
 */
function replayOutcome(value) {
  const verification = /** @type {Record<string, any>|null|undefined} */ (value);
  if (verification && REPLAY_OUTCOMES.has(verification.replayOutcome)) {
    return verification.replayOutcome;
  }
  if (verification?.success === true && verification?.pathComplete === true) {
    return "passed";
  }
  if (typeof verification?.heldAtSegment === "number") {
    return "held";
  }
  if (verification?.success === false || verification?.pathComplete === false) {
    return "failed";
  }
  return "unknown";
}

/**
 * @param {Record<string, any>} extractResult
 * @param {number} rowCount
 * @returns {"data"|"empty"|"drift"|"no_schema"|"unavailable"}
 */
function dataOutcome(extractResult, rowCount) {
  if (extractResult.status === "data" && rowCount > 0) return "data";
  if (extractResult.status === "data" && rowCount === 0) return "empty";
  if (extractResult.status === "confident-zero") return "empty";
  if (extractResult.status === "drift") return "drift";
  if (extractResult.status === "no-schema") return "no_schema";
  return "unavailable";
}

/**
 * @param {"passed"|"held"|"failed"|"unknown"} replay
 */
function replayLabel(replay) {
  if (replay === "passed") return "Replay passed";
  if (replay === "held") return "Replay held";
  if (replay === "failed") return "Replay failed";
  return "Replay outcome is unknown";
}

/**
 * @param {"data"|"empty"|"drift"|"no_schema"|"unavailable"} outcome
 * @param {number} rowCount
 * @param {"passed"|"held"|"failed"|"unknown"} replay
 * @param {string|undefined} reason
 */
function buildSummary(outcome, rowCount, replay, reason) {
  if (outcome === "data") {
    return {
      headline: `Data extraction produced ${rowCount} ${rowCount === 1 ? "row" : "rows"}.`,
      detail: `${replayLabel(replay)}; data was read from the current page snapshot.`
    };
  }
  if (outcome === "empty") {
    return {
      headline: "Data extraction produced 0 rows.",
      detail: `${replayLabel(replay)}; extraction completed but the current page snapshot had no rows.`
    };
  }
  if (outcome === "drift") {
    return {
      headline: "Data extraction drifted.",
      detail: `${replayLabel(replay)}; data extraction drifted and needs extractor healing.`
    };
  }
  if (outcome === "no_schema") {
    return {
      headline: "Data extraction has no schema.",
      detail: `${replayLabel(replay)}; no reliable data schema was available${reason ? `: ${reason}` : "."}`
    };
  }
  return {
    headline: "Data extraction was unavailable.",
    detail: `${replayLabel(replay)}; data extraction did not produce a usable result${reason ? `: ${reason}` : "."}`
  };
}

/**
 * Build the canonical user-facing data-result report.
 *
 * @param {{
 *   runId: string,
 *   dataMode?: string,
 *   verification?: Record<string, any>|null,
 *   extractResult: Record<string, any>,
 *   maxPreviewRows?: number
 * }} input
 */
export function buildDataResultArtifact(input) {
  const rows = Array.isArray(input.extractResult.rows) ? input.extractResult.rows : [];
  const rowCount = rows.length;
  const replay = replayOutcome(input.verification);
  const outcome = dataOutcome(input.extractResult, rowCount);
  const maxPreviewRows = typeof input.maxPreviewRows === "number" ? input.maxPreviewRows : 5;
  const summary = buildSummary(outcome, rowCount, replay, input.extractResult.reason);
  const dataMode = typeof input.dataMode === "string" && DATA_MODES.has(input.dataMode) ? input.dataMode : "extract";

  return {
    schemaVersion: SCHEMA_VERSIONS.dataResult,
    runId: input.runId,
    dataMode,
    replayOutcome: replay,
    dataOutcome: outcome,
    extractStatus: String(input.extractResult.status || "unavailable"),
    ...(typeof input.extractResult.stepIndex === "number" ? { stepIndex: input.extractResult.stepIndex } : {}),
    ...(typeof input.extractResult.pageKey === "string" ? { pageKey: input.extractResult.pageKey } : {}),
    ...(typeof input.extractResult.cardinality === "number" ? { cardinality: input.extractResult.cardinality } : {}),
    rowCount,
    rows,
    previewRows: rows.slice(0, Math.max(0, maxPreviewRows)),
    ...(typeof input.extractResult.reason === "string" ? { reason: input.extractResult.reason } : {}),
    summary
  };
}

/**
 * @param {{ summary?: { headline?: string, detail?: string } }} artifact
 */
export function formatDataResultSummary(artifact) {
  return [artifact.summary?.headline, artifact.summary?.detail].filter(Boolean).join(" ");
}
