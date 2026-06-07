import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * SPA capture/replay e2e (deterministic regression gate).
 *
 * Proves the recorder/runner enhancements on a modern-SPA shape that the
 * semantic-HTML selfclean fixture does NOT exercise:
 *   - the Title is a contenteditable <div role="textbox" aria-label="Title">
 *     (no <input>) → must be filled via atomic-fp (role+name) + DOM.focus +
 *     Input.insertText, not via a CSS selector + .value;
 *   - "Create" is a role-less <div role="button"> (no <button>/<a> tag) →
 *     must be clicked via atomic-fp role+name resolution.
 *
 * If both replay paths work, the typed value reaches the server store.
 */
test("verify-contenteditable: role-resolved contenteditable fill + role-less div click replay", { timeout: 90000 }, async () => {
  const runId = `spa-ce-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/spa`;
    const doneUrl = `${baseUrl}/spa/done`;

    const before = await fetch(`${baseUrl}/api/spa/list`).then((r) => r.json());
    assert.deepEqual(before.items, [], "spa store must be empty before test");

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: doneUrl,
      steps: [
        { action: "goto" },
        {
          action: "fill",
          selector: "[data-bf=\"spa-title\"]",
          // No fieldName: the runner's fill signature check would compare against
          // the element's id ("spa-title"); we rely purely on atomic-fp role+name.
          contentEditable: true,
          value: "spa-ce-value",
          atomicFp: { strategy: "role", role: "textbox", name: "Title" }
        },
        {
          action: "click",
          selector: "[data-bf=\"spa-create\"]",
          text: "Create",
          expectUrl: doneUrl,
          atomicFp: { strategy: "role", role: "button", name: "Create" }
        }
      ],
      verification: {
        expectedFinalUrl: doneUrl,
        expectedNetwork: null,
        expectedEvidence: { selector: "[data-bf-evidence=\"spa-done\"]", textIncludes: "Created" },
        transitionTimeoutMs: 15000
      },
      security: {
        localOnly: true,
        sanitizedArtifactsOnly: true,
        screenshotsPersisted: false
      }
    });

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });

    // Dispositive: the typed contenteditable value reached the server, which can
    // only happen if (a) insertText filled the contenteditable AND (b) the
    // role-less div click fired its handler and navigated.
    const after = await fetch(`${baseUrl}/api/spa/list`).then((r) => r.json());
    assert.deepEqual(
      after.items,
      ["spa-ce-value"],
      `spa store must contain the typed value — got: ${JSON.stringify(after.items)}`
    );

    assert.equal(
      /** @type {any} */ (result.report).success,
      true,
      `verify must succeed — report: ${JSON.stringify(result.report)}`
    );
  } finally {
    await fixtureServer.close();
  }
});
