// bf doctor: staleness detection command.
//
// Reads the per-page-node snapshot time-series
// (knowledge/pages/<pageKey>/snapshots/<timestampMs>.html.gz), computes
// content hashes on the first and latest snapshot of each page-node,
// and reports a binary staleness status: stable vs changed.
//
// Design decisions:
// - hash-only diff (not semantic HTML diff) for v1
// - first-vs-last comparison only (not every-adjacent-pair)
// - decompress before hashing (sha256 of gunzipped bytes)
// - read-only: doctor surfaces signal, does not mutate state

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { getDefaultChromePath, getPagesRoot, getPaths, getRepoRoot, pagePaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { getStringOption } from "../lib/args.mjs";
import { checkRuntimeDependencyPreflight } from "../lib/runtime-preflight.mjs";

const REQUIRED_PACKAGES = ["chrome-remote-interface", "parse5", "cheerio", "zod"];

/**
 * Walk getPagesRoot() recursively and return all pageKeys (any
 * subdirectory that contains meta.json). Nested page-nodes are
 * supported because pageKeys themselves can contain `/` segments
 * (e.g., `synthetic/synthetic/result`).
 *
 * @returns {string[]}
 */
function listPageKeys() {
  const root = getPagesRoot();
  if (!existsSync(root)) {
    return [];
  }
  /** @type {string[]} */
  const keys = [];
  /**
   * @param {string} dir
   * @param {string[]} segments
   */
  function walk(dir, segments) {
    if (segments.length > 0 && existsSync(resolve(dir, "meta.json"))) {
      keys.push(segments.join("/"));
    }
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "snapshots") {
        walk(resolve(dir, entry.name), [...segments, entry.name]);
      }
    }
  }
  walk(root, []);
  return keys.sort();
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function hashSnapshot(absolutePath) {
  const compressed = readFileSync(absolutePath);
  const decompressed = gunzipSync(compressed);
  return createHash("sha256").update(decompressed).digest("hex");
}

/**
 * @typedef {{
 *   pageKey: string,
 *   captureCount: number,
 *   snapshotCount: number,
 *   status: "no-snapshots" | "single-capture" | "stable" | "changed",
 *   firstHash?: string,
 *   latestHash?: string,
 *   firstSnapshot?: string,
 *   latestSnapshot?: string
 * }} PageNodeStatus
 *
 * @typedef {{
 *   name: string,
 *   ok: boolean,
 *   status: "ok" | "warning" | "fail",
 *   detail: string,
 *   path?: string
 * }} PreflightCheck
 */

/**
 * Compute staleness status for a single page-node.
 *
 * @param {string} pageKey
 * @returns {PageNodeStatus}
 */
export function pageNodeStatus(pageKey) {
  const paths = pagePaths(pageKey);
  const meta = /** @type {{ captureCount?: number }} */ (readJson(paths.metaPath));

  let snapshotFiles = /** @type {string[]} */ ([]);
  if (existsSync(paths.snapshotsDir)) {
    snapshotFiles = readdirSync(paths.snapshotsDir)
      .filter((name) => name.endsWith(".html.gz"))
      .sort(); // filenames are <timestampMs>.html.gz → lex sort == chronological
  }

  const captureCount = typeof meta.captureCount === "number" ? meta.captureCount : 0;

  if (snapshotFiles.length === 0) {
    return {
      pageKey,
      captureCount,
      snapshotCount: 0,
      status: "no-snapshots"
    };
  }

  if (snapshotFiles.length === 1) {
    return {
      pageKey,
      captureCount,
      snapshotCount: 1,
      status: "single-capture",
      firstHash: hashSnapshot(resolve(paths.snapshotsDir, snapshotFiles[0])),
      firstSnapshot: snapshotFiles[0]
    };
  }

  const firstName = snapshotFiles[0];
  const latestName = snapshotFiles[snapshotFiles.length - 1];
  const firstHash = hashSnapshot(resolve(paths.snapshotsDir, firstName));
  const latestHash = hashSnapshot(resolve(paths.snapshotsDir, latestName));
  return {
    pageKey,
    captureCount,
    snapshotCount: snapshotFiles.length,
    status: firstHash === latestHash ? "stable" : "changed",
    firstHash,
    latestHash,
    firstSnapshot: firstName,
    latestSnapshot: latestName
  };
}

/**
 * `bf doctor [--page-key <key>]` — survey page-node staleness.
 *
 * @param {Record<string, string | boolean>} options
 * @returns {{ pageNodes: PageNodeStatus[], preflight: { ok: boolean, checks: PreflightCheck[] } }}
 */
export function doctorCommand(options) {
  const specificKey = getStringOption(options, "page-key", undefined);
  const keys = specificKey ? [specificKey] : listPageKeys();
  const pageNodes = keys.map(pageNodeStatus);
  return { pageNodes, preflight: buildPreflight(options) };
}

/**
 * @param {Record<string, string | boolean>} options
 * @returns {{ ok: boolean, checks: PreflightCheck[] }}
 */
