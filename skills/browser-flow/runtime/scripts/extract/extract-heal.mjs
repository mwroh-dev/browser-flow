// Phase NNN: extraction-heal — the deterministic half of the drift-repair loop
// (decision ②, value prop #4). Drift is detected by golden-probe inside bf extract;
// this builds the heal-request the extract-heal-agent consumes, and bf extract-heal
// --apply force-writes the re-derived config + verifies it against the drifted
// snapshot. No runner regenerate/cleanup/rerun — extraction is not in the runner.

import { existsSync } from "node:fs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseExtractHealResult } from "../lib/schemas.mjs";
import { writeScrapingKnowledge, readGolden } from "./scraping-store.mjs";
import { readSnapshotHtml } from "./snapshot-read.mjs";
import { runExtractor } from "./extractor.mjs";
import { classify } from "./golden-probe.mjs";

/**
 * @param {string} pageKey
 * @param {number} stepIndex
 * @param {{ cardinality?: number, sampleValues?: any[] }|null|undefined} golden
 * @param {{ cardinality: number, containerResolved: boolean }} extraction
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 */
export function buildExtractHealRequest(pageKey, stepIndex, golden, extraction, manifestPath, snapshotsDir) {
  return {
    pageKey,
    stepIndex,
    expected: { cardinality: (golden && golden.cardinality) ?? 0, sampleValues: (golden && golden.sampleValues) ?? [] },
    observed: { cardinality: extraction.cardinality, containerResolved: extraction.containerResolved },
    snapshotsManifestPath: manifestPath,
    snapshotsDir
  };
}

/**
 * Phase NNN: bf extract-heal — deterministic half of the extraction-heal loop.
 * Reads extract-heal-request.json; on --apply force-writes the re-derived durable
 * config (status "healed") and re-runs it against the drifted snapshot to verify,
 * or surfaces the reason (status "unrepairable" → value prop #4 "notify user").
 *
 * @param {{ runId: string, applyPath?: string }} input
 * @param {{ readSnapshotHtml?: Function, runExtractor?: Function, classify?: Function }} [deps]
 */
export async function runExtractHealCommand(input, deps = {}) {
  const runPaths = getRunPaths(input.runId);
  if (!existsSync(runPaths.extractHealRequestPath)) {
    throw new Error("no extract-heal-request for run " + input.runId + " — no extraction drift was recorded");
  }
  const request = /** @type {Record<string, any>} */ (readJson(runPaths.extractHealRequestPath));
  if (!input.applyPath) {
    return { runId: input.runId, extractHealRequest: request };
  }

  const result = parseExtractHealResult(readJson(input.applyPath), input.applyPath);
  if (result.status === "unrepairable") {
    return { runId: input.runId, pageKey: result.pageKey, status: "unrepairable", reason: result.reason };
  }

  // healed: force-write the re-derived durable config (heal-in-place), then verify.
  const config = { schemaVersion: 1, pageKey: result.pageKey, ...result.extractorConfig };
  writeScrapingKnowledge(result.pageKey, config, result.golden || {}, { force: true });

  const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
  const extract = deps.runExtractor ?? runExtractor;
  const verdict = deps.classify ?? classify;
  const html = readSnap(request.snapshotsManifestPath, request.snapshotsDir, request.stepIndex);
  const extraction = extract(html, config);
  const verify = verdict(extraction, result.golden || readGolden(result.pageKey));
  return { runId: input.runId, pageKey: result.pageKey, status: "healed", verify: { status: verify.status, cardinality: extraction.cardinality } };
}
