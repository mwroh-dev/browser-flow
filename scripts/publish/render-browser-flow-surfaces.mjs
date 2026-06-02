#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

const SUBAGENT_PLAYBOOKS = [
  ["capture-driver", "agents/capture/playbooks/capture-driver.md"],
  ["scope-agent", "agents/analyzer/playbooks/scope-agent.md"],
  ["scoring-agent", "agents/analyzer/playbooks/scoring-agent.md"],
  ["variable-agent", "agents/analyzer/playbooks/variable-agent.md"],
  ["scraping-agent", "agents/extractor/playbooks/scraping-agent.md"],
  ["extract-heal-agent", "agents/extractor/playbooks/extract-heal-agent.md"],
  ["heal-agent", "agents/verifier/playbooks/heal-agent.md"],
  ["spec-agent", "agents/verifier/playbooks/spec-agent.md"]
];

const TEXT_REWRITE_EXTENSIONS = new Set([".md", ".yaml", ".yml"]);
const SKIP_BASENAMES = new Set([".DS_Store"]);

/**
 * @param {string} path
 * @returns {string}
 */
function readUtf8(path) {
  return readFileSync(path, "utf8");
}

/**
 * @param {string} path
 * @param {string} contents
 */
function writeUtf8(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * @param {string} template
 * @param {{ entry: string, browserFlowCli: string, browserFlowAgentRoot: string, browserFlowRuntimeRoot: string, browserFlowSkillRoot: string }} values
 */
function renderTemplate(template, values) {
  return template
    .replaceAll("{{ENTRY}}", values.entry)
    .replaceAll("{{BROWSER_FLOW_CLI}}", values.browserFlowCli)
    .replaceAll("{{BROWSER_FLOW_AGENT_ROOT}}", values.browserFlowAgentRoot)
    .replaceAll("{{BROWSER_FLOW_RUNTIME_ROOT}}", values.browserFlowRuntimeRoot)
    .replaceAll("{{BROWSER_FLOW_SKILL_ROOT}}", values.browserFlowSkillRoot);
}

/**
 * @param {string} text
 */
function rewriteSurfaceText(text) {
  return text
    .replaceAll(".codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs", "runtime/scripts/cli.mjs")
    .replaceAll(".codex/skills/browser-flow/prompt.md", "prompt.md")
    .replaceAll(".codex/skills/browser-flow/SKILL.md", "SKILL.md")
    .replaceAll("bundle/runtime/scripts/", "runtime/scripts/")
    .replaceAll("bundle/runtime/knowledge/", "runtime/knowledge/")
    .replaceAll("bundle/runtime/artifacts/", "runtime/artifacts/")
    .replaceAll("bundle/runtime/", "runtime/")
    .replaceAll("bundle/agents/", "agents/")
    .replaceAll("bundle/skills/", "skills/");
}

/**
 * @param {string} name
 */
function shouldSkipPath(name) {
  return SKIP_BASENAMES.has(name) || name === "node_modules" || name === "artifacts" || name === "publish";
}

/**
 * @param {string} source
 * @param {string} target
 * @param {{ rewriteText?: boolean }} [options]
 */
function copyTree(source, target, { rewriteText = false } = {}) {
  if (!existsSync(source)) {
    throw new Error(`Missing source path: ${source}`);
  }
  const sourceStat = statSync(source);
  if (sourceStat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source).sort()) {
      if (shouldSkipPath(name)) continue;
      copyTree(resolve(source, name), resolve(target, name), { rewriteText });
    }
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  if (rewriteText && TEXT_REWRITE_EXTENSIONS.has(extname(source))) {
    writeUtf8(target, rewriteSurfaceText(readUtf8(source)));
    return;
  }
  copyFileSync(source, target);
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 */
function writeRuntimePackageJson(sourcePath, targetPath) {
  const pkg = JSON.parse(readUtf8(sourcePath));
  pkg.scripts = {
    "validate-skill": "node ../scripts/validate-skill.mjs"
  };
  writeUtf8(targetPath, JSON.stringify(pkg, null, 2) + "\n");
}

/**
 * @param {string} repoRoot
 * @param {string} outputDir
 */
export function assembleBrowserFlowPackage(repoRoot, outputDir) {
  const root = resolve(repoRoot);
  const surfaceRoot = resolve(root, "surfaces/browser-flow");
  const publicRoot = resolve(surfaceRoot, "public");
  const packageRoot = resolve(outputDir);
  const values = {
    browserFlowCli: "runtime/scripts/cli.mjs",
    browserFlowAgentRoot: "agents",
    browserFlowRuntimeRoot: "runtime",
    browserFlowSkillRoot: "skills",
    entry: ""
  };

  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(packageRoot, { recursive: true });

  writeUtf8(
    resolve(packageRoot, "SKILL.md"),
    readUtf8(resolve(surfaceRoot, "package/SKILL.md.tmpl"))
  );
  writeUtf8(
    resolve(packageRoot, "manifest.json"),
    readUtf8(resolve(surfaceRoot, "package/manifest.json.tmpl"))
  );
  writeUtf8(
    resolve(packageRoot, "prompt.md"),
    renderTemplate(readUtf8(resolve(publicRoot, "entry.md")), values)
  );

  copyTree(resolve(publicRoot, "references"), resolve(packageRoot, "references"));
  copyTree(resolve(root, "agents"), resolve(packageRoot, "agents"), { rewriteText: true });
  copyTree(resolve(root, "scripts"), resolve(packageRoot, "runtime/scripts"));
  copyTree(resolve(root, "knowledge"), resolve(packageRoot, "runtime/knowledge"));
  copyTree(
    resolve(surfaceRoot, "package/scripts/validate-skill.mjs"),
    resolve(packageRoot, "scripts/validate-skill.mjs")
  );
  copyTree(resolve(root, "package-lock.json"), resolve(packageRoot, "runtime/package-lock.json"));
  copyTree(resolve(root, "tsconfig.json"), resolve(packageRoot, "runtime/tsconfig.json"));
  writeRuntimePackageJson(
    resolve(root, "package.json"),
    resolve(packageRoot, "runtime/package.json")
  );

  for (const [skillName, playbookPath] of SUBAGENT_PLAYBOOKS) {
    const skillText = rewriteSurfaceText(readUtf8(resolve(root, playbookPath)))
      .replaceAll("node scripts/cli.mjs", "node runtime/scripts/cli.mjs");
    writeUtf8(resolve(packageRoot, "skills", skillName, "SKILL.md"), skillText);
  }
}

/**
 * @param {string} repoRoot
 * @param {string} outputPath
 * @param {string} [packageMountPath]
 */
export function renderClaudeCommand(repoRoot, outputPath, packageMountPath = ".claude/browser-flow") {
  const root = resolve(repoRoot);
  const surfaceRoot = resolve(root, "surfaces/browser-flow");
  const publicRoot = resolve(surfaceRoot, "public");
  const claudeValues = {
    browserFlowCli: `${packageMountPath}/runtime/scripts/cli.mjs`,
    browserFlowAgentRoot: `${packageMountPath}/agents`,
    browserFlowRuntimeRoot: `${packageMountPath}/runtime`,
    browserFlowSkillRoot: `${packageMountPath}/skills`,
    entry: ""
  };

  writeUtf8(
    resolve(outputPath),
    renderTemplate(
      readUtf8(resolve(surfaceRoot, "adapters/claude/browser-flow.md.tmpl")),
      {
        ...claudeValues,
        entry: renderTemplate(readUtf8(resolve(publicRoot, "entry.md")), claudeValues)
      }
    )
  );
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
export function stageBrowserFlowPackage(repoRoot) {
  const stageRoot = resolve(tmpdir(), `browser-flow-package-${process.pid}-${Date.now()}`);
  assembleBrowserFlowPackage(repoRoot, stageRoot);
  return stageRoot;
}

/**
 * @param {string[]} argv
 */
export function main(argv) {
  const [command, arg1, arg2] = argv;
  const repoRoot = resolve(dirname(scriptPath), "../..");

  if (command === "assemble-package") {
    if (!arg1) {
      throw new Error("assemble-package requires an output directory");
    }
    assembleBrowserFlowPackage(repoRoot, resolve(arg1));
    return;
  }

  if (command === "render-claude-command") {
    if (!arg1 || !arg2) {
      throw new Error("render-claude-command requires <outputPath> <packageMountPath>");
    }
    renderClaudeCommand(repoRoot, resolve(arg1), arg2);
    return;
  }

  throw new Error("Usage: render-browser-flow-surfaces.mjs assemble-package <outputDir> | render-claude-command <outputPath> <packageMountPath>");
}
