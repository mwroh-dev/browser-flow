import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

/**
 * Breadth-search read-only enrichment e2e (real Chrome).
 *
 * The docs flow touches only browser-filter + detail-link on the catalog page,
 * but the catalog also has `<a href="/docs/detail/browser-flow">Open with legacy
 * route</a>` which the flow NEVER clicks. With read-only skeleton capture, the
 * daemon enumerates the FULL page affordances on navigation, so the catalog
 * page-node's mold.json must contain affordances that are NOT in any touched
 * step — proving the mold is the full page skeleton, not just touched locators.
 * Also asserts the richer skeleton stays security-scan-safe (securityOk true).
 */

/** Recursively collect every mold.json under the pages root. @param {string} root */
function collectMolds(root) {
  /** @type {Array<{role?:string,name?:string,structuralKey?:string}>} */
  const skeleton = [];
  /** @param {string} dir */
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (name === "mold.json") {
        try {
          const mold = /** @type {any} */ (readJson(p));
          if (mold && Array.isArray(mold.skeleton)) skeleton.push(...mold.skeleton);
        } catch { /* ignore unreadable */ }
      }
    }
  }
  walk(root);
  return skeleton;
}

test("verify-breadth-enrichment: page-node mold.json holds full-page affordances (incl. untouched), scan-safe", { timeout: 120000 }, async () => {
  const runId = `breadth-e2e-${Date.now()}`;

  const prepared = runCli(["prepare", "--run-id", runId, "--fixture", "docs", "--headless"]);
  await driveObservedWorkflow({ debugPort: prepared.debugPort, workflow: "docs" });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);

  // Touched structuralKeys = the locators the captured steps actually used.
  const workflow = /** @type {any} */ (readJson(getRunPaths(runId).workflowJsonPath));
  const touchedKeys = new Set(
    (workflow.steps || [])
      .map((/** @type {any} */ s) => s && s.locator && s.locator.structuralKey)
      .filter(Boolean)
  );

  // The pages root is redirected to a temp dir by tests/_setup.mjs.
  const pagesRoot = process.env.BROWSER_FLOW_PAGES_PATH;
  assert.ok(pagesRoot, "BROWSER_FLOW_PAGES_PATH must be set by the test setup");
  const moldSkeleton = collectMolds(pagesRoot);

  // 1. Molds were written and are non-trivial (daemon captured affordances).
  assert.ok(moldSkeleton.length > 0, "expected at least one captured affordance in some mold.json");

  // 2. The mold contains affordances NOT in any touched step — i.e. it is the
  //    FULL page skeleton, not just the touched-step derivation.
  const nonTouched = moldSkeleton.filter((e) => e.structuralKey && !touchedKeys.has(e.structuralKey));
  assert.ok(
    nonTouched.length > 0,
    `mold must include affordances beyond touched steps — touched=${JSON.stringify([...touchedKeys])}, moldKeys=${JSON.stringify(moldSkeleton.map((e) => e.structuralKey))}`
  );

  // 3. Specifically, the never-clicked "Open with legacy route" link is enumerated.
  const hasLegacy = moldSkeleton.some((e) => (e.name || "").includes("legacy"));
  assert.ok(hasLegacy, `the untouched 'Open with legacy route' link must be in some mold — got names ${JSON.stringify(moldSkeleton.map((e) => e.name))}`);

  // 4. Richer skeleton stays scan-safe: a full verify keeps securityOk true.
  runCli(["generate", "--run-id", runId]);
  const result = /** @type {any} */ (runCli(["verify", "--run-id", runId, "--headless"]));
  const report = /** @type {any} */ (readJson(getRunPaths(runId).verificationPath));
  assert.equal(report.securityOk, true, `securityOk must stay true with the richer mold — report securityOk=${report.securityOk}`);
  assert.equal(result.ok, true, "docs verify loop must pass end-to-end");
});
