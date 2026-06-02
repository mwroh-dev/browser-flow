import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { parseDataResult } from "../lib/schemas.mjs";
import {
  assertOriginsCoverWorkflow,
  normalizeOrigins,
  registrySafeUrl
} from "../registry/external-promotion.mjs";
import { upsertRegistryEntry } from "../registry/workflow-registry.mjs";

const AUTH_MODES = ["none", "login-required", "keychain-session", "attach", "persistent-profile"];
const PROFILE_MODES = ["ephemeral", "named-profile", "attached-browser"];
const PRIVACY_LEVELS = ["minimal", "profile", "full"];
const SCREENSHOTS = ["off", "allowed"];
const DATA_MODES = ["route", "extract", "mixed"];

/**
 * @param {Record<string, string | boolean>} options
 * @param {string} key
 * @param {readonly string[]} allowed
 */
function requiredEnum(options, key, allowed) {
  const value = getStringOption(options, key, undefined);
  if (!value || !allowed.includes(value)) {
    throw new Error(`promote requires --${key} with one of: ${allowed.join(" | ")}.`);
  }
  return value;
}

/**
 * @param {Record<string, string | boolean>} options
 */
export function promoteCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("promote requires --run-id.");
  }
  if (getStringOption(options, "scope", undefined) !== "external") {
    throw new Error("promote currently supports only --scope external.");
  }

  const runPaths = getRunPaths(runId);
  if (!existsSync(runPaths.workflowJsonPath)) {
    throw new Error(`promote requires ${runPaths.workflowJsonPath}.`);
  }
  if (!existsSync(runPaths.verificationPath) || !existsSync(runPaths.securityPath)) {
    throw new Error("promote requires both verification.json and security.json artifacts.");
  }

  const originsRaw = getStringOption(options, "origins", undefined);
  if (!originsRaw) {
    throw new Error("promote external requires --origins.");
  }
  const origins = normalizeOrigins(originsRaw);
  if (origins.length === 0) {
    throw new Error("promote external requires --origins with at least one valid origin.");
  }

  /** @type {Record<string, any>} */
  const workflow = /** @type {Record<string, any>} */ (readJson(runPaths.workflowJsonPath));
  /** @type {Record<string, any>} */
  const verification = /** @type {Record<string, any>} */ (readJson(runPaths.verificationPath));
  /** @type {Record<string, any>} */
  const security = /** @type {Record<string, any>} */ (readJson(runPaths.securityPath));
  assertOriginsCoverWorkflow(origins, workflow);

  const replayPassed = verification.replayOutcome !== undefined
    ? verification.replayOutcome === "passed"
    : (verification.success === true && verification.pathComplete === true);
  if (!replayPassed) {
    throw new Error("promote external requires a passed replay.");
  }
  if (security.ok !== true) {
    throw new Error("promote external requires security scan ok:true.");
  }

  const authMode = requiredEnum(options, "auth-mode", AUTH_MODES);
  const profileMode = requiredEnum(options, "profile-mode", PROFILE_MODES);
  const privacyLevel = requiredEnum(options, "privacy-level", PRIVACY_LEVELS);
  const screenshots = requiredEnum(options, "screenshots", SCREENSHOTS);
  const dataMode = requiredEnum(options, "data-mode", DATA_MODES);
  let dataResult;
  if (dataMode === "extract" || dataMode === "mixed") {
    if (!existsSync(runPaths.dataResultPath)) {
      throw new Error(`promote external with --data-mode ${dataMode} requires ${runPaths.dataResultPath}.`);
    }
    dataResult = parseDataResult(readJson(runPaths.dataResultPath), runPaths.dataResultPath);
    if (dataResult.runId !== runId) {
      throw new Error(`promote external data-result runId ${JSON.stringify(dataResult.runId)} does not match ${JSON.stringify(runId)}.`);
    }
    if (dataResult.dataMode !== dataMode) {
      throw new Error(`promote external data-result dataMode ${JSON.stringify(dataResult.dataMode)} does not match ${JSON.stringify(dataMode)}.`);
    }
    if (dataResult.replayOutcome !== "passed") {
      throw new Error(`promote external data-result replayOutcome must be "passed"; got ${JSON.stringify(dataResult.replayOutcome)}.`);
    }
  }

  const entry = {
    id: runId,
    fixture: typeof workflow.fixture === "string" ? workflow.fixture : "manual",
    runId,
    status: "replay_verified",
    startUrl: registrySafeUrl(workflow.startUrl),
    finalUrl: registrySafeUrl(workflow.finalUrl),
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    security: {
      ...(typeof workflow.security === "object" && workflow.security ? workflow.security : {}),
      localOnly: false,
      targetScope: "external"
    },
    promotion: {
      scope: "external",
      approved: true,
      origins,
      authMode,
      profileMode,
      privacyLevel,
      screenshots,
      dataMode,
      warningOnly: security.warningOnly === true,
      findingsCount: Array.isArray(security.findings) ? security.findings.length : 0,
      ...(dataResult ? { dataResultPath: runPaths.dataResultPath, dataOutcome: dataResult.dataOutcome, rowCount: dataResult.rowCount } : {})
    }
  };

  upsertRegistryEntry(entry);

  return {
    ok: true,
    runId,
    status: "replay_verified",
    promotion: entry.promotion
  };
}
