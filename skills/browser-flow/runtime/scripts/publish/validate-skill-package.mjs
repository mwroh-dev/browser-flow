#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleBrowserFlowPackage } from "./render-browser-flow-surfaces.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stageRoot = resolve(tmpdir(), `browser-flow-validate-${process.pid}-${Date.now()}`);
const packageRoot = resolve(stageRoot, "skills", "browser-flow");

try {
  rmSync(stageRoot, { recursive: true, force: true });
  assembleBrowserFlowPackage(repoRoot, packageRoot);
  execFileSync(process.execPath, [resolve(packageRoot, "scripts/validate-skill.mjs")], {
    cwd: packageRoot,
    stdio: "inherit"
  });
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
