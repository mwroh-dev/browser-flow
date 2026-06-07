import test from "node:test";
import assert from "node:assert/strict";
import { createRunActionSeqTagger } from "../../scripts/observe/action-seq.mjs";

test("run actionSeq tagger assigns monotonic run-local ids and keeps action-diff correlated", () => {
  const tag = createRunActionSeqTagger();

  const firstClick = tag(
    { type: "click", actionId: "a1", actionSeq: 999001, documentId: "doc-1" },
    { targetId: "target-1", tabOrdinal: 0 }
  );
  const firstDiff = tag(
    { type: "action-diff", refType: "click", actionId: "a1", actionSeq: 999001, documentId: "doc-1" },
    { targetId: "target-1", tabOrdinal: 0 }
  );
  const secondDocClick = tag(
    { type: "click", actionId: "a1", actionSeq: 999001, documentId: "doc-2" },
    { targetId: "target-1", tabOrdinal: 0 }
  );
  const secondDocDiff = tag(
    { type: "action-diff", refType: "click", actionId: "a1", actionSeq: 999001, documentId: "doc-2" },
    { targetId: "target-1", tabOrdinal: 0 }
  );

  assert.equal(firstClick.actionSeq, 1);
  assert.equal(firstDiff.actionSeq, 1);
  assert.equal(secondDocClick.actionSeq, 2);
  assert.equal(secondDocDiff.actionSeq, 2);
});
