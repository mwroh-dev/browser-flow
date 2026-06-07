import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEntry, markStatus, readJournal } from "../../scripts/lib/state-journal.mjs";

function tmpJournal() { return join(mkdtempSync(join(tmpdir(), "bf-journal-")), "state-journal.jsonl"); }

test("readJournal on a missing file returns []", () => {
  assert.deepEqual(readJournal(join(tmpdir(), "does-not-exist-" + Date.now() + ".jsonl")), []);
});

test("write-ahead: an appended in-progress entry survives without markStatus (crash sim)", () => {
  const p = tmpJournal();
  appendEntry(p, { segmentIndex: 0, intent: "create note", status: "in-progress" });
  const j = readJournal(p);
  assert.equal(j.length, 1);
  assert.equal(j[0].segmentIndex, 0);
  assert.equal(j[0].status, "in-progress");
  assert.equal(j[0].intent, "create note");
});

test("markStatus folds to the latest status per segment + carries created/observedEndUrl", () => {
  const p = tmpJournal();
  appendEntry(p, { segmentIndex: 0, intent: "s0", status: "in-progress" });
  markStatus(p, 0, "done", { created: ["__bf_test__x"], observedEndUrl: "/done" });
  appendEntry(p, { segmentIndex: 1, intent: "s1", status: "in-progress" });
  const j = readJournal(p);
  assert.equal(j.length, 2);
  const s0 = j.find((e) => e.segmentIndex === 0);
  assert.equal(s0.status, "done");
  assert.deepEqual(s0.created, ["__bf_test__x"]);
  assert.equal(s0.observedEndUrl, "/done");
  assert.equal(j.find((e) => e.segmentIndex === 1).status, "in-progress");
});

test("readJournal clears stale error details when a later status marks the segment done", () => {
  const p = tmpJournal();
  appendEntry(p, { segmentIndex: 0, intent: "s0", status: "in-progress" });
  markStatus(p, 0, "incomplete", { error: "ambiguous locator" });
  markStatus(p, 0, "done", { observedEndUrl: "/done" });

  const j = readJournal(p);
  assert.equal(j.length, 1);
  assert.equal(j[0].status, "done");
  assert.equal(j[0].observedEndUrl, "/done");
  assert.equal(j[0].error, undefined);
});
