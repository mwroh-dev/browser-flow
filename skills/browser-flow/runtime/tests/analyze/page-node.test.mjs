import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ensureRunDirs, pagePaths, pageSnapshotPath } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";

// compile.mjs derives pageKey for each step + writes per-page-node
// knowledge under knowledge/pages/<pageKey>/. Each test below installs its
// own BROWSER_FLOW_PAGES_PATH override so accumulated state does not bleed
// across tests (the global override from tests/_setup.mjs is the default
// but these tests need their own isolated pages tree per-test for the
// captureCount assertions to be deterministic).

/**
 * @param {() => Promise<void> | void} body
 */
async function withIsolatedPages(body) {
  const previous = process.env.BROWSER_FLOW_PAGES_PATH;
  const isolatedRoot = mkdtempSync(join(tmpdir(), "browser-flow-page-node-test-"));
  process.env.BROWSER_FLOW_PAGES_PATH = isolatedRoot;
  try {
    await body();
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSER_FLOW_PAGES_PATH;
    } else {
      process.env.BROWSER_FLOW_PAGES_PATH = previous;
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

function fixtureSyntheticEvents() {
  return [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", fieldName: "displayName", value: "Codex", secret: false, timestamp: 950, ancestors: [{ tag: "form", id: "", role: "form", ariaLabel: "", dataBf: "", dataTestid: "" }], siblings: { totalMatchingSelector: 1, totalMatchingRole: 1 } },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000, ancestors: [{ tag: "main", id: "", role: "main", ariaLabel: "", dataBf: "", dataTestid: "" }], siblings: { totalMatchingSelector: 1, totalMatchingRole: 1 } },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ];
}

/**
 * @param {string} runId
 * @param {string} fixture
 * @param {Array<Record<string, unknown>>} events
 */
function seedRunArtifacts(runId, fixture, events) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    runId,
    fixture,
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, events);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);
  return runPaths;
}

test("compile tags each workflow step with a derived pageKey", async () => {
  await withIsolatedPages(() => {
    const runId = `page-node-tag-${Date.now()}`;
    seedRunArtifacts(runId, "synthetic", fixtureSyntheticEvents());

    const rawWorkflow = compileRun(runId);
    const workflow = /** @type {{ steps: Array<{ action: string, pageKey?: string }> }} */ (/** @type {unknown} */ (rawWorkflow));
    assert.ok(Array.isArray(workflow.steps), "workflow.steps must be array");
    for (const step of workflow.steps) {
      assert.equal(typeof step.pageKey, "string", `step ${step.action} must carry pageKey`);
      const key = /** @type {string} */ (step.pageKey);
      assert.ok(key.length > 0, `step ${step.action} pageKey must be non-empty`);
    }
    // goto + fill + click all happen on the source page (synthetic/synthetic).
    // The transition to the result page only updates currentPageKey AFTER
    // the click is processed, so the click step is tagged with the source.
    const sourcePageKeys = workflow.steps.map((step) => step.pageKey);
    assert.ok(sourcePageKeys.includes("synthetic/synthetic"), "expected at least one step on synthetic/synthetic");
  });
});

test("first compile creates per-page-node selectors.json + neighbors.json + meta.json", async () => {
  await withIsolatedPages(() => {
    const runId = `page-node-create-${Date.now()}`;
    seedRunArtifacts(runId, "synthetic", fixtureSyntheticEvents());

    compileRun(runId);

    const sourcePaths = pagePaths("synthetic/synthetic");
    const targetPaths = pagePaths("synthetic/synthetic/result");

    assert.equal(existsSync(sourcePaths.selectorsPath), true, "source page selectors.json must exist");
    assert.equal(existsSync(sourcePaths.neighborsPath), true, "source page neighbors.json must exist");
    assert.equal(existsSync(sourcePaths.metaPath), true, "source page meta.json must exist");
    assert.equal(existsSync(targetPaths.metaPath), true, "target page meta.json must exist (terminal node)");

    const sourceMeta = /** @type {{ pageKey: string, captureCount: number, fixtures: string[] }} */ (readJson(sourcePaths.metaPath));
    assert.equal(sourceMeta.pageKey, "synthetic/synthetic");
    assert.equal(sourceMeta.captureCount, 1);
    assert.deepEqual(sourceMeta.fixtures, ["synthetic"]);

    const sourceSelectors = /** @type {{ selectors: Array<{ selector: string, captureCount: number, actions: string[] }> }} */ (readJson(sourcePaths.selectorsPath));
    const launchEntry = sourceSelectors.selectors.find((entry) => entry.selector === "[data-bf=\"launch\"]");
    const nameInputEntry = sourceSelectors.selectors.find((entry) => entry.selector === "[data-bf=\"name-input\"]");
    assert.ok(launchEntry, "launch selector must be captured on source page");
    assert.ok(nameInputEntry, "name-input selector must be captured on source page");
    assert.equal(launchEntry?.captureCount, 1);
    assert.ok((launchEntry?.actions ?? []).includes("click"));
    assert.ok((nameInputEntry?.actions ?? []).includes("fill"));

    const sourceNeighbors = /** @type {{ outgoing: Array<{ to: string, transitionCount: number }> }} */ (readJson(sourcePaths.neighborsPath));
    const edgeToResult = sourceNeighbors.outgoing.find((edge) => edge.to === "synthetic/synthetic/result");
    assert.ok(edgeToResult, "source page must have outgoing edge to result page");
    assert.equal(edgeToResult?.transitionCount, 1);
  });
});

