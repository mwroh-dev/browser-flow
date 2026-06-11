import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBooleanOption, getStringOption } from "../lib/args.mjs";
import {
  createCaptureProfileDir,
  ensureRunDirs,
  getDefaultChromePath,
  getRepoRoot,
  getRunPaths,
  profilePath
} from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { resolveRunId } from "../lib/run-id.mjs";
import { withTrace } from "../lib/trace.mjs";
import { assertLocalUrl } from "../security/local-only.mjs";
import { sanitizeUrl } from "../security/redact.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export function prepareCommand(options) {
  const runId = resolveRunId(getStringOption(options, "run-id", undefined));
  const runPaths = ensureRunDirs(runId);
  return withTrace(runPaths, "prepare", () => {
    const headless = getBooleanOption(options, "headless");
    const startUrl = getStringOption(options, "start-url", undefined);
    const fixture = getStringOption(options, "fixture", "manual") ?? "manual";
    const chromePath = getStringOption(options, "chrome-path", getDefaultChromePath()) ?? getDefaultChromePath();
    const debugPort = Number(getStringOption(options, "debug-port", "0"));
    const assignedDebugPort = Number.isFinite(debugPort) && debugPort > 0 ? debugPort : 0;
    // Opt-in DOM snapshot mode. Default false (script/style stripped, input value redacted).
    const snapshotDom = getBooleanOption(options, "snapshot-dom");
    const captureMode = resolveCaptureModeOption(options);
    // Opt-in named persistent capture profile. Default off (ephemeral mktemp).
    // When set, the profile dir is reused across captures and a Chrome
    // SingletonLock collision refuses the run.
    const profileName = getStringOption(options, "profile-name", undefined);
    // Opt-in unmasked debug mode. When set, external URLs are allowed at the
    // capture boundary AND registry write is blocked at the persistence boundary
    // (preserving constitutional invariant #1 at the catalog-write site rather
    // than at the URL site).
    const unmasked = getBooleanOption(options, "unmasked");

    if (!chromePath || !existsSync(chromePath)) {
      throw new Error(`Chrome binary not found at ${chromePath}.`);
    }
    if (startUrl && !unmasked) {
      assertLocalUrl(startUrl, "startUrl");
    }

    /** @type {string} */
    let profileDir;
    let profilePersistent = false;
    if (profileName) {
      profileDir = profilePath(profileName);
      mkdirSync(profileDir, { recursive: true });
      const lockPath = resolve(profileDir, "SingletonLock");
      if (existsSync(lockPath)) {
        throw new Error(
          `Profile "${profileName}" is in use or has a stale lock. ` +
            `If no other capture is running, remove ${lockPath} and retry.`
        );
      }
      profilePersistent = true;
    } else {
      profileDir = createCaptureProfileDir(runId);
    }

    return initializeDaemon({
      chromePath,
      debugPort: assignedDebugPort,
      fixture,
      headless,
      profileDir,
      profilePersistent,
      runId,
      runPaths,
      startUrl,
      captureMode,
      snapshotDom,
      unmasked
    });
  });
}

/**
 * @param {Record<string, string | boolean>} options
 * @returns {"normal" | "strict"}
 */
export function resolveCaptureModeOption(options) {
  const mode = getStringOption(options, "capture-mode", "normal") ?? "normal";
  if (mode === "normal" || mode === "strict") {
    return mode;
  }
  throw new Error(`prepare: invalid --capture-mode "${mode}". Expected normal or strict.`);
}

/**
 * @param {{
 *   chromePath: string,
 *   debugPort: number,
 *   fixture: string,
 *   headless: boolean,
 *   profileDir: string,
 *   profilePersistent: boolean,
 *   runId: string,
 *   runPaths: ReturnType<typeof getRunPaths>,
 *   startUrl: string | undefined,
 *   captureMode: "normal" | "strict",
 *   snapshotDom: boolean,
 *   unmasked: boolean
 * }} input
 */
function initializeDaemon(input) {
  return {
    runId: input.runId,
    startUrl: input.startUrl ? sanitizeUrl(input.startUrl, { unmasked: input.unmasked }) : undefined,
    fixture: input.fixture,
    headless: input.headless,
    captureMode: input.captureMode,
    snapshotDom: input.snapshotDom,
    profilePersistent: input.profilePersistent,
    unmasked: input.unmasked,
    ...(awaitReady(input))
  };
}

/**
 * @param {{
 *   chromePath: string,
 *   debugPort: number,
 *   fixture: string,
 *   headless: boolean,
 *   profileDir: string,
 *   profilePersistent: boolean,
 *   runId: string,
 *   runPaths: ReturnType<typeof getRunPaths>,
 *   startUrl: string | undefined,
 *   captureMode: "normal" | "strict",
 *   snapshotDom: boolean,
 *   unmasked: boolean
 * }} input
 */
function awaitReady(input) {
  const config = {
    chromePath: input.chromePath,
    createdAt: new Date().toISOString(),
    debugPort: input.debugPort,
    fixture: input.fixture,
    headless: input.headless,
    profileDir: input.profileDir,
    profileMode: input.profilePersistent ? "persistent-named" : "ephemeral-temp",
    profilePersistent: input.profilePersistent,
    runId: input.runId,
    startUrl: input.startUrl ? sanitizeUrl(input.startUrl) : (input.fixture === "manual" ? "about:blank" : undefined),
    status: "preparing",
    captureMode: input.captureMode,
    snapshotDom: input.snapshotDom,
    unmasked: input.unmasked
  };

  writeJson(input.runPaths.manifestPath, config);
  writeJson(input.runPaths.controlPath, config);

  const daemonPath = fileURLToPath(new URL("../observe/observer-daemon.mjs", import.meta.url));
  const logFd = openSync(input.runPaths.daemonLogPath, "a");
  const child = spawn(process.execPath, [daemonPath, input.runId], {
    cwd: getRepoRoot(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      BROWSER_FLOW_PROFILE_DIR: input.profileDir,
      BROWSER_FLOW_START_URL_RAW: input.startUrl ?? ""
    }
  });
  child.unref();

  return waitForDaemonReady(input.runPaths.controlPath);
}

/**
 * @param {string} controlPath
 */
function waitForDaemonReady(controlPath) {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt <= timeoutMs) {
    /** @type {{ status?: string, error?: string } | undefined} */
    let control;
    try {
      control = /** @type {{ status?: string, error?: string }} */ (readJson(controlPath));
    } catch {
      // The daemon may not have written its readiness state yet.
    }

    if (control?.status === "ready") {
      return control;
    }
    if (control?.status === "error") {
      throw new Error(control.error ?? "Observer daemon failed during startup.");
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  throw new Error("Timed out waiting for observer daemon to become ready.");
}
