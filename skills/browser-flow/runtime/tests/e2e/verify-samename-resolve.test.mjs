import test from "node:test";
import assert from "node:assert/strict";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

/**
 * Same-name disambiguation e2e (real Chrome, full pipeline).
 *
 * The `samename` fixture has TWO links with identical visible text "지리":
 *   - ANCHOR link: href="#geo", neighbor text "대한민국 개요"  (a section anchor — page stays at /samename)
 *   - ARTICLE link: href="/samename/geo", neighbor text "지리학 문서" (real navigation → /samename/geo)
 *
 * The OLD find-first resolver would grab the first "지리" by role+name — which half
 * the time would be the anchor (#geo), leaving the URL unchanged and verify failing.
 *
 * The coverage-aware scorer uses href + neighborTexts to disambiguate: the captured
 * locator carries href="/samename/geo" and neighborTexts containing "지리학 문서",
 * so the scorer picks the ARTICLE link with high confidence, navigates to /samename/geo,
 * and verify succeeds.
 *
 * Assert:
 *   1. result.report.success === true  (scorer picked the article link, not the anchor)
 *   2. resolverLayers has a click with layerUsed: "score"
 */
test("verify-samename-resolve: score-best disambiguates two '지리' links via href+neighbor", { timeout: 120000 }, async () => {
  const runId = `samename-e2e-${Date.now()}`;

  // 1. CAPTURE — prepare the samename fixture, drive a click on the ARTICLE link.
  const prepared = /** @type {{ debugPort: number }} */ (
    runCli(["prepare", "--run-id", runId, "--fixture", "samename", "--headless"])
  );

  await driveObservedWorkflow({ debugPort: prepared.debugPort, workflow: "samename" });

  // 2. DONE + ANALYZE — flush + compile captured events.
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);

  // 3. Assert the captured click carries href + neighborTexts (scorer signals present).
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ action: string, locator?: { href?: string, neighborTexts?: string[] } }> }} */ (
    readJson(runPaths.workflowJsonPath)
  );
  const clickStep = workflow.steps.find((s) => s.action === "click");
  assert.ok(clickStep, `captured workflow must include a click step — steps: ${JSON.stringify(workflow.steps.map((s) => s.action))}`);
  assert.ok(clickStep.locator, "captured click step must carry a locator");

  const capturedHref = clickStep.locator.href ?? "";
  const capturedNeighbors = clickStep.locator.neighborTexts ?? [];
  console.log("[samename] captured click locator href:", capturedHref);
  console.log("[samename] captured click locator neighborTexts:", JSON.stringify(capturedNeighbors));

  assert.ok(
    capturedHref.includes("/samename/geo"),
    `captured locator.href must include "/samename/geo" (article link) — got: ${JSON.stringify(capturedHref)}`
  );
  assert.ok(
    capturedNeighbors.some((t) => t.includes("지리학")),
    `captured locator.neighborTexts must contain "지리학" (article neighbor) — got: ${JSON.stringify(capturedNeighbors)}`
  );

  // 4. REPLAY — generate runner, then verify.
  // At replay there are TWO "지리" links; the scorer must pick the ARTICLE one
  // (via href+neighborTexts). If it picks the anchor (#geo), the URL stays at
  // /samename and verify fails.
  generateRunner(runId);
  const result = await verifyRun(runId, { headless: true });
  const report = /** @type {any} */ (result.report);

  console.log("[samename] verify report:", JSON.stringify(report));

  // 5. Primary assertion: scorer picked the article link, navigation succeeded.
  assert.equal(
    report.success,
    true,
    `verify must succeed (replay reached /samename/geo — scorer picked the ARTICLE "지리", not the anchor) — report: ${JSON.stringify(report)}`
  );

  // 6. Resolver assertion: click was resolved via the coverage-aware scorer.
  const layers = /** @type {Array<{ action: string, layerUsed: string }> | undefined} */ (report.resolverLayers);
  assert.ok(Array.isArray(layers), `report must include resolverLayers — report: ${JSON.stringify(report)}`);
  const clickLayer = layers.find((l) => l.action === "click");
  assert.ok(clickLayer, `resolverLayers must record the click — got: ${JSON.stringify(layers)}`);
  assert.equal(
    clickLayer.layerUsed,
    "score",
    `click must be resolved via the scorer (layerUsed="score") — got: ${clickLayer.layerUsed} (all: ${JSON.stringify(layers)})`
  );
});
