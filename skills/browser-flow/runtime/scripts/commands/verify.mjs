import { getBooleanOption, getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";
import { parseWorkflowArtifact } from "../lib/schemas.mjs";
import { withTrace } from "../lib/trace.mjs";
import { verifyRun } from "../verify/verify-run.mjs";

const SCREENSHOT_MODES = new Set(["off", "final", "steps", "both"]);

/**
 * @param {Record<string, string | boolean>} options
 */
export async function verifyCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("verify requires --run-id.");
  }

  const screenshotMode = getStringOption(options, "screenshots", undefined);
  if (screenshotMode !== undefined && !SCREENSHOT_MODES.has(screenshotMode)) {
    throw new Error(`verify: invalid --screenshots mode "${screenshotMode}". Expected one of off | final | steps | both.`);
  }

  // --first / --repeat flags for auth-mode selection.
  // Default: "repeat" (automated keychain-session path). Use --first for
  // the human-driven login bootstrap (real-site only, not auto-tested).
  /** @type {"first" | "repeat" | undefined} */
  let mode;
  if (getBooleanOption(options, "first")) {
    mode = "first";
  } else if (getBooleanOption(options, "repeat")) {
    mode = "repeat";
  }

  // --attach <port> connects to a user-logged-in Chrome (no spawn, no cookie injection).
  // Auth comes from the attached browser, so attach takes precedence over --first/--repeat.
  const attachRaw = getStringOption(options, "attach", undefined);
  /** @type {number | undefined} */
  let attachPort;
  if (attachRaw !== undefined) {
    attachPort = Number(attachRaw);
    if (!Number.isInteger(attachPort) || attachPort <= 0) {
      throw new Error(`verify: invalid --attach port "${attachRaw}".`);
    }
  }

  const runPaths = getRunPaths(runId);
  if (screenshotMode !== undefined) {
    const workflow = parseWorkflowArtifact(readJson(runPaths.workflowJsonPath), runPaths.workflowJsonPath);
    const nextWorkflow = {
      ...workflow,
      security: {
        ...(workflow.security ?? {}),
        screenshotMode,
        screenshotsPersisted: screenshotMode !== "off"
      }
    };
    writeJson(runPaths.workflowJsonPath, nextWorkflow);
    generateRunner(runId);
  }
  return withTrace(runPaths, "verify", () =>
    verifyRun(runId, {
      headless: getBooleanOption(options, "headless"),
      ...(mode !== undefined ? { mode } : {}),
      ...(attachPort !== undefined ? { attachPort } : {})
    })
  );
}
