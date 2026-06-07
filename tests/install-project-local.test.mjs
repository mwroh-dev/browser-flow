import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

function makeTarget() {
  return mkdtempSync(resolve(tmpdir(), "browser-flow-install-"));
}

test("codex install copies a self-contained browser-flow skill", () => {
  const target = makeTarget();
  try {
    execFileSync(resolve(repoRoot, "install-project-local.sh"), [target], {
      cwd: repoRoot,
      stdio: "pipe"
    });

    const skillRoot = resolve(target, ".codex/skills/browser-flow");
    const skillText = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
    const runtimePkg = JSON.parse(readFileSync(resolve(skillRoot, "runtime/package.json"), "utf8"));

    assert.match(skillText, /name: browser-flow/);
    assert.equal(runtimePkg.bin["browser-flow"], "./scripts/cli.mjs");
    assert.equal(runtimePkg.scripts.check, "npm run lint && npm test");
    assert.doesNotMatch(skillText, /\{\{[^}]+\}\}/);

    execFileSync("node", [resolve(skillRoot, "scripts/validate-skill.mjs")], {
      cwd: skillRoot,
      stdio: "pipe"
    });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("claude install writes command and private skill paths that point at the copied package", () => {
  const target = makeTarget();
  try {
    execFileSync(resolve(repoRoot, "install-project-local.sh"), ["--tool", "claude", target], {
      cwd: repoRoot,
      stdio: "pipe"
    });

    const privateRoot = resolve(target, ".claude/browser-flow");
    const commandText = readFileSync(resolve(target, ".claude/commands/browser-flow.md"), "utf8");

    assert.match(commandText, /\.claude\/browser-flow\/runtime\/scripts\/cli\.mjs/);
    assert.match(commandText, /\.claude\/browser-flow\/agents\/orchestrator\/AGENT\.md/);
    assert.doesNotMatch(commandText, /\{\{[^}]+\}\}/);
    assert.equal(commandText.includes(["scripts", "pub" + "lish"].join("/")), false);

    execFileSync("node", [resolve(privateRoot, "scripts/validate-skill.mjs")], {
      cwd: privateRoot,
      stdio: "pipe"
    });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
