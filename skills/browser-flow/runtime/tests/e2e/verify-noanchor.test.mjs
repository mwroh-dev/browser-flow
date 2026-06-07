import test from "node:test";
import assert from "node:assert/strict";
import CDP from "chrome-remote-interface";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Name-independent resolution e2e (real capture then replay, no gate-bypass).
 *
 * The noanchor fixture's "Go" control has no id, no data-attributes, no aria, no
 * role, and a RANDOMIZED class per page load — so neither a CSS selector nor
 * role+name can re-locate it across loads. Only the layered resolver's
 * structural / relXPath / coords rungs can.
 *
 * Full pipeline (capture, sanitize, compile, generate, verify — NOT a hand-authored
 * workflow). The daemon and the runner each start their own built-in noanchor fixture
 * server (so the synchronous CLI calls do not deadlock an in-process server).
 */
test("verify-noanchor: name-independent resolution via the layered ladder (real capture then replay)", { timeout: 120000 }, async () => {
  const runId = `noanchor-e2e-${Date.now()}`;

  // 1. CAPTURE — prepare the built-in noanchor fixture, drive a real click via CDP.
  const prepared = /** @type {{ debugPort: number }} */ (
    runCli(["prepare", "--run-id", runId, "--fixture", "noanchor", "--headless"])
  );

  const targets = await CDP.List({ port: prepared.debugPort });
  const page = targets.find((t) => t.type === "page" && /\/noanchor/.test(t.url)) || targets.find((t) => t.type === "page");
  const client = await CDP({ target: page, port: prepared.debugPort });
  try {
    await client.Runtime.enable();
    await sleep(800);
    // Click the Go control (role-less div[tabindex]) — fires the recorder's
    // capture-phase click listener (matched via [tabindex]) and navigates.
    await client.Runtime.evaluate({ expression: "document.querySelector('div[tabindex]').click()" });
    await sleep(1500); // let the recorder capture + navigation settle
  } finally {
    await client.close();
  }

  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);

  // 2. The captured click step must carry a structuralKey (capture pipeline works
  //    end-to-end: recorder, sanitize, compile all preserve the locator).
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ action: string, locator?: { structuralKey?: string } }> }} */ (
    readJson(runPaths.workflowJsonPath)
  );
  const clickStep = workflow.steps.find((s) => s.action === "click");
  assert.ok(clickStep, "captured workflow must include a click step");
  assert.ok(
    clickStep.locator && typeof clickStep.locator.structuralKey === "string" && clickStep.locator.structuralKey.length > 0,
    `captured click must carry a structuralKey — got: ${JSON.stringify(clickStep && clickStep.locator)}`
  );

  // 3. REPLAY — generate the runner, then verify (the runner starts its own noanchor
  //    fixture; the random class differs from capture, so only the name-independent
  //    rungs can re-locate Go).
  generateRunner(runId);
  const result = await verifyRun(runId, { headless: true });

  assert.equal(
    /** @type {any} */ (result.report).success,
    true,
    `verify must succeed (replay click reached /noanchor/done) — report: ${JSON.stringify(result.report)}`
  );

  const layers = /** @type {Array<{ action: string, layerUsed: string }> | undefined} */ (
    /** @type {any} */ (result.report).resolverLayers
  );
  assert.ok(Array.isArray(layers), "report must include resolverLayers");
  const clickLayer = layers.find((l) => l.action === "click");
  assert.ok(clickLayer, "resolverLayers must record the click");
  // Resolution is now the coverage-aware scorer (layerUsed = "score"),
  // not per-rung. Name-independence is proven by success===true above: the random
  // class differs from capture + the "Go" div has no stable name, yet the click
  // resolved + reached /noanchor/done — so the scorer relied on structural signals
  // (structuralKey/relXPath), not name/class.
  assert.equal(clickLayer.layerUsed, "score", `click resolved via the scorer — got: ${clickLayer.layerUsed} (all: ${JSON.stringify(layers)})`);
});
