#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultReleaseRoot = resolve(dirname(scriptPath), "..", "..", "..", "browser-flow-released");

const REQUIRED_FILES = [
  "README.md",
  "HISTORY.md",
  "INSTALL.md",
  "install-project-local.sh",
  "scripts/publish/render-browser-flow-surfaces-cli.mjs",
  "scripts/publish/render-browser-flow-surfaces.mjs",
  "surfaces/browser-flow/public/entry.md",
  "surfaces/browser-flow/adapters/claude/browser-flow.md.tmpl",
  "skills/browser-flow/SKILL.md",
  "skills/browser-flow/scripts/validate-skill.mjs",
  "skills/browser-flow/runtime/scripts/cli.mjs",
  "skills/browser-flow/runtime/package.json",
  "skills/browser-flow/runtime/package-lock.json",
  "skills/browser-flow/runtime/tsconfig.json",
  "skills/browser-flow/agents/orchestrator/AGENT.md"
];

/**
 * @param {string} releaseRoot
 * @param {{ smoke?: boolean }} [options]
 */
export function assertReleaseClosure(releaseRoot, options = {}) {
  const root = resolve(releaseRoot);
  assertRequiredFiles(root);
  assertRelativeImportClosure(root);
  if (options.smoke !== false) {
    assertReleaseSmoke(root);
  }
}

/**
 * @param {string} root
 */
function assertRequiredFiles(root) {
  const missing = REQUIRED_FILES.filter((rel) => !existsSync(resolve(root, rel)));
  if (missing.length > 0) {
    throw new Error(`release closure missing required file(s): ${missing.join(", ")}`);
  }
}

/**
 * @param {string} root
 */
export function assertRelativeImportClosure(root) {
  /** @type {string[]} */
  const missing = [];
  for (const file of listFiles(root)) {
    if (!file.endsWith(".mjs")) continue;
    const relFile = toRel(root, file);
    const source = readFileSync(file, "utf8");
    for (const specifier of relativeImportSpecifiers(source)) {
      const target = resolve(dirname(file), specifier);
      if (!existsSync(target)) {
        missing.push(`${relFile} -> ${specifier}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`release closure missing relative import target(s):\n${missing.join("\n")}`);
  }
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function relativeImportSpecifiers(source) {
  /** @type {string[]} */
  const out = [];
  const staticPattern = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm;
  const dynamicPattern = /^\s*(?:await\s+)?import\(["'](\.{1,2}\/[^"']+)["']\)/gm;
  for (const match of source.matchAll(staticPattern)) out.push(match[1]);
  for (const match of source.matchAll(dynamicPattern)) out.push(match[1]);
  return out;
}

/**
 * @param {string} root
 */
function assertReleaseSmoke(root) {
  execFileSync(process.execPath, ["skills/browser-flow/scripts/validate-skill.mjs"], {
    cwd: root,
    stdio: "pipe"
  });
  runRuntimeCliHelp(root, "skills/browser-flow/runtime/scripts/cli.mjs");

  const codexTarget = mkdtempSync(resolve(tmpdir(), "bf-release-codex-target-"));
  const claudeTarget = mkdtempSync(resolve(tmpdir(), "bf-release-claude-target-"));
  try {
    execFileSync("git", ["init", codexTarget], { stdio: "pipe" });
    const codex = spawnSync("bash", ["install-project-local.sh", codexTarget], {
      cwd: root,
      encoding: "utf8"
    });
    if (codex.status !== 0) {
      throw new Error(`codex install smoke failed:\n${codex.stderr || codex.stdout}`);
    }
    runRuntimeCliHelp(codexTarget, ".codex/skills/browser-flow/runtime/scripts/cli.mjs");
    const codexOutput = execFileSync(
      "codex",
      [
        "exec",
        "-C",
        codexTarget,
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "read-only",
        "If a project-local browser-flow skill is available here, answer exactly BROWSER_FLOW_AVAILABLE. Otherwise answer exactly BROWSER_FLOW_MISSING."
      ],
      { encoding: "utf8", stdio: "pipe" }
    );
    if (!/BROWSER_FLOW_AVAILABLE/.test(codexOutput)) {
      throw new Error(`codex install smoke failed: discovery output was ${JSON.stringify(codexOutput.trim())}`);
    }

    execFileSync("git", ["init", claudeTarget], { stdio: "pipe" });
    const claude = spawnSync("bash", ["install-project-local.sh", "--tool", "claude", claudeTarget], {
      cwd: root,
      encoding: "utf8"
    });
    if (claude.status !== 0) {
      throw new Error(`claude install smoke failed:\n${claude.stderr || claude.stdout}`);
    }
    const command = readFileSync(resolve(claudeTarget, ".claude/commands/browser-flow.md"), "utf8");
    if (!command.includes(".claude/browser-flow")) {
      throw new Error("claude install smoke failed: command does not point at .claude/browser-flow");
    }
    runRuntimeCliHelp(claudeTarget, ".claude/browser-flow/runtime/scripts/cli.mjs");
    const claudeOutput = execFileSync(
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
      { cwd: claudeTarget, encoding: "utf8", stdio: "pipe" }
    );
    if (/찾을 수 없었습니다|not a registered skill/i.test(claudeOutput)) {
      throw new Error(`claude install smoke failed: discovery output was ${JSON.stringify(claudeOutput.trim())}`);
    }
  } finally {
    rmSync(codexTarget, { recursive: true, force: true });
    rmSync(claudeTarget, { recursive: true, force: true });
  }
}

/**
 * @param {string} cwd
 * @param {string} cliRel
 */
function runRuntimeCliHelp(cwd, cliRel) {
  const cli = resolve(cwd, cliRel);
  const isolationRoot = mkdtempSync(resolve(tmpdir(), "bf-release-cli-"));
  try {
    execFileSync(process.execPath, [cli, "--help"], {
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: "",
        BROWSER_FLOW_REGISTRY_PATH: resolve(isolationRoot, "registry", "workflows.json"),
        BROWSER_FLOW_PAGES_PATH: resolve(isolationRoot, "knowledge", "pages"),
        BROWSER_FLOW_SCRAPING_PATH: resolve(isolationRoot, "knowledge", "scraping"),
        BROWSER_FLOW_SCORING_PATTERNS_PATH: resolve(isolationRoot, "knowledge", "analyzer", "semantic", "scoring-patterns.json")
      }
    });
  } finally {
    rmSync(isolationRoot, { recursive: true, force: true });
    rmSync(resolve(dirname(cli), "..", "node_modules"), { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listFiles(root) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ abs) => {
    for (const name of readdirSync(abs)) {
      if (name === ".git" || name === "node_modules") continue;
      const child = resolve(abs, name);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk(root);
  return out;
}

/**
 * @param {string} root
 * @param {string} abs
 */
function toRel(root, abs) {
  return abs.slice(root.length + 1).replaceAll("\\", "/");
}

function main() {
  const releaseRoot = process.argv[2] ? resolve(process.argv[2]) : defaultReleaseRoot;
  try {
    assertReleaseClosure(releaseRoot);
    process.stdout.write(`release-closure OK (${releaseRoot})\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release-closure failed: ${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === scriptPath) {
  main();
}
