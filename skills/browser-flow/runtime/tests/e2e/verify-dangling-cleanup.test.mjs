import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { appendEntry, markStatus } from "../../scripts/lib/state-journal.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { runCleanupCommand } from "../../scripts/commands/cleanup.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Dangling-cleanup e2e (real capture-independent; deterministic).
 *
 * Simulate a held/aborted run that created an artifact but never tore it down:
 *   - the selfclean store has a dangling item "__bf_test__dangling",
 *   - the run's state journal records it as `created`,
 *   - the workflow carries a teardown recipe (fill name + click delete).
 * `bf cleanup` reads the journal, seeds the runner's cleanup-only path with the name,
 * and the teardown recipe deletes it -> store byte-clean.
 */
test("verify-dangling-cleanup: bf cleanup removes journal-recorded orphaned data via the teardown recipe", { timeout: 90000 }, async () => {
  const runId = `dangling-cleanup-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;
    const doneUrl = `${baseUrl}/selfclean/done`;

    // 1. Seed a dangling artifact directly into the store.
    await fetch(`${baseUrl}/api/selfclean/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ itemName: "__bf_test__dangling" }).toString(),
      redirect: "manual"
    });
    const before = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(before.items, ["__bf_test__dangling"], "dangling item must be seeded");

    // 2. A workflow carrying the teardown delete recipe (fill name + click delete).
    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: startUrl,
      steps: [{ action: "goto" }],
      verification: { expectedNetwork: null, expectedEvidence: null, transitionTimeoutMs: 15000 },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
      teardown: {
        strategy: "record",
        steps: [
          { action: "fill", selector: "[data-bf=\"item-name-delete\"]" },
          { action: "click", selector: "[data-bf=\"item-delete\"]", text: "Delete", expectUrl: doneUrl }
        ],
        dummyNaming: { prefix: "__bf_test__", hashLen: 8 }
      }
    });
    generateRunner(runId);

    // 3. Write the state journal recording the dangling creation (as a held run would).
    appendEntry(runPaths.journalPath, { segmentIndex: 0, intent: "create", status: "in-progress" });
    markStatus(runPaths.journalPath, 0, "done", { created: ["__bf_test__dangling"] });

    // 4. bf cleanup — reads journal -> collectDangling -> cleanup-only runner -> teardown delete.
    const result = await runCleanupCommand({ runId, headless: true });

    assert.deepEqual(result.dangling, ["__bf_test__dangling"], "cleanup must collect the dangling name from the journal");
    assert.ok(result.removed.includes("__bf_test__dangling"), `cleanup must remove the dangling item — got: ${JSON.stringify(result)}`);

    // 5. Store is byte-clean.
    const after = await fetch(`${baseUrl}/api/selfclean/list`).then((r) => r.json());
    assert.deepEqual(after.items, [], `store must be empty after cleanup — got: ${JSON.stringify(after.items)}`);
  } finally {
    await fixtureServer.close();
  }
});
