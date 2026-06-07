import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Drift-hold e2e (deterministic, no LLM).
 *
 * A 2-segment workflow: segment 0 (create) succeeds; segment 1 targets an element
 * that does not exist (simulated drift). The runner must:
 *   - run segment 0 to completion (journal status "done"),
 *   - HOLD at segment 1 (journal "incomplete", heldAtSegment = 1),
 *   - NOT run anything past the held segment,
 *   - report success = false.
 * This proves "race until evidence breaks -> pit-in" + the write-ahead journal that
 * makes dangling-data recovery possible.
 */
test("verify-drift-hold: runner stops at the first failing segment; journal is recoverable", { timeout: 90000 }, async () => {
  const runId = `drift-hold-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;
    const createdUrl = `${baseUrl}/selfclean?created=1`;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: createdUrl,
      steps: [
        { action: "goto" },
        { action: "fill", selector: "[data-bf=\"item-name\"]", value: "drift-test-x" },
        { action: "click", selector: "[data-bf=\"item-create\"]", text: "Create", expectUrl: createdUrl },
        // Segment 1: a control that does not exist on the page -> resolution throws -> drift.
        { action: "click", selector: "[data-bf=\"does-not-exist\"]", text: "Nope" }
      ],
      segments: [
        { range: [0, 2], startPageKey: "selfclean", endPageKey: "selfclean", name: "create" },
        { range: [3, 3], startPageKey: "selfclean", endPageKey: "selfclean", name: "broken" }
      ],
      verification: {
        expectedNetwork: null,
        expectedEvidence: null,
        transitionTimeoutMs: 8000
      },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    const report = /** @type {any} */ (result.report);

    assert.equal(report.heldAtSegment, 1, `must hold at segment 1 — report: ${JSON.stringify(report)}`);
    assert.equal(report.success, false, "held run must not be a success");

    const journal = /** @type {Array<{segmentIndex:number,status:string,observedEndUrl?:string}>} */ (report.journal);
    assert.ok(Array.isArray(journal), "report must include the journal");
    const s0 = journal.find((e) => e.segmentIndex === 0);
    const s1 = journal.find((e) => e.segmentIndex === 1);
    assert.equal(s0 && s0.status, "done", `segment 0 must be journaled done — journal: ${JSON.stringify(journal)}`);
    assert.equal(s1 && s1.status, "incomplete", `segment 1 must be journaled incomplete — journal: ${JSON.stringify(journal)}`);
    assert.equal(journal.length, 2, "no segment beyond the held one may be journaled (not executed)");

    // affectedSegments surfaced on hold. Segment 1 (the held one) has no
    // data-dependent downstream here, so it affects only itself. (Cascade semantics
    // — downstream sharing a binding is included — are unit-proven in dependency-graph.)
    assert.deepEqual(/** @type {any} */ (report).affectedSegments, [1], `affectedSegments should be [1] — got ${JSON.stringify(report.affectedSegments)}`);

    // Segment 0's create action took effect (it ran to completion before the hold).
    assert.ok((report.executedSteps || []).includes("fill"), "segment 0 fill must have executed");
  } finally {
    await fixtureServer.close();
  }
});
