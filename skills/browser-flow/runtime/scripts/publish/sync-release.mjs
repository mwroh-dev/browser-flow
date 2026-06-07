#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditRelease } from "./release-audit.mjs";
import { applyReleaseNote, readReleaseNote, updateReadmeLatest, validateReleaseNote } from "./release-history.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultReleaseRoot = resolve(repoRoot, "..", "browser-flow-released");
const RELEASE_STATE = ".release-state.json";
const RELEASE_SOURCE = ".release-source.json";
const PROJECTION_VERSION = 1;

function run(/** @type {string} */ command, /** @type {string[]} */ args, /** @type {string} */ cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function assertGitRepo(/** @type {string} */ path, /** @type {string} */ label) {
  if (!existsSync(resolve(path, ".git"))) {
    throw new Error(`${label} is not a git repo: ${path}`);
  }
}

/**
 * Build the sibling release bundle and commit it when the build changed files.
 *
 * @param {{
 *   sourceRoot?: string,
 *   releaseRoot?: string,
 *   env?: Record<string, string | undefined>,
 *   build?: (bundleRoot: string) => void,
 *   releaseNotePath?: string,
 *   releaseNote?: unknown,
 *   now?: string,
 *   audit?: (releaseRoot: string) => void
 * }} [options]
 */
export function syncRelease(options = {}) {
  const env = options.env ?? process.env;
  if (env.BROWSER_FLOW_SKIP_RELEASE_HOOK) {
    return { status: "skipped" };
  }

  const sourceRoot = options.sourceRoot ?? repoRoot;
  const releaseRoot = options.releaseRoot ?? defaultReleaseRoot;
  assertGitRepo(sourceRoot, "sourceRoot");
  assertGitRepo(releaseRoot, "releaseRoot");

  const sourceDirty = run("git", ["status", "--short"], sourceRoot);
  if (sourceDirty) {
    throw new Error(`source repo has uncommitted changes:\n${sourceDirty}`);
  }

  const dirtyBefore = run("git", ["status", "--short"], releaseRoot);
  if (dirtyBefore) {
    throw new Error(`release repo has uncommitted changes:\n${dirtyBefore}`);
  }

  const sourceSha = run("git", ["rev-parse", "--short", "HEAD"], sourceRoot);
  const sourceHead = run("git", ["rev-parse", "HEAD"], sourceRoot);
  const sourceBranch = run("git", ["branch", "--show-current"], sourceRoot) || "detached";
  if (sourceBranch !== "main") {
    throw new Error(`release sync must run from source main, got: ${sourceBranch}`);
  }
  const mode = resolveReleaseMode(env);
  const previousState = readReleaseState(releaseRoot);
  if (mode === "bootstrap-amend" && previousState.published === true) {
    throw new Error("bootstrap-amend is only allowed before public release");
  }
  if (mode === "append" && previousState.published === false) {
    throw new Error("append release sync requires published release state; use bootstrap-amend before public release");
  }
  const previousSource = readReleaseSource(releaseRoot);
  const previousSourceHead = previousSource?.sourceHead ?? null;
  const sourceAlreadySynced = previousSourceHead === sourceHead;
  if (previousSourceHead) {
    assertSourceAncestor(sourceRoot, previousSourceHead, sourceHead);
  }
  const previousHistory = readTextIfExists(resolve(releaseRoot, "HISTORY.md"));
  const previousReadme = readTextIfExists(resolve(releaseRoot, "README.md"));
  const bundleRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-release-bundle-"));
  const note = resolveReleaseNote(options, env);
  const now = options.now ?? new Date().toISOString();
  try {
    const build = options.build ?? ((target) => {
      execFileSync(process.execPath, ["scripts/publish/build-bundle.mjs"], {
        cwd: sourceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, BROWSER_FLOW_RELEASE_DIR: target }
      });
    });
    build(bundleRoot);
    const bundleFileCount = readBundleFileCount(bundleRoot);
    writeReleaseState(bundleRoot, previousState, now);
    writeReleaseSource(bundleRoot, {
      previousSourceHead,
      sourceHead,
      sourceRange: previousSourceHead ? `${previousSourceHead}..${sourceHead}` : null,
      sourceBranch,
      builtAt: now,
      bundleFileCount,
      projectionVersion: PROJECTION_VERSION
    });

    if (note) {
      const historyPath = resolve(bundleRoot, "HISTORY.md");
      const readmePath = resolve(bundleRoot, "README.md");
      const metadata = {
        updateDate: now,
        sourceBranch,
        sourceSha,
        bundleFileCount
      };
      const applied = applyReleaseNote({
        historyMarkdown: previousHistory || readFileSync(historyPath, "utf8"),
        readmeMarkdown: previousReadme || readFileSync(readmePath, "utf8"),
        note,
        metadata
      });
      writeFileSync(historyPath, applied.historyMarkdown, "utf8");
      writeFileSync(readmePath, applied.readmeMarkdown, "utf8");
    } else {
      // build-bundle copies public README/HISTORY templates. Preserve the release
      // repo's existing ledger once it is published. During bootstrap-amend the
      // source templates are still canonical and should replace pre-public drafts.
      if (previousHistory && mode !== "bootstrap-amend") {
        writeFileSync(resolve(bundleRoot, "HISTORY.md"), previousHistory, "utf8");
      }
      const readmePath = resolve(bundleRoot, "README.md");
      const readmeForLatest = previousReadme && mode !== "bootstrap-amend"
        ? previousReadme
        : readFileSync(readmePath, "utf8");
      writeFileSync(
        readmePath,
        updateReadmeLatest(readmeForLatest, [], {
          updateDate: now,
          sourceBranch,
          sourceSha,
          bundleFileCount
        }),
        "utf8"
      );
    }

    if (mode === "append" && !note && sourceAlreadySynced) {
      preserveExistingReleaseFiles(bundleRoot, releaseRoot, [
        ".bundle-stamp.json",
        ".release-source.json",
        ".release-state.json",
        "HISTORY.md",
        "README.md"
      ]);
    }

    if (!hasBundleDiff(bundleRoot, releaseRoot)) {
      return { status: "unchanged", sourceSha };
    }
    if (!note && mode !== "bootstrap-amend") {
      throw new Error(
        "release repo has sync changes but no release note was provided. " +
        "Set BROWSER_FLOW_RELEASE_NOTE or pass releaseNotePath."
      );
    }

    applyBundleFiles(bundleRoot, releaseRoot);
  } finally {
    rmSync(bundleRoot, { recursive: true, force: true });
  }

  const dirtyAfter = run("git", ["status", "--short"], releaseRoot);
  if (!dirtyAfter) {
    return { status: "unchanged", sourceSha };
  }

  const audit = options.audit ?? ((root) => {
    const result = auditRelease(root);
    if (!result.ok) {
      throw new Error(`release audit failed:\n${result.findings.join("\n")}`);
    }
  });
  audit(releaseRoot);

  run("git", ["add", "-A"], releaseRoot);
  const commitArgs = [
    "commit",
    "-m",
    `release: sync from ${sourceSha}`,
    "-m",
    renderCommitMetadata(previousSourceHead, sourceHead)
  ];
  if (mode === "bootstrap-amend" && hasHeadCommit(releaseRoot)) {
    run("git", [...commitArgs, "--amend"], releaseRoot);
    return { status: "amended", sourceSha };
  }
  run("git", commitArgs, releaseRoot);
  return { status: "committed", sourceSha };
}

