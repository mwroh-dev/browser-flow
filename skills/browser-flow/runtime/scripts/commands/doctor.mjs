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

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { getPagesRoot, pagePaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { getStringOption } from "../lib/args.mjs";

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
 * @returns {{ pageNodes: PageNodeStatus[] }}
 */
export function doctorCommand(options) {
  const specificKey = getStringOption(options, "page-key", undefined);
  const keys = specificKey ? [specificKey] : listPageKeys();
  const pageNodes = keys.map(pageNodeStatus);
  return { pageNodes };
}
