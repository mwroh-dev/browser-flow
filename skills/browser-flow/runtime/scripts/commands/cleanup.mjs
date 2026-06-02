import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { readJournal } from "../lib/state-journal.mjs";
import { collectDangling } from "../lib/dangling.mjs";

/**
 * bf cleanup — reads the run's state journal, collects dangling artifact names,
 * and spawns the run's generated runner in cleanup-only mode
 * (BROWSER_FLOW_CLEANUP_NAMES env var) to delete them via the teardown recipe.
 *
 * @param {{ runId: string, headless?: boolean }} input
 * @returns {Promise<{ runId: string, dangling: string[], removed: string[], errors: Array<{name:string,error:string}> }>}
 */
export async function runCleanupCommand(input) {
  const runPaths = getRunPaths(input.runId);
  const journal = readJournal(runPaths.journalPath);
  const dangling = collectDangling(journal);
  if (dangling.length === 0) {
    return { runId: input.runId, dangling: [], removed: [], errors: [] };
  }
  if (!existsSync(runPaths.runnerPath)) {
    return {
      runId: input.runId,
      dangling,
      removed: [],
      errors: dangling.map((name) => ({
        name,
        error: "generated runner missing; cleanup cannot execute"
      }))
    };
  }
  await spawnCleanupRunner(runPaths.runnerPath, input.headless !== false, JSON.stringify(dangling));
  /** @type {any} */
  let report = {};
  if (existsSync(runPaths.verificationPath)) {
    try { report = readJson(runPaths.verificationPath); } catch (_) {}
  }
  const cleanup = report.cleanup || { requested: dangling, removed: [], errors: [] };
  return {
    runId: input.runId,
    dangling,
    removed: cleanup.removed ?? [],
    errors: cleanup.errors ?? []
  };
}

/**
 * Spawn the generated runner in cleanup-only mode.
 * Headless is passed as --headless CLI arg (mirrors verify-run.mjs spawnRunner).
 * BROWSER_FLOW_CLEANUP_NAMES env var seeds the artifact list.
 *
 * @param {string} runnerPath
 * @param {boolean} headless
 * @param {string} cleanupNamesJson
 * @returns {Promise<void>}
 */
function spawnCleanupRunner(runnerPath, headless, cleanupNamesJson) {
  return new Promise((resolve, reject) => {
    const args = [runnerPath];
    if (headless) {
      args.push("--headless");
    }
    /** @type {Record<string, string>} */
    const env = Object.fromEntries(
      Object.entries(process.env)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, /** @type {string} */ (v)])
    );
    env.BROWSER_FLOW_CLEANUP_NAMES = cleanupNamesJson;
    const child = spawn(process.execPath, args, {
      env,
      stdio: ["ignore", "ignore", "inherit"]
    });
    child.on("error", reject);
    child.on("exit", () => resolve(undefined));
  });
}

/**
 * @param {Record<string, string | boolean>} options
 * @returns {Promise<{ runId: string, dangling: string[], removed: string[], errors: Array<{name:string,error:string}> }>}
 */
export function cleanupCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf cleanup requires --run-id");
  return runCleanupCommand({ runId });
}
