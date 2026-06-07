import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pagePaths, pageSnapshotPath } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { doctorCommand, pageNodeStatus } from "../../scripts/commands/doctor.mjs";

// Staleness detection over the page-node snapshot time-series.
// Each test installs its own BROWSER_FLOW_PAGES_PATH override (same
// pattern as the page-node tests) so accumulated state does
// not bleed across cases.

/**
 * @param {() => Promise<void> | void} body
 */
async function withIsolatedPages(body) {
  const previous = process.env.BROWSER_FLOW_PAGES_PATH;
  const isolatedRoot = mkdtempSync(join(tmpdir(), "browser-flow-doctor-test-"));
  process.env.BROWSER_FLOW_PAGES_PATH = isolatedRoot;
  try {
    await body();
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSER_FLOW_PAGES_PATH;
    } else {
      process.env.BROWSER_FLOW_PAGES_PATH = previous;
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} pageKey
 * @param {Array<{ timestamp: number, html: string }>} snapshots
 */
function seedPageNode(pageKey, snapshots) {
  const paths = pagePaths(pageKey);
  mkdirSync(paths.pageDir, { recursive: true });
  writeJson(paths.metaPath, {
    schemaVersion: 1,
    pageKey,
    firstSeen: "2026-05-19T00:00:00.000Z",
    lastSeen: "2026-05-19T00:00:00.000Z",
    captureCount: snapshots.length,
    fixtures: ["synthetic"]
  });
  if (snapshots.length > 0) {
    mkdirSync(paths.snapshotsDir, { recursive: true });
    for (const { timestamp, html } of snapshots) {
      writeFileSync(pageSnapshotPath(pageKey, timestamp), gzipSync(html));
    }
  }
}

test("pageNodeStatus reports 'no-snapshots' when snapshot dir is missing or empty", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", []);
    const status = pageNodeStatus("synthetic/synthetic");
    assert.equal(status.status, "no-snapshots");
    assert.equal(status.snapshotCount, 0);
    assert.equal(status.firstHash, undefined);
  });
});

test("pageNodeStatus reports 'single-capture' with only one snapshot", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", [
      { timestamp: 1779200000000, html: "<html><body>v1</body></html>" }
    ]);
    const status = pageNodeStatus("synthetic/synthetic");
    assert.equal(status.status, "single-capture");
    assert.equal(status.snapshotCount, 1);
    assert.equal(typeof status.firstHash, "string");
    assert.ok(status.firstHash && status.firstHash.length === 64, "sha256 hex is 64 chars");
    assert.equal(status.latestHash, undefined);
  });
});

test("pageNodeStatus reports 'stable' when first and latest snapshots match", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", [
      { timestamp: 1779200000000, html: "<html><body>same</body></html>" },
      { timestamp: 1779200001000, html: "<html><body>same</body></html>" }
    ]);
    const status = pageNodeStatus("synthetic/synthetic");
    assert.equal(status.status, "stable");
    assert.equal(status.snapshotCount, 2);
    assert.equal(status.firstHash, status.latestHash);
  });
});

test("pageNodeStatus reports 'changed' when first and latest snapshots differ", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", [
      { timestamp: 1779200000000, html: "<html><body>v1</body></html>" },
      { timestamp: 1779200001000, html: "<html><body>v2</body></html>" }
    ]);
    const status = pageNodeStatus("synthetic/synthetic");
    assert.equal(status.status, "changed");
    assert.equal(status.snapshotCount, 2);
    assert.notEqual(status.firstHash, status.latestHash);
    assert.ok(status.firstSnapshot && status.latestSnapshot);
    assert.notEqual(status.firstSnapshot, status.latestSnapshot);
  });
});

test("doctorCommand surveys every page-node by default", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", [
      { timestamp: 1779200000000, html: "<html>stable-a</html>" },
      { timestamp: 1779200001000, html: "<html>stable-a</html>" }
    ]);
    seedPageNode("synthetic/synthetic/result", [
      { timestamp: 1779200000000, html: "<html>v1</html>" },
      { timestamp: 1779200001000, html: "<html>v2</html>" }
    ]);
    seedPageNode("submit/submit", []);

    const report = doctorCommand({});
    const statusByKey = new Map(report.pageNodes.map((p) => [p.pageKey, p]));
    assert.equal(statusByKey.size, 3, "doctor must surface all three seeded page-nodes");
    assert.equal(statusByKey.get("synthetic/synthetic")?.status, "stable");
    assert.equal(statusByKey.get("synthetic/synthetic/result")?.status, "changed");
    assert.equal(statusByKey.get("submit/submit")?.status, "no-snapshots");
  });
});

test("doctorCommand --page-key targets a single page-node", async () => {
  await withIsolatedPages(() => {
    seedPageNode("synthetic/synthetic", [
      { timestamp: 1779200000000, html: "<html>v1</html>" },
      { timestamp: 1779200001000, html: "<html>v2</html>" }
    ]);
    seedPageNode("synthetic/synthetic/result", [
      { timestamp: 1779200000000, html: "<html>stable-b</html>" },
      { timestamp: 1779200001000, html: "<html>stable-b</html>" }
    ]);

    const report = doctorCommand({ "page-key": "synthetic/synthetic" });
    assert.equal(report.pageNodes.length, 1);
    assert.equal(report.pageNodes[0].pageKey, "synthetic/synthetic");
    assert.equal(report.pageNodes[0].status, "changed");
  });
});
