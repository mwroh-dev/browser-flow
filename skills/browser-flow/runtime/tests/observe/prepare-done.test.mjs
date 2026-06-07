import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { readRawEventLog } from "../../scripts/lib/raw-event-log.mjs";
import { readJournalEvents } from "../../scripts/lib/capture-journal.mjs";
import { writeCaptureNoisePreview } from "../../scripts/commands/done.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

test("done capture noise preview reports trimmable trailing detours", () => {
  const runId = `observe-noise-preview-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    fixture: "manual",
    runId,
    startUrl: "https://news.example/section/101"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://news.example/section/101", timestamp: 1 },
    { type: "click", selector: "a.headline", text: "Top headline", locator: { name: "Top headline", href: "/article/1" }, timestamp: 2 },
    { type: "navigate", url: "https://news.example/article/1", timestamp: 3 },
    { type: "navigate", url: "https://news.example/section/101", timestamp: 4 }
  ]);

  const preview = /** @type {{ status: string, suggestions: Array<{ kind: string, actionText: string }>, artifact?: string }} */ (
    writeCaptureNoisePreview(runPaths)
  );
  const persisted = /** @type {{ status?: string }} */ (readJson(`${runPaths.analysisDir}/capture-noise-preview.json`));

  assert.equal(preview.status, "auto_trim_available");
  assert.equal(preview.suggestions[0].kind, "backtracked-trailing-action");
  assert.equal(preview.suggestions[0].actionText, "Top headline");
  assert.equal(preview.artifact, "analysis/capture-noise-preview.json");
  assert.equal(persisted.status, "auto_trim_available");
});

test("prepare and done capture a sanitized synthetic workflow", async () => {
  const runId = `observe-synth-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);

  assert.equal(prepared.status, "ready");
  assert.equal(typeof prepared.debugPort, "number");

  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });

  const done = runCli(["done", "--run-id", runId]);
  const runPaths = getRunPaths(runId);
  const events = /** @type {Array<{ type: string, value?: string }>} */ (readJson(runPaths.sanitizedEventsPath));
  const manifest = /** @type {{ profileMode?: string }} */ (readJson(runPaths.manifestPath));

  assert.equal(done.ok, true);
  assert.equal(existsSync(runPaths.sanitizedEventsPath), true);
  assert.equal(existsSync(runPaths.captureJournalPath), true);
  assert.equal(existsSync(runPaths.networkSummaryPath), true);
  assert.equal(existsSync(runPaths.pageEvidencePath), true);
  assert.equal(manifest.profileMode, "ephemeral-temp");
  assert.equal(events.some((event) => event.type === "input"), true);
  assert.equal(events.some((event) => event.type === "click"), true);
  assert.equal(events.some((event) => event.type === "navigate"), true);
  assert.equal(readJournalEvents(runPaths.captureJournalPath).some((event) => event.kind === "user-action"), true);
  assert.equal(readFileSync(runPaths.sanitizedEventsPath, "utf8").includes("authorization"), false);
  assert.equal(readFileSync(runPaths.selectorsPath, "utf8").includes("storage"), false);
  assert.equal(readFileSync(runPaths.pageEvidencePath, "utf8").includes(".png"), false);
});

