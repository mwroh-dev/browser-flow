import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getStringOption } from "../lib/args.mjs";
import { ensureRunDirs, getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { buildComposeSummary, normalizeComposeBlockedReason } from "../compose/compose-summary.mjs";
import { assembleComposedWorkflow } from "../compose/workflow-assembler.mjs";
import { assertComposeActionAllowed } from "../compose/policy-hooks.mjs";
import { deriveDeterministicComposeDecision, selectComposeSteps } from "../compose/request-selection.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";
import { verifyRun } from "../verify/verify-run.mjs";

let composeRunSequence = 0;

function mintDerivedRunId() {
  composeRunSequence = (composeRunSequence + 1) % 1_000_000;
  return [
    "compose",
    Date.now().toString(36),
    process.hrtime.bigint().toString(36),
    composeRunSequence.toString(36)
  ].join("-");
}

function appendComposeJournal(journalPath, entry) {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf8");
}

const ALLOWED_BLOCKED_REASONS = new Set(["unreachable_goal", "policy_blocked", "graph_disconnect"]);

function normalizeBlockedReason(reason) {
  return ALLOWED_BLOCKED_REASONS.has(reason) ? reason : "unreachable_goal";
}

function normalizeVerificationBlockedReason(verificationResult) {
  if (verificationResult?.security?.ok !== true) return "policy_blocked";

  const directReason = verificationResult?.blockedReason ??
    verificationResult?.verification?.blockedReason ??
    verificationResult?.report?.blockedReason;
  if (directReason !== undefined && directReason !== "none") return normalizeComposeBlockedReason(directReason);

  const verification = verificationResult?.verification ?? verificationResult?.report ?? {};
  const failureText = [
    verification.failureReason,
    verification.error,
    verification.driftReason
  ].filter(Boolean).join("\n").toLowerCase();
  if (
    verification.pathComplete === false ||
    failureText.includes("action-path-mismatch") ||
    failureText.includes("graph") ||
    failureText.includes("disconnect") ||
    failureText.includes("drift") ||
    failureText.includes("locator")
  ) {
    return "graph_disconnect";
  }

  return "unreachable_goal";
}

function composePolicyMode(sourceWorkflow) {
  return sourceWorkflow?.security?.localOnly === false ? "public-read" : "local";
}

function writeBrokenLearningCheckpoint({ derivedPaths, runId, blockedReason, learnedSteps, reusedSegments = [] }) {
  writeJson(derivedPaths.composeSessionPath, {
    checkpoint: "learning_gap_resolved",
    status: "broken",
    blockedReason
  });
  writeJson(derivedPaths.composeSummaryPath, buildComposeSummary({
    primaryRunId: runId,
    sourceRuns: [runId],
    status: "broken",
    blockedReason,
    reusedSegments,
    learnedSteps: learnedSteps.length
  }));
}

/**
 * @returns {{
 *   decide: ({ request, sourceWorkflow }: { request: string, sourceWorkflow: Record<string, unknown> }) => Promise<Record<string, unknown>>,
 *   learnGap: (input: {
 *     request: string,
 *     decision: Record<string, unknown>,
 *     sourceWorkflow: Record<string, unknown>,
 *     composePaths: ReturnType<typeof getRunPaths>
 *   }) => Promise<{ status: string, blockedReason?: string, learnedSteps: unknown[] }>,
 *   generateDerived: (input: { derivedRunId: string, derivedPaths: ReturnType<typeof getRunPaths> }) => Promise<{ runnerPath: string }>,
 *   verifyDerived: (input: {
 *     derivedRunId: string,
 *     derivedPaths: ReturnType<typeof getRunPaths>,
 *     runnerPath: string
 *   }) => Promise<{ ok: boolean, verification?: Record<string, unknown>, report?: Record<string, unknown>, security?: { ok?: boolean } & Record<string, unknown> }>
 * }}
 */
function defaultDeps() {
  return {
    decide: async ({ request, sourceWorkflow }) => deriveDeterministicComposeDecision({ request, sourceWorkflow }),
    learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
    generateDerived: async ({ derivedRunId }) => generateRunner(derivedRunId),
    verifyDerived: async ({ derivedRunId }) => {
      const result = await verifyRun(derivedRunId, { headless: true });
      return {
        ok: result.ok,
        verification: result.report,
        security: result.security
      };
    }
  };
}

/**
 * Compose command surface. This phase assembles a derived workflow from the
 * source run, can bridge a composer-identified gap through injected live
 * learning, and treats generate + verify as the truth gate for final success.
 *
 * @param {Record<string, string | boolean>} options
 * @param {Partial<ReturnType<typeof defaultDeps>>} [deps]
 */
export async function composeCommand(options, deps = {}) {
  const resolvedDeps = { ...defaultDeps(), ...deps };
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf compose requires --run-id");

  const request = getStringOption(options, "request", undefined);
  if (!request) throw new Error("bf compose requires --request");
  const dryRun = options["dry-run"] === true;

  const sourcePaths = getRunPaths(runId);
  let sourceWorkflow;
  try {
    sourceWorkflow = /** @type {{ steps?: unknown[] } & Record<string, unknown>} */ (
      readJson(sourcePaths.workflowJsonPath)
    );
  } catch (error) {
    throw new Error(`Source workflow not found at ${sourcePaths.workflowJsonPath}. Run \`bf analyze --run-id ${runId}\` first.`);
  }
  const decision = await resolvedDeps.decide({ request, sourceWorkflow });
  const derivedRunId = mintDerivedRunId();
  const selection = selectComposeSteps(sourceWorkflow, decision);
  const { selectedSteps, selectedSegmentIndexes } = selection;
  const learningNeeded = decision?.candidateHints?.stopAfterSegment !== undefined;
  const previewPaths = getRunPaths(derivedRunId);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      sourceRunId: runId,
      request,
      derivedRunId,
      planned: {
        selectedSegmentIndexes,
        selectedStepCount: selectedSteps.length,
        learningNeeded,
        blockedReason: selection.blockedReason ? normalizeBlockedReason(selection.blockedReason) : "none",
        policyMode: composePolicyMode(sourceWorkflow)
      },
      wouldWrite: [
        previewPaths.composeRequestPath,
        previewPaths.composePlanPath,
        previewPaths.workflowJsonPath,
        previewPaths.runnerPath,
        previewPaths.composeSummaryPath
      ],
      wouldRun: learningNeeded ? ["learn-gap", "generate", "verify"] : ["generate", "verify"]
    };
  }
  const derivedPaths = ensureRunDirs(derivedRunId);
  const learnResult = learningNeeded
    ? await resolvedDeps.learnGap({ request, decision, sourceWorkflow, composePaths: derivedPaths })
    : { status: "not-needed", learnedSteps: [] };
  const learnedSteps = Array.isArray(learnResult.learnedSteps) ? learnResult.learnedSteps : [];

  writeJson(derivedPaths.composeRequestPath, { runId, request });
  writeJson(derivedPaths.composePlanPath, decision);

  if (selection.blockedReason) {
    const blockedReason = normalizeBlockedReason(selection.blockedReason);
    writeBrokenLearningCheckpoint({
      derivedPaths,
      runId,
      blockedReason,
      learnedSteps: [],
      reusedSegments: selectedSegmentIndexes
    });
    return {
      ok: false,
      blockedReason,
      derivedRunId
    };
  }

  const policyMode = composePolicyMode(sourceWorkflow);
  for (const step of learnedSteps) {
    try {
      assertComposeActionAllowed({ mode: policyMode, action: step });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "policy_blocked") throw error;
      writeBrokenLearningCheckpoint({
        derivedPaths,
        runId,
        blockedReason: "policy_blocked",
        learnedSteps: [],
        reusedSegments: selectedSegmentIndexes
      });
      return {
        ok: false,
        blockedReason: "policy_blocked",
        derivedRunId
      };
    }
  }

  for (const [stepIndex, step] of learnedSteps.entries()) {
    appendComposeJournal(derivedPaths.composeJournalPath, {
      type: "learned_step",
      stepIndex,
      step
    });
  }

  if (learnResult.status === "blocked") {
    const blockedReason = normalizeBlockedReason(learnResult.blockedReason);
    writeBrokenLearningCheckpoint({
      derivedPaths,
      runId,
      blockedReason,
      learnedSteps,
      reusedSegments: selectedSegmentIndexes
    });

    return {
      ok: false,
      blockedReason,
      derivedRunId
    };
  }

  const assembled = assembleComposedWorkflow({
    sourceWorkflow,
    primaryRunId: runId,
    derivedRunId,
    selectedSteps,
    learnedSteps
  });

  writeJson(derivedPaths.workflowJsonPath, assembled);
  writeJson(derivedPaths.composeSessionPath, { checkpoint: "workflow_generated", status: "in-progress" });
  const generation = await resolvedDeps.generateDerived({ derivedRunId, derivedPaths });
  const verification = await resolvedDeps.verifyDerived({
    derivedRunId,
    derivedPaths,
    runnerPath: generation.runnerPath
  });
  const success =
    verification.ok === true &&
    verification.verification?.success === true &&
    verification.security?.ok === true;
  const blockedReason = success ? "none" : normalizeVerificationBlockedReason(verification);
  writeJson(derivedPaths.composeSessionPath, {
    checkpoint: "verification_complete",
    status: success ? "composed" : "broken",
    blockedReason
  });
  writeJson(derivedPaths.composeSummaryPath, buildComposeSummary({
    primaryRunId: runId,
    sourceRuns: [runId],
    status: success ? "composed" : "broken",
    blockedReason,
    reusedSegments: selectedSegmentIndexes,
    learnedSteps: learnedSteps.length
  }));

  return {
    ok: success,
    derivedRunId,
    derivedWorkflowPath: derivedPaths.workflowJsonPath,
    composeSummaryPath: derivedPaths.composeSummaryPath,
    blockedReason
  };
}
