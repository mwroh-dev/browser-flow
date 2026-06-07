import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { judgeNovelty } from "../../scripts/lib/atomic-fp-novelty.mjs";

/**
 * Stand up an isolated knowledge/pages tree under tmpdir and point
 * `BROWSER_FLOW_PAGES_PATH` at it (existing override pattern).
 * Returns helper to populate a page-node + cleanup.
 */
function setupIsolatedPagesRoot() {
  const root = mkdtempSync(join(tmpdir(), "bf-novelty-"));
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
      delete process.env.BROWSER_FLOW_PAGES_PATH;
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("judgeNovelty flags new pageKey as new path", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/never-seen.com" },
        { action: "click", selector: "button", pageKey: "manual/never-seen.com" }
      ]
    };
    const report = judgeNovelty(workflow);
    assert.equal(report.isNewPath, true);
    assert.deepEqual(report.newPageKeys, ["manual/never-seen.com"]);
    assert.equal(report.newAtomicFps.length, 1);
    assert.equal(report.newAtomicFps[0].selector, "button");
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty flags new selector within existing page-node", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    fixture.writePageNode("manual/known.com", ["[data-bf=\"foo\"]", "button[aria-label=\"search\"]"]);
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/known.com" },
        { action: "click", selector: "button[aria-label=\"delete\"]", pageKey: "manual/known.com" }
      ]
    };
    const report = judgeNovelty(workflow);
    assert.equal(report.isNewPath, true);
    assert.deepEqual(report.newPageKeys, []);
    assert.equal(report.newAtomicFps.length, 1);
    assert.equal(report.newAtomicFps[0].selector, "button[aria-label=\"delete\"]");
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty returns isNewPath=false when all atomic fps + page-nodes are known", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    fixture.writePageNode("manual/known.com", ["button[aria-label=\"search\"]", "#input"]);
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/known.com" },
        { action: "click", selector: "button[aria-label=\"search\"]", pageKey: "manual/known.com" },
        { action: "fill", selector: "#input", pageKey: "manual/known.com" }
      ]
    };
    const report = judgeNovelty(workflow);
    assert.equal(report.isNewPath, false);
    assert.deepEqual(report.newPageKeys, []);
    assert.deepEqual(report.newAtomicFps, []);
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty ignores goto steps for selector matching but still counts pageKey", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    // pageKey is new but it's only a goto step (no selectors expected)
    const workflow = {
      steps: [{ action: "goto", pageKey: "manual/brand-new.com" }]
    };
    const report = judgeNovelty(workflow);
    assert.equal(report.isNewPath, true);
    assert.deepEqual(report.newPageKeys, ["manual/brand-new.com"]);
    // goto-only flow: no atomic fp selectors recorded
    assert.deepEqual(report.newAtomicFps, []);
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty handles workflow without steps", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    assert.deepEqual(judgeNovelty({}), { isNewPath: false, newAtomicFps: [], newPageKeys: [] });
    assert.deepEqual(judgeNovelty({ steps: [] }), { isNewPath: false, newAtomicFps: [], newPageKeys: [] });
  } finally {
    fixture.cleanup();
  }
});

test("judgeNovelty deduplicates new pageKey reports", () => {
  const fixture = setupIsolatedPagesRoot();
  try {
    const workflow = {
      steps: [
        { action: "goto", pageKey: "manual/new.com" },
        { action: "click", selector: "button", pageKey: "manual/new.com" },
        { action: "click", selector: "a", pageKey: "manual/new.com" }
      ]
    };
    const report = judgeNovelty(workflow);
    // single new pageKey even though it appears in 3 steps
    assert.deepEqual(report.newPageKeys, ["manual/new.com"]);
    // both selectors flagged (page-node didn't exist, so any selector is new)
    assert.equal(report.newAtomicFps.length, 2);
  } finally {
    fixture.cleanup();
  }
});