test("done --capture-screenshot final persists an opt-in capture final screenshot artifact", async () => {
  const runId = `observe-capture-final-screenshot-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);

  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });

  const done = runCli(["done", "--run-id", runId, "--capture-screenshot", "final"]);
  const runPaths = getRunPaths(runId);
  const manifest = /** @type {{ entries?: Array<Record<string, any>> }} */ (readJson(runPaths.screenshotsManifestPath));
  const captureEntry = manifest.entries?.find((entry) => entry.kind === "capture-final");

  assert.equal(done.captureScreenshot?.mode, "final");
  assert.ok(captureEntry, "capture-final entry must be present");
  assert.equal(captureEntry.source, "capture");
  assert.equal(captureEntry.verified, false);
  assert.equal(typeof captureEntry.targetUrl, "string");
  assert.equal(typeof captureEntry.tabOrdinal, "number");
  assert.equal(existsSync(`${runPaths.screenshotsDir}/capture-final.png`), true);
});

test("done capture noise preview reports needs_review for rapid interrupted toggle prefixes", () => {
  const runId = `observe-noise-review-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    fixture: "synthetic",
    runId,
    startUrl: "http://127.0.0.1:59999/reveal/noise"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/reveal/noise", timestamp: 1 },
    { type: "click", actionId: "a1", selector: "a", text: "Expand menu", href: "/#closed", locator: { structuralKey: "header>nav>a|role=button||menu-toggle" }, timestamp: 2 },
    { type: "action-diff", refType: "click", actionId: "a1", settleStatus: "interrupted", beforeSkeleton: [], afterSkeleton: [], timestamp: 3 },
    { type: "click", actionId: "a2", selector: "a", text: "Collapse menu", href: "/#open", locator: { structuralKey: "header>nav>a|role=button||menu-toggle" }, timestamp: 4 },
    { type: "action-diff", refType: "click", actionId: "a2", settleStatus: "interrupted", beforeSkeleton: [], afterSkeleton: [], timestamp: 5 },
    { type: "click", actionId: "a3", selector: "a", text: "Expand menu", href: "/#closed", locator: { structuralKey: "header>nav>a|role=button||menu-toggle" }, timestamp: 6 },
    { type: "action-diff", refType: "click", actionId: "a3", settleStatus: "settled", beforeSkeleton: [], afterSkeleton: [{ role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" }], timestamp: 7 },
    { type: "click", actionId: "a4", selector: "a", text: "Weather", href: "/reveal/weather", locator: { structuralKey: "nav>ul>li>a|||Weather" }, timestamp: 8 },
    { type: "navigate", url: "http://127.0.0.1:59999/reveal/weather", timestamp: 9 }
  ]);

  const preview = /** @type {{ status: string, suggestions: Array<Record<string, any>>, artifact?: string }} */ (
    writeCaptureNoisePreview(runPaths)
  );
  const persisted = /** @type {{ status?: string, suggestions?: Array<Record<string, any>> }} */ (readJson(runPaths.captureNoisePreviewPath));

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-prefix-toggle");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.equal(preview.artifact, "analysis/capture-noise-preview.json");
  assert.equal(persisted.status, "needs_review");
  assert.equal(persisted.suggestions?.[0]?.candidateId, "cn1");
});

test("--snapshot-dom captures sanitized DOM snapshots per navigation", async () => {
  const runId = `observe-phase35-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless",
    "--snapshot-dom"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });
  runCli(["done", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  assert.equal(existsSync(runPaths.snapshotsDir), true, "snapshots dir must exist when --snapshot-dom is set");
  const snapshotFiles = readdirSync(runPaths.snapshotsDir).filter((name) => name.endsWith(".html.gz"));
  assert.ok(snapshotFiles.length >= 1, `expected at least 1 .html.gz snapshot, got ${snapshotFiles.length}`);

  // Decompress the first snapshot and assert structural expectations:
  // - Non-empty
  // - Contains the synthetic fixture's data-bf markers (selector context preserved)
  // - <script> contents stripped (safe-mode policy)
  // - <input value="..."> redacted to <redacted-input-value>
  snapshotFiles.sort();
  const firstSnapshotPath = `${runPaths.snapshotsDir}/${snapshotFiles[0]}`;
  const decompressed = gunzipSync(readFileSync(firstSnapshotPath)).toString("utf8");
  assert.ok(decompressed.length > 0, "decompressed snapshot must be non-empty");
  assert.ok(decompressed.includes("data-bf"), "snapshot should preserve [data-bf] selectors for page-node design");
  // Safe-mode: <script>...</script> must have empty body. Synthetic page
  // ships an inline <script> handler; assert the body is stripped.
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i;
  const scriptMatch = scriptRegex.exec(decompressed);
  if (scriptMatch) {
    assert.equal(scriptMatch[1].trim(), "", "safe-mode policy must strip <script> body");
  }

  // Observer must persist a snapshots manifest so the
  // analyzer can lift each snapshot into knowledge/pages/<key>/snapshots/.
  assert.equal(existsSync(runPaths.snapshotsManifestPath), true, "snapshots-manifest.json must exist when --snapshot-dom is set");
  const manifest = /** @type {{ schemaVersion: number, entries: Array<{ index: number, url: string, timestamp: number, filename: string }> }} */ (readJson(runPaths.snapshotsManifestPath));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.entries) && manifest.entries.length >= 1, "manifest must list at least one snapshot entry");
  for (const entry of manifest.entries) {
    assert.equal(typeof entry.index, "number");
    assert.equal(typeof entry.url, "string");
    assert.equal(typeof entry.timestamp, "number");
    assert.equal(typeof entry.filename, "string");
    assert.ok(entry.filename.endsWith(".html.gz"));
  }
});

test("--snapshot-dom is opt-in — default capture produces no snapshots directory", async () => {
  const runId = `observe-phase35-default-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });
  runCli(["done", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  // Without --snapshot-dom, the daemon must not create the snapshots
  // directory (zero-cost default; opt-in only).
  assert.equal(existsSync(runPaths.snapshotsDir), false, "snapshots dir must NOT exist when --snapshot-dom is absent");
});

test("click and input events carry ancestor chain and sibling fingerprint", async () => {
  const runId = `observe-phase34-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });
  runCli(["done", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  const events = /** @type {Array<{
    type: string,
    selector?: string,
    ancestors?: Array<{ tag?: string, id?: string, role?: string, ariaLabel?: string, dataBf?: string, dataTestid?: string }>,
    siblings?: { totalMatchingSelector?: number, totalMatchingRole?: number }
  }>} */ (readJson(runPaths.sanitizedEventsPath));

  const click = events.find((event) => event.type === "click");
  const input = events.find((event) => event.type === "input");
  assert.ok(click, "expected at least one click event");
  assert.ok(input, "expected at least one input event");

  // ancestors: structural array (top → element), bounded depth, no class field.
  for (const event of [click, input]) {
    assert.ok(Array.isArray(event.ancestors), `event.ancestors must be array (type=${event.type})`);
    assert.ok(event.ancestors.length >= 1, `event.ancestors must have at least 1 entry (type=${event.type})`);
    assert.ok(event.ancestors.length <= 5, `event.ancestors must cap at 5 entries (type=${event.type})`);
    for (const entry of event.ancestors) {
      assert.equal(typeof entry.tag, "string", "ancestor.tag must be string");
      assert.equal(typeof entry.id, "string", "ancestor.id must be string");
      assert.equal(typeof entry.role, "string", "ancestor.role must be string");
      assert.equal(typeof entry.ariaLabel, "string", "ancestor.ariaLabel must be string");
      assert.equal(typeof entry.dataBf, "string", "ancestor.dataBf must be string");
      assert.equal(typeof entry.dataTestid, "string", "ancestor.dataTestid must be string");
      assert.ok(!("class" in entry), "ancestor entry must NOT include class (classes are volatile)");
      assert.ok(!("className" in entry), "ancestor entry must NOT include className");
    }
  }

  // siblings: ambiguity fingerprint. Synthetic fixture's data-bf keys are unique → both counts === 1.
  for (const event of [click, input]) {
    assert.ok(event.siblings, `event.siblings must be present (type=${event.type})`);
    assert.equal(typeof event.siblings.totalMatchingSelector, "number");
    assert.equal(typeof event.siblings.totalMatchingRole, "number");
    assert.equal(
      event.siblings.totalMatchingSelector,
      1,
      `synthetic fixture's data-bf selector should match exactly 1 element (type=${event.type})`
    );
  }
});

