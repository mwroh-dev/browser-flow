#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [sourceSkillDir, outputPath, packageMountPath = ".claude/browser-flow"] = process.argv.slice(2);

if (!sourceSkillDir || !outputPath) {
  process.stderr.write("Usage: render-claude-command.mjs <sourceSkillDir> <outputPath> [packageMountPath]\n");
  process.exit(64);
}

const promptPath = resolve(sourceSkillDir, "prompt.md");
const commandPath = resolve(outputPath);

if (!existsSync(promptPath)) {
  process.stderr.write(`prompt.md not found: ${promptPath}\n`);
  process.exit(66);
}

const prompt = readFileSync(promptPath, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/(?<![\w-])runtime\/scripts\/cli\.mjs/g, `${packageMountPath}/runtime/scripts/cli.mjs`)
  .replace(/(?<![\w-])runtime\/knowledge\//g, `${packageMountPath}/runtime/knowledge/`)
  .replace(/(?<![\w-])runtime\/artifacts\//g, `${packageMountPath}/runtime/artifacts/`)
  .replace(/(?<![\w-])agents\//g, `${packageMountPath}/agents/`)
  .replace(/(?<![\w-])skills\//g, `${packageMountPath}/skills/`)
  .replace(/(?<![\w-])references\//g, `${packageMountPath}/references/`);

mkdirSync(dirname(commandPath), { recursive: true });
writeFileSync(commandPath, `# Browser Flow\n\nUse this command to run the browser-flow workflow.\n\n${prompt}`);
