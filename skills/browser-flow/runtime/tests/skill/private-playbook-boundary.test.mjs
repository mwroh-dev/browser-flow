import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getRepoRoot } from "../../scripts/lib/config.mjs";

const repoRoot = getRepoRoot();

test("internal browser-flow contracts live under agent-owned private playbooks", () => {
  for (const privatePath of [
    "agents/capture/playbooks/capture-driver.md",
    "agents/analyzer/playbooks/scope-agent.md",
    "agents/analyzer/playbooks/scoring-agent.md",
    "agents/analyzer/playbooks/variable-agent.md",
    "agents/analyzer/playbooks/scoring-patterns.json",
    "agents/extractor/AGENT.md",
    "agents/extractor/openai.yaml",
    "agents/extractor/knowledge-pattern.md",
    "agents/extractor/playbooks/scraping-agent.md",
    "agents/extractor/playbooks/extract-heal-agent.md",
    "agents/verifier/playbooks/heal-agent.md",
    "agents/verifier/playbooks/spec-agent.md",
    "agents/orchestrator/playbooks/composer-agent.md"
  ]) {
    assert.equal(existsSync(resolve(repoRoot, privatePath)), true, `${privatePath} must exist`);
  }
});

test("internal browser-flow contracts are not exposed as top-level public Codex skills", () => {
  for (const publicPath of [
    ".codex/skills/capture-driver/SKILL.md",
    ".codex/skills/scope-agent/SKILL.md",
    ".codex/skills/scoring-agent/SKILL.md",
    ".codex/skills/scoring-agent/patterns.json",
    ".codex/skills/variable-agent/SKILL.md",
    ".codex/skills/scraping-agent/SKILL.md",
    ".codex/skills/extract-heal-agent/SKILL.md",
    ".codex/skills/heal-agent/SKILL.md",
    ".codex/skills/spec-agent/SKILL.md",
    ".codex/skills/composer-agent/SKILL.md"
  ]) {
    assert.equal(existsSync(resolve(repoRoot, publicPath)), false, `${publicPath} must not exist`);
  }
});

test("runtime scoring paths split static playbook seeds from mutable learned knowledge", () => {
  const patternMatch = readFileSync(resolve(repoRoot, "scripts/lib/pattern-match.mjs"), "utf8");
  const scoreCommand = readFileSync(resolve(repoRoot, "scripts/commands/score.mjs"), "utf8");
  const config = readFileSync(resolve(repoRoot, "scripts/lib/config.mjs"), "utf8");

  assert.match(patternMatch, /agents\/analyzer\/playbooks\/scoring-patterns\.json/);
  assert.doesNotMatch(scoreCommand, /agents\/analyzer\/playbooks\/scoring-patterns\.json/);
  assert.match(scoreCommand, /getScoringPatternsPath/);
  assert.match(config, /knowledge["'], ["']analyzer["'], ["']semantic["'], ["']scoring-patterns\.json/);
  assert.match(config, /BROWSER_FLOW_SCORING_PATTERNS_PATH/);
});