test("prepare and done capture the final transition before persistence", async () => {
  const runId = `observe-stateful-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "stateful",
    "--headless"
  ]);

  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "stateful"
  });

  runCli(["done", "--run-id", runId]);
  const runPaths = getRunPaths(runId);
  const network = /** @type {Array<{ url?: string, status?: number }>} */ (readJson(runPaths.networkSummaryPath));

  assert.equal(network.some((entry) => entry.url?.includes("/api/stateful") && entry.status === 200), true);
});

test("observer streams raw events to raw-events.jsonl during capture", async () => {
  const runId = `observe-phase55-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);

  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });

  const runPaths = getRunPaths(runId);
  // The streaming write must happen *during* capture, not just at
  // done-time. Verify the file exists and has at least one event
  // before /done is invoked.
  assert.equal(existsSync(runPaths.rawEventsPath), true, "raw-events.jsonl must exist before /done");
  const preDoneLog = readRawEventLog(runPaths);
  assert.ok(preDoneLog.length >= 1, "raw event log must have at least one entry before /done");

  runCli(["done", "--run-id", runId]);

  // After done, the file remains and contains both recorder events
  // (click/input/navigate) and network events. Persistence is the
  // load-bearing property: even if done's sanitize had fail-closed,
  // this file would survive.
  const log = readRawEventLog(runPaths);
  assert.ok(log.length >= preDoneLog.length, "raw event log must only grow, never shrink");
  assert.equal(log.some((event) => event.type === "click"), true, "raw log must contain at least one click");
  assert.equal(log.some((event) => event.type === "input"), true, "raw log must contain at least one input");
  assert.equal(log.some((event) => typeof event.type === "string" && event.type.startsWith("network")), true, "raw log must contain at least one network entry (CDP shape: network.request|response|loadingFinished)");
});