function buildPreflight(options) {
  const checks = [
    nodeCheck(),
    npmCheck(),
    runtimeDependencyCheck(),
    artifactDirectoriesCheck(),
    registryCheck(),
    securityBaselineCheck(),
    chromeCheck(getStringOption(options, "chrome-path", getDefaultChromePath()))
  ];
  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks
  };
}

/**
 * @returns {PreflightCheck}
 */
function nodeCheck() {
  return {
    name: "node",
    ok: true,
    status: "ok",
    detail: `Node ${process.version}`
  };
}

/**
 * @returns {PreflightCheck}
 */
function npmCheck() {
  const result = spawnSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.error) {
    return {
      name: "npm",
      ok: false,
      status: "fail",
      detail: result.error.message
    };
  }
  if (result.status !== 0) {
    return {
      name: "npm",
      ok: false,
      status: "fail",
      detail: (result.stderr || result.stdout || "npm --version failed").trim()
    };
  }
  return {
    name: "npm",
    ok: true,
    status: "ok",
    detail: `npm ${(result.stdout || "").trim()}`
  };
}

/**
 * @returns {PreflightCheck}
 */
function runtimeDependencyCheck() {
  const repoRoot = getRepoRoot();
  const missing = REQUIRED_PACKAGES.filter((name) => !existsSync(resolve(repoRoot, "node_modules", name, "package.json")));
  const writable = checkRuntimeDependencyPreflight(repoRoot);
  if (!writable.ok) {
    return {
      name: "runtimeDependencies",
      ok: false,
      status: "fail",
      detail: writable.detail || "runtime root is not writable",
      path: repoRoot
    };
  }
  if (missing.length > 0) {
    return {
      name: "runtimeDependencies",
      ok: false,
      status: "fail",
      detail: `missing packages: ${missing.join(", ")}`,
      path: resolve(repoRoot, "node_modules")
    };
  }
  return {
    name: "runtimeDependencies",
    ok: true,
    status: "ok",
    detail: "required runtime packages are installed",
    path: resolve(repoRoot, "node_modules")
  };
}

/**
 * @returns {PreflightCheck}
 */
function artifactDirectoriesCheck() {
  const paths = getPaths();
  const checks = [
    directoryWritableStatus(paths.runsRoot),
    directoryWritableStatus(dirname(paths.registryPath))
  ];
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warning");
  return {
    name: "artifactDirectories",
    ok: failed.length === 0,
    status: failed.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "ok",
    detail: checks.map((check) => `${check.path}: ${check.detail}`).join("; ")
  };
}

/**
 * @param {string} path
 * @returns {{ path: string, status: "ok" | "warning" | "fail", detail: string }}
 */
function directoryWritableStatus(path) {
  if (!existsSync(path)) {
    return { path, status: "warning", detail: "directory does not exist yet" };
  }
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return { path, status: "ok", detail: "readable and writable" };
  } catch (error) {
    return {
      path,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @returns {PreflightCheck}
 */
function registryCheck() {
  const { registryPath } = getPaths();
  if (!existsSync(registryPath)) {
    return {
      name: "registry",
      ok: true,
      status: "warning",
      detail: "registry file does not exist yet",
      path: registryPath
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    if (!Array.isArray(parsed)) {
      return {
        name: "registry",
        ok: false,
        status: "fail",
        detail: "registry JSON must be an array",
        path: registryPath
      };
    }
    return {
      name: "registry",
      ok: true,
      status: "ok",
      detail: `${parsed.length} entries readable`,
      path: registryPath
    };
  } catch (error) {
    return {
      name: "registry",
      ok: false,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      path: registryPath
    };
  }
}

/**
 * @returns {PreflightCheck}
 */
function securityBaselineCheck() {
  const repoRoot = getRepoRoot();
  const required = [
    resolve(repoRoot, "scripts", "security", "pii-scan.mjs"),
    resolve(repoRoot, "scripts", "security", "no-provenance.mjs")
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    return {
      name: "securityBaseline",
      ok: false,
      status: "fail",
      detail: `missing security scripts: ${missing.join(", ")}`
    };
  }
  return {
    name: "securityBaseline",
    ok: true,
    status: "ok",
    detail: "security scan entrypoints are present"
  };
}

/**
 * @param {string | undefined} chromePath
 * @param {() => string | undefined} [defaultChromePath]
 * @returns {PreflightCheck}
 */
export function chromeCheck(chromePath, defaultChromePath = getDefaultChromePath) {
  const path = chromePath || defaultChromePath();
  if (typeof path !== "string" || !existsSync(path)) {
    return {
      name: "chrome",
      ok: false,
      status: "warning",
      detail: "Chrome path does not exist; set --chrome-path or BROWSER_FLOW_CHROME_PATH before browser phases",
      path
    };
  }
  return {
    name: "chrome",
    ok: true,
    status: "ok",
    detail: "Chrome path exists",
    path
  };
}
