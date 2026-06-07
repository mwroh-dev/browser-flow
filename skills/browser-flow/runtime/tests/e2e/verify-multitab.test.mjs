import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Builds the happy-path multitab workflow.
 * Step 0: goto tabOrdinal 0 (main tab)
 * Step 1: click "Open popup" on tabOrdinal 0 (opens target=_blank → new tab)
 * Step 2: click "Confirm" on tabOrdinal 1 (runner waits for the new tab, follows it)
 * Evidence "[data-bf-evidence=done]"="Confirmed" is only reachable in the popup tab.
 *
 * @param {string} runId
 * @param {string} baseUrl
 * @returns {any}
 */
function buildHappyPathWorkflow(runId, baseUrl) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: `${baseUrl}/multitab`,
    finalUrl: `${baseUrl}/multitab/popup`,
    tabCount: 2,
    steps: [
      { action: "goto", tabOrdinal: 0 },
      {
        action: "click",
        selector: "[data-bf=\"open-popup\"]",
        text: "Open popup",
        tabOrdinal: 0,
        locator: {
          role: "link",
          name: "Open popup",
          structuralKey: "body>main|a|||Open popup",
          href: "/multitab/popup"
        }
      },
      {
        action: "click",
        selector: "[data-bf=\"confirm\"]",
        text: "Confirm",
        tabOrdinal: 1,
        locator: {
          role: "button",
          name: "Confirm",
          structuralKey: "body>main|button|type=button||Confirm"
        }
      }
    ],
    segments: [
      {
        range: [0, 1],
        startPageKey: "multitab",
        endPageKey: "multitab",
        name: "open-tab"
      },
      {
        range: [2, 2],
        startPageKey: "multitab/popup",
        endPageKey: "multitab/popup",
        name: "confirm-in-tab"
      }
    ],
    verification: {
      expectedNetwork: null,
      expectedEvidence: {
        selector: "[data-bf-evidence=\"done\"]",
        textIncludes: "Confirmed"
      },
      transitionTimeoutMs: 8000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

/**
 * Builds a fail-safe workflow where tabOrdinal 1 is required but no new tab ever opens.
 * Step 0: goto tabOrdinal 0 (no click that opens a new tab)
 * Step 1: click "Confirm" on tabOrdinal 1 → waitForNewTarget times out → drift-hold.
 * Uses a short transitionTimeoutMs to keep the test fast.
 *
 * @param {string} runId
 * @param {string} baseUrl
 * @returns {any}
 */
function buildFailSafeWorkflow(runId, baseUrl) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: `${baseUrl}/multitab`,
    finalUrl: `${baseUrl}/multitab`,
    tabCount: 1,
    steps: [
      { action: "goto", tabOrdinal: 0 },
      {
        action: "click",
        selector: "[data-bf=\"confirm\"]",
        text: "Confirm",
        tabOrdinal: 1,
        locator: {
          role: "button",
          name: "Confirm",
          structuralKey: "body>main|button|type=button||Confirm"
        }
      }
    ],
    segments: [
      {
        range: [0, 1],
        startPageKey: "multitab",
        endPageKey: "multitab/popup",
        name: "expect-tab-never-opens"
      }
    ],
    verification: {
      expectedNetwork: null,
      expectedEvidence: null,
      // Short timeout so the test completes quickly (default would wait 30s).
      transitionTimeoutMs: 2000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

test(
  "verify-multitab: replay follows a new tab and continues there",
  { timeout: 120000 },
  async () => {
    const server = await startFixtureServer();
    try {
      const runId = `multitab-${Date.now()}`;
      ensureRunDirs(runId);
      writeJson(getRunPaths(runId).workflowJsonPath, buildHappyPathWorkflow(runId, server.baseUrl));
      generateRunner(runId);
      const r = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
      assert.equal(r.pathComplete, true, `must complete across tabs — ${JSON.stringify(r)}`);
      assert.ok(
        (r.executedSteps || []).filter((/** @type {string} */ s) => s === "click").length >= 2,
        "both clicks (open + confirm-in-new-tab) executed"
      );
    } finally {
      await server.close();
    }
  }
);

test(
  "verify-multitab: missing new tab drift-holds (fail-safe)",
  { timeout: 120000 },
  async () => {
    const server = await startFixtureServer();
    try {
      const runId = `multitab-fail-${Date.now()}`;
      ensureRunDirs(runId);
      // No click opens a new tab — tabOrdinal 1 is never created
      // → waitForNewTarget times out (transitionTimeoutMs=2000) → drift-hold.
      writeJson(getRunPaths(runId).workflowJsonPath, buildFailSafeWorkflow(runId, server.baseUrl));
      generateRunner(runId);
      const r = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
      assert.ok(
        typeof r.heldAtSegment === "number",
        `must drift-hold when the tab never appears — ${JSON.stringify(r)}`
      );
    } finally {
      await server.close();
    }
  }
);
