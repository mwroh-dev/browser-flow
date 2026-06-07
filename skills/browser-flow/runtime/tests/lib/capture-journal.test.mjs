import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendJournalEvent,
  readJournalEvents,
  toJournalEvent
} from "../../scripts/lib/capture-journal.mjs";

test("capture journal preserves rapid user actions as append-only facts", () => {
  const dir = mkdtempSync(join(tmpdir(), "bf-capture-journal-"));
  try {
    const journalPath = join(dir, "events", "journal.jsonl");
    appendJournalEvent(journalPath, toJournalEvent({
      source: "recorder",
      phase: "capture",
      event: {
        type: "click",
        actionId: "a1",
        actionSeq: 1001,
        documentId: "doc1",
        timestamp: 100,
        url: "https://weather.naver.com/map/09740660",
        tabOrdinal: 0,
        text: "영상",
        selector: "button",
        locator: { role: "button", name: "영상", structuralKey: "button|map_item_button|영상" }
      }
    }));
    appendJournalEvent(journalPath, toJournalEvent({
      source: "recorder",
      phase: "capture",
      event: {
        type: "click",
        actionId: "a2",
        actionSeq: 1002,
        documentId: "doc1",
        timestamp: 130,
        url: "https://weather.naver.com/map/09740660",
        tabOrdinal: 0,
        text: "강수예측",
        selector: "button",
        locator: { role: "button", name: "강수예측", structuralKey: "button|map_depth_button.type_maple|강수예측" }
      }
    }));

    const entries = readJournalEvents(journalPath);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.actionSeq), [1001, 1002]);
    assert.deepEqual(entries.map((entry) => entry.kind), ["user-action", "user-action"]);
    assert.ok(entries[0].recordedAt, "journal lines carry host-side recordedAt timestamps");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("capture journal redacts secret input values before writing", () => {
  const entry = /** @type {any} */ (toJournalEvent({
    source: "recorder",
    phase: "capture",
    event: {
      type: "input",
      actionId: "a3",
      actionSeq: 1003,
      documentId: "doc1",
      timestamp: 140,
      url: "https://example.com/login",
      fieldName: "password",
      secret: true,
      value: "do-not-write"
    }
  }));

  assert.equal(entry.kind, "user-action");
  assert.equal(entry.value, "<redacted-secret>");
  assert.equal(entry.fieldName, "<redacted-field>");
});

test("capture journal records hot action-window facts without enrichment blocking fields", () => {
  const entry = /** @type {any} */ (toJournalEvent({
    source: "recorder",
    phase: "capture",
    event: {
      type: "action-window",
      lane: "hot-journal",
      captureWindowId: "cw-doc1-1",
      actionSeq: 1001,
      documentId: "doc1",
      frameId: "frame-main",
      backendNodeId: 777,
      timestamp: 99,
      timestampMonotonic: 1234.5,
      url: "https://weather.naver.com/map/09740660",
      tabOrdinal: 0,
      pointer: { x: 1149, y: 198 },
      hitTarget: {
        role: "button",
        name: "영상 위성",
        selector: "button.map_item_button",
        box: { cx: 1149, cy: 198, w: 42, h: 46 }
      }
    }
  }));

  assert.equal(entry.kind, "action-window");
  assert.equal(entry.captureWindowId, "cw-doc1-1");
  assert.equal(entry.timestampMonotonic, 1234.5);
  assert.equal(entry.frameId, "frame-main");
  assert.equal(entry.backendNodeId, 777);
  assert.equal(entry.hitTarget.name, "영상 위성");
});

test("capture journal records async enrichment as a separate joinable lane", () => {
  const entry = /** @type {any} */ (toJournalEvent({
    source: "daemon",
    phase: "capture",
    event: {
      type: "action-enrichment",
      lane: "snapshot-enrichment",
      stage: "after",
      captureWindowId: "cw-doc1-1",
      actionSeq: 1001,
      documentId: "doc1",
      frameId: "frame-main",
      timestamp: 140,
      timestampMonotonic: 1275.2,
      url: "https://weather.naver.com/map/09740660",
      tabOrdinal: 0,
      affordances: [
        { role: "button", name: "강수예측", structuralKey: "button|map_depth_button.type_maple|강수예측" }
      ],
      screenshotCrop: {
        source: "action-window",
        box: { cx: 1149, cy: 245, w: 120, h: 160 }
      },
      providerHints: [
        { pattern: "layered-control-surface", controlGroup: "visual-layer", confidence: "high" }
      ],
      mutationBatch: [
        { kind: "child-list", target: "weather-map-controls", added: 1, removed: 0 }
      ]
    }
  }));

  assert.equal(entry.kind, "enrichment");
  assert.equal(entry.stage, "after");
  assert.equal(entry.captureWindowId, "cw-doc1-1");
  assert.equal(entry.affordances[0].name, "강수예측");
  assert.equal(entry.screenshotCrop.box.w, 120);
  assert.equal(entry.providerHints[0].pattern, "layered-control-surface");
  assert.equal(entry.mutationBatch[0].kind, "child-list");
});
