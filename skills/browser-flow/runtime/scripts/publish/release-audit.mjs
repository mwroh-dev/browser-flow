#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultReleaseRoot = resolve(dirname(scriptPath), "..", "..", "..", "browser-flow-released");

const TEXT_EXT = /\.(mjs|js|cjs|ts|json|md|ya?ml|txt|html|css|sh)$/i;
const PERSONAL_PATTERN = /\/Users\/cielo-iamdt|Downloads\/browser-test|projects\/browser-flow-released|\bcielo-iamdt\b/;
const SECRET_PATTERN = /Bearer\s+[A-Za-z0-9._-]{20,}|Authorization:\s*[^\n]+|Cookie:\s*[^\n]+|Set-Cookie:\s*[^\n]+|BEGIN (?:RSA|OPENSSH|PRIVATE) KEY/i;
const FORBIDDEN_PATH_PATTERN = /(^|\/)(?:artifacts|profiles|_temp|docs|tasks)(?:\/|$)|raw-events\.jsonl$|events\/journal\.jsonl$|\.html\.gz$|\/reports\/screenshots\/.+\.png$|capture-final\.png$/i;
const PERSONAL_TERMS = [
  "/Users/cielo-iamdt",
  "Downloads/browser-test",
  "projects/browser-flow-released",
  "cielo-iamdt"
];
const SECRET_TERMS = [
  "Bearer ",
  "Authorization:",
  "Cookie:",
  "Set-Cookie:",
  "BEGIN RSA",
  "BEGIN OPENSSH",
  "BEGIN PRIVATE"
];

/**
 * @param {string} releaseRoot
 * @returns {{ ok: true } | { ok: false, findings: string[] }}
 */
export function auditRelease(releaseRoot) {
  const root = resolve(releaseRoot);
  /** @type {string[]} */
  const findings = [];
  if (!existsSync(root)) {
    return { ok: false, findings: [`release root does not exist: ${root}`] };
  }
  auditCurrentTree(root, findings);
  auditGitHistory(root, findings);
  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}

/**
 * @param {string} root
 * @param {string[]} findings
 */
function auditCurrentTree(root, findings) {
  for (const file of listFiles(root)) {
    const rel = toRel(root, file);
    if (FORBIDDEN_PATH_PATTERN.test(rel)) {
      findings.push(`current forbidden path: ${rel}`);
      continue;
    }
    if (!TEXT_EXT.test(rel)) continue;
    const text = readFileSync(file, "utf8");
    if (PERSONAL_PATTERN.test(text)) findings.push(`current personal marker: ${rel}`);
    if (SECRET_PATTERN.test(text)) findings.push(`current secret marker: ${rel}`);
  }
  auditLatestReleaseMetadata(root, findings);
}

/**
 * @param {string} root
 * @param {string[]} findings
 */
function auditLatestReleaseMetadata(root, findings) {
  const sourcePath = resolve(root, ".release-source.json");
  const readmePath = resolve(root, "README.md");
  if (!existsSync(sourcePath) || !existsSync(readmePath)) return;
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const readme = readFileSync(readmePath, "utf8");
  const sourceHead = typeof source.sourceHead === "string" ? source.sourceHead : "";
  const builtAt = typeof source.builtAt === "string" ? source.builtAt : "";
  const shortSha = sourceHead.slice(0, 7);
  if (shortSha && !readme.includes(`- Source SHA: \`${shortSha}\``)) {
    findings.push(`README latest source SHA mismatch: expected ${shortSha}`);
  }
  if (builtAt && !readme.includes(`- Updated: ${builtAt}`)) {
    findings.push(`README latest updated timestamp mismatch: expected ${builtAt}`);
  }
}

/**
 * @param {string} root
 * @param {string[]} findings
 */
function auditGitHistory(root, findings) {
  if (!existsSync(resolve(root, ".git"))) return;
  const historicalPaths = runGit(root, ["log", "--all", "--name-only", "--pretty=format:"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const rel of new Set(historicalPaths)) {
    if (FORBIDDEN_PATH_PATTERN.test(rel)) {
      findings.push(`history forbidden path: ${rel}`);
    }
  }
  const revs = runGit(root, ["rev-list", "--all"]).split("\n").filter(Boolean);
  for (const rev of revs) {
    if (grepHistoryTerms(root, rev, PERSONAL_TERMS)) findings.push(`history personal marker: ${rev.slice(0, 12)}`);
    if (grepHistoryTerms(root, rev, SECRET_TERMS)) findings.push(`history secret marker: ${rev.slice(0, 12)}`);
  }
}

/**
 * @param {string} root
 * @param {string} rev
 * @param {string[]} terms
 */
function grepHistoryTerms(root, rev, terms) {
  for (const term of terms) {
    if (runGitMaybe(root, ["grep", "-I", "-n", "-F", term, rev, "--", "."])) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runGitMaybe(cwd, args) {
  try {
    return runGit(cwd, args);
  } catch {
    return "";
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
  const result = auditRelease(releaseRoot);
  if (!result.ok) {
    for (const finding of result.findings) {
      process.stderr.write(`RELEASE_AUDIT ${finding}\n`);
    }
    process.stderr.write(`release:audit FAILED (${result.findings.length} finding(s))\n`);
    process.exit(1);
  }
  process.stdout.write(`release:audit OK (${releaseRoot})\n`);
}

if (process.argv[1] === scriptPath) {
  main();
}
