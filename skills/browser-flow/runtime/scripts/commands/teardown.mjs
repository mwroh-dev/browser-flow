import { getStringOption } from "../lib/args.mjs";
import { getRunPaths, pagePaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseWorkflowArtifact } from "../lib/schemas.mjs";
import { buildRecordTeardown, buildSearchTeardown } from "../lib/teardown.mjs";

/**
 * Link a teardown into a main workflow. Supports two strategies:
 * - `search`: discover a delete affordance from a captured page's selectors.json
 * - `record`: lift a cleanup run's steps directly as the teardown
 *
 * @param {{ runId: string, recordFrom?: string, search?: { intent: string, pageKey: string } }} input
 * @returns {{ runId: string, strategy: string | undefined, recordedFrom?: string, searchedPage?: string, teardownStepCount: number }}
 */
export function runTeardownCommand(input) {
  const mainPaths = getRunPaths(input.runId);
  const mainWorkflow = /** @type {Record<string, unknown>} */ (readJson(mainPaths.workflowJsonPath));
  if (input.search) {
    const pageNode = /** @type {{ selectors?: Array<Record<string, unknown>> }} */ (
      readJson(pagePaths(input.search.pageKey).selectorsPath)
    );
    mainWorkflow.teardown = buildSearchTeardown(/** @type {any} */ (pageNode.selectors ?? []), input.search.intent);
  } else if (input.recordFrom) {
    const cleanupWorkflow = /** @type {{ steps: Array<Record<string, unknown>> }} */ (
      readJson(getRunPaths(input.recordFrom).workflowJsonPath)
    );
    mainWorkflow.teardown = buildRecordTeardown(cleanupWorkflow.steps);
  } else {
    throw new Error("runTeardownCommand requires either recordFrom or search");
  }
  const validated = parseWorkflowArtifact(mainWorkflow, mainPaths.workflowJsonPath);
  writeJson(mainPaths.workflowJsonPath, validated);
  return {
    runId: input.runId,
    strategy: validated.teardown?.strategy,
    recordedFrom: input.recordFrom,
    searchedPage: input.search?.pageKey,
    teardownStepCount: validated.teardown?.steps.length ?? 0
  };
}

/**
 * CLI entry for `bf teardown`.
 *
 * @param {Record<string, string | boolean>} options
 */
export function teardownCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  const recordFrom = getStringOption(options, "record", undefined);
  const isSearch = options.search === true || options.search === "true";
  const intent = getStringOption(options, "intent", undefined);
  const page = getStringOption(options, "page", undefined);
  if (isSearch && recordFrom) {
    throw new Error("bf teardown: --search and --record are mutually exclusive");
  }
  if (!runId) throw new Error("bf teardown requires --run-id");
  if (isSearch) {
    let pageKey = page;
    if (!pageKey) {
      const wf = /** @type {{ steps?: Array<{ pageKey?: string }> }} */ (
        readJson(getRunPaths(runId).workflowJsonPath)
      );
      const steps = Array.isArray(wf.steps) ? wf.steps : [];
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (typeof steps[i]?.pageKey === "string" && steps[i].pageKey) {
          pageKey = steps[i].pageKey;
          break;
        }
      }
    }
    if (!pageKey) throw new Error("bf teardown --search requires --page <pageKey> (or a workflow step with a pageKey)");
    return runTeardownCommand({ runId, search: { intent: intent ?? "", pageKey } });
  }
  if (!recordFrom) throw new Error("bf teardown requires --record <cleanupRunId> or --search --page <pageKey>");
  return runTeardownCommand({ runId, recordFrom });
}
