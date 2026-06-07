#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  checkRuntimeDependencyPreflight,
  formatRuntimePreflightError
} from "./lib/runtime-preflight.mjs";
import {
  classifyCliError,
  formatHumanCliError,
  formatJsonCliError,
  isJsonErrorMode
} from "./lib/cli-errors.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredPackages = ["chrome-remote-interface", "parse5", "cheerio", "zod"];

function dependencyReady(/** @type {string} */ name) {
  return existsSync(resolve(runtimeRoot, "node_modules", name, "package.json"));
}

/**
 * @param {string} runtimeRoot
 * @param {unknown} detail
 */
export function formatDependencyInstallError(runtimeRoot, detail) {
  const base = `Unable to prepare browser-flow runtime dependencies inside ${runtimeRoot}.`;
  const trimmedDetail = detail ? String(detail).trim() : "";
  const permissionHint = /EACCES|EPERM|permission denied|operation not permitted/i.test(trimmedDetail)
    ? "\nPermission hint: fix the directory permissions, then rerun `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`."
    : "";

  return trimmedDetail ? `${base}\n${trimmedDetail}${permissionHint}` : `${base}${permissionHint}`;
}

function ensureRuntimeDependencies() {
  if (requiredPackages.every(dependencyReady)) return;

  const preflight = checkRuntimeDependencyPreflight(runtimeRoot);
  if (!preflight.ok) {
    throw new Error(formatRuntimePreflightError(runtimeRoot, preflight));
  }

  process.stderr.write("[browser-flow] preparing bundled runtime dependencies...\n");
  const result = spawnSync(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(formatDependencyInstallError(runtimeRoot, detail));
  }
}

async function runCli() {
  try {
    ensureRuntimeDependencies();
    await import("./cli-main.mjs");
  } catch (error) {
    const failure = classifyCliError(error, { command: process.argv[2] });
    process.exitCode = failure.exitCode;
    if (isJsonErrorMode(process.argv)) {
      process.stdout.write(`${JSON.stringify(formatJsonCliError(failure), null, 2)}\n`);
    } else {
      process.stderr.write(formatHumanCliError(failure));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
