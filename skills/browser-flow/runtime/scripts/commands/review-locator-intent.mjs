import { mkdirSync, writeFileSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export async function reviewLocatorIntentCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("review-locator-intent requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  const applyPath = getStringOption(options, "apply", undefined);
  if (applyPath) {
    return applyLocatorIntentResult(runPaths, applyPath);
  }
  return briefLocatorIntent(runPaths);
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
export function briefLocatorIntent(runPaths) {
  const preview = readPreview(runPaths);
  const candidates = reviewCandidates(preview);
  const result = readOptionalResult(runPaths);
  const resolved = new Set(
    Array.isArray(result?.decisions)
      ? result.decisions.map((entry) => entry?.candidateId).filter(Boolean)
      : []
  );
  const unresolved = candidates
    .filter((candidate) => !resolved.has(candidate.candidateId))
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      eventIndex: candidate.eventIndex,
      actionText: candidate.actionText ?? "",
      pageUrl: candidate.pageUrl ?? "",
      targetHref: candidate.targetHref ?? "",
      sameNameCountPage: candidate.sameNameCountPage ?? 0,
      sameNameCountRegion: candidate.sameNameCountRegion ?? 0,
      semanticRegionSummary: candidate.semanticRegionSummary ?? "",
      replayPermission: candidate.replayPermission ?? null,
      briefing: locatorIntentBriefing(candidate),
      prompt: "This generic repeated action is identified by its visible section/card context. Confirm this is the intended action before replay?",
      recommendedAction: candidate.recommendedAction ?? "confirm",
      summary: candidate.summary ?? ""
    }));
  return {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentPreview,
    status: unresolved.length > 0 ? "needs_review" : preview.status ?? "clean",
    message: unresolved.length > 0
      ? "Review generic same-name locator intent before replay. Show every candidate and choose confirm or recapture."
      : "No unresolved locator intent review candidates.",
    unresolved
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {string} applyPath
 */
function applyLocatorIntentResult(runPaths, applyPath) {
  const preview = readPreview(runPaths);
  const candidates = reviewCandidates(preview);
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const input = /** @type {Record<string, any>} */ (readJson(applyPath));
  if (input.schemaVersion !== SCHEMA_VERSIONS.locatorIntentResult) {
    throw new Error(`locator-intent-result schemaVersion must be ${SCHEMA_VERSIONS.locatorIntentResult}.`);
  }
  if (input.runId !== runPaths.runId) {
    throw new Error(`locator-intent-result runId ${JSON.stringify(input.runId)} does not match ${JSON.stringify(runPaths.runId)}.`);
  }
  if (!Array.isArray(input.decisions)) {
    throw new Error("locator-intent-result decisions must be an array.");
  }
  const decisions = input.decisions.map((entry) => {
    const candidateId = typeof entry?.candidateId === "string" ? entry.candidateId : "";
    const verdict = typeof entry?.verdict === "string" ? entry.verdict : "";
    if (!candidateIds.has(candidateId)) {
      throw new Error(`Unknown locator intent candidateId: ${candidateId || "<missing>"}.`);
    }
    if (verdict !== "confirm" && verdict !== "recapture") {
      throw new Error(`Invalid locator intent verdict for ${candidateId}: ${verdict || "<missing>"}. Expected confirm or recapture.`);
    }
    return { candidateId, verdict };
  });
  const resolved = new Set(decisions.map((decision) => decision.candidateId));
  const unresolved = candidates.filter((candidate) => !resolved.has(candidate.candidateId));
  const output = {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentResult,
    runId: runPaths.runId,
    decisions
  };
  mkdirSync(runPaths.analysisDir, { recursive: true });
  writeFileSync(runPaths.locatorIntentResultPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  return {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentResult,
    status: unresolved.length === 0 ? "resolved" : "partial",
    decisions,
    unresolved: unresolved.map((candidate) => candidate.candidateId)
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readPreview(runPaths) {
  return /** @type {Record<string, any>} */ (readJson(runPaths.locatorIntentPreviewPath));
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readOptionalResult(runPaths) {
  try {
    return /** @type {Record<string, any>} */ (readJson(runPaths.locatorIntentResultPath));
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any>} preview
 */
function reviewCandidates(preview) {
  return Array.isArray(preview?.suggestions)
    ? preview.suggestions.filter((entry) => entry && typeof entry.candidateId === "string")
    : [];
}

/**
 * @param {Record<string, any>} candidate
 */
function locatorIntentBriefing(candidate) {
  const actionText = typeof candidate.actionText === "string" && candidate.actionText
    ? `"${candidate.actionText}"`
    : "<unnamed action>";
  const region = typeof candidate.semanticRegionSummary === "string" && candidate.semanticRegionSummary
    ? candidate.semanticRegionSummary
    : "no semantic region captured";
  return [
    `${candidate.candidateId}: ${candidate.kind || "locator-intent"}`,
    `action: ${actionText}`,
    `page: ${candidate.pageUrl || ""}`,
    `target href: ${candidate.targetHref || ""}`,
    `visible region: ${region}`,
    `same-name count: ${candidate.sameNameCountPage ?? 0} on page, ${candidate.sameNameCountRegion ?? 0} in region`,
    `replay permission: ${candidate.replayPermission?.level || "confirmed-equivalence"}`,
    `recommended: ${candidate.recommendedAction || "confirm"}`
  ].join("\n");
}
