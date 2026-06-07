import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Adversarial validation of the multi-tab fail-safe inference:
 * "a mis-routed tab (e.g. an ad/popup that is NOT the intended one) must FAIL SAFE
 * (drift-hold) — never a wrong action."
 *
 * The flow opens the AD tab (which has only a DECOY 'Advertisement' button, no 'Confirm'),
 * but the next step's locator targets a 'Confirm' button on tab 1. The runner switches to
 * the (ad) tab and tries to resolve 'Confirm' — which is absent. The action-path guard /
 * confidence gate must REFUSE: the run drift-holds and the confirm click never executes
 * (the decoy is never clicked). This is the deterministic stand-in for real-site ad popups
 * (which are non-deterministic by nature; the literature's full-determinism path would
 * require capturing all external inputs, which we deliberately do not — so fail-safe is the
 * only sound response). See docs/research-applied.md §4.
 */
test("verify-multitab-failsafe: a mis-routed (ad) tab drift-holds; the decoy is never clicked", { timeout: 120000 }, async () => {
  const server = await startFixtureServer();
  try {
    const runId = `multitab-failsafe-${Date.now()}`;
    ensureRunDirs(runId);
    writeJson(getRunPaths(runId).workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual",
      startUrl: `${server.baseUrl}/multitab`, finalUrl: `${server.baseUrl}/multitab/ad`, tabCount: 2,
      steps: [
        { action: "goto", tabOrdinal: 0 },
        // tab0 click OPENS the ad tab (not the intended popup).
        // name "Open ad" is unique on the page (vs "Open popup") + decisive href -> resolves HIGH.
        // (No structuralKey: a guessed/stale one would tank the mass gate and drift-hold here,
        // which is NOT what this test exercises — we want the OPEN to succeed, the CONFIRM to fail-safe.)
        { action: "click", selector: "[data-bf=\"open-ad\"]", text: "Open ad", tabOrdinal: 0,
          locator: { role: "link", name: "Open ad", href: "/multitab/ad" } },
        // tab1 step targets a 'Confirm' button — which exists only on the popup, NOT the ad tab.
        { action: "click", selector: "[data-bf=\"confirm\"]", text: "Confirm", tabOrdinal: 1,
          locator: { role: "button", name: "Confirm", structuralKey: "body>main>button|type=button||Confirm" } }
      ],
      segments: [
        { range: [0, 1], startPageKey: "multitab", endPageKey: "multitab", name: "open-ad" },
        { range: [2, 2], startPageKey: "multitab/ad", endPageKey: "multitab/ad", name: "confirm-in-tab" }
      ],
      verification: { expectedNetwork: null, expectedEvidence: null, transitionTimeoutMs: 8000 },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });
    generateRunner(runId);

    const r = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);

    // Fail-safe: the run must NOT complete, must drift-hold, and the confirm step must NOT
    // have executed (the decoy 'Advertisement' button was never clicked).
    assert.notEqual(r.pathComplete, true, `mis-routed tab must NOT complete — ${JSON.stringify(r)}`);
    assert.ok(typeof r.heldAtSegment === "number", `must drift-hold (fail-safe) — ${JSON.stringify(r)}`);
    const clicks = (r.executedSteps || []).filter((/** @type {string} */ s) => s === "click");
    assert.equal(clicks.length, 1, `only the tab0 open-ad click may execute; the confirm must be refused (no wrong click) — executed=${JSON.stringify(r.executedSteps)}`);
  } finally {
    await server.close();
  }
});
