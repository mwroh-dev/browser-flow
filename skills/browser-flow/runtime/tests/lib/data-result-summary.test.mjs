import test from "node:test";
import assert from "node:assert/strict";
import { buildDataResultArtifact, formatDataResultSummary } from "../../scripts/lib/data-result-summary.mjs";

test("buildDataResultArtifact records extracted rows as the user-facing data result", () => {
  const artifact = buildDataResultArtifact({
    runId: "run-1",
    dataMode: "extract",
    verification: { replayOutcome: "passed", success: true, pathComplete: true },
    extractResult: {
      status: "data",
      stepIndex: 4,
      pageKey: "manual/news.example/section",
      cardinality: 2,
      rows: [{ title: "A" }, { title: "B" }]
    }
  });
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.replayOutcome, "passed");
  assert.equal(artifact.dataOutcome, "data");
  assert.equal(artifact.rowCount, 2);
  assert.deepEqual(artifact.previewRows, [{ title: "A" }, { title: "B" }]);
  assert.match(artifact.summary.headline, /2 rows/);
});

test("buildDataResultArtifact keeps replay success separate from extraction drift", () => {
  const artifact = buildDataResultArtifact({
    runId: "run-2",
    dataMode: "mixed",
    verification: { replayOutcome: "passed", success: true, pathComplete: true },
    extractResult: {
      status: "drift",
      stepIndex: 4,
      pageKey: "manual/news.example/section",
      cardinality: 0,
      rows: [],
      reason: "container missing"
    }
  });
  assert.equal(artifact.replayOutcome, "passed");
  assert.equal(artifact.dataOutcome, "drift");
  assert.match(formatDataResultSummary(artifact), /Replay passed; data extraction drifted/);
});