test("snapshot lift copies artifacts/snapshots into knowledge/pages/<key>/snapshots/", async () => {
  await withIsolatedPages(() => {
    const runId = `snapshot-lift-${Date.now()}`;
    const runPaths = seedRunArtifacts(runId, "synthetic", fixtureSyntheticEvents());

    // Seed outputs by hand: snapshot file + manifest. We seed
    // the same shape observer-daemon would write at done time, then
    // verify compile lifts to the page-node store.
    mkdirSync(runPaths.snapshotsDir, { recursive: true });
    const snapshotIndex = 0;
    const snapshotTimestamp = 1779200000000;
    const snapshotFilename = "000-synthetic.html.gz";
    const sourceHtml = "<!doctype html><html><body><h1 data-bf-evidence=\"heading\">Synthetic Demo</h1></body></html>";
    const sourcePath = resolvePath(runPaths.snapshotsDir, snapshotFilename);
    writeFileSync(sourcePath, gzipSync(sourceHtml));
    writeJson(runPaths.snapshotsManifestPath, {
      schemaVersion: 1,
      entries: [
        {
          index: snapshotIndex,
          url: "http://127.0.0.1:59999/synthetic",
          timestamp: snapshotTimestamp,
          filename: snapshotFilename
        }
      ]
    });

    compileRun(runId);

    const destinationPath = pageSnapshotPath("synthetic/synthetic", snapshotTimestamp);
    assert.equal(existsSync(destinationPath), true, "snapshot must be lifted to knowledge/pages/synthetic/synthetic/snapshots/");
    const lifted = gunzipSync(readFileSync(destinationPath)).toString("utf8");
    assert.equal(lifted, sourceHtml, "lifted snapshot bytes must match source");

    // Artifacts file remains as audit trail (copy semantics, not move).
    assert.equal(existsSync(sourcePath), true, "source artifacts snapshot must remain (copy semantics)");
  });
});

test("compile is a no-op for snapshots when manifest is absent (snapshot mode off)", async () => {
  await withIsolatedPages(() => {
    const runId = `snapshot-lift-noop-${Date.now()}`;
    const runPaths = seedRunArtifacts(runId, "synthetic", fixtureSyntheticEvents());
    // No snapshots-manifest.json seeded — represents a run with
    // snapshot mode off. compile must not fail and must not create
    // any page-node snapshots/ directory.

    compileRun(runId);

    const sourcePaths = pagePaths("synthetic/synthetic");
    assert.equal(existsSync(sourcePaths.snapshotsDir), false, "no snapshots dir when manifest absent");
  });
});

test("second compile on the same fixture merges into existing page-node files", async () => {
  await withIsolatedPages(() => {
    const runId1 = `page-node-merge-1-${Date.now()}`;
    seedRunArtifacts(runId1, "synthetic", fixtureSyntheticEvents());
    compileRun(runId1);

    const runId2 = `page-node-merge-2-${Date.now()}-b`;
    seedRunArtifacts(runId2, "synthetic", fixtureSyntheticEvents());
    compileRun(runId2);

    const sourcePaths = pagePaths("synthetic/synthetic");
    const meta = /** @type {{ captureCount: number, fixtures: string[] }} */ (readJson(sourcePaths.metaPath));
    assert.equal(meta.captureCount, 2, "captureCount must accumulate across runs");
    assert.deepEqual(meta.fixtures, ["synthetic"], "fixtures list dedup-s within the same fixture");

    const selectors = /** @type {{ selectors: Array<{ selector: string, captureCount: number }> }} */ (readJson(sourcePaths.selectorsPath));
    const launchEntry = selectors.selectors.find((entry) => entry.selector === "[data-bf=\"launch\"]");
    assert.equal(launchEntry?.captureCount, 2, "selector captureCount accumulates across runs");

    const neighbors = /** @type {{ outgoing: Array<{ to: string, transitionCount: number }> }} */ (readJson(sourcePaths.neighborsPath));
    const edge = neighbors.outgoing.find((entry) => entry.to === "synthetic/synthetic/result");
    assert.equal(edge?.transitionCount, 2, "transitionCount accumulates across runs");
  });
});
