import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Idempotent orphan-recovery e2e.
 *
 * Simulates a PRIOR crashed teardown that left an orphan dummy in the store.
 * On the next verify, the runner's orphan sweep must enumerate live items by
 * the dummy prefix and delete the leftover — so the store ends byte-clean even
 * though the recorded teardown only knows about the item IT created this run.
 *
 * Sequence:
 *   pre-seed: store = ["__bf_test__dead"]   (a prior crash's orphan)
 *   forward:  create __bf_test__<new>       → store = [dead, <new>]
 *   teardown: delete __bf_test__<new>       → store = [dead]
 *   sweep:    AX-enumerate prefix → [dead]  → delete → store = []
 */
test("verify-orphan-recovery: pre-existing orphan + freshly-created dummy both swept clean", { timeout: 90000 }, async () => {
  const runId = `orphan-recovery-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;
    const doneUrl = `${baseUrl}/selfclean/done`;
    const createdUrl = `${baseUrl}/selfclean?created=1`;

    // PRE-SEED a prior-crash orphan directly via the create API (form-urlencoded).
    await fetch(`${baseUrl}/api/selfclean/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ itemName: "__bf_test__dead" }).toString(),
      redirect: "manual"
    });
    const seeded = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(seeded.items, ["__bf_test__dead"], "orphan must be pre-seeded");

    // Same self-cleaning workflow as verify-self-cleaning.test.mjs.
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

    generateRunner(runId);

    const result = await verifyRun(runId, { headless: true });

    // The store must be empty: the recorded teardown removed the freshly-created
    // dummy, and the orphan sweep removed the pre-seeded "__bf_test__dead".
    const afterList = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(
      afterList.items,
      [],
      `store must be empty after verify — got: ${JSON.stringify(afterList.items)}`
    );

    // The orphan sweep must have run and removed the pre-seeded orphan.
    const orphanSweep = /** @type {{ available: boolean, found: string[], removed: string[], errors: Array<{name:string,error:string}> } | undefined} */ (
      /** @type {any} */ (result.report).orphanSweep
    );
    assert.ok(orphanSweep, "report must include orphanSweep");
    assert.equal(orphanSweep.available, true, "orphanSweep.available must be true (listable AX surface present)");
    assert.ok(
      orphanSweep.removed.includes("__bf_test__dead"),
      `orphanSweep.removed must include the pre-seeded orphan — got: ${JSON.stringify(orphanSweep)}`
    );
  } finally {
    await fixtureServer.close();
  }
});
