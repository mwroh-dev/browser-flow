import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

// Trace-level phase-order eval pilot.
//
// Pattern source: OpenAI Trace Grading
// (platform.openai.com/docs/guides/trace-grading) + AgentProcessBench
// (arXiv:2603.14465). Outcome-based tests assert that the final
// artifact is correct; trace-based tests assert that the trajectory
// that produced it followed the right shape. This file is the first
// trajectory-shape test in the suite.
//
// The four-phase pipeline is deterministic (capture's prepare/done +
// analyze + generate + verify run via CLI in a fixed order). Strict
// ordering assertions are safe here per
// `evaluation-as-behavioral-specification` Known Limit ("trace-based
// evals are more brittle to implementation changes than output-based
// evals — balance coverage depth with maintenance cost"). One pilot
// fixture (`synthetic`) is enough to anchor the contract; richer
// per-phase labeling (+1/0/-1) is the next iteration.

/**
 * @param {string} runId
 */
async function executeLoop(runId) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
  runCli(["generate", "--run-id", runId]);
  return runCli(["verify", "--run-id", runId, "--headless"]);
}

/**
 * @typedef {{
 *   runId: string,
 *   phase: "prepare" | "done" | "analyze" | "generate" | "verify",
 *   event: "started" | "completed" | "error",
 *   timestamp: string,
 *   message?: string
 * }} TraceEvent
 *
 * @param {string} tracePath
 * @returns {TraceEvent[]}
 */
function readTrace(tracePath) {
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("trace.jsonl records 5 phases in strict serial order, no errors", async () => {
  const runId = `trace-order-${Date.now()}`;
  await executeLoop(runId);
  const runPaths = getRunPaths(runId);
  const events = readTrace(runPaths.tracePath);

  // Every phase emits exactly one started and one completed (no errors).
  const expectedPhases = ["prepare", "done", "analyze", "generate", "verify"];
  for (const phase of expectedPhases) {
    const started = events.filter((e) => e.phase === phase && e.event === "started");
    const completed = events.filter((e) => e.phase === phase && e.event === "completed");
    const errored = events.filter((e) => e.phase === phase && e.event === "error");
    assert.equal(started.length, 1, `expected 1 "${phase}.started", got ${started.length}`);
    assert.equal(completed.length, 1, `expected 1 "${phase}.completed", got ${completed.length}`);
    assert.equal(errored.length, 0, `expected 0 "${phase}.error", got ${errored.length}`);
  }

  // Strict serial order: every phase completes before the next phase starts.
  for (let i = 0; i < expectedPhases.length - 1; i += 1) {
    const completed = events.find(
      (e) => e.phase === expectedPhases[i] && e.event === "completed"
    );
    const nextStarted = events.find(
      (e) => e.phase === expectedPhases[i + 1] && e.event === "started"
    );
    assert.ok(completed, `${expectedPhases[i]}.completed missing`);
    assert.ok(nextStarted, `${expectedPhases[i + 1]}.started missing`);
    assert.ok(
      new Date(completed.timestamp).getTime() <= new Date(nextStarted.timestamp).getTime(),
      `${expectedPhases[i]}.completed (${completed.timestamp}) must be ≤ ${expectedPhases[i + 1]}.started (${nextStarted.timestamp})`
    );
  }

  // Within each phase, started ≤ completed.
  for (const phase of expectedPhases) {
    const started = events.find((e) => e.phase === phase && e.event === "started");
    const completed = events.find((e) => e.phase === phase && e.event === "completed");
    assert.ok(
      new Date(/** @type {TraceEvent} */ (started).timestamp).getTime() <=
        new Date(/** @type {TraceEvent} */ (completed).timestamp).getTime(),
      `${phase}.started must precede ${phase}.completed`
    );
  }

  // Every event names the same runId — no cross-run pollution.
  for (const event of events) {
    assert.equal(event.runId, runId, `unexpected runId in trace: ${event.runId}`);
  }
});

test("trace.jsonl records the analyze error event when compile throws", () => {
  // Trigger compile failure: run analyze on a runId with no sanitized events.
  const runId = `trace-error-${Date.now()}`;
  assert.throws(() => runCli(["analyze", "--run-id", runId]));
  const runPaths = getRunPaths(runId);
  const events = readTrace(runPaths.tracePath);

  const started = events.filter((e) => e.phase === "analyze" && e.event === "started");
  const errored = events.filter((e) => e.phase === "analyze" && e.event === "error");
  const completed = events.filter((e) => e.phase === "analyze" && e.event === "completed");

  assert.equal(started.length, 1);
  assert.equal(errored.length, 1);
  assert.equal(completed.length, 0);
  assert.ok(
    typeof errored[0].message === "string" && errored[0].message.length > 0,
    "error event must carry a non-empty message"
  );
});
