import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getStringOption } from "../lib/args.mjs";
import { getVerifySpecPaths } from "../lib/config.mjs";
import { loadMergedQuestions, writeVerifySpec } from "../lib/verify-spec.mjs";
import { detectGaps } from "../lib/spec-agent.mjs";
import { createReadlineAsk } from "../lib/variable-agent-interaction.mjs";

/**
 * Run the spec questionnaire: load merged questions, detect gaps against
 * the raw request, ask only the missing questions, and write verify-spec.json.
 *
 * Raw-answered questions (detected from the request text) store the raw
 * request string as their answer value. LLM refinement (offline spec-agent
 * sub-skill) extracts the bare value later.
 *
 * @param {{ runId: string, request?: string, ask?: (prompt: string) => Promise<string> }} input
 * @returns {Promise<{ runId: string, verifySpecPath: string, asked: string[], detected: string[] }>}
 */
export async function runSpecCommand(input) {
  const runId = input.runId;
  const request = input.request ?? "";
  const { basePath, overridePath, perRunPath } = getVerifySpecPaths(runId);
  const questions = loadMergedQuestions(basePath, overridePath);
  const { answered, missing } = detectGaps(questions, request, {});

  /** @type {Record<string, unknown>} */
  const answers = {};
  // Raw-answered: store the raw request string (LLM sub-skill refines later).
  for (const id of answered) answers[id] = request;

  const asker = input.ask ? { ask: input.ask, close() {} } : createReadlineAsk();
  try {
    for (const id of missing) {
      const q = questions.find((x) => x.id === id);
      answers[id] = await asker.ask(`${q?.prompt ?? id}\n> `);
    }
  } finally {
    asker.close?.();
  }

  mkdirSync(dirname(perRunPath), { recursive: true });
  writeVerifySpec(perRunPath, { schemaVersion: 1, answers });
  return { runId, verifySpecPath: perRunPath, asked: missing, detected: answered };
}

/**
 * CLI entry — called from scripts/cli.mjs with parsed options.
 *
 * @param {Record<string, string | boolean>} options
 */
export async function specCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf spec requires --run-id");
  const request = getStringOption(options, "request", "") ?? "";
  return runSpecCommand({ runId, request });
}
