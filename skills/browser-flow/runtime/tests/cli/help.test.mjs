// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

const commands = [
  "prepare",
  "done",
  "replay",
  "analyze",
  "generate",
  "verify",
  "doctor",
  "completion",
  "vars",
  "run",
  "spec",
  "teardown",
  "cleanup",
  "heal",
  "score",
  "scope",
  "reveal",
  "review-noise",
  "review-locator-intent",
  "review-route-intent",
  "extract",
  "extract-heal",
  "explore",
  "serve-browser",
  "promote",
  "compose"
];

/**
 * @param {string[]} args
 */
function runCliText(args) {
  return spawnSync(process.execPath, ["scripts/cli.mjs", ...args], {
    cwd: getRepoRoot(),
    encoding: "utf8",
    env: { ...process.env }
  });
}

test("top-level help groups commands by user workflow and points to topic help", () => {
  const result = runCliText(["help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Setup \/ diagnostics/i);
  assert.match(result.stdout, /Capture/i);
  assert.match(result.stdout, /Analyze \/ generate \/ verify/i);
  assert.match(result.stdout, /Reuse \/ run/i);
  assert.match(result.stdout, /Extract/i);
  assert.match(result.stdout, /Review checkpoints/i);
  assert.match(result.stdout, /Promote/i);
  assert.match(result.stdout, /Compose/i);
  assert.match(result.stdout, /Cleanup \/ heal/i);
  assert.match(result.stdout, /browser-flow help workflows/i);
  assert.match(result.stdout, /browser-flow help examples/i);
  assert.match(result.stdout, /browser-flow help safety/i);
  assert.match(result.stdout, /browser-flow help artifacts/i);
});

test("workflow topic help explains happy path, safety, examples, and artifacts", () => {
  const topics = {
    workflows: [/prepare/, /done/, /analyze/, /generate/, /verify/, /run/],
    examples: [/first capture/i, /reuse/i, /extract/i, /promote/i],
    safety: [/verification\.json/, /security\.json/, /raw cookies/i, /unmasked/i],
    artifacts: [/path\.yaml/, /recipe\.yaml/, /runner\.mjs/, /registry/i]
  };

  for (const [topic, patterns] of Object.entries(topics)) {
    const result = runCliText(["help", topic]);
    assert.equal(result.status, 0, `help ${topic} should exit 0`);
    assert.match(result.stdout, new RegExp(`browser-flow help ${topic}`));
    for (const pattern of patterns) {
      assert.match(result.stdout, pattern, `help ${topic} should include ${pattern}`);
    }
  }
});

test("every dispatched command has complete scoped help", () => {
  for (const command of commands) {
    const result = runCliText([command, "--help"]);

    assert.equal(result.status, 0, `${command} --help should exit 0`);
    assert.match(result.stdout, new RegExp(`^browser-flow ${command}`, "m"), `${command} has title`);
    assert.match(result.stdout, /Description:/, `${command} includes description`);
    assert.match(result.stdout, /Usage:/, `${command} includes usage`);
    assert.match(result.stdout, /Required options:/, `${command} includes required options`);
    assert.match(result.stdout, /Common examples:/, `${command} includes examples`);
    assert.match(result.stdout, /Side effects:/, `${command} includes side effects`);
    assert.match(result.stdout, /Artifacts:/, `${command} includes artifacts`);
    assert.match(result.stdout, /Related commands:/, `${command} includes related commands`);
  }
});