/**
 * @param {string} bundleRoot
 * @param {string} releaseRoot
 * @param {string[]} files
 */
function preserveExistingReleaseFiles(bundleRoot, releaseRoot, files) {
  for (const rel of files) {
    const existing = resolve(releaseRoot, rel);
    if (existsSync(existing)) {
      copyFileSync(existing, resolve(bundleRoot, rel));
    }
  }
}

/**
 * @param {string} path
 */
function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {"append" | "bootstrap-amend"}
 */
function resolveReleaseMode(env) {
  const mode = env.BROWSER_FLOW_RELEASE_MODE || "append";
  if (mode !== "append" && mode !== "bootstrap-amend") {
    throw new Error(`invalid BROWSER_FLOW_RELEASE_MODE: ${mode}`);
  }
  return mode;
}

/**
 * @param {string} releaseRoot
 * @returns {{ published: boolean | null, projectionVersion: number, createdAt: string | null, updatedAt: string | null }}
 */
function readReleaseState(releaseRoot) {
  const path = resolve(releaseRoot, RELEASE_STATE);
  if (!existsSync(path)) {
    return { published: null, projectionVersion: PROJECTION_VERSION, createdAt: null, updatedAt: null };
  }
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (typeof state.published !== "boolean") {
    throw new Error(`${RELEASE_STATE} must include boolean published`);
  }
  return {
    published: state.published,
    projectionVersion: typeof state.projectionVersion === "number" ? state.projectionVersion : PROJECTION_VERSION,
    createdAt: typeof state.createdAt === "string" ? state.createdAt : null,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null
  };
}

/**
 * @param {string} releaseRoot
 * @returns {{ sourceHead?: string } | null}
 */
function readReleaseSource(releaseRoot) {
  const path = resolve(releaseRoot, RELEASE_SOURCE);
  if (!existsSync(path)) return null;
  const source = JSON.parse(readFileSync(path, "utf8"));
  return source && typeof source === "object" ? source : null;
}

/**
 * @param {string} bundleRoot
 * @param {{ published: boolean | null, projectionVersion: number, createdAt: string | null, updatedAt: string | null }} previousState
 * @param {string} now
 */
function writeReleaseState(bundleRoot, previousState, now) {
  const published = previousState.published === true;
  const createdAt = previousState.createdAt || now;
  writeFileSync(resolve(bundleRoot, RELEASE_STATE), JSON.stringify({
    published,
    projectionVersion: previousState.projectionVersion || PROJECTION_VERSION,
    createdAt,
    updatedAt: now
  }, null, 2) + "\n");
}

