import { mkdirSync, writeFileSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export async function reviewRouteIntentCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("review-route-intent requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  const applyPath = getStringOption(options, "apply", undefined);
  if (applyPath) {
    return applyRouteIntentResult(runPaths, applyPath);
  }
  return briefRouteIntent(runPaths);
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
export function briefRouteIntent(runPaths) {
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
      strategy: candidate.strategy,
      targetStateUrl: candidate.targetStateUrl ?? "",
      omittedSteps: Array.isArray(candidate.omittedSteps) ? candidate.omittedSteps : [],
      proofs: Array.isArray(candidate.proofs) ? candidate.proofs : [],
      risks: Array.isArray(candidate.risks) ? candidate.risks : [],
      briefing: routeIntentBriefing(candidate),
      prompt: "This candidate can replay the approved target state instead of every captured DOM click. Confirm the state route or keep the DOM route?",
      recommendedAction: candidate.recommendedAction ?? "confirm-state-route",
      summary: candidate.summary ?? ""
    }));
  return {
    schemaVersion: SCHEMA_VERSIONS.routeIntentPreview,
    status: unresolved.length > 0 ? "needs_review" : preview.status ?? "clean",
    message: unresolved.length > 0
      ? "Review route intent before replay. Show every candidate with omitted steps, target state URL, proofs, and risks."
      : "No unresolved route intent review candidates.",
    unresolved
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {string} applyPath
 */
function applyRouteIntentResult(runPaths, applyPath) {
  const preview = readPreview(runPaths);
  const candidates = reviewCandidates(preview);
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const input = /** @type {Record<string, any>} */ (readJson(applyPath));
  if (input.schemaVersion !== SCHEMA_VERSIONS.routeIntentResult) {
    throw new Error(`route-intent-result schemaVersion must be ${SCHEMA_VERSIONS.routeIntentResult}.`);
  }
  if (input.runId !== runPaths.runId) {
    throw new Error(`route-intent-result runId ${JSON.stringify(input.runId)} does not match ${JSON.stringify(runPaths.runId)}.`);
  }
  if (!Array.isArray(input.decisions)) {
    throw new Error("route-intent-result decisions must be an array.");
  }
  const decisions = input.decisions.map((entry) => {
    const candidateId = typeof entry?.candidateId === "string" ? entry.candidateId : "";
    const verdict = typeof entry?.verdict === "string" ? entry.verdict : "";
    if (!candidateIds.has(candidateId)) {
      throw new Error(`Unknown route intent candidateId: ${candidateId || "<missing>"}.`);
    }
    if (verdict !== "confirm-state-route" && verdict !== "keep-dom-route") {
      throw new Error(`Invalid route intent verdict for ${candidateId}: ${verdict || "<missing>"}. Expected confirm-state-route or keep-dom-route.`);
    }
    return { candidateId, verdict };
  });
  const resolved = new Set(decisions.map((decision) => decision.candidateId));
  const unresolved = candidates.filter((candidate) => !resolved.has(candidate.candidateId));
  const output = {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    runId: runPaths.runId,
    decisions
  };
  mkdirSync(runPaths.analysisDir, { recursive: true });
  writeFileSync(runPaths.routeIntentResultPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  return {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    status: unresolved.length === 0 ? "resolved" : "partial",
    decisions,
    unresolved: unresolved.map((candidate) => candidate.candidateId)
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readPreview(runPaths) {
  return /** @type {Record<string, any>} */ (readJson(runPaths.routeIntentPreviewPath));
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function readOptionalResult(runPaths) {
  try {
    return /** @type {Record<string, any>} */ (readJson(runPaths.routeIntentResultPath));
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
function routeIntentBriefing(candidate) {
  const omitted = Array.isArray(candidate.omittedSteps) ? candidate.omittedSteps : [];
  const proofs = Array.isArray(candidate.proofs) ? candidate.proofs : [];
  const risks = Array.isArray(candidate.risks) ? candidate.risks : [];
  const omittedText = omitted.length > 0
    ? omitted.map((step) => {
      const label = [
        step.action,
        quote(step.text),
        step.href ? `href ${step.href}` : "",
        step.pageUrl ? `from ${step.pageUrl}` : "",
        step.providerContext ? `provider ${formatProviderContext(step.providerContext)}` : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `step ${step.stepIndex}: ${label}`;
    }).join("; ")
    : "none";
  const proofText = proofs.length > 0
    ? proofs.map((proof) => {
      if (proof.kind === "url-state") {
        const params = Array.isArray(proof.params)
          ? proof.params.map((/** @type {Record<string, any>} */ param) => `${param.key}=${param.value}`).join(", ")
          : "";
        return `url-state ${params}`.trim();
      }
      if (proof.kind === "final-url") return `final-url ${proof.expectedUrl || ""}`.trim();
      if (proof.kind === "network") return `network ${proof.method || "GET"} ${proof.url || ""} ${proof.status || ""}`.trim();
      if (proof.kind === "dom-evidence") return `dom-evidence ${proof.selector || ""} includes ${quote(proof.textIncludes)}`.trim();
      return String(proof.kind || "proof");
    }).join("; ")
    : "none";
  return [
    `${candidate.candidateId}: ${candidate.strategy} route`,
    `target state URL: ${candidate.targetStateUrl || ""}`,
    `omitted DOM steps: ${omittedText}`,
    `proofs: ${proofText}`,
    `risks: ${risks.join("; ") || "none"}`
  ].join("\n");
}

/**
 * @param {unknown} value
 */
function quote(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? `"${text}"` : "";
}

/**
 * @param {Record<string, any>} providerContext
 */
function formatProviderContext(providerContext) {
  return [
    providerContext.pattern,
    providerContext.stateCarrier,
    providerContext.replayStrategy,
    providerContext.controlGroup ? `group=${providerContext.controlGroup}` : ""
  ].filter(Boolean).join("/");
}
