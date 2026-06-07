import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { writeJson } from "../../scripts/lib/fs.mjs";
import {
  snapshotKnowledgePageNodes,
  judgeNovelty
} from "../../scripts/lib/atomic-fp-novelty.mjs";

function setupIsolatedPagesRoot() {
  const root = mkdtempSync(join(tmpdir(), "bf-snapshot-"));
  const originalOverride = process.env.BROWSER_FLOW_PAGES_PATH;
  process.env.BROWSER_FLOW_PAGES_PATH = root;
  return {
    root,
    /** @param {string} pageKey @param {string[]} selectors */
    writePageNode(pageKey, selectors = []) {
      const pageDir = resolve(root, pageKey);
      mkdirSync(pageDir, { recursive: true });
      writeJson(resolve(pageDir, "selectors.json"), {
        schemaVersion: 1,
        pageKey,
        selectors: selectors.map((selector) => ({ selector, captureCount: 1 }))
      });
    },
    cleanup() {
      if (originalOverride === undefined) {
        delete process.env.BROWSER_FLOW_PAGES_PATH;
      } else {
        process.env.BROWSER_FLOW_PAGES_PATH = originalOverride;
      }
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("snapshotKnowledgePageNodes returns empty map when pages root missing", () => {
  const fixture = setupIsolatedPagesRoot();
  rmSync(fixture.root, { recursive: true, force: true });
  try {
    const snapshot = snapshotKnowledgePageNodes();
    assert.equal(snapshot.size, 0);
  } finally {
    fixture.cleanup();
  }
});

test("snapshotKnowledgePageNodes captures nested pageKeys + selector sets", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    fixture.writePageNode("manual/example.com", ["button[aria-label=\"search\"]"]);
    fixture.writePageNode("manual/example.com/notebook/:id", [
      "button[aria-label=\"more\"]",
      "[data-bf=\"item\"]"
    ]);
    const snapshot = snapshotKnowledgePageNodes();
    assert.equal(snapshot.size, 2);
    assert.equal(snapshot.has("manual/example.com"), true);
    assert.equal(snapshot.has("manual/example.com/notebook/:id"), true);
    const innerSelectors = snapshot.get("manual/example.com/notebook/:id");
    assert.ok(innerSelectors !== undefined, "expected selector set for nested pageKey");
    assert.equal(innerSelectors.has("button[aria-label=\"more\"]"), true);
    assert.equal(innerSelectors.has("[data-bf=\"item\"]"), true);
    assert.equal(innerSelectors.has("never-seen"), false);
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty with snapshot returns isNewPath=true when filesystem has the page-node but snapshot does not", () => {
  // analyze must snapshot
  // BEFORE compileRun writes new page-nodes, otherwise judgeNovelty
  // against the filesystem returns isNewPath=false (the just-written
  // page-node is visible).
  const fixture = setupIsolatedPagesRoot();
  try {
    // Simulate compile having written a page-node AFTER snapshot was taken
    const emptySnapshot = snapshotKnowledgePageNodes();
    fixture.writePageNode("manual/new.com", ["button"]);
    // Now filesystem has the page-node, but snapshot does not
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/new.com" },
        { action: "click", selector: "button", pageKey: "manual/new.com" }
      ]
    };
    // Default (filesystem-based) → not novel (page-node now exists)
    assert.equal(judgeNovelty(workflow).isNewPath, false);
    // Snapshot-based → novel (snapshot was taken before write)
    const noveltyFromSnapshot = judgeNovelty(workflow, emptySnapshot);
    assert.equal(noveltyFromSnapshot.isNewPath, true);
    assert.deepEqual(noveltyFromSnapshot.newPageKeys, ["manual/new.com"]);
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty with snapshot recognizes known selectors from snapshot map", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    fixture.writePageNode("manual/known.com", ["button[aria-label=\"go\"]"]);
    const snapshot = snapshotKnowledgePageNodes();
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/known.com" },
        { action: "click", selector: "button[aria-label=\"go\"]", pageKey: "manual/known.com" }
      ]
    };
    const novelty = judgeNovelty(workflow, snapshot);
    assert.equal(novelty.isNewPath, false);
    assert.deepEqual(novelty.newPageKeys, []);
    assert.deepEqual(novelty.newAtomicFps, []);
  } finally {
    fixture.cleanup();
  }
});
