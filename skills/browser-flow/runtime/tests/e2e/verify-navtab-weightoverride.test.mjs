import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Builds a workflow for the navtab fixture. With withOverride=false the locator
 * uses DEFAULT_WEIGHTS: name(1.5,sim1) + structuralKey(1.5,sim0) → mass 0.5 < 0.55 → drift-hold.
 * With withOverride=true: weightOverrides {href:1.5, structuralKey:0.5} → name(1.5,sim1) +
 * href(1.5,sim1) in mass → mass 1.0 ≥ 0.55 → HIGH → click talk link → completes.
 *
 * @param {string} runId
 * @param {string} baseUrl
 * @param {boolean} withOverride
 * @returns {any}
 */
function buildWorkflow(runId, baseUrl, withOverride) {
  /** @type {any} */
  const locator = {
    role: "link", name: "Section",
    structuralKey: "nav>STALE-WRAPPER|a|||Section",
    href: "/navtab/talk", relXPath: "//nav/a[2]"
  };
  if (withOverride) {
    locator.disambiguation = {
      weightOverrides: { href: 1.5, structuralKey: 0.5 },
      patternId: "nav-tab"
    };
  }
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: `${baseUrl}/navtab`,
    finalUrl: `${baseUrl}/navtab/talk`,
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "nav a",
        text: "Section",
        href: "/navtab/talk",
        expectUrl: `${baseUrl}/navtab/talk`,
        locator
      }
    ],
    segments: [
      {
        range: [0, 1],
        startPageKey: "navtab",
        endPageKey: "navtab/talk",
        name: "open-talk"
      }
    ],
    verification: {
      expectedNetwork: null,
      expectedEvidence: null,
      expectedFinalUrl: "/navtab/talk",
      transitionTimeoutMs: 8000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

test(
  "verify-navtab: default weights drift-hold (mass<0.55); nav-tab weightOverride completes",
  { timeout: 120000 },
  async () => {
    const server = await startFixtureServer();
    try {
      // (a) WITHOUT override -> drift-hold at segment 0 (NO wrong click).
      const idA = `navtab-default-${Date.now()}`;
      ensureRunDirs(idA);
      writeJson(getRunPaths(idA).workflowJsonPath, buildWorkflow(idA, server.baseUrl, false));
      generateRunner(idA);
      const held = /** @type {any} */ ((await verifyRun(idA, { headless: true })).report);
      assert.equal(
        held.heldAtSegment,
        0,
        `default must drift-hold at segment 0 — report: ${JSON.stringify(held)}`
      );

      // (b) WITH nav-tab override -> HIGH -> completes to /navtab/talk.
      const idB = `navtab-override-${Date.now()}`;
      ensureRunDirs(idB);
      writeJson(getRunPaths(idB).workflowJsonPath, buildWorkflow(idB, server.baseUrl, true));
      generateRunner(idB);
      const ok = /** @type {any} */ ((await verifyRun(idB, { headless: true })).report);
      assert.equal(
        ok.pathComplete,
        true,
        `override must complete the path — report: ${JSON.stringify(ok)}`
      );
      assert.ok(
        (ok.executedSteps || []).includes("click"),
        `the nav-tab click must execute — ${JSON.stringify(ok.executedSteps)}`
      );
    } finally {
      await server.close();
    }
  }
);
