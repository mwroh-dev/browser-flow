import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Phase trace emission for trajectory-level evaluation.
 *
 * Per `evaluation-as-behavioral-specification` (AgentProcessBench
 * arXiv:2603.14465, Process Reward Models arXiv:2502.10325) and
 * OpenAI Trace Grading (platform.openai.com/docs/guides/trace-grading):
 * step-level trajectory eval requires a structured event log emitted
 * by the runtime, separate from the artifact contents. The trace is
 * what makes the difference between outcome-based grading ("the final
 * report is green") and process-based grading ("the phases ran in the
 * correct order, no phase errored, no phase was skipped").
 *
 * One JSONL line per phase event. Append-only — this is episodic
 * evidence per `artifact-vs-knowledge`; it lives under
 * `artifacts/runs/<run-id>/trace.jsonl` (gitignored).
 *
 * @typedef {{
 *   runId: string,
 *   tracePath: string,
 *   runRoot: string
 * }} RunPaths
 *
 * @typedef {"prepare" | "done" | "analyze" | "generate" | "verify"} TracePhase
 * @typedef {"started" | "completed" | "error"} TraceEvent
 */

/**
 * @param {RunPaths} runPaths
 * @param {TracePhase} phase
 * @param {TraceEvent} event
 * @param {Record<string, unknown>} [extra]
 */
export function emitTraceEvent(runPaths, phase, event, extra = {}) {
  mkdirSync(dirname(runPaths.tracePath), { recursive: true });
  const record = {
    runId: runPaths.runId,
    phase,
    event,
    timestamp: new Date().toISOString(),
    ...extra
  };
  appendFileSync(runPaths.tracePath, `${JSON.stringify(record)}\n`);
}

/**
 * Wraps a command function with started / completed / error trace
 * emission. Preserves sync-ness: if `fn` returns a non-Promise value
 * the wrapper returns synchronously; if `fn` returns a Promise the
 * wrapper returns a Promise. Re-throws on failure after emitting the
 * error event.
 *
 * @template T
 * @param {RunPaths} runPaths
 * @param {TracePhase} phase
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>}
 */
export function withTrace(runPaths, phase, fn) {
  emitTraceEvent(runPaths, phase, "started");
  let result;
  try {
    result = fn();
  } catch (error) {
    emitTraceEvent(runPaths, phase, "error", {
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  if (result && typeof (/** @type {Promise<unknown>} */ (result).then) === "function") {
    return /** @type {Promise<T>} */ (result).then(
      (value) => {
        emitTraceEvent(runPaths, phase, "completed");
        return value;
      },
      (error) => {
        emitTraceEvent(runPaths, phase, "error", {
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    );
  }
  emitTraceEvent(runPaths, phase, "completed");
  return result;
}
