// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

const repoRoot = getRepoRoot();

/**
 * @param {string} path
 */
function readRepoFile(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

test("README contains concise actual CLI section", () => {
  const readme = readRepoFile("README.md");

  assert.match(readme, /## CLI/);
  assert.match(readme, /browser-flow help workflows/);
  assert.match(readme, /browser-flow capabilities --json/);
  assert.match(readme, /browser-flow schema command verify --json/);
  assert.match(readme, /browser-flow completion bash/);
  assert.match(readme, /--dry-run/);
});

test("docs/cli.md documents human CLI workflows without overclaiming", () => {
  const doc = readRepoFile("docs/cli.md");

  for (const heading of [
    "Install",
    "Verify Installation",
    "First Capture",
    "Analyze, Generate, Verify",
    "Reuse",
    "Extract Data",
    "Promote External Workflow",
    "Cleanup And Recovery"
  ]) {
    assert.match(doc, new RegExp(`## ${heading}`));
  }
  assert.match(doc, /verification\.json/);
  assert.match(doc, /security\.json/);
  assert.match(doc, /not a bypass/i);
});

test("docs/cli-contract.md documents agent-facing schema, errors, side effects, and automation expectations", () => {
  const doc = readRepoFile("docs/cli-contract.md");

  assert.match(doc, /browser-flow capabilities --json/);
  assert.match(doc, /browser-flow schema --json/);
  assert.match(doc, /browser-flow schema command <name> --json/);
  assert.match(doc, /ok: false/);
  assert.match(doc, /error\.code/);
  assert.match(doc, /invalid_usage/);
  assert.match(doc, /verification_not_green/);
  assert.match(doc, /registryMutation/);
  assert.match(doc, /--dry-run/);
});
