import { existsSync } from "node:fs";
import { getStringOption, getBooleanOption } from "../lib/args.mjs";
import { invalidUsage } from "../lib/cli-errors.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseScrapeResult } from "../lib/schemas.mjs";
import { buildDataResultArtifact } from "../lib/data-result-summary.mjs";
import { applyExtract } from "../extract/extract-apply.mjs";
import { readSnapshotHtml } from "../extract/snapshot-read.mjs";
import { runExtractor } from "../extract/extractor.mjs";
import { classify } from "../extract/golden-probe.mjs";
import { writeScrapingKnowledge, readScrapingConfig, readGolden } from "../extract/scraping-store.mjs";
import { buildExtractHealRequest } from "../extract/extract-heal.mjs";
import { runExtractorPaged, readAllSnapshotsHtml } from "../extract/pager.mjs";
import { buildPublicReadPromotion } from "../registry/external-promotion.mjs";
import { upsertRegistryEntry } from "../registry/workflow-registry.mjs";

/**
 * Emit an extract-heal-request when an extraction drifts (golden-probe verdict).
 * @param {{ snapshotsManifestPath: string, snapshotsDir: string, extractHealRequestPath: string }} runPaths
 * @param {string} pageKey
 * @param {number} stepIndex
 * @param {{ cardinality?: number, sampleValues?: any[] }|null|undefined} golden
 * @param {{ cardinality: number, containerResolved: boolean }} extraction
 */
