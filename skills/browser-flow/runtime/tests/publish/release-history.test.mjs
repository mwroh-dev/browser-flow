import { test } from "node:test";
import assert from "node:assert/strict";

import { applyReleaseNote, updateReadmeLatest, validateReleaseNote } from "../../scripts/publish/release-history.mjs";

const baseHistory = [
  "# Browser Flow History",
  "",
  "<!-- browser-flow-history:start -->",
  "No work-item releases yet.",
  "<!-- browser-flow-history:end -->",
  ""
].join("\n");

const baseReadme = [
  "# Browser Flow",
  "",
  "<!-- browser-flow-latest:start -->",
  "No release sync yet.",
  "<!-- browser-flow-latest:end -->",
  ""
].join("\n");

const metadata = {
  updateDate: "2026-06-02T00:00:00.000Z",
  sourceBranch: "main",
  sourceSha: "abc1234",
  bundleFileCount: 42
};

function note(/** @type {Record<string, unknown>} */ overrides = {}) {
  return /** @type {any} */ ({
    workItemId: "release-sync-history",
    title: "Release sync history",
    status: "resolved",
    userRequest: "Publish only the public browser-flow surface.",
    whyItMattered: "The source repo contains private history and local artifacts.",
    modelConclusion: "Release sync needs an explicit work-item ledger.",
    changesMade: "Added HISTORY and README release metadata updates.",
    expectedResolution: "Public commits stay traceable without exposing source-only data.",
    validation: "Unit test",
    publicationNotes: "No screenshots or raw events are published.",
    ...overrides
  });
}

test("validateReleaseNote requires explicit work item identity", () => {
  assert.throws(
    () => validateReleaseNote({ ...note(), workItemId: undefined }),
    /requires workItemId or continuationOf/
  );
  assert.throws(
    () => validateReleaseNote({ ...note(), continuationOf: "existing-work" }),
    /either workItemId or continuationOf/
  );
});

test("new work item is prepended with required sections and README latest metadata", () => {
  const result = applyReleaseNote({
    historyMarkdown: baseHistory,
    readmeMarkdown: baseReadme,
    note: note(),
    metadata
  });

  assert.match(result.historyMarkdown, /## Work Item: release-sync-history - Release sync history/);
  for (const heading of [
    "### User Request",
    "### Why It Mattered",
    "### Model Conclusion",
    "### Changes Made",
    "### Expected Resolution",
    "### Validation",
    "### Publication Notes"
  ]) {
    assert.match(result.historyMarkdown, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(result.readmeMarkdown, /Source branch: `main`/);
  assert.match(result.readmeMarkdown, /Source SHA: `abc1234`/);
  assert.match(result.readmeMarkdown, /`release-sync-history`: Release sync history \(resolved\)/);
});

test("README latest metadata can be refreshed without work items", () => {
  const result = applyReleaseNote({
    historyMarkdown: baseHistory,
    readmeMarkdown: baseReadme,
    note: note(),
    metadata
  });
  const refreshed = updateReadmeLatest(result.readmeMarkdown, [], {
    ...metadata,
    updateDate: "2026-06-03T00:00:00.000Z",
    sourceSha: "def5678"
  });

  assert.match(refreshed, /Source SHA: `def5678`/);
  assert.match(refreshed, /Updated: 2026-06-03T00:00:00\.000Z/);
  assert.match(refreshed, /Updated work items:\n- none/);
});

test("continuation appends an update to an existing work item", () => {
  const first = applyReleaseNote({
    historyMarkdown: baseHistory,
    readmeMarkdown: baseReadme,
    note: note(),
    metadata
  });
  const second = applyReleaseNote({
    historyMarkdown: first.historyMarkdown,
    readmeMarkdown: first.readmeMarkdown,
    note: note({
      workItemId: undefined,
      continuationOf: "release-sync-history",
      title: "Release sync history follow-up",
      changesMade: "Tightened release audit behavior."
    }),
    metadata: { ...metadata, updateDate: "2026-06-03T00:00:00.000Z", sourceSha: "def5678" }
  });

  assert.equal((second.historyMarkdown.match(/## Work Item: release-sync-history/g) || []).length, 1);
  assert.match(second.historyMarkdown, /#### 2026-06-03T00:00:00\.000Z - def5678/);
  assert.match(second.historyMarkdown, /Tightened release audit behavior/);
});

test("continuation fails when the target id is absent and title similarity is ignored", () => {
  assert.throws(
    () => applyReleaseNote({
      historyMarkdown: baseHistory,
      readmeMarkdown: baseReadme,
      note: note({
        workItemId: undefined,
        continuationOf: "missing-work-item",
        title: "Release sync history"
      }),
      metadata
    }),
    /continuation target not found/
  );
});
