#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [sourceSkillDir, outputPath, packageMountPath = ".claude/browser-flow"] = process.argv.slice(2);

if (!sourceSkillDir || !outputPath) {
  process.stderr.write("Usage: render-claude-command.mjs <sourceSkillDir> <outputPath> [packageMountPath]\n");
  process.exit(64);
}

const promptPath = resolve(sourceSkillDir, "prompt.md");
const commandPath = resolve(outputPath);

const prompt = readFileSync(promptPath, "utf8")
  .replaceAll("runtime/scripts/cli.mjs", `${packageMountPath}/runtime/scripts/cli.mjs`)
  .replaceAll("runtime/knowledge/", `${packageMountPath}/runtime/knowledge/`)
  .replaceAll("runtime/artifacts/", `${packageMountPath}/runtime/artifacts/`)
  .replaceAll("agents/", `${packageMountPath}/agents/`)
  .replaceAll("skills/", `${packageMountPath}/skills/`)
  .replaceAll("references/", `${packageMountPath}/references/`);

mkdirSync(dirname(commandPath), { recursive: true });
writeFileSync(commandPath, `# Browser Flow\n\nUse this command to run the browser-flow workflow.\n\n${prompt}`);
