import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const browserTestRoot = "/Users/cielo-iamdt/Downloads/browser-test";
const internalNames = [
  "capture-driver",
  "scope-agent",
  "scoring-agent",
  "variable-agent",
  "scraping-agent",
  "extract-heal-agent",
  "heal-agent",
  "spec-agent"
];

function runInstaller(
  /** @type {string} */ installer,
  /** @type {string} */ target,
  /** @type {"codex"|"claude"|null} */ tool = null
) {
  const args = tool ? ["--tool", tool, target] : [target];
  return spawnSync("bash", [installer, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

/**
 * @param {string} target
 */
function initGitRepo(target) {
  execFileSync("git", ["init", target], { stdio: "pipe" });
}

/**
 * @param {string} target
 */
function assertCodexDiscovery(target) {
  const output = execFileSync(
    "codex",
    [
      "exec",
      "-C",
      target,
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only",
      "If a project-local browser-flow skill is available here, answer exactly BROWSER_FLOW_AVAILABLE. Otherwise answer exactly BROWSER_FLOW_MISSING."
    ],
    { encoding: "utf8", stdio: "pipe" }
  );
  assert.match(output, /BROWSER_FLOW_AVAILABLE/);
}

/**
 * @param {string} target
 */
function assertClaudeDiscovery(target) {
  const output = execFileSync(
    "claude",
    [
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "plan",
      "--model",
      "sonnet",
      "/browser-flow\n한 줄로 이 커맨드가 무엇인지 설명해."
    ],
    { cwd: target, encoding: "utf8", stdio: "pipe" }
  );
  assert.doesNotMatch(output, /찾을 수 없었습니다|not a registered skill/i);
  assert.match(output, /브라우저|workflow|파이프라인/i);
}

/**
 * @param {string} target
 */
function summarizeCodexInstall(target) {
  const skillRoot = resolve(target, ".codex/skills/browser-flow");
  const runtimeCli = existsSync(resolve(skillRoot, "runtime/scripts/cli.mjs"))
    ? resolve(skillRoot, "runtime/scripts/cli.mjs")
    : resolve(skillRoot, "bundle/runtime/scripts/cli.mjs");
  const orchestratorAgent = existsSync(resolve(skillRoot, "agents/orchestrator/AGENT.md"))
    ? resolve(skillRoot, "agents/orchestrator/AGENT.md")
    : resolve(skillRoot, "bundle/agents/orchestrator/AGENT.md");
  const captureDriver = existsSync(resolve(skillRoot, "skills/capture-driver/SKILL.md"))
    ? resolve(skillRoot, "skills/capture-driver/SKILL.md")
    : resolve(skillRoot, "bundle/skills/capture-driver/SKILL.md");

  return {
    hasSkill: existsSync(resolve(skillRoot, "SKILL.md")),
    hasValidator: existsSync(resolve(skillRoot, "scripts/validate-skill.mjs")),
    hasRuntimeCli: existsSync(runtimeCli),
    hasOrchestratorAgent: existsSync(orchestratorAgent),
    hasCaptureDriver: existsSync(captureDriver)
  };
}

test("project-local installer defaults to a Codex-only install", () => {
  const target = mkdtempSync(resolve(tmpdir(), "browser-flow-install-target-"));
  try {
    const result = runInstaller(resolve(repoRoot, "install-project-local.sh"), target);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(readdirSync(target).sort(), [".codex"]);
    assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/SKILL.md")));
    assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/runtime/scripts/cli.mjs")));
    assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/runtime/scripts/commands/compose.mjs")));
    assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/agents/orchestrator/AGENT.md")));
    assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/skills/capture-driver/SKILL.md")));
    assert.ok(!existsSync(resolve(target, ".claude")));
    assert.ok(!existsSync(resolve(target, "CLAUDE.md")));
    assert.ok(!existsSync(resolve(target, ".browser-flow")));
    assert.ok(!existsSync(resolve(target, ".codex/skills/capture-driver/SKILL.md")));
    assert.ok(!existsSync(resolve(target, ".codex/skills/scope-agent/SKILL.md")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-local installer can write a Claude-only install without mutating host CLAUDE.md", () => {
  const target = mkdtempSync(resolve(tmpdir(), "browser-flow-claude-install-target-"));
  try {
    writeFileSync(resolve(target, "CLAUDE.md"), "# Existing Project\n");
    const result = runInstaller(resolve(repoRoot, "install-project-local.sh"), target, "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(readdirSync(target).sort(), [".claude", "CLAUDE.md"]);
    assert.ok(existsSync(resolve(target, ".claude/commands/browser-flow.md")));
    assert.ok(existsSync(resolve(target, ".claude/browser-flow/runtime/scripts/cli.mjs")));
    assert.ok(existsSync(resolve(target, ".claude/browser-flow/runtime/scripts/commands/compose.mjs")));
    assert.ok(existsSync(resolve(target, ".claude/browser-flow/agents/orchestrator/AGENT.md")));
    assert.ok(existsSync(resolve(target, ".claude/browser-flow/skills/capture-driver/SKILL.md")));
    assert.equal(readFileSync(resolve(target, "CLAUDE.md"), "utf8"), "# Existing Project\n");
    assert.ok(!existsSync(resolve(target, ".codex")));
    assert.ok(!existsSync(resolve(target, ".browser-flow")));
    assert.ok(!existsSync(resolve(target, ".claude/commands/scope-agent.md")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-local installer removes stale browser-flow projections when switching tools", () => {
  const target = mkdtempSync(resolve(tmpdir(), "browser-flow-install-existing-target-"));
  try {
    mkdirSync(resolve(target, ".codex/skills/browser-flow"), { recursive: true });
    mkdirSync(resolve(target, ".claude/browser-flow"), { recursive: true });
    mkdirSync(resolve(target, ".claude/commands"), { recursive: true });
    mkdirSync(resolve(target, ".browser-flow"), { recursive: true });
    writeFileSync(resolve(target, ".claude/commands/browser-flow.md"), "stale\n");
    for (const name of internalNames) {
      mkdirSync(resolve(target, ".codex/skills", name), { recursive: true });
      writeFileSync(resolve(target, ".codex/skills", name, "SKILL.md"), "stale\n");
      writeFileSync(resolve(target, ".claude/commands", `${name}.md`), "stale\n");
    }

    let result = runInstaller(resolve(repoRoot, "install-project-local.sh"), target);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readdirSync(target).sort(), [".codex"]);
    assert.ok(!existsSync(resolve(target, ".claude")));
    assert.ok(!existsSync(resolve(target, ".browser-flow")));

    result = runInstaller(resolve(repoRoot, "install-project-local.sh"), target, "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readdirSync(target).sort(), [".claude"]);
    assert.ok(!existsSync(resolve(target, ".codex")));
    assert.ok(!existsSync(resolve(target, ".browser-flow")));
    assert.ok(existsSync(resolve(target, ".claude/browser-flow/runtime/scripts/cli.mjs")));
    for (const name of internalNames) {
      assert.ok(!existsSync(resolve(target, ".claude/commands", `${name}.md`)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-local installer rejects missing or non-directory target and invalid tool", () => {
  const installer = resolve(repoRoot, "install-project-local.sh");
  const missingArg = spawnSync("bash", [installer], { cwd: repoRoot, encoding: "utf8" });
  assert.notEqual(missingArg.status, 0);
  assert.match(missingArg.stderr, /Usage:/);

  const missingDir = runInstaller(installer, resolve(tmpdir(), "browser-flow-no-such-target"));
  assert.notEqual(missingDir.status, 0);
  assert.match(missingDir.stderr, /Target directory does not exist/);

  const invalidToolTarget = mkdtempSync(resolve(tmpdir(), "browser-flow-invalid-tool-"));
  try {
    const invalidTool = spawnSync("bash", [installer, "--tool", "nope", invalidToolTarget], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.notEqual(invalidTool.status, 0);
    assert.match(invalidTool.stderr, /Unknown tool/);
  } finally {
    rmSync(invalidToolTarget, { recursive: true, force: true });
  }
});

test("project-local installer source does not contain global install paths", () => {
  const source = readFileSync(resolve(repoRoot, "install-project-local.sh"), "utf8");
  assert.doesNotMatch(source, /\$HOME|~\/\.codex|~\/\.agents|CODEX_HOME/);
});

test("project-local install docs and publisher describe the tool-specific install surfaces", () => {
  const docs = [
    readFileSync(resolve(repoRoot, "README.md"), "utf8"),
    readFileSync(resolve(repoRoot, "INSTALL.md"), "utf8"),
    readFileSync(resolve(repoRoot, "scripts/publish/build-bundle.mjs"), "utf8")
  ].join("\n");

  assert.match(docs, /\.codex\/skills\/browser-flow/);
  assert.match(docs, /\.claude\/browser-flow/);
  assert.doesNotMatch(docs, /\.browser-flow/);
  assert.doesNotMatch(docs, /\.agents\/skills\/browser-flow/);
});

test("release bundle ships package sources and the installer preserves native CLI discovery", () => {
  const releaseDir = mkdtempSync(resolve(tmpdir(), "browser-flow-release-"));
  const codexTarget = mkdtempSync(resolve(tmpdir(), "browser-flow-release-codex-target-"));
  const claudeTarget = mkdtempSync(resolve(tmpdir(), "browser-flow-release-claude-target-"));
  try {
    execFileSync("node", ["scripts/publish/build-bundle.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, BROWSER_FLOW_RELEASE_DIR: releaseDir },
      stdio: "pipe"
    });
    const installer = resolve(releaseDir, "install-project-local.sh");
    assert.ok(existsSync(resolve(releaseDir, "README.md")), "release ships public README");
    assert.ok(existsSync(resolve(releaseDir, "HISTORY.md")), "release ships work-item history");
    assert.ok(existsSync(installer), "release root has installer");
    assert.ok(existsSync(resolve(releaseDir, "skills/browser-flow/SKILL.md")), "release ships package source");
    assert.ok(existsSync(resolve(releaseDir, "surfaces/browser-flow/public/entry.md")), "release ships command renderer source");
    assert.ok(existsSync(resolve(releaseDir, "scripts/publish/render-browser-flow-surfaces.mjs")), "release ships renderer");
    assert.ok(!existsSync(resolve(releaseDir, ".codex")), "release does not ship committed Codex adapter output");
    assert.ok(!existsSync(resolve(releaseDir, ".claude")), "release does not ship committed Claude adapter output");
    assert.ok(!existsSync(resolve(releaseDir, "CLAUDE.md")), "release does not ship generated Claude root adapter");
    assert.ok(!existsSync(resolve(releaseDir, "docs")), "release does not ship source docs");
    assert.ok(!existsSync(resolve(releaseDir, "tasks")), "release does not ship source tasks");
    assert.ok(!existsSync(resolve(releaseDir, "artifacts")), "release does not ship run artifacts");
    assert.doesNotThrow(() => {
      execFileSync("node", ["skills/browser-flow/scripts/validate-skill.mjs"], {
        cwd: releaseDir,
        stdio: "pipe"
      });
    });

    initGitRepo(codexTarget);
    let result = runInstaller(installer, codexTarget);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readdirSync(codexTarget).sort(), [".codex", ".git"]);
    assert.ok(existsSync(resolve(codexTarget, ".codex/skills/browser-flow/runtime/scripts/commands/compose.mjs")));
    assertCodexDiscovery(codexTarget);

    initGitRepo(claudeTarget);
    writeFileSync(resolve(claudeTarget, "CLAUDE.md"), "# Host Claude Memory\n");
    result = runInstaller(installer, claudeTarget, "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readdirSync(claudeTarget).sort(), [".claude", ".git", "CLAUDE.md"]);
    assert.ok(existsSync(resolve(claudeTarget, ".claude/commands/browser-flow.md")));
    assert.ok(existsSync(resolve(claudeTarget, ".claude/browser-flow/runtime/scripts/commands/compose.mjs")));
    assert.equal(readFileSync(resolve(claudeTarget, "CLAUDE.md"), "utf8"), "# Host Claude Memory\n");
    assertClaudeDiscovery(claudeTarget);
  } finally {
    rmSync(releaseDir, { recursive: true, force: true });
    rmSync(codexTarget, { recursive: true, force: true });
    rmSync(claudeTarget, { recursive: true, force: true });
  }
});

test("new codex install matches browser-test on normalized capability checks", { skip: !existsSync(browserTestRoot) }, () => {
  const target = mkdtempSync(resolve(tmpdir(), "browser-flow-browser-test-compare-"));
  try {
    initGitRepo(target);
    const result = runInstaller(resolve(repoRoot, "install-project-local.sh"), target);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const actual = summarizeCodexInstall(target);
    const golden = summarizeCodexInstall(browserTestRoot);
    assert.deepEqual(actual, golden);

    assert.doesNotThrow(() => {
      execFileSync("node", [resolve(target, ".codex/skills/browser-flow/scripts/validate-skill.mjs")], {
        cwd: target,
        stdio: "pipe"
      });
    });
    assert.doesNotThrow(() => {
      execFileSync("node", [resolve(browserTestRoot, ".codex/skills/browser-flow/scripts/validate-skill.mjs")], {
        cwd: browserTestRoot,
        stdio: "pipe"
      });
    });
    assertCodexDiscovery(target);

    const goldenDiscovery = execFileSync(
      "codex",
      [
        "exec",
        "-C",
        browserTestRoot,
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "read-only",
        "If a project-local browser-flow skill is available here, answer exactly BROWSER_FLOW_AVAILABLE. Otherwise answer exactly BROWSER_FLOW_MISSING."
      ],
      { encoding: "utf8", stdio: "pipe" }
    );
    assert.match(goldenDiscovery, /BROWSER_FLOW_AVAILABLE/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
