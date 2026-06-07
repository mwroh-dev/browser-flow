import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { getPaths, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

// --unmasked debug mode. Bypasses URL-boundary local-only
// check; blocks persistence-boundary registry write. Constitutional
// invariant #1 (no non-local-only entries in the verified-flow
// catalog) is preserved at the registry-write site.

test("--unmasked + external --start-url does NOT throw at prepare", () => {
  const runId = `unmasked-external-${Date.now()}`;
  // No driveObservedWorkflow / done — we only assert that prepare
  // does not reject the external URL. The daemon will spawn Chrome
  // for about:blank / unreachable target; we tear it down by sending
  // done after a minimal driver pause. Simpler: send done immediately
  // and accept whatever capture state results.
  let prepared;
  try {
    prepared = runCli([
      "prepare",
      "--run-id", runId,
      "--fixture", "manual",
      "--headless",
      "--unmasked",
      "--start-url", "https://example.com/"
    ]);
    assert.equal(prepared.status, "ready", "prepare must accept external URL under --unmasked");
    assert.equal(prepared.unmasked, true, "prepare result must surface unmasked: true");
  } finally {
    if (prepared) {
      runCli(["done", "--run-id", runId]);
    }
  }
});

test("external --start-url WITHOUT --unmasked is rejected at prepare", () => {
  let threw = false;
  try {
    runCli([
      "prepare",
      "--run-id", `unmasked-rejected-${Date.now()}`,
      "--fixture", "manual",
      "--headless",
      "--start-url", "https://example.com/"
    ]);
  } catch (error) {
    threw = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /local|local-only|loopback/i, `unexpected rejection message: ${message}`);
  }
  assert.equal(threw, true, "prepare must reject external URL when --unmasked is absent");
});

test("--unmasked synthetic full-loop sets workflow.security.localOnly=false and skips registry", async () => {
  const runId = `unmasked-skip-registry-${Date.now()}`;
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless",
    "--unmasked"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
  runCli(["generate", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ security: { localOnly: boolean } }} */ (readJson(runPaths.workflowJsonPath));
  assert.equal(workflow.security.localOnly, false, "compile must invert security.localOnly under unmasked");

  // Registry must NOT contain this run's id. The test setup
  // redirects BROWSER_FLOW_REGISTRY_PATH to a per-suite tmpdir
  // (tests/_setup.mjs), so other unmasked tests in the same run
  // also don't pollute it. We assert that this run-id is absent.
  const { registryPath } = getPaths();
  if (existsSync(registryPath)) {
    const registry = /** @type {Array<{ id: string }>} */ (readJson(registryPath));
    const matching = registry.filter((entry) => entry.id === runId);
    assert.equal(matching.length, 0, `unmasked run must NOT be persisted to the registry; found ${matching.length} entries for ${runId}`);
  }
  // (If registryPath does not exist, the registry is empty, which
  //  is also a valid "not persisted" outcome.)
});
