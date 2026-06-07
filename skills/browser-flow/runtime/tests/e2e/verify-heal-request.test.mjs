import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Heal-request e2e (real Chrome; deterministic — drift is forced).
 *
 * A 2-segment workflow: segment 0 (create) succeeds; segment 1 first resolves
 * a real locator-bearing field, then targets a phantom element (a locator whose
 * role/name/structuralKey + selector match nothing on the live page) -> resolution
 * fails -> drift-hold at segment 1. Before returning the
 * held report, the runner must:
 *   - capture the LIVE affordance skeleton of the current page,
 *   - diff it against the stored mold (here: the held segment's own step locators),
 *   - write `heal-request.json` { heldSegment, intent, heldStepLocator, diff, liveSkeleton }.
 * This is the deterministic input the heal sub-agent reasons over. No LLM.
 */
test("verify-heal-request: drift-hold emits an agent-blind heal-request with a non-empty diff", { timeout: 90000 }, async () => {
  const runId = `heal-request-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;
    const createdUrl = `${baseUrl}/selfclean?created=1`;
    const phantomKey = "div.phantom>button|button|data-bf=phantom-save|phantom-cls|Phantom Save";
    const phantomShape = "div.phantom>button|button|data-bf=phantom-save|phantom-cls|";
    const realFieldKey = "body>main>form>label|input|name=itemName||Delete item";

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: createdUrl,
      steps: [
        { action: "goto" },
        { action: "fill", selector: "[data-bf=\"item-name\"]", value: "heal-test-x" },
        { action: "click", selector: "[data-bf=\"item-create\"]", text: "Create", expectUrl: createdUrl },
        // Segment 1: first a real locator-bearing field, then a phantom control.
        // The heal target must be the failed phantom step, not the first locator
        // in the held segment.
        {
          action: "fill",
          selector: "[data-bf=\"item-name-delete\"]",
          value: "not-created",
          locator: { role: "textbox", name: "Delete item", structuralKey: realFieldKey }
        },
        {
          action: "click",
          selector: "[data-bf=\"phantom-does-not-exist\"]",
          text: "Phantom Save",
          locator: {
            role: "button",
            name: "Phantom Save",
            structuralKey: phantomKey,
            identityKey: `${phantomShape}option`,
            identityShape: phantomShape,
            controlKind: "option",
            textParts: ["Phantom Save"]
          }
        }
      ],
      segments: [
        { range: [0, 2], startPageKey: "selfclean", endPageKey: "selfclean", name: "create" },
        { range: [3, 4], startPageKey: "selfclean", endPageKey: "selfclean", name: "phantom-save" }
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

    // The runner must have emitted the heal-request artifact.
    const healPath = getRunPaths(runId).healRequestPath;
    assert.ok(existsSync(healPath), `heal-request.json must exist at ${healPath}`);
    const heal = /** @type {any} */ (readJson(healPath));

    assert.equal(heal.heldSegment, 1, `heal-request.heldSegment must be 1 — got ${JSON.stringify(heal)}`);
    assert.equal(heal.heldStepIndex, 4, `heal-request.heldStepIndex must be the failed phantom step — got ${JSON.stringify(heal)}`);
    assert.ok(heal.heldStepLocator, "heal-request must carry the held step locator");
    assert.equal(heal.heldStepLocator.structuralKey, phantomKey, "heldStepLocator must be the phantom locator");
    assert.equal(heal.heldStepLocator.identityShape, phantomShape, "heldStepLocator must preserve replay identity shape");
    assert.equal(heal.heldStepLocator.controlKind, "option", "heldStepLocator must preserve control kind");
    assert.deepEqual(heal.heldStepLocator.textParts, ["Phantom Save"], "heldStepLocator must preserve text parts");
    assert.ok(heal.locatorDiagnostics, "heal-request must carry locator diagnostics when resolve fails");
    assert.equal(typeof heal.locatorDiagnostics.totalCandidates, "number", "locator diagnostics must include candidate counts");

    // Live skeleton: the selfclean page has real affordances (name input + create button).
    assert.ok(Array.isArray(heal.liveSkeleton) && heal.liveSkeleton.length > 0, `liveSkeleton must be non-empty — got ${JSON.stringify(heal.liveSkeleton)}`);

    // Diff: the phantom (stored) is absent from the live page -> "disappeared";
    // the real live affordances are not in the stored skeleton -> "appeared".
    assert.ok(heal.diff, "heal-request must carry a diff");
    const disappearedKeys = (heal.diff.disappeared || []).map((/** @type {any} */ x) => x.structuralKey);
    assert.ok(disappearedKeys.includes(phantomKey), `phantom locator must be in diff.disappeared — got ${JSON.stringify(heal.diff)}`);
    assert.ok((heal.diff.appeared || []).length > 0, "live affordances must appear in diff.appeared");

    // agent-blind: the artifact carries only role/name/structuralKey-shaped data.
    // The fill value ("heal-test-x") must not leak into the heal-request.
    assert.ok(!JSON.stringify(heal).includes("heal-test-x"), "heal-request must not contain any filled value (agent-blind)");
  } finally {
    await fixtureServer.close();
  }
});
