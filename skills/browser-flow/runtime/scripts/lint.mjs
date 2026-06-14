#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["scripts", "tests"];

/**
 * @param {string} root
 * @returns {string[]}
 */
function collectFiles(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const fullPath = join(root, name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      entries.push(...collectFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".mjs")) {
      entries.push(fullPath);
    }
  }
  return entries;
}

const files = roots.flatMap((root) => collectFiles(root));

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });
}

console.log(`Syntax-checked ${files.length} files.`);
