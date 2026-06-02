import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { readRawEventLog } from "../lib/raw-event-log.mjs";
import { persistSanitizedArtifacts } from "../sanitize/persist.mjs";
import { withTrace } from "../lib/trace.mjs";

/**
 * bf replay — re-executes sanitize/persist on a previously captured run
 * without re-driving the browser. Input: `raw-events.jsonl` (streaming) +
 * `raw-page-evidence.json`. Output: sanitized-events.json + network-summary.json
 * + selectors.json + page-evidence.json + security.json — same shape as the
 * live `done` produces.
 *
 * After one GUI capture, all subsequent sanitize/scan/analyzer changes can be
 * validated by `bf replay` without re-asking the user to perform the GUI flow
 * again (capture/analyze separation).
 *
 * Architectural boundary preserved: persistSanitizedArtifacts is the single
 * sanitize/scan implementation. Replay reuses it byte-for-byte so the live
 * and replayed paths cannot drift.
 *
 * @param {Record<string, string | boolean>} options
 */
export function replayCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("replay requires --run-id.");
  }
  const runPaths = getRunPaths(runId);

  if (!existsSync(runPaths.rawEventsPath)) {
    throw new Error(
      `Run ${runId} has no raw-events.jsonl. Replay requires a raw-event log capture (raw-event log persistence).`
    );
  }
  if (!existsSync(runPaths.manifestPath)) {
    throw new Error(
      `Run ${runId} has no manifest.json. The original capture must have reached at least manifest write before replay is possible.`
    );
  }

  return withTrace(runPaths, "done", () => {
    const manifest = /** @type {Record<string, unknown>} */ (readJson(runPaths.manifestPath));
    const log = readRawEventLog(runPaths);
    /** @type {import("../sanitize/event-sanitizer.mjs").RawEvent[]} */
    const rawEvents = [];
    /** @type {import("../sanitize/event-sanitizer.mjs").RawEvent[]} */
    const networkEvents = [];
    for (const event of log) {
      // Partition every CDP network subtype (network.request / .response /
      // .loadingFinished, and any future network.*) into networkEvents.
      // `startsWith` is intentional — a new subtype follows its siblings.
      if (event.type.startsWith("network")) {
        networkEvents.push(event);
      } else {
        rawEvents.push(event);
      }
    }
    const pageEvidence = existsSync(runPaths.rawPageEvidencePath)
      ? /** @type {import("../sanitize/event-sanitizer.mjs").RawEvent[]} */ (readJson(runPaths.rawPageEvidencePath))
      : [];

    const result = persistSanitizedArtifacts({
      runPaths,
      manifest: {
        ...manifest,
        status: "replayed",
        replayedAt: new Date().toISOString()
      },
      rawEvents,
      pageEvidence,
      networkEvents
    });

    if (existsSync(runPaths.controlPath)) {
      const control = /** @type {Record<string, unknown>} */ (readJson(runPaths.controlPath));
      writeJson(runPaths.controlPath, { ...control, status: "replayed" });
    }

    return {
      ok: result.security.ok,
      runId,
      rawEventCount: rawEvents.length,
      networkEventCount: networkEvents.length,
      pageEvidenceCount: pageEvidence.length,
      security: result.security
    };
  });
}