/**
 * @param {string} bundleRoot
 * @param {{
 *   previousSourceHead: string | null,
 *   sourceHead: string,
 *   sourceRange: string | null,
 *   sourceBranch: string,
 *   builtAt: string,
 *   bundleFileCount?: number,
 *   projectionVersion: number
 * }} source
 */
function writeReleaseSource(bundleRoot, source) {
  writeFileSync(resolve(bundleRoot, RELEASE_SOURCE), JSON.stringify(source, null, 2) + "\n");
}

/**
 * @param {string} sourceRoot
 * @param {string} previousSourceHead
 * @param {string} sourceHead
 */
function assertSourceAncestor(sourceRoot, previousSourceHead, sourceHead) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", previousSourceHead, sourceHead], {
      cwd: sourceRoot,
      stdio: "ignore"
    });
  } catch {
    throw new Error(`previous released source is not an ancestor of current source: ${previousSourceHead}`);
  }
}

/**
 * @param {string | null} previousSourceHead
 * @param {string} sourceHead
 */
function renderCommitMetadata(previousSourceHead, sourceHead) {
  return [
    `Source-Previous: ${previousSourceHead || "null"}`,
    `Source-Commit: ${sourceHead}`,
    `Source-Range: ${previousSourceHead ? `${previousSourceHead}..${sourceHead}` : "initial"}`,
    `Projection-Version: ${PROJECTION_VERSION}`
  ].join("\n");
}

/**
 * @param {string} releaseRoot
 */
function hasHeadCommit(releaseRoot) {
  try {
    run("git", ["rev-parse", "--verify", "HEAD"], releaseRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} releaseRoot
 */
function readBundleFileCount(releaseRoot) {
  try {
    const stamp = JSON.parse(readFileSync(resolve(releaseRoot, ".bundle-stamp.json"), "utf8"));
    return typeof stamp.fileCount === "number" ? stamp.fileCount : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} bundleRoot
 * @param {string} releaseRoot
 */
function hasBundleDiff(bundleRoot, releaseRoot) {
  const bundleFiles = listFiles(bundleRoot);
  const releaseFiles = listFiles(releaseRoot);
  const bundleSet = new Set(bundleFiles);
  const releaseSet = new Set(releaseFiles);
  if (bundleFiles.some((rel) => !releaseSet.has(rel))) return true;
  if (releaseFiles.some((rel) => !bundleSet.has(rel))) return true;
  return bundleFiles.some((rel) => !sameFile(resolve(bundleRoot, rel), resolve(releaseRoot, rel)));
}

/**
 * Apply an already-validated bundle to the release repo file-by-file. This
 * deliberately avoids replacing the release directory wholesale: stale files
 * are removed individually, changed files are copied individually, and .git is
 * left untouched.
 *
 * @param {string} bundleRoot
 * @param {string} releaseRoot
 */
function applyBundleFiles(bundleRoot, releaseRoot) {
  const bundleFiles = listFiles(bundleRoot);
  const releaseFiles = listFiles(releaseRoot);
  const bundleSet = new Set(bundleFiles);
  for (const rel of releaseFiles) {
    if (!bundleSet.has(rel)) {
      rmSync(resolve(releaseRoot, rel), { force: true });
    }
  }
  for (const rel of bundleFiles) {
    const src = resolve(bundleRoot, rel);
    const dest = resolve(releaseRoot, rel);
    if (existsSync(dest) && sameFile(src, dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  pruneEmptyDirs(releaseRoot, releaseRoot);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listFiles(root) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ abs, /** @type {string} */ rel) => {
    for (const name of readdirSync(abs)) {
      if (!rel && name === ".git") continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const child = resolve(abs, name);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child, childRel);
      else out.push(childRel);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * @param {string} left
 * @param {string} right
 */
function sameFile(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  return Buffer.compare(readFileSync(left), readFileSync(right)) === 0;
}

/**
 * @param {string} root
 * @param {string} dir
 */
function pruneEmptyDirs(root, dir) {
  for (const name of readdirSync(dir)) {
    if (dir === root && name === ".git") continue;
    const child = resolve(dir, name);
    if (statSync(child).isDirectory()) pruneEmptyDirs(root, child);
  }
  if (dir !== root && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {{ releaseNotePath?: string, releaseNote?: unknown }} options
 * @param {Record<string, string | undefined>} env
 */
function resolveReleaseNote(options, env) {
  if (options.releaseNote) return validateReleaseNote(options.releaseNote);
  const notePath = options.releaseNotePath ?? env.BROWSER_FLOW_RELEASE_NOTE;
  if (!notePath) return null;
  return readReleaseNote(resolve(notePath));
}

function main() {
  try {
    const result = syncRelease();
    process.stdout.write(`sync-release ${result.status}${result.sourceSha ? ` (${result.sourceSha})` : ""}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sync-release failed: ${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
