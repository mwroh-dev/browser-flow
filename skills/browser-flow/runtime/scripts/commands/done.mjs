import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths, getTaskPath } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { withTrace } from "../lib/trace.mjs";
import { createTask } from "../lib/workflow-status.mjs";
import { scanBrokenTasks, formatBrokenNotice } from "../lib/broken-state-validator.mjs";
import { detectCaptureNoise } from "../analyze/capture-noise.mjs";
import { detectLocatorIntent } from "../analyze/locator-intent.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export async function doneCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("done requires --run-id.");
  }

  const runPaths = getRunPaths(runId);
  return withTrace(runPaths, "done", async () => {
    const control = /** @type {{ controlPort?: number }} */ (readJson(runPaths.controlPath));
    if (!control.controlPort) {
      throw new Error(`Run ${runId} is missing control port metadata.`);
    }
    const captureScreenshot = getStringOption(options, "capture-screenshot", undefined);
    if (captureScreenshot !== undefined && captureScreenshot !== "final") {
      throw new Error(`done: invalid --capture-screenshot mode "${captureScreenshot}". Expected final.`);
    }
    const doneUrl = new URL(`http://127.0.0.1:${control.controlPort}/done`);
    if (captureScreenshot === "final") {
      doneUrl.searchParams.set("captureScreenshot", "final");
    }
    const response = await fetch(doneUrl, {
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(`Observer daemon returned ${response.status} for /done.`);
    }
    const doneResult = await response.json();
    const captureDiagnostics = writeCaptureNoisePreview(runPaths);
    const locatorDiagnostics = writeLocatorIntentPreview(runPaths);
    // Register the variable-extraction task in pending state.
    registerVariableExtractionTask(runPaths);
    // Surface any prior broken-state tasks for this runId — non-blocking,
    // capture data is the most expensive resource and must not be refused.
    surfaceBrokenStateNotice(runPaths.runId);
    return { ...doneResult, captureDiagnostics, locatorDiagnostics };
  });
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
export function writeCaptureNoisePreview(runPaths) {
  try {
    const events = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.sanitizedEventsPath));
    const manifest = /** @type {{ fixture?: string, startUrl?: string }} */ (readJson(runPaths.manifestPath));
    const navigates = events.filter((event) => event.type === "navigate" && event.url);
    const realNavigates = navigates.filter((event) => event.url !== "about:blank");
    const firstNavigate = realNavigates[0]?.url ?? manifest.startUrl ?? navigates[0]?.url ?? "about:blank";
    const finalNavigate = realNavigates[realNavigates.length - 1]?.url ?? firstNavigate;
    const preview = detectCaptureNoise({
      events,
      fixture: manifest.fixture ?? "manual",
      firstNavigate,
      finalNavigate
    });
    const previewPath = runPaths.captureNoisePreviewPath;
    mkdirSync(runPaths.analysisDir, { recursive: true });
    writeFileSync(previewPath, JSON.stringify(preview, null, 2) + "\n", "utf8");
    return { ...preview, artifact: relative(runPaths.runRoot, previewPath) };
  } catch (error) {
    return {
      schemaVersion: 1,
      status: "unavailable",
      suggestions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
export function writeLocatorIntentPreview(runPaths) {
  try {
    const events = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.sanitizedEventsPath));
    const manifest = /** @type {{ fixture?: string, startUrl?: string }} */ (readJson(runPaths.manifestPath));
    const navigates = events.filter((event) => event.type === "navigate" && event.url);
    const realNavigates = navigates.filter((event) => event.url !== "about:blank");
    const firstNavigate = realNavigates[0]?.url ?? manifest.startUrl ?? navigates[0]?.url ?? "about:blank";
    const preview = detectLocatorIntent({
      events,
      fixture: manifest.fixture ?? "manual",
      firstNavigate
    });
    const previewPath = runPaths.locatorIntentPreviewPath;
    mkdirSync(runPaths.analysisDir, { recursive: true });
    writeFileSync(previewPath, JSON.stringify(preview, null, 2) + "\n", "utf8");
    return { ...preview, artifact: relative(runPaths.runRoot, previewPath) };
  } catch (error) {
    return {
      schemaVersion: 1,
      status: "unavailable",
      suggestions: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {string} runId
 */
function surfaceBrokenStateNotice(runId) {
  const broken = scanBrokenTasks(runId);
  if (broken.length === 0) return;
  process.stderr.write(formatBrokenNotice(broken, {
    resumeHint: `재개하려면: bf vars --run-id ${runId} --resume`
  }) + "\n");
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 */
function registerVariableExtractionTask(runPaths) {
  const taskPath = getTaskPath(runPaths.runId, "variable-extraction");
  if (existsSync(taskPath)) {
    return; // idempotent — repeated bf done on same run preserves the existing state
  }
  mkdirSync(runPaths.tasksDir, { recursive: true });
  const task = createTask({
    kind: "variable-extraction",
    runId: runPaths.runId,
    context: {}
  });
  writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
}
