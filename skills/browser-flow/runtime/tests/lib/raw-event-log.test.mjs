import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRawEvent, readRawEventLog } from "../../scripts/lib/raw-event-log.mjs";

function makeRunPaths() {
  const runRoot = mkdtempSync(join(tmpdir(), "browser-flow-raw-log-"));
  return {
    runId: "test-run",
    rawEventsPath: join(runRoot, "raw-events.jsonl")
  };
}

test("appendRawEvent writes one JSON line per call (jsonl append-only)", () => {
  const runPaths = makeRunPaths();

  appendRawEvent(runPaths, { type: "click", selector: "[data-bf=\"submit\"]" });
  appendRawEvent(runPaths, { type: "input", selector: "[data-bf=\"name\"]", value: "alice" });

  const lines = readFileSync(runPaths.rawEventsPath, "utf8").split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { type: "click", selector: "[data-bf=\"submit\"]" });
  assert.deepEqual(JSON.parse(lines[1]), { type: "input", selector: "[data-bf=\"name\"]", value: "alice" });
});

test("readRawEventLog round-trips appended events in order", () => {
  const runPaths = makeRunPaths();
  const inputs = [
    { type: "navigate", url: "http://127.0.0.1:9999/" },
    { type: "click", selector: "[data-bf=\"a\"]" },
    { type: "network", url: "http://127.0.0.1:9999/api", method: "POST", status: 200 }
  ];

  for (const event of inputs) {
    appendRawEvent(runPaths, event);
  }

  const log = readRawEventLog(runPaths);
  assert.deepEqual(log, inputs);
});

test("readRawEventLog returns empty array when the file does not exist", () => {
  const runRoot = mkdtempSync(join(tmpdir(), "browser-flow-raw-log-missing-"));
  const runPaths = { runId: "missing", rawEventsPath: join(runRoot, "raw-events.jsonl") };
  assert.equal(existsSync(runPaths.rawEventsPath), false);
  assert.deepEqual(readRawEventLog(runPaths), []);
});

test("appendRawEvent survives partial writes — each line is independently parseable", () => {
  // if the daemon process crashes mid-capture, every
  // line already on disk must be a complete JSON document. The append
  // pattern guarantees this because each append is a single syscall
  // containing one full record + trailing newline.
  const runPaths = makeRunPaths();
  for (let i = 0; i < 10; i += 1) {
    appendRawEvent(runPaths, { type: "click", timestamp: i });
  }

  const raw = readFileSync(runPaths.rawEventsPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 10);
  for (const line of lines) {
    // Each line independently parseable — no need to read the whole
    // file to recover state up to the crash point.
    const parsed = JSON.parse(line);
    assert.equal(parsed.type, "click");
    assert.equal(typeof parsed.timestamp, "number");
  }
});
