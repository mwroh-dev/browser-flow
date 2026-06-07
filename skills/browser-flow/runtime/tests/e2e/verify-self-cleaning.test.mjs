import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Self-cleaning e2e.
 *
 * Full lifecycle: forward creates a dummy item → teardown deletes it.
 * After verify, the fixture server store MUST be empty (byte-clean).
 *
 * Design:
 * - fixture: "manual" — runner uses startUrl directly (test's fixture server).
 *   Chrome makes real HTTP requests to the test's server; the store is shared.
 * - Form submissions with 303 redirect: Chrome follows redirect, providing
 *   navigation events the runner can wait for via expectUrl.
 * - safety.sandbox.available = false → verifyRun generates dummy binding for
 *   itemName → runner applies bindInputs at startup (both forward + teardown
 *   steps get the same __bf_test__<hash> value via valueRef substitution).
 * - After verify, query /api/selfclean/list on the test server → must be empty.
 */
test("verify-self-cleaning: create→run→teardown leaves store clean", { timeout: 90000 }, async () => {
  const runId = `selfclean-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // Start the shared fixture server. Chrome (in the runner subprocess) will
  // make real HTTP requests to this server, so the store mutations happen here.
  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;

    // Assert store is empty before the test.
    const beforeList = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(beforeList.items, [], "store must be empty before test");

    const doneUrl = `${baseUrl}/selfclean/done`;
    const createdUrl = `${baseUrl}/selfclean?created=1`;

    // Build a workflow with:
    //   - forward:
    //       goto → fill item-name (valueRef → {{input.itemName}}) → click Create
    //       expectUrl after click: the server redirects → /selfclean?created=1
    //       (a DISTINCT URL from the start /selfclean, so waitForExpectedUrl waits
    //       for the create navigation to settle before teardown fills the delete
    //       input — otherwise the create redirect reloads the page mid-teardown and
    //       wipes the fill, submitting an empty name that matches nothing).
    //   - teardown:
    //       fill item-name-delete (valueRef → same {{input.itemName}}) → click Delete
    //       expectUrl after click: the server redirects → /selfclean/done
    //       (a DISTINCT URL from /selfclean, so waitForExpectedUrl detects the
    //       navigation rather than the already-at-same-URL false positive).
    //   - inputs: [{name:"itemName", type:"text"}]
    //   - safety.sandbox.available = false → verifyRun generates dummy binding
    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: startUrl,
      steps: [
        { action: "goto" },
        {
          action: "fill",
          selector: "[data-bf=\"item-name\"]",
          fieldName: "itemName",
          valueRef: "{{input.itemName}}"
        },
        {
          action: "click",
          selector: "[data-bf=\"item-create\"]",
          text: "Create",
          expectUrl: createdUrl
        }
      ],
      verification: {
        expectedNetwork: null,
        expectedEvidence: null,
        transitionTimeoutMs: 15000
      },
      security: {
        localOnly: true,
        sanitizedArtifactsOnly: true,
        screenshotsPersisted: false
      },
      inputs: [
        { name: "itemName", label: "Item name", suggestedFrom: -1, type: "text" }
      ],
      teardown: {
        strategy: "record",
        steps: [
          {
            action: "fill",
            selector: "[data-bf=\"item-name-delete\"]",
            valueRef: "{{input.itemName}}"
          },
          {
            action: "click",
            selector: "[data-bf=\"item-delete\"]",
            text: "Delete",
            expectUrl: doneUrl
          }
        ],
        dummyNaming: { prefix: "__bf_test__", hashLen: 8 }
      },
      safety: {
        irreversibleStepIndexes: [],
        consentRequired: false,
        sandbox: { available: false, location: null }
      }
    });

    // Generate the runner (embeds workflow, will apply BROWSER_FLOW_DUMMY_BINDINGS at runtime).
    generateRunner(runId);

    // Run verifyRun — it will:
    //   1. Detect safety.sandbox.available=false + inputs → generate dummy binding for itemName.
    //   2. Spawn runner with BROWSER_FLOW_DUMMY_BINDINGS={"itemName":"__bf_test__<hash>"}.
    //   3. Runner applies bindInputs at startup → both fill steps get __bf_test__<hash>.
    //   4. Forward: Chrome fills __bf_test__<hash> in item-name, clicks Create.
    //      Form posts to /api/selfclean/create → store.push(name) → 303 → /selfclean?created=1.
    //      expectUrl on click step waits for /selfclean?created=1 to load.
    //   5. Teardown: Chrome fills __bf_test__<hash> in item-name-delete, clicks Delete.
    //      Form posts to /api/selfclean/delete → store.splice(name) → 303 → /selfclean/done.
    //      expectUrl on click step waits for /selfclean/done (distinct from /selfclean,
    //      avoiding the already-at-same-URL false positive).
    const result = await verifyRun(runId, { headless: true });

    // After verify, the store must be empty (teardown deleted the dummy item).
    const afterList = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(
      afterList.items,
      [],
      `store must be empty after verify — got: ${JSON.stringify(afterList.items)}`
    );

    // The teardown must have completed successfully.
    assert.equal(
      /** @type {any} */ (result.report).teardownComplete,
      true,
      "teardownComplete must be true"
    );

    // The teardown steps must all be ok.
    const teardownSteps = /** @type {Array<{action: string, ok: boolean, error?: string}> | undefined} */ (
      /** @type {any} */ (result.report).teardownSteps
    );
    assert.ok(Array.isArray(teardownSteps), "teardownSteps must be present in report");
    assert.ok(teardownSteps.length >= 2, `teardownSteps must have ≥2 entries, got ${teardownSteps.length}`);
    for (const step of teardownSteps) {
      assert.equal(
        step.ok,
        true,
        `teardown step "${step.action}" must be ok — error: ${step.error ?? "none"}`
      );
    }

    // The report must include dummyBindingNames so orphan sweep can find them.
    const dummyBindingNames = /** @type {string[] | undefined} */ (
      /** @type {any} */ (result.report).dummyBindingNames
    );
    assert.ok(
      Array.isArray(dummyBindingNames) && dummyBindingNames.includes("itemName"),
      "dummyBindingNames must include itemName"
    );
  } finally {
    await fixtureServer.close();
  }
});
