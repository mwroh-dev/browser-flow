import { statSync } from "node:fs";
import { resolve } from "node:path";
import { getRunPaths } from "./config.mjs";
import { readJson } from "./fs.mjs";

const ARTIFACT_FILENAMES = {
  workflow: "workflow.json",
  verification: "verification.json",
  security: "security.json",
  summary: "verification-summary.json",
  dataResult: "data-result.json"
};

/**
 * @typedef {{
 *   path: string,
 *   exists: boolean,
 *   mtimeMs?: number,
 *   mtime?: string,
 *   parseOk?: boolean,
 *   parseError?: string
 * }} ArtifactStatus
 */

/**
 * @param {string} runId
 */
export function buildStatusReport(runId) {
  const runPaths = getRunPaths(runId);
  const artifactPaths = {
    workflow: runPaths.workflowJsonPath,
    verification: runPaths.verificationPath,
    security: runPaths.securityPath,
    summary: resolve(runPaths.reportsDir, "verification-summary.json"),
    dataResult: runPaths.dataResultPath
  };

  const workflow = readOptionalJson(artifactPaths.workflow);
  const verification = readOptionalJson(artifactPaths.verification);
  const security = readOptionalJson(artifactPaths.security);
  const summary = readOptionalJson(artifactPaths.summary);
  const dataResult = readOptionalJson(artifactPaths.dataResult);

  const verificationDoc = asRecord(verification.value);
  const securityDoc = asRecord(security.value);
  const executedSteps = Array.isArray(verificationDoc?.executedSteps)
    ? verificationDoc.executedSteps.length
    : undefined;
  const stepCount = typeof verificationDoc?.stepCount === "number"
    ? verificationDoc.stepCount
    : undefined;

  const artifactFailure = firstFailure([
    requiredArtifactFailure("workflow", workflow, ARTIFACT_FILENAMES.workflow),
    requiredArtifactFailure("verification", verification, ARTIFACT_FILENAMES.verification),
    requiredArtifactFailure("security", security, ARTIFACT_FILENAMES.security),
    requiredArtifactFailure("summary", summary, ARTIFACT_FILENAMES.summary),
    optionalArtifactFailure("dataResult", dataResult, ARTIFACT_FILENAMES.dataResult)
  ]);
  let lastFailure = artifactFailure;
  if (lastFailure === undefined) {
    lastFailure = firstFailure([
      verificationDoc?.replayOutcome === "passed"
        ? null
        : {
            code: "replay_not_passed",
            message: `verification replayOutcome is ${JSON.stringify(verificationDoc?.replayOutcome ?? null)}; expected "passed".`,
            artifact: "verification"
          },
      verificationDoc?.pathComplete === true
        ? null
        : {
            code: "path_incomplete",
            message: "verification pathComplete is not true.",
            artifact: "verification"
          },
      executedSteps !== undefined && stepCount !== undefined && executedSteps === stepCount
        ? null
        : {
            code: "executed_steps_mismatch",
            message: `verification executedSteps length ${executedSteps ?? "unknown"} does not match stepCount ${stepCount ?? "unknown"}.`,
            artifact: "verification"
          },
      securityDoc?.ok === true
        ? null
        : {
            code: "security_not_ok",
            message: "security ok is not true.",
            artifact: "security"
          }
    ]);
  }

  return {
    ok: true,
    runId,
    successClaimable: lastFailure === undefined,
    artifacts: {
      workflow: workflow.artifact,
      verification: verification.artifact,
      security: security.artifact,
      summary: summary.artifact,
      dataResult: dataResult.artifact
    },
    evidence: {
      usesAuthoritativeArtifacts: true,
      journalUsedForSuccess: false
    },
    verification: {
      success: verificationDoc?.success === true,
      replayOutcome: verificationDoc?.replayOutcome ?? null,
      pathComplete: verificationDoc?.pathComplete === true,
      executedSteps: executedSteps ?? null,
      stepCount: stepCount ?? null
    },
    security: {
      ok: securityDoc?.ok === true,
      warningOnly: securityDoc?.warningOnly === true,
      findings: Array.isArray(securityDoc?.findings) ? securityDoc.findings.length : null
    },
    ...(lastFailure ? { lastFailure } : {})
  };
}

/**
 * @param {string} path
 * @returns {{ artifact: ArtifactStatus, value: unknown }}
 */
function readOptionalJson(path) {
  const artifact = artifactStatus(path);
  if (!artifact.exists) {
    return { artifact, value: undefined };
  }
  try {
    return {
      artifact: { ...artifact, parseOk: true },
      value: readJson(path)
    };
  } catch (error) {
    return {
      artifact: {
        ...artifact,
        parseOk: false,
        parseError: error instanceof Error ? error.message : String(error)
      },
      value: undefined
    };
  }
}

/**
 * @param {string} path
 * @returns {ArtifactStatus}
 */
function artifactStatus(path) {
  try {
    const stats = statSync(path);
    return {
      path,
      exists: true,
      mtimeMs: stats.mtimeMs,
      mtime: stats.mtime.toISOString()
    };
  } catch {
    return { path, exists: false };
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, any> | undefined}
 */
function asRecord(value) {
  return isPlainObject(value)
    ? /** @type {Record<string, any>} */ (value)
    : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * @param {string} name
 * @param {{ artifact: ArtifactStatus }} result
 * @param {string} filename
 */
function requiredArtifactFailure(name, result, filename) {
  if (!result.artifact.exists) {
    return {
      code: `${name}_missing`,
      message: `${filename} is missing.`,
      artifact: name
    };
  }
  if (result.artifact.parseOk !== true) {
    return {
      code: `${name}_malformed`,
      message: `${filename} could not be parsed.`,
      artifact: name
    };
  }
  return null;
}

/**
 * @param {string} name
 * @param {{ artifact: ArtifactStatus }} result
 * @param {string} filename
 */
function optionalArtifactFailure(name, result, filename) {
  if (!result.artifact.exists) return null;
  if (result.artifact.parseOk !== true) {
    return {
      code: `${name}_malformed`,
      message: `${filename} could not be parsed.`,
      artifact: name
    };
  }
  return null;
}

/**
 * @param {Array<null | undefined | { code: string, message: string, artifact: string }>} failures
 */
function firstFailure(failures) {
  return failures.find(Boolean) ?? undefined;
}
