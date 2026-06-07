import test from "node:test";
import assert from "node:assert/strict";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

/**
 * Signal-capture e2e — proves the recorder assembles
 * href / neighborTexts / cleanId / type on each captured step
 * end-to-end through prepare → capture → done → analyze → workflow.json.
 *
 * Fixture elements:
 *   - input[data-bf="field"][id="mw9xZqA1"][type="email"]
 *       dynamic id (mw…) → cleanId must be ""
 *       type attribute → locator.type === "email"
 *   - a[data-bf="go"][id="go-link"][href="/signals/dest"]
 *       stable id → cleanId === "go-link"
 *       href present → locator.href includes "/signals/dest"
 *       surrounded by <p>Before marker</p>/<p>After marker</p>
 *       → neighborTexts includes a string containing "marker"
 */
test("verify-signal-capture: href/neighborTexts/cleanId/type captured end-to-end", { timeout: 90000 }, async () => {
  const runId = `signals-e2e-${Date.now()}`;

  // 1. PREPARE — start Chrome with the signals fixture server.
  const prepared = /** @type {{ debugPort: number }} */ (
    runCli(["prepare", "--run-id", runId, "--fixture", "signals", "--headless"])
  );

  // 2. DRIVE — fill the email input then click the anchor link.
  await driveObservedWorkflow({ debugPort: prepared.debugPort, workflow: "signals" });

  // 3. DONE + ANALYZE — flush + compile the captured events.
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);

  // 4. ASSERT — inspect the compiled workflow.json locators.
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ action: string, selector?: string, locator?: { type?: string, cleanId?: string, href?: string, neighborTexts?: string[] } }> }} */ (
    readJson(runPaths.workflowJsonPath)
  );

  // --- fill step (data-bf="field") ---
  const fillStep = workflow.steps.find(
    (s) => s.action === "fill" && typeof s.selector === "string" && s.selector.includes("field")
  );
  assert.ok(fillStep, `workflow must include a fill step for "field" — steps: ${JSON.stringify(workflow.steps.map((s) => ({ action: s.action, selector: s.selector })))}`);
  assert.ok(fillStep.locator, "fill step must carry a locator");
  assert.equal(
    fillStep.locator.type,
    "email",
    `fill locator.type must be "email" (from type="email" attribute) — got: ${JSON.stringify(fillStep.locator.type)}`
  );
  assert.equal(
    fillStep.locator.cleanId,
    "",
    `fill locator.cleanId must be "" — dynamic mw id must be filtered — got: ${JSON.stringify(fillStep.locator.cleanId)}`
  );

  // --- click step (data-bf="go") ---
  const clickStep = workflow.steps.find(
    (s) => s.action === "click" && typeof s.selector === "string" && s.selector.includes("go")
  );
  assert.ok(clickStep, `workflow must include a click step for "go" — steps: ${JSON.stringify(workflow.steps.map((s) => ({ action: s.action, selector: s.selector })))}`);
  assert.ok(clickStep.locator, "click step must carry a locator");
  assert.ok(
    typeof clickStep.locator.href === "string" && clickStep.locator.href.length > 0,
    `click locator.href must be a non-empty string — got: ${JSON.stringify(clickStep.locator.href)}`
  );
  assert.ok(
    clickStep.locator.href.includes("/signals/dest"),
    `click locator.href must include "/signals/dest" — got: ${JSON.stringify(clickStep.locator.href)}`
  );
  assert.equal(
    clickStep.locator.cleanId,
    "go-link",
    `click locator.cleanId must be "go-link" — stable id must be preserved — got: ${JSON.stringify(clickStep.locator.cleanId)}`
  );
  assert.ok(
    Array.isArray(clickStep.locator.neighborTexts) && clickStep.locator.neighborTexts.length > 0,
    `click locator.neighborTexts must be a non-empty array — got: ${JSON.stringify(clickStep.locator.neighborTexts)}`
  );
  assert.ok(
    clickStep.locator.neighborTexts.some((t) => t.includes("marker")),
    `click locator.neighborTexts must contain a string with "marker" — got: ${JSON.stringify(clickStep.locator.neighborTexts)}`
  );

  // Report the actual captured values for the task report.
  console.log("[signal-capture] fill locator:", JSON.stringify(fillStep.locator));
  console.log("[signal-capture] click locator:", JSON.stringify(clickStep.locator));
});
