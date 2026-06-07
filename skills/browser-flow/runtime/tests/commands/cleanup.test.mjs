import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { appendEntry } from "../../scripts/lib/state-journal.mjs";
import { readJournal } from "../../scripts/lib/state-journal.mjs";
import { collectDangling } from "../../scripts/lib/dangling.mjs";
import { runCleanupCommand } from "../../scripts/commands/cleanup.mjs";

test("collectDangling returns empty array for empty journal", () => {
  const result = collectDangling([]);
  assert.deepEqual(result, []);
});

test("collectDangling collects names from journal created[] entries", () => {
  const journal = [
    { segmentIndex: 0, status: "in-progress", created: ["artifact-alpha", "artifact-beta"] },
    { segmentIndex: 1, status: "failed", created: ["artifact-gamma"] },
    { segmentIndex: 2, status: "done", created: ["artifact-alpha"] } // duplicate — deduped
  ];
  const result = collectDangling(journal);
  assert.deepEqual(result, ["artifact-alpha", "artifact-beta", "artifact-gamma"]);
});

test("collectDangling ignores entries without created field", () => {
  const journal = [
    { segmentIndex: 0, status: "done" },
    { segmentIndex: 1, status: "failed", created: ["orphan-1"] }
  ];
  const result = collectDangling(journal);
  assert.deepEqual(result, ["orphan-1"]);
});

test("readJournal + collectDangling round-trip via journal file", () => {
  const runId = `cleanup-test-journal-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  appendEntry(runPaths.journalPath, {
    segmentIndex: 0,
    status: "in-progress",
    intent: "create note",
    created: ["note-fixture-abc123"]
  });
  appendEntry(runPaths.journalPath, {
    segmentIndex: 0,
    status: "failed",
    error: "drift detected"
  });

  const journal = readJournal(runPaths.journalPath);
  const dangling = collectDangling(journal);
  assert.deepEqual(dangling, ["note-fixture-abc123"]);
});

test("runCleanupCommand returns empty result when journal is empty (no spawn)", async () => {
  const runId = `cleanup-test-empty-${Date.now()}`;
  ensureRunDirs(runId);
  // journalPath does not exist — readJournal returns [], collectDangling returns []
  const result = await runCleanupCommand({ runId });
  assert.equal(result.runId, runId);
  assert.deepEqual(result.dangling, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, []);
});

test("runCleanupCommand reports runner-missing cleanup errors without spawning", async () => {
  const runId = `cleanup-test-dangling-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  appendEntry(runPaths.journalPath, {
    segmentIndex: 0,
    status: "in-progress",
    created: ["note-to-clean-1", "note-to-clean-2"]
  });

  const result = await runCleanupCommand({ runId });
  assert.equal(result.runId, runId);
  assert.deepEqual(result.dangling, ["note-to-clean-1", "note-to-clean-2"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, [
    { name: "note-to-clean-1", error: "generated runner missing; cleanup cannot execute" },
    { name: "note-to-clean-2", error: "generated runner missing; cleanup cannot execute" }
  ]);
});
