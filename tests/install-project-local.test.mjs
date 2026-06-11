import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    assert.match(commandText, /\.claude\/browser-flow\/agents\/orchestrator\/AGENT\.md/);
    assert.match(commandText, /\.claude\/browser-flow\/references\/phase-entry-contract\.md/);
    assert.doesNotMatch(commandText, /\{\{[^}]+\}\}/);
    assert.equal(commandText.includes(["scripts", "pub" + "lish"].join("/")), false);
    assert.equal(existsSync(resolve(privateRoot, "runtime/scripts/cli.mjs")), true);

    execFileSync("node", [resolve(privateRoot, "scripts/validate-skill.mjs")], {
      cwd: privateRoot,
      stdio: "pipe"
    });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("codex install with trailing slash on target path installs correctly", () => {
  const target = makeTarget();
  try {
    execFileSync(resolve(repoRoot, "install-project-local.sh"), [`${target}/`], {
      cwd: repoRoot,
      stdio: "pipe"
    });

    const skillRoot = resolve(target, ".codex/skills/browser-flow");
    assert.equal(existsSync(resolve(skillRoot, "SKILL.md")), true);
    // node_modules must not be copied into the installed skill
    assert.equal(existsSync(resolve(skillRoot, "runtime/node_modules")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("claude install with trailing slash on target path installs correctly", () => {
  const target = makeTarget();
  try {
    execFileSync(resolve(repoRoot, "install-project-local.sh"), ["--tool", "claude", `${target}/`], {
      cwd: repoRoot,
      stdio: "pipe"
    });

    const commandPath = resolve(target, ".claude/commands/browser-flow.md");
    assert.equal(existsSync(commandPath), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("claude command renderer rewrites only path tokens and normalizes line endings", () => {
  const target = makeTarget();
  try {
    const sourceSkillDir = resolve(target, "source-skill");
    const commandPath = resolve(target, "command.md");
    mkdirSync(sourceSkillDir, { recursive: true });
    writeFileSync(
      resolve(sourceSkillDir, "prompt.md"),
      [
        "runtime/scripts/cli.mjs",
        "technical-skills/reference.md",
        "sub-agents/example.md",
        "references/security-policy.md"
      ].join("\r\n")
    );

    execFileSync(
      process.execPath,
      [
        resolve(repoRoot, "scripts/install/render-claude-command.mjs"),
        sourceSkillDir,
        commandPath,
        ".claude/browser-flow"
      ],
      { cwd: repoRoot, stdio: "pipe" }
    );

    const commandText = readFileSync(commandPath, "utf8");
    assert.match(commandText, /\.claude\/browser-flow\/runtime\/scripts\/cli\.mjs/);
    assert.match(commandText, /\.claude\/browser-flow\/references\/security-policy\.md/);
    assert.match(commandText, /technical-skills\/reference\.md/);
    assert.match(commandText, /sub-agents\/example\.md/);
    assert.equal(commandText.includes("\r\n"), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
