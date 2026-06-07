import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const installer = resolve(repoRoot, "install-project-local.sh");

function install(/** @type {string} */ targetRoot, /** @type {"codex"|"claude"|null} */ tool = null) {
  const args = tool ? ["--tool", tool, targetRoot] : [targetRoot];
  execFileSync(installer, args, {
    cwd: repoRoot,
    stdio: "pipe"
  });
}

test("default project-local install writes only the Codex projection", () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-install-codex-"));
  try {
    install(targetRoot);

    assert.deepEqual(readdirSync(targetRoot).sort(), [".codex"]);
    assert.equal(existsSync(resolve(targetRoot, ".codex/skills/browser-flow/SKILL.md")), true);
    assert.equal(
      existsSync(resolve(targetRoot, ".codex/skills/browser-flow/runtime/scripts/cli.mjs")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".codex/skills/browser-flow/agents/orchestrator/AGENT.md")),
      true
    );
    assert.equal(existsSync(resolve(targetRoot, ".claude")), false);
    assert.equal(existsSync(resolve(targetRoot, "CLAUDE.md")), false);
    assert.equal(existsSync(resolve(targetRoot, ".browser-flow")), false);
    assert.equal(existsSync(resolve(targetRoot, ".agents")), false);
    assert.equal(existsSync(resolve(targetRoot, ".codex/skills/scope-agent/SKILL.md")), false);
    assert.equal(
      existsSync(resolve(targetRoot, ".codex/skills/browser-flow/skills/capture-driver/SKILL.md")),
      true
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("Claude project-local install writes only the Claude projection and keeps host CLAUDE.md untouched", () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-install-claude-"));
  try {
    writeFileSync(resolve(targetRoot, "CLAUDE.md"), "# Existing Host Memory\n");
    install(targetRoot, "claude");

    assert.deepEqual(readdirSync(targetRoot).sort(), [".claude", "CLAUDE.md"]);
    assert.equal(existsSync(resolve(targetRoot, ".codex")), false);
    assert.equal(existsSync(resolve(targetRoot, ".browser-flow")), false);
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/commands/browser-flow.md")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/browser-flow/runtime/scripts/cli.mjs")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/browser-flow/agents/orchestrator/AGENT.md")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/browser-flow/skills/capture-driver/SKILL.md")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/browser-flow/runtime/knowledge/registry/workflows.json")),
      true
    );
    assert.equal(
      existsSync(resolve(targetRoot, ".claude/commands/scope-agent.md")),
      false
    );
    assert.equal(
      readFileSync(resolve(targetRoot, "CLAUDE.md"), "utf8"),
      "# Existing Host Memory\n"
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});
