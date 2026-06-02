#!/usr/bin/env node
// Test-suite runner with a deterministic/Chrome split.
//
// The repo's real-Chrome integration tests are non-deterministic under loaded
// serial full-suite runs (Chrome process + tmp-profile leakage; plus an
// architectural enumerate-gap race in verify-breadth-enrichment — see
// docs/testing.md and tasks/lessons.md 2026-05-24). They are listed in
// scripts/test/e2e-suite.json and quarantined out of the unit suite so that
// `npm run check` (which runs `npm test` = the unit suite) is deterministic.
//
// Usage:
//   node scripts/test/run-suite.mjs --suite=unit            (default; used by `npm test`)
//   node scripts/test/run-suite.mjs --suite=e2e --retries=2 (real Chrome lane)
//   node scripts/test/run-suite.mjs --suite=all             (everything, once)
//
// Mirrors the node:test flags the project relies on (test isolation import,
// serial execution, timeout, force-exit).

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const testsRoot = resolve(repoRoot, "tests");
const e2eListPath = resolve(repoRoot, "scripts", "test", "e2e-suite.json");

/**
 * @param {string[]} argv
 * @returns {{ suite: string, retries: number }}
 */
function parseArgs(argv) {
  let suite = "unit";
  let retries = 0;
  for (const arg of argv) {
    if (arg.startsWith("--suite=")) suite = arg.slice("--suite=".length);
    else if (arg.startsWith("--retries=")) retries = Number(arg.slice("--retries=".length)) || 0;
  }
  return { suite, retries };
}

/**
 * Repo-relative POSIX paths of every *.test.mjs under tests/.
 * @param {string} dir
 * @returns {string[]}
 */
function walkTests(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = resolve(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkTests(abs));
    else if (name.endsWith(".test.mjs")) out.push(relative(repoRoot, abs).split(sep).join("/"));
  }
  return out;
}

/** @returns {string[]} */
function nodeTestFlags() {
  return [
    "--import=./tests/_setup.mjs",
    "--test",
    "--test-concurrency=1",
    "--test-timeout=120000",
    "--test-force-exit"
  ];
}

/**
 * Run files, streaming output live. Returns the process exit code.
 * @param {string[]} files
 * @returns {number}
 */
function runLive(files) {
  const res = spawnSync(process.execPath, [...nodeTestFlags(), ...files], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  return res.status ?? 1;
}

/**
 * Run files capturing stdout so failed FILES can be parsed for retry.
 * node:test prints a top-level `not ok N - <abs file path>` per failing file.
 * @param {string[]} files
 * @returns {{ code: number, failedFiles: string[] }}
 */
function runCapturing(files) {
  const res = spawnSync(process.execPath, [...nodeTestFlags(), ...files], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  });
  const stdout = res.stdout || "";
  process.stdout.write(stdout);
  /** @type {Set<string>} */
  const failed = new Set();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^not ok \d+ - (.+\.test\.mjs)\s*$/);
    if (!match) continue;
    const raw = match[1].trim();
    const rel = raw.startsWith("/") ? relative(repoRoot, raw).split(sep).join("/") : raw;
    failed.add(rel);
  }
  return { code: res.status ?? 1, failedFiles: [...failed] };
}

function main() {
  const { suite, retries } = parseArgs(process.argv.slice(2));

  const all = walkTests(testsRoot).sort();

  /** @type {{ files: string[] }} */
  const e2eDoc = JSON.parse(readFileSync(e2eListPath, "utf8"));
  const e2eList = e2eDoc.files;
  const stale = e2eList.filter((file) => !existsSync(resolve(repoRoot, file)));
  if (stale.length > 0) {
    process.stderr.write(`[run-suite] e2e-suite.json lists missing file(s):\n  ${stale.join("\n  ")}\n`);
    process.exit(2);
  }
  const e2eSet = new Set(e2eList);
  const unit = all.filter((file) => !e2eSet.has(file));
  const e2e = all.filter((file) => e2eSet.has(file));

  /** @type {string[]} */
  let files;
  if (suite === "unit") files = unit;
  else if (suite === "e2e") files = e2e;
  else if (suite === "all") files = all;
  else {
    process.stderr.write(`[run-suite] unknown --suite=${suite} (expected unit|e2e|all)\n`);
    process.exit(2);
    return;
  }

  process.stdout.write(
    `[run-suite] suite=${suite} → ${files.length} file(s) ` +
    `(unit=${unit.length}, e2e=${e2e.length}, total=${all.length}, retries=${retries})\n`
  );

  if (files.length === 0) {
    process.stdout.write("[run-suite] no files for this suite — nothing to run.\n");
    process.exit(0);
    return;
  }

  if (retries <= 0) {
    process.exit(runLive(files));
    return;
  }

  // Retry lane: re-run only the failed files, up to `retries` times.
  let toRun = files;
  let attempt = 0;
  let lastCode = 1;
  while (attempt <= retries) {
    if (attempt > 0) {
      process.stdout.write(`[run-suite] retry ${attempt}/${retries} on ${toRun.length} failed file(s)\n`);
    }
    const { code, failedFiles } = runCapturing(toRun);
    lastCode = code;
    if (code === 0) {
      process.stdout.write(`[run-suite] PASS${attempt > 0 ? ` (after ${attempt} retry/retries)` : ""}\n`);
      process.exit(0);
      return;
    }
    if (failedFiles.length === 0) {
      // Non-zero exit but no parseable failed files — bail with the code.
      process.exit(code);
      return;
    }
    toRun = failedFiles;
    attempt += 1;
  }
  process.stderr.write(`[run-suite] still failing after ${retries} retry/retries: ${toRun.join(", ")}\n`);
  process.exit(lastCode || 1);
}

main();
