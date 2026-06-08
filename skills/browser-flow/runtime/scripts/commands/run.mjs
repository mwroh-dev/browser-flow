/**
 * `bf run <runId> --bind input.X=value`
 *
 * Binds workflow inputs and emits a new runner under a derived runId.
 *
 * Flow:
 *   1. Read source runId's workflow.json
 *   2. Collect all --bind input.X=value from CLI argv
 *   3. bindInputs(workflow, bindings) → bound workflow
 *   4. Create new runId directory (artifacts/runs/<newRunId>/)
 *   5. New manifest.json (sourceRunId + bindings metadata) + new workflow.json (bound)
 *   6. generateRunner(newRunId) → new runner.mjs (reuses generate-runner)
 *   7. If --execute flag, spawn the new runner
 */

import { existsSync, mkdirSync } from "node:fs";
import { getRunPaths, ensureRunDirs } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { bindInputs, bindingsShortHash } from "../lib/workflow-inputs.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";

/**
 * Collect every occurrence of --bind key=value from argv. Supports both
 * `--bind input.fileName=/path` (canonical, strips `input.` prefix)
 * and bare `--bind fileName=/path`.
 *
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function collectBindingsFromArgv(argv) {
  /** @type {Record<string, string>} */
  const bindings = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--bind") continue;
    const pair = argv[i + 1];
    if (!pair || pair.startsWith("--")) {
      throw new Error("--bind requires a key=value argument (e.g. --bind input.fileName=/tmp/x.pdf).");
    }
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--bind argument "${pair}" must be key=value form.`);
    }
    const rawKey = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const key = rawKey.startsWith("input.") ? rawKey.slice("input.".length) : rawKey;
    if (key in bindings) {
      throw new Error(`Duplicate --bind for input "${key}".`);
    }
    bindings[key] = value;
    i += 1;
  }
  return bindings;
}

/**
 * @param {Record<string, string | boolean>} options
 * @param {string[]} [argv]
 */
export function runCommand(options, argv = process.argv) {
  const runId = typeof options["run-id"] === "string" ? /** @type {string} */ (options["run-id"]) : "";
  if (!runId) {
    throw new Error("run requires --run-id.");
  }
  const dryRun = options["dry-run"] === true;
  const originalPaths = getRunPaths(runId);
  if (!existsSync(originalPaths.workflowJsonPath)) {
    throw new Error(`Source workflow not found at ${originalPaths.workflowJsonPath}. Run \`bf analyze --run-id ${runId}\` first.`);
  }
  const sourceWorkflow = /** @type {Record<string, unknown>} */ (readJson(originalPaths.workflowJsonPath));
  const bindings = collectBindingsFromArgv(argv);

  // bindInputs throws on undeclared bindings + missing placeholders.
  const boundWorkflow = bindInputs(sourceWorkflow, bindings);

  // 새 runId 명명 — 결정적 short hash 으로 같은 bindings 는 idempotent.
  const hash = bindingsShortHash(bindings);
  const newRunId = `${runId}-bind-${hash}`;
  const previewPaths = getRunPaths(newRunId);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      sourceRunId: runId,
      newRunId,
      newRunRoot: previewPaths.runRoot,
      bindings,
      bindingsHash: hash,
      wouldWrite: [previewPaths.manifestPath, previewPaths.workflowJsonPath, previewPaths.runnerPath],
      registryMutation: "none"
    };
  }
  const newPaths = ensureRunDirs(newRunId);

  // 새 manifest — sourceRunId + bindings 메타로 출처 기록.
  const sourceManifest = /** @type {Record<string, unknown>} */ (readJson(originalPaths.manifestPath));
  writeJson(newPaths.manifestPath, {
    ...sourceManifest,
    runId: newRunId,
    sourceRunId: runId,
    bindings,
    createdAt: new Date().toISOString(),
    boundFrom: "phase-61b-run"
  });

  // 새 workflow.json (bound) — id 를 새 runId 로 갱신.
  const boundForPersist = { ...boundWorkflow, id: newRunId };
  writeJson(newPaths.workflowJsonPath, boundForPersist);

  // generate-runner 재사용 — 새 runId 의 workflow.json 위에서 runner.mjs 생성.
  // generate-runner는 workflow.security.localOnly === false (unmasked) 경우에
  // 한해 registry skip + 진행. bind-derived 산출은 원본의 security flag를 그대로 상속.
  const generateResult = generateRunner(newRunId);

  return {
    sourceRunId: runId,
    newRunId,
    newRunRoot: newPaths.runRoot,
    runnerPath: generateResult.runnerPath,
    bindings,
    bindingsHash: hash
  };
}