function emitHealOnDrift(runPaths, pageKey, stepIndex, golden, extraction) {
  const req = buildExtractHealRequest(pageKey, stepIndex, golden, extraction, runPaths.snapshotsManifestPath, runPaths.snapshotsDir);
  writeJson(runPaths.extractHealRequestPath, req);
  return req;
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {{ runId: string, dataMode?: "extract"|"mixed" }} input
 * @param {Record<string, any>} extractOut
 */
function writeDataResult(runPaths, input, extractOut) {
  const verification = existsSync(runPaths.verificationPath)
    ? /** @type {Record<string, any>} */ (readJson(runPaths.verificationPath))
    : undefined;
  const artifact = buildDataResultArtifact({
    runId: input.runId,
    dataMode: input.dataMode,
    verification,
    extractResult: extractOut
  });
  writeJson(runPaths.dataResultPath, artifact);
  return artifact;
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {{ runId: string, dataMode?: "extract"|"mixed" }} input
 * @param {Record<string, any>} workflow
 * @param {ReturnType<typeof writeDataResult>} dataResult
 */
function updatePublicReadRegistryData(runPaths, input, workflow, dataResult) {
  if (!existsSync(runPaths.verificationPath) || !existsSync(runPaths.securityPath)) return;
  const security = /** @type {Record<string, any>} */ (readJson(runPaths.securityPath));
  const dataMode = input.dataMode ?? "extract";
  const promotion = buildPublicReadPromotion(workflow, security, {
    dataMode,
    dataResultPath: runPaths.dataResultPath,
    dataOutcome: dataResult.dataOutcome,
    rowCount: dataResult.rowCount
  });
  if (!promotion) return;
  upsertRegistryEntry({
    id: input.runId,
    fixture: typeof workflow.fixture === "string" ? workflow.fixture : "manual",
    runId: input.runId,
    status: "replay_verified",
    startUrl: workflow.startUrl,
    finalUrl: workflow.finalUrl,
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    security: workflow.security,
    promotion
  });
}

/**
 * Phase NNN: bf extract — the scraping sub-agent's deterministic companion.
 * - no `--apply`: emit scrape-request.json (target schema + snapshot pointers)
 *   for the orchestrator to dispatch the scraping-agent against.
 * - `--apply <scrape-result.json>`: validate, write step.extraction, persist the
 *   run-scoped extractor-config, run it against the capture snapshot (Gate-3
 *   Fact), and write extract-result.json. LLM-free.
 *
 * @param {{ runId: string, applyPath?: string, schemaPath?: string, stepIndex?: number, reuse?: boolean, paged?: boolean, dataMode?: "extract"|"mixed" }} input
 * @param {{ readSnapshotHtml?: Function, runExtractor?: Function, classify?: Function, readAllSnapshotsHtml?: Function }} [deps]
 */
export async function runExtractCommand(input, deps = {}) {
  const runPaths = getRunPaths(input.runId);
  const workflow = /** @type {{ steps: Record<string, any>[] } & Record<string, any>} */ (readJson(runPaths.workflowJsonPath));

  if (input.reuse) {
    if (typeof input.stepIndex !== "number") throw new Error("bf extract --reuse requires --step <n>");
    const step = workflow.steps[input.stepIndex];
    const pageKey = (step && step.pageKey) || "";
    const config = readScrapingConfig(pageKey);
    if (!config) throw new Error(`no durable scraping config for pageKey "${pageKey}" — run setup (--apply) first`);
    const golden = readGolden(pageKey);
    const verdict = deps.classify ?? classify;

    if (input.paged) {
      const readAll = deps.readAllSnapshotsHtml ?? readAllSnapshotsHtml;
      const paged = runExtractorPaged(readAll(runPaths.snapshotsManifestPath, runPaths.snapshotsDir), /** @type {{ container: string|null, fields: any[] }} */ (config));
      const pagedResult = verdict({ rows: paged.rows, cardinality: paged.cardinality, containerResolved: paged.cardinality > 0 }, golden);
      if (pagedResult.status === "drift" && pageKey) emitHealOnDrift(runPaths, pageKey, input.stepIndex, golden, { cardinality: paged.cardinality, containerResolved: paged.cardinality > 0 });
      const pagedOut = /** @type {Record<string, any>} */ ({ runId: input.runId, stepIndex: input.stepIndex, pageKey, status: pagedResult.status, rows: paged.rows, cardinality: paged.cardinality, pages: paged.pages, reused: true });
      updatePublicReadRegistryData(runPaths, input, workflow, writeDataResult(runPaths, input, pagedOut));
      writeJson(runPaths.extractResultPath, pagedOut);
      return pagedOut;
    }

    const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
    const extract = deps.runExtractor ?? runExtractor;
    const html = readSnap(runPaths.snapshotsManifestPath, runPaths.snapshotsDir, input.stepIndex);
    const extraction = extract(html, config);
    const result = verdict(extraction, golden);
    if (result.status === "drift" && pageKey) emitHealOnDrift(runPaths, pageKey, input.stepIndex, golden, extraction);
    const out = /** @type {Record<string, any>} */ ({ runId: input.runId, stepIndex: input.stepIndex, pageKey, status: result.status, rows: result.rows, cardinality: extraction.cardinality, reason: result.reason, reused: true });
    updatePublicReadRegistryData(runPaths, input, workflow, writeDataResult(runPaths, input, out));
    writeJson(runPaths.extractResultPath, out);
    return out;
  }

  if (!input.applyPath) {
    if (typeof input.stepIndex !== "number") throw new Error("bf extract (emit) requires --step <n>");
    if (!input.schemaPath) throw new Error("bf extract (emit) requires --schema <path>");
    const targetSchema = readJson(input.schemaPath);
    const step = workflow.steps[input.stepIndex];
    const request = {
      runId: input.runId,
      candidates: [{ stepIndex: input.stepIndex, pageKey: (step && step.pageKey) || "", targetSchema }],
      snapshotsManifestPath: runPaths.snapshotsManifestPath,
      snapshotsDir: runPaths.snapshotsDir
    };
    writeJson(runPaths.scrapeRequestPath, request);
    return request;
  }

  const scrapeResult = parseScrapeResult(readJson(input.applyPath), input.applyPath);
  const applied = applyExtract(workflow.steps, scrapeResult);
  writeJson(runPaths.workflowJsonPath, workflow);

  if (scrapeResult.status !== "extracted" || !scrapeResult.extractorConfig) {
    const out = /** @type {Record<string, any>} */ ({ runId: input.runId, status: "no-schema", stepIndex: applied.stepIndex, reason: scrapeResult.reason });
    updatePublicReadRegistryData(runPaths, input, workflow, writeDataResult(runPaths, input, out));
    return out;
  }

  // Wrap the agent's config body into a full ExtractorConfigV1 + persist (run-scoped).
  const config = { schemaVersion: 1, pageKey: applied.pageKey, ...scrapeResult.extractorConfig };
  writeJson(runPaths.extractorConfigPath, config);

  // Gate-3 (Fact): run the config against the capture snapshot; classify the result.
  const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
  const extract = deps.runExtractor ?? runExtractor;
  const verdict = deps.classify ?? classify;
  const html = readSnap(runPaths.snapshotsManifestPath, runPaths.snapshotsDir, applied.stepIndex);
  const extraction = extract(html, config);
  const result = verdict(extraction, scrapeResult.golden);
  if (result.status === "drift" && applied.pageKey) {
    emitHealOnDrift(runPaths, applied.pageKey, /** @type {number} */ (applied.stepIndex), scrapeResult.golden, extraction);
  }

  const out = /** @type {Record<string, any>} */ ({
    runId: input.runId,
    stepIndex: applied.stepIndex,
    pageKey: applied.pageKey,
    status: result.status,
    rows: result.rows,
    cardinality: extraction.cardinality,
    reason: result.reason
  });
  updatePublicReadRegistryData(runPaths, input, workflow, writeDataResult(runPaths, input, out));
  writeJson(runPaths.extractResultPath, out);

  // Decision ①: persist to the durable scraping-knowledge domain (first-write-wins),
  // keyed by the step's structural pageKey, so a later flow on the same page reuses
  // it with zero tokens. Skip when pageKey is empty.
  if (applied.pageKey) {
    out.durable = writeScrapingKnowledge(applied.pageKey, config, scrapeResult.golden || {});
  }
  return out;
}

/** @param {Record<string, string | boolean>} options */
export function extractCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf extract requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  const schemaPath = getStringOption(options, "schema", undefined);
  const stepRaw = getStringOption(options, "step", undefined);
  const stepIndex = stepRaw === undefined ? undefined : Number(stepRaw);
  if (stepRaw !== undefined && (!Number.isInteger(stepIndex) || /** @type {number} */ (stepIndex) < 0)) {
    throw invalidUsage(`bf extract --step must be a non-negative integer, got "${stepRaw}".`);
  }
  const reuse = getBooleanOption(options, "reuse");
  const paged = getBooleanOption(options, "paged");
  const dataModeRaw = getStringOption(options, "data-mode", undefined);
  if (dataModeRaw !== undefined && dataModeRaw !== "extract" && dataModeRaw !== "mixed") {
    throw new Error("bf extract --data-mode must be one of: extract | mixed");
  }
  const dataMode = /** @type {"extract"|"mixed"|undefined} */ (dataModeRaw);
  return runExtractCommand({ runId, applyPath, schemaPath, stepIndex, reuse, paged, dataMode });
}
