import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { collectBindingsFromArgv, runCommand } from "../../scripts/commands/run.mjs";
import { bindingsShortHash } from "../../scripts/lib/workflow-inputs.mjs";

test("collectBindingsFromArgv collects multiple --bind occurrences", () => {
  const bindings = collectBindingsFromArgv([
    "node", "bf", "run", "--run-id", "r1",
    "--bind", "input.fileName=/tmp/x.pdf",
    "--bind", "input.searchTerm=AI papers"
  ]);
  assert.deepEqual(bindings, { fileName: "/tmp/x.pdf", searchTerm: "AI papers" });
});

test("collectBindingsFromArgv accepts bare key=value (no input. prefix)", () => {
  const bindings = collectBindingsFromArgv(["--bind", "foo=bar"]);
  assert.deepEqual(bindings, { foo: "bar" });
});

test("collectBindingsFromArgv throws on duplicate --bind for same input", () => {
  assert.throws(
    () => collectBindingsFromArgv(["--bind", "input.foo=a", "--bind", "input.foo=b"]),
    /Duplicate --bind for input "foo"/
  );
});

test("collectBindingsFromArgv throws on missing value", () => {
  assert.throws(
    () => collectBindingsFromArgv(["--bind"]),
    /requires a key=value argument/
  );
  assert.throws(
    () => collectBindingsFromArgv(["--bind", "--other"]),
    /requires a key=value argument/
  );
  assert.throws(
    () => collectBindingsFromArgv(["--bind", "no-equals-sign"]),
    /must be key=value form/
  );
});

test("runCommand throws when --run-id missing", () => {
  assert.throws(() => runCommand({}, []), /run requires --run-id/);
});

test("runCommand throws when source workflow.json does not exist", () => {
  assert.throws(
    () => runCommand({ "run-id": `nonexistent-${Date.now()}` }, []),
    /Source workflow not found/
  );
});

test("runCommand generates new runner under <runId>-bind-<hash> with bound workflow", () => {
  // Stand up a synthetic source run with a manually authored
  // workflow.json that declares inputs[] + valueRef placeholders.
  // Skip the full compile pipeline — exercising bindInputs +
  // generateRunner is what the test covers.
  const sourceRunId = `run-cmd-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto", url: "/synthetic", pageKey: "synthetic/root" },
      {
        action: "fill",
        selector: "[data-bf=\"name-input\"]",
        fieldName: "name",
        value: "",
        secret: false,
        pageKey: "synthetic/root",
        valueRef: "{{input.name}}"
      },
      { action: "click", selector: "[data-bf=\"launch\"]", text: "Run", pageKey: "synthetic/root" }
    ],
    inputs: [{ name: "name", label: "name", type: "text" }],
    segments: [{ range: [0, 2], startPageKey: "synthetic/root", endPageKey: "synthetic/root" }],
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: { url: "/api/complete", method: "POST", status: 200 },
      expectedEvidence: { selector: "[data-bf-evidence=\"result\"]", textIncludes: "Done" }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = runCommand(
    { "run-id": sourceRunId },
    ["node", "bf", "run", "--run-id", sourceRunId, "--bind", "input.name=Codex"]
  );

  const expectedHash = bindingsShortHash({ name: "Codex" });
  assert.equal(result.sourceRunId, sourceRunId);
  assert.equal(result.newRunId, `${sourceRunId}-bind-${expectedHash}`);
  assert.equal(result.bindings.name, "Codex");

  const newPaths = getRunPaths(result.newRunId);
  assert.equal(existsSync(newPaths.workflowJsonPath), true);
  assert.equal(existsSync(newPaths.runnerPath), true);

  // bound workflow: value substituted, valueRef stripped
  const boundWorkflow = /** @type {{ steps: Array<{ value?: string, valueRef?: string, action: string }> }} */ (
    JSON.parse(readFileSync(newPaths.workflowJsonPath, "utf8"))
  );
  const fillStep = boundWorkflow.steps.find((s) => s.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  assert.equal(fillStep.value, "Codex");
  assert.equal(fillStep.valueRef, undefined);

  // manifest carries source link + bindings
  const newManifest = /** @type {{ sourceRunId: string, bindings: Record<string, string> }} */ (
    JSON.parse(readFileSync(newPaths.manifestPath, "utf8"))
  );
  assert.equal(newManifest.sourceRunId, sourceRunId);
  assert.deepEqual(newManifest.bindings, { name: "Codex" });

  // generated runner.mjs embeds the bound value (not the placeholder)
  const runnerSource = readFileSync(newPaths.runnerPath, "utf8");
  assert.match(runnerSource, /Codex/);
  assert.equal(runnerSource.includes("{{input.name}}"), false, "placeholder must not survive into runner");
});

test("runCommand idempotent for same bindings (same hash → same newRunId)", () => {
  const sourceRunId = `run-cmd-idem-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, { runId: sourceRunId, fixture: "synthetic", startUrl: "/x" });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/x",
    finalUrl: "/x",
    steps: [
      { action: "goto", url: "/x", pageKey: "synthetic/x" },
      { action: "fill", selector: "#i", fieldName: "i", value: "", secret: false, pageKey: "synthetic/x", valueRef: "{{input.foo}}" }
    ],
    inputs: [{ name: "foo", type: "text" }],
    verification: {
      expectedFinalUrl: "/x",
      expectedNetwork: { url: "/api/x", method: "POST", status: 200 },
      expectedEvidence: { selector: "h1", textIncludes: "x" }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const first = runCommand({ "run-id": sourceRunId }, ["--bind", "input.foo=A"]);
  const second = runCommand({ "run-id": sourceRunId }, ["--bind", "input.foo=A"]);
  assert.equal(first.newRunId, second.newRunId, "same bindings must yield same newRunId");
});
