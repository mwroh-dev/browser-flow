import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { runSpecCommand } from "../../scripts/commands/spec.mjs";
import { createScriptedAsk } from "../../scripts/lib/variable-agent-interaction.mjs";
import { getVerifySpecPaths } from "../../scripts/lib/config.mjs";
import { readVerifySpec } from "../../scripts/lib/verify-spec.mjs";

test("runSpecCommand asks only the gaps and writes verify-spec.json", async () => {
  const runId = `spec-${Date.now()}`;
  const { perRunPath } = getVerifySpecPaths(runId);
  mkdirSync(perRunPath.replace(/\/verify-spec\.json$/, ""), { recursive: true });
  // raw request answers site-url; the rest are asked via scripted ask
  const ask = createScriptedAsk([
    "y",           // login-required
    "ask-after-verify", // external-promotion-intent
    "login-required",   // external-auth-profile-policy
    "extract",          // external-data-mode
    "minimal",          // external-artifact-retention
    "/path/file",  // file-location
    "노트 내용",   // input-values
    "record",      // teardown-strategy
    "n",           // sandbox-available
    "n"            // irreversible-ops-consent
  ]);
  await runSpecCommand({ runId, request: "https://notebooklm.google.com 에서 작업", ask });
  const spec = readVerifySpec(perRunPath);
  // site-url detected from raw request → stored as raw request string
  assert.equal(spec.answers["site-url"], "https://notebooklm.google.com 에서 작업");
  // missing questions answered interactively
  assert.equal(spec.answers["external-promotion-intent"], "ask-after-verify");
  assert.equal(spec.answers["external-auth-profile-policy"], "login-required");
  assert.equal(spec.answers["external-data-mode"], "extract");
  assert.equal(spec.answers["external-artifact-retention"], "minimal");
  assert.equal(spec.answers["teardown-strategy"], "record");
  assert.equal(spec.answers["login-required"], "y");
  assert.equal(spec.answers["file-location"], "/path/file");
  assert.equal(spec.answers["input-values"], "노트 내용");
  assert.equal(spec.answers["sandbox-available"], "n");
  assert.equal(spec.answers["irreversible-ops-consent"], "n");
});

test("runSpecCommand asks external reuse policy questions for external workflow requests", async () => {
  const runId = `spec-external-${Date.now()}`;
  const answers = ["ask-after-verify", "login-required", "extract", "minimal"];
  let index = 0;

  const result = await runSpecCommand({
    runId,
    request: "Capture a NotebookLM workflow and save it for reuse",
    ask: async () => answers[index++]
  });

  assert.equal(result.asked.includes("external-promotion-intent"), true);
  assert.equal(result.asked.includes("external-auth-profile-policy"), true);
  assert.equal(result.asked.includes("external-data-mode"), true);
  assert.equal(result.asked.includes("external-artifact-retention"), true);
});
