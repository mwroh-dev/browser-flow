import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { renderClaudeCommand } from "../../scripts/publish/render-browser-flow-surfaces.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";
import { withAssembledPackage } from "../helpers/assembled-package.mjs";

const repoRoot = getRepoRoot();

test("source repo keeps browser-flow surface templates without committed generated adapters", () => {
  assert.equal(existsSync(resolve(repoRoot, "surfaces/browser-flow/package/SKILL.md.tmpl")), true);
  assert.equal(existsSync(resolve(repoRoot, "surfaces/browser-flow/package/manifest.json.tmpl")), true);
  assert.equal(existsSync(resolve(repoRoot, "surfaces/browser-flow/package/scripts/validate-skill.mjs")), true);
  assert.equal(existsSync(resolve(repoRoot, ".codex/skills/browser-flow/SKILL.md")), false);
  assert.equal(existsSync(resolve(repoRoot, ".claude/commands/browser-flow.md")), false);
  assert.equal(existsSync(resolve(repoRoot, "CLAUDE.md")), false);
});

test("internal browser-flow contracts remain private and are not exposed as top-level public skill entries", () => {
  for (const forbidden of [
    ".codex/skills/capture-driver/SKILL.md",
    ".codex/skills/scope-agent/SKILL.md",
    ".codex/skills/scoring-agent/SKILL.md",
    ".codex/skills/scraping-agent/SKILL.md",
    ".codex/skills/extract-heal-agent/SKILL.md",
    ".codex/skills/heal-agent/SKILL.md",
    ".codex/skills/spec-agent/SKILL.md",
    ".codex/skills/variable-agent/SKILL.md",
    ".codex/skills/composer-agent/SKILL.md"
  ]) {
    assert.equal(existsSync(resolve(repoRoot, forbidden)), false, `${forbidden} must not exist`);
  }
});

test("package validator source stays package-local and does not rely on committed adapters", () => {
  const validator = readFileSync(
    resolve(repoRoot, "surfaces/browser-flow/package/scripts/validate-skill.mjs"),
    "utf8"
  );

  assert.doesNotMatch(validator, /bundleRoot/);
  assert.doesNotMatch(validator, /\.codex\/skills\/browser-flow/);
  assert.doesNotMatch(validator, /CLAUDE\.md/);
  assert.match(validator, /const agentsRoot = resolve\(root, "agents"\)/);
  assert.match(validator, /const runtimeRoot = resolve\(root, "runtime"\)/);
  assert.match(validator, /const skillsRoot = resolve\(root, "skills"\)/);
});

test("canonical public entry renders package-relative prompt paths and claude absolute command paths", async () => {
  const entry = readFileSync(resolve(repoRoot, "surfaces/browser-flow/public/entry.md"), "utf8");
  await withAssembledPackage(async ({ packageRoot }) => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-claude-render-"));
    try {
      const commandPath = resolve(tempRoot, ".claude/commands/browser-flow.md");
      renderClaudeCommand(repoRoot, commandPath, ".claude/browser-flow");

      const prompt = readFileSync(resolve(packageRoot, "prompt.md"), "utf8");
      const claudeCommand = readFileSync(commandPath, "utf8");

      assert.match(entry, /\{\{BROWSER_FLOW_CLI\}\}/);
      assert.match(entry, /\{\{BROWSER_FLOW_AGENT_ROOT\}\}/);
      assert.match(entry, /\{\{BROWSER_FLOW_RUNTIME_ROOT\}\}/);
      assert.match(entry, /\{\{BROWSER_FLOW_SKILL_ROOT\}\}/);

      assert.match(prompt, /agents\/orchestrator\/AGENT\.md/);
      assert.match(prompt, /runtime\/knowledge\/registry\/workflows\.json/);
      assert.match(prompt, /skills\/scraping-agent\/SKILL\.md/);
      assert.match(prompt, /node runtime\/scripts\/cli\.mjs prepare/);

      assert.match(claudeCommand, /\.claude\/browser-flow\/agents\/orchestrator\/AGENT\.md/);
      assert.match(claudeCommand, /\.claude\/browser-flow\/runtime\/knowledge\/registry\/workflows\.json/);
      assert.match(claudeCommand, /\.claude\/browser-flow\/skills\/scraping-agent\/SKILL\.md/);
      assert.match(claudeCommand, /node \.claude\/browser-flow\/runtime\/scripts\/cli\.mjs prepare/);
      assert.doesNotMatch(claudeCommand, /\.browser-flow\//);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

test("public security reference allows explicit unmasked real-site diagnostics", () => {
  const securityPolicy = readFileSync(
    resolve(repoRoot, "surfaces/browser-flow/public/references/security-policy.md"),
    "utf8"
  );

  assert.doesNotMatch(securityPolicy, /Local-only targets only/i);
  assert.match(securityPolicy, /real-site/i);
  assert.match(securityPolicy, /--unmasked/);
});
