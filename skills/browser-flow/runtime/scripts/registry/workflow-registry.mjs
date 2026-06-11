import { closeSync, existsSync, openSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { getPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseDataResult } from "../lib/schemas.mjs";
import { isSecurityClean } from "../security/scan-artifacts.mjs";
import {
  classifyRegistryPromotion,
  formatPromotionRefusal,
  registrySafeUrl
} from "./external-promotion.mjs";

/**
 * @returns {Array<Record<string, unknown>>}
 */
export function readRegistry() {
  const { registryPath } = getPaths();
  if (!existsSync(registryPath)) {
    return [];
  }
  return /** @type {Array<Record<string, unknown>>} */ (readJson(registryPath));
}

/**
 * @param {Record<string, unknown>} entry
 */
export function registryPromotionRefusal(entry) {
  const promotion = classifyRegistryPromotion(entry);
  if (!promotion.ok) {
    const id = typeof entry.id === "string" || typeof entry.id === "number" || typeof entry.id === "symbol"
      ? entry.id
      : undefined;
    return {
      code: promotion.reason,
      message: formatPromotionRefusal(promotion.reason, id)
    };
  }
  return null;
}

/**
 * @param {Record<string, unknown>} entry
 */
export function upsertRegistryEntry(entry) {
  // persistence-boundary enforcement of constitutional
  // invariant #1. Unmasked debug captures emit
  // workflow.security.localOnly = false; this gate refuses to add
  // them to the verified-flow catalog. Capture pipeline can be
  // bypassed at the URL boundary (assertLocalUrl), but the registry
  // catalog stays local-only by contract.
  const refusal = registryPromotionRefusal(entry);
  if (refusal) {
    process.stderr.write(`${refusal.message}\n`);
    return readRegistry();
  }
  const entryToPersist = sanitizeRegistryEntry(entry);
  // verified-status gate (defense-in-depth). A "verified" entry must be
  // backed by a verification.json AND a security.json that both exist and a
  // security scan that is truly clean (not unmasked warning-only). This makes
  // it impossible for any caller — first-mode bootstrap, future code — to mint
  // a fake "verified" entry without real, green artifacts.
  if (entry.status === "verified") {
    const vPath = /** @type {string | undefined} */ (entry.verificationPath);
    const sPath = /** @type {string | undefined} */ (entry.securityPath);
    if (!vPath || !existsSync(vPath) || !sPath || !existsSync(sPath)) {
      throw new Error(
        `registry: refusing "verified" upsert for "${entry.id}" — both verification.json and security.json must exist.`
      );
    }
    const scanResult = /** @type {{ ok?: boolean, warningOnly?: boolean }} */ (readJson(sPath));
    if (!isSecurityClean(scanResult)) {
      throw new Error(
        `registry: refusing "verified" upsert for "${entry.id}" — security scan is not clean (ok=${scanResult?.ok}, warningOnly=${scanResult?.warningOnly}).`
      );
    }
  }
  if (entry.status === "replay_verified") {
    const vPath = /** @type {string | undefined} */ (entry.verificationPath);
    const sPath = /** @type {string | undefined} */ (entry.securityPath);
    if (!vPath || !existsSync(vPath) || !sPath || !existsSync(sPath)) {
      throw new Error(
        `registry: refusing "replay_verified" upsert for "${entry.id}" — both verification.json and security.json must exist.`
      );
    }
    const verification = /** @type {{ replayOutcome?: string, success?: boolean, pathComplete?: boolean }} */ (readJson(vPath));
    const scanResult = /** @type {{ ok?: boolean }} */ (readJson(sPath));
    const replayPassed = verification.replayOutcome !== undefined
      ? verification.replayOutcome === "passed"
      : (verification.success === true && verification.pathComplete === true);
    if (!replayPassed) {
      throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — replay did not pass.`);
    }
    if (scanResult.ok !== true) {
      throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — security scan failed.`);
    }
    validateExternalDataResult(entry);
  }
  const { registryPath } = getPaths();
  const lockPath = `${registryPath}.lock`;
  const tempPath = `${registryPath}.tmp`;
  const lockFd = acquireLock(lockPath);
  try {
    const registry = readRegistry();
    const next = registry.filter((item) => item.id !== entry.id);
    next.push(entryToPersist);
    writeJson(tempPath, next);
    renameSync(tempPath, registryPath);
    return next;
  } finally {
    closeSync(lockFd);
    rmSync(lockPath, { force: true });
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
function sanitizeRegistryEntry(entry) {
  const security = /** @type {Record<string, unknown> | undefined} */ (
    entry.security && typeof entry.security === "object" ? entry.security : undefined
  );
  const external = security?.localOnly === false || security?.targetScope === "external";
  if (!external) return entry;
  return {
    ...entry,
    startUrl: registrySafeUrl(entry.startUrl),
    finalUrl: registrySafeUrl(entry.finalUrl)
  };
}

/**
 * @param {Record<string, unknown>} entry
 */
function validateExternalDataResult(entry) {
  const security = /** @type {Record<string, unknown> | undefined} */ (
    entry.security && typeof entry.security === "object" ? entry.security : undefined
  );
  const external = security?.localOnly === false || security?.targetScope === "external";
  if (!external) return;
  const promotion = /** @type {Record<string, unknown> | undefined} */ (entry.promotion);
  if (!promotion || (promotion.dataMode !== "extract" && promotion.dataMode !== "mixed")) return;
  const dataResultPath = promotion.dataResultPath;
  if (typeof dataResultPath !== "string" || !existsSync(dataResultPath)) {
    throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — external data-result artifact must exist.`);
  }
  const dataResult = parseDataResult(readJson(dataResultPath), dataResultPath);
  if (dataResult.runId !== entry.runId && dataResult.runId !== entry.id) {
    throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — data-result runId does not match.`);
  }
  if (dataResult.dataMode !== promotion.dataMode) {
    throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — data-result dataMode does not match.`);
  }
  if (dataResult.replayOutcome !== "passed") {
    throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — data-result replayOutcome must be passed.`);
  }
  if (promotion.dataOutcome !== dataResult.dataOutcome || promotion.rowCount !== dataResult.rowCount) {
    throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — data-result metadata does not match.`);
  }
}

/** Stale lock threshold in milliseconds. A lock file older than this is assumed orphaned. */
const STALE_LOCK_MS = 30_000;

/**
 * @param {string} lockPath
 */
function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return openSync(lockPath, "wx");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("EEXIST")) {
        throw error;
      }
      // Steal stale locks via rename, not rmSync: rename moves exactly one
      // file, so two waiters cannot both "win", and the inode check below
      // detects a lock that was re-created between stat and rename so a
      // live lock is never deleted (the rmSync version had that TOCTOU).
      try {
        const seen = statSync(lockPath);
        if (Date.now() - seen.mtimeMs > STALE_LOCK_MS) {
          const stalePath = `${lockPath}.stale-${process.pid}`;
          renameSync(lockPath, stalePath);
          const grabbed = statSync(stalePath);
          if (grabbed.ino === seen.ino && Date.now() - grabbed.mtimeMs > STALE_LOCK_MS) {
            rmSync(stalePath, { force: true });
            continue; // stolen — retry openSync immediately
          }
          // A fresh lock raced in between stat and rename; restore it.
          renameSync(stalePath, lockPath);
        }
      } catch {
        // Lock vanished or another stealer won the rename — treat like a
        // held lock and back off instead of busy-spinning.
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error(`Timed out acquiring registry lock at ${lockPath}.`);
}
