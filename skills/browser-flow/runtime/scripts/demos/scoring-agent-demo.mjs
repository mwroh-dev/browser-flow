// @ts-check
// NON-CI demo: real internal scoring-agent sub-agent path (reactive; mirrors gap1 heal demo).
// Precondition: a run that ambiguous-drift-held (bf verify wrote scoring-request.json).
// Usage (orchestrator): node scripts/demos/scoring-agent-demo.mjs --run-id <id>
//   1) reads artifacts/runs/<id>/scoring-request.json (agent-blind held-element + drift metrics),
//   2) the ORCHESTRATOR dispatches `agents/analyzer/playbooks/scoring-agent.md` (Task tool) -> scoring-result.json,
//   3) bf score --run-id <id> --apply artifacts/runs/<id>/tasks/scoring-result.json -> re-run completes.
// Steps 2-3 are run by the orchestrator (as in the heal demo); this script just surfaces the request.
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { existsSync } from "node:fs";

/** @param {string} name @returns {string | undefined} */
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const runId = arg("--run-id");
  if (!runId) { console.error("usage: node scripts/demos/scoring-agent-demo.mjs --run-id <id>"); process.exit(1); }
  const paths = getRunPaths(runId);
  if (!existsSync(paths.scoringRequestPath)) {
    console.error("no scoring-request.json — run did not ambiguous-drift-hold (winner>=0.5)");
    process.exit(2);
  }
  const req = readJson(paths.scoringRequestPath);
  console.error("scoring-request:", JSON.stringify(req, null, 2));
  console.error("Next (orchestrator): dispatch agents/analyzer/playbooks/scoring-agent.md with the above,");
  console.error("then: bf score --run-id " + runId + " --apply <scoring-result.json>");
}

main();
