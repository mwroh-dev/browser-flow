import { z } from "zod";
import { SCHEMA_VERSIONS } from "./schema-versions.mjs";
import { getWeatherMapControlGroups } from "./surface-context.mjs";
import {
  getProviderPatterns,
  getProviderReplayStrategies,
  getProviderStateCarriers
} from "./provider-context.mjs";

/**
 * Zod schemas for result artifacts.
 *
 * Per `orchestrator-gated-context-distribution` Known Limit
 * ("Result artifact schemas must be versioned") and arXiv:2512.06659
 * "schema-bound tool ecosystems": mature multi-agent pipelines
 * validate the field shape at the read site, not just the version
 * number. `assertSchemaVersion` is the version-only floor;
 * this module raises it to field-level validation.
 *
 * Pattern source: Zod `z.discriminatedUnion('schemaVersion', [...])`
 * — production-used by tRPC, Astro content collections, T3 stack.
 * The discriminator key matches `SCHEMA_VERSIONS` keys from
 * `schema-versions.mjs` so version bumps and schema authoring stay
 * in lockstep.
 *
 * Adding a new version: define a `<Kind>V<N>` schema, append to the
 * discriminated union, bump `SCHEMA_VERSIONS[kind]` and
 * `ACCEPTED_VERSIONS[kind]` accordingly. Removing an old version is
 * a breaking change — coordinate with all readers.
 */

const ProviderContextShape = z
  .object({
    pattern: z.enum(
      /** @type {[string, ...string[]]} */ ([...getProviderPatterns()])
    ),
    stateCarrier: z.enum(
      /** @type {[string, ...string[]]} */ ([...getProviderStateCarriers()])
    ),
    replayStrategy: z.enum(
      /** @type {[string, ...string[]]} */ ([...getProviderReplayStrategies()])
    ),
    surfaceKey: z.string().min(1).optional(),
    controlGroup: z.string().min(1).optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional()
  })
  .passthrough();

const VerificationProof = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("final-url"),
    expectedUrl: z.string(),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("url-state"),
    expectedUrl: z.string(),
    params: z.array(z.object({ key: z.string(), value: z.string() }).passthrough()),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("network"),
    url: z.string(),
    method: z.string(),
    status: z.number(),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("dom-evidence"),
    selector: z.string(),
    textIncludes: z.string(),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("action-transition"),
    stepIndex: z.number().int().nonnegative(),
    transition: z.record(z.string(), z.unknown()),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("state-control"),
    stepIndex: z.number().int().nonnegative(),
    controlText: z.string().optional(),
    controlRole: z.string().optional(),
    stateSignals: z.record(z.string(), z.unknown()).optional(),
    expectedSelected: z.boolean().optional(),
    expectedPressed: z.boolean().optional(),
    networkHints: z.array(z.record(z.string(), z.unknown())).optional(),
    domEvidence: z.record(z.string(), z.unknown()).optional(),
    surfaceContext: z.record(z.string(), z.unknown()).optional(),
    providerContext: ProviderContextShape.optional(),
    required: z.literal(true)
  }).passthrough(),
  z.object({
    kind: z.literal("provider-transaction"),
    stepIndex: z.number().int().nonnegative(),
    postconditions: z.array(z.record(z.string(), z.unknown())),
    providerContext: ProviderContextShape.optional(),
    required: z.literal(true)
  }).passthrough()
]);

const VerificationGate = z
  .object({
    expectedFinalUrl: z.string().optional(),
    expectedNetwork: z
      .object({
        url: z.string(),
        method: z.string(),
        status: z.number()
      })
      .nullable()
      .optional(),
    expectedEvidence: z
      .object({
        selector: z.string(),
        textIncludes: z.string()
      })
      .nullable()
      .optional(),
    proofs: z.array(VerificationProof).optional()
  })
  .passthrough();

const SecurityClaim = z
  .object({
    localOnly: z.boolean(),
    installScope: z.literal("project-local").optional(),
    targetScope: z.enum(["local", "external"]).optional(),
    sanitizedArtifactsOnly: z.boolean().optional(),
    screenshotMode: z.enum(["off", "final", "steps", "both"]).optional(),
    screenshotsPersisted: z.boolean().optional()
  })
  .passthrough();

// Multi-signal locator fingerprint for the layered resolver.
// Factored into a named const so it can be reused by HealResultV1
// without duplication. Shape and .passthrough() are identical
// to the inline version that previously lived inside Step.
const LocatorShape = z
  .object({
    role: z.string().optional(),
    name: z.string().optional(),
    structuralKey: z.string().optional(),
    elementKey: z.string().optional(),
    relXPath: z.string().optional(),
    box: z.object({ cx: z.number(), cy: z.number(), w: z.number(), h: z.number() }).partial().optional(),
    viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }).partial().optional(),
    // New capture signals — text-bearing fields (neighborTexts, alt, href)
    // are agent-blind sanitized by event-sanitizer.mjs before persistence.
    href: z.string().optional(),
    neighborTexts: z.array(z.string()).optional(),
    semanticRegion: z.object({
      role: z.string().optional(),
      label: z.string().optional(),
      headingText: z.string().optional(),
      regionText: z.string().optional(),
      selector: z.string().optional(),
      sameNameCountPage: z.number().optional(),
      sameNameCountRegion: z.number().optional(),
      targetPosition: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
      box: z.object({ cx: z.number(), cy: z.number(), w: z.number(), h: z.number() }).partial().optional()
    }).passthrough().optional(),
    cleanId: z.string().optional(),
    type: z.string().optional(),
    alt: z.string().optional(),
    // Per-element weight tuning. A deterministic pattern (pattern-match.mjs)
    // or the scoring-agent writes this; resolveLocator merges weightOverrides over
    // DEFAULT_WEIGHTS. Agent-blind: signal names + numeric weights only, no values.
    disambiguation: z.object({
      weightOverrides: z.record(z.string(), z.number()).optional(),
      patternId: z.string().optional(),
      decisiveSignals: z.array(z.string()).optional(),
      note: z.string().optional()
    }).passthrough().optional()
  })
  .passthrough();

const SurfaceContextShape = z
  .object({
    kind: z.literal("weather-map"),
    surfaceKey: z.string().min(1),
    controlGroup: z.enum(
      /** @type {[string, ...string[]]} */ ([...getWeatherMapControlGroups()])
    )
  })
  .passthrough();

const Step = z
  .object({
    action: z.string(),
    // page-as-node — optional pageKey tagging each step with
    // the page-graph node where the action occurs. Additive-optional;
    // older artifacts without pageKey continue to parse.
    pageKey: z.string().min(1).optional(),
    // When this step's value comes from a workflow input
    // binding, valueRef holds the canonical placeholder
    // (`{{input.X}}`). bindInputs() substitutes the literal value and
    // strips this field before runner generation.
    valueRef: z.string().optional(),
    // Fill steps targeting contentEditable fields carry this
    // flag so the runner picks the contenteditable replay path.
    contentEditable: z.boolean().optional(),
    // Multi-signal locator fingerprint for the layered resolver.
    // Captured in-page per click/fill; replay tries the rungs in order
    // (role+name → structuralKey → relXPath → coords). Additive-optional.
    locator: LocatorShape.optional(),
    // Additive surface-aware hint for same-page layered controls. V1 uses the
    // weather-map subtype first; later surface families can extend this shape.
    surfaceContext: SurfaceContextShape.optional(),
    // Provider-facing frontend construction pattern. This is the generic
    // successor to site-specific surface hints; surfaceContext remains a
    // compatibility field while consumers move to providerContext.
    providerContext: ProviderContextShape.optional(),
    // Tab the step belongs to (creation-order ordinal; 0 = initial tab).
    // Absent on legacy single-tab workflows -> treated as 0 by the runner.
    tabOrdinal: z.number().int().nonnegative().optional(),
    // Stateful reveal controls look navigational in capture (often stale href)
    // but must be replayed as same-page affordance transitions before any
    // revealed follow-up click.
    actionSemantics: z
      .object({
        kind: z.literal("stateful-affordance"),
        verification: z.literal("transition"),
        hrefPolicy: z.literal("ignore"),
        followupStepIndex: z.number().int().nonnegative().optional()
      })
      .passthrough()
      .optional(),
    // Scraping extraction reference. Points at the durable extractor
    // config (by pageKey) the scraping-agent established for this step. The
    // config BODY lives separately (run artifact; knowledge/scraping stores durable);
    // this is just the reference + setup-time pagination class.
    extraction: z
      .object({
        pageKey: z.string(),
        status: z.enum(["extracted", "no-schema"]),
        pagination: z.object({ kind: z.string() }).passthrough().optional()
      })
      .passthrough()
      .optional(),
    locatorIntentReview: z.object({
      candidateId: z.string(),
      checkpoint: z.literal("locator_intent_review"),
      verdict: z.literal("confirm")
    }).passthrough().optional(),
    navigationFallback: z.object({
      kind: z.literal("confirmed-link-navigation"),
      checkpoint: z.literal("locator_intent_review"),
      href: z.string()
    }).passthrough().optional()
  })
  .passthrough();

const WorkflowInput = z
  .object({
    name: z.string().min(1),
    label: z.string().optional(),
    suggestedFrom: z.number().optional(),
    type: z.enum(["text", "path", "secret"])
  })
  .passthrough();

const WorkflowSegment = z
  .object({
    name: z.string().optional(),
    range: z.tuple([z.number(), z.number()]),
    startPageKey: z.string(),
    endPageKey: z.string()
  })
  .passthrough();

const WorkflowCompound = z
  .object({
    kind: z.string().min(1),
    range: z.tuple([z.number(), z.number()]),
    pageKey: z.string().optional(),
    surfaceKey: z.string().optional(),
    triggerStepIndex: z.number().int().nonnegative().optional(),
    followupStepIndex: z.number().int().nonnegative().optional()
  })
  .passthrough();

const WorkflowGraphEdge = z
  .object({
    kind: z.enum(["reveal", "surface-enter", "surface-exit", "modal-open", "modal-close", "tab-switch"]),
    fromStepIndex: z.number().int().nonnegative(),
    toStepIndex: z.number().int().nonnegative(),
    pageKey: z.string().optional(),
    surfaceKey: z.string().optional(),
    fromSurfaceKey: z.string().optional(),
    toSurfaceKey: z.string().optional()
  })
  .passthrough();

const WorkflowGraph = z
  .object({
    edges: z.array(WorkflowGraphEdge).default([])
  })
  .passthrough();

const RouteIntentStrategy = z.enum(["captured-dom", "state-url", "confirmed-link-navigation", "hybrid"]);

const WorkflowIntentPlan = z
  .object({
    strategy: RouteIntentStrategy,
    source: z.literal("route-intent"),
    targetStateUrl: z.string().optional(),
    proofs: z.array(VerificationProof).optional(),
    omittedStepIndexes: z.array(z.number().int().nonnegative()).default([]),
    checkpointResolved: z.literal("route_intent_review").optional()
  })
  .passthrough();

// Optional precondition/teardown/safety schemas.
// Additive-optional — older workflow.json documents without these
// fields continue to parse cleanly.

const WorkflowPrecondition = z
  .object({
    kind: z.literal("login"),
    site: z.string(),
    authMode: z.literal("human-bootstrap+keychain-session"),
    sessionRef: z.string()
  })
  .strict();

const WorkflowTeardown = z
  .object({
    strategy: z.enum(["record", "search", "bfs"]),
    steps: z.array(z.record(z.string(), z.unknown())).default([]),
    dummyNaming: z.object({ prefix: z.string(), hashLen: z.number().int().positive() })
  })
  .strict();

const WorkflowSafety = z
  .object({
    irreversibleStepIndexes: z.array(z.number().int().nonnegative()).default([]),
    consentRequired: z.boolean(),
    sandbox: z.object({ available: z.boolean(), location: z.string().nullable() })
  })
  .strict();

const WorkflowV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.workflow),
    id: z.string().min(1),
    fixture: z.string().min(1),
    startUrl: z.string(),
    finalUrl: z.string(),
    steps: z.array(Step),
    verification: VerificationGate,
    security: SecurityClaim,
    // Additive-optional fields. Older workflow.json documents parse cleanly without these.
    // Inputs are populated by the variable-agent sub-skill at `bf analyze` time;
    // segments are populated deterministically by segmentByPageNode().
    inputs: z.array(WorkflowInput).optional(),
    segments: z.array(WorkflowSegment).optional(),
    compounds: z.array(WorkflowCompound).optional(),
    workflowGraph: WorkflowGraph.optional(),
    intentPlan: WorkflowIntentPlan.optional(),
    // Additive-optional fields for human-in-loop verify.
    preconditions: z.array(WorkflowPrecondition).optional(),
    teardown: WorkflowTeardown.optional(),
    safety: WorkflowSafety.optional(),
    // Number of distinct tabs seen during capture (creation-order ordinal + 1).
    // Absent on legacy single-tab workflows.
    tabCount: z.number().int().positive().optional(),
    // Ambiguous reveal-like click steps that require reveal-agent review before
    // runner generation can safely ignore stale href navigation semantics.
    revealCandidates: z.array(z.number().int().nonnegative()).optional()
  })
  .passthrough();

export const WorkflowArtifact = z.discriminatedUnion("schemaVersion", [WorkflowV1]);

/**
 * @typedef {z.infer<typeof WorkflowArtifact>} WorkflowArtifact
 */

const TransitionCheck = z
  .object({
    name: z.string()
  })
  .passthrough();

const ProofCheck = z
  .object({
    kind: z.string(),
    name: z.string(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
    passed: z.boolean()
  })
  .passthrough();

const ResultEvidence = z
  .object({
    passed: z.boolean(),
    selector: z.string(),
    actualText: z.string(),
    expectedText: z.string()
  })
  .passthrough();

const TeardownStepResult = z
  .object({
    action: z.string(),
    ok: z.boolean(),
    error: z.string().optional()
  })
  .passthrough();

const VerificationV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.verification),
    success: z.boolean(),
    pathComplete: z.boolean(),
    executedSteps: z.array(z.string()),
    stepCount: z.number(),
    transitionChecks: z.array(TransitionCheck),
    proofChecks: z.array(ProofCheck).optional(),
    resultEvidence: ResultEvidence.optional(),
    failureReason: z.string().optional(),
    error: z.string().optional(),
    providerDiagnostics: z.record(z.string(), z.unknown()).optional(),
    verificationOutcome: z.enum(["verified", "not_verified"]).optional(),
    reasonCategory: z.enum([
      "none",
      "dynamic_content_drift",
      "state_drift",
      "locator_drift",
      "transition_timeout",
      "evidence_mismatch",
      "proof_mismatch",
      "security_not_clean",
      "replay_error"
    ]).optional(),
    blockingGate: z.enum([
      "none",
      "action_path",
      "locator",
      "transition",
      "evidence",
      "proof",
      "security",
      "runner"
    ]).optional(),
    userFault: z.boolean().optional(),
    diagnosticMode: z.boolean().optional(),
    replayOutcome: z.enum(["passed", "held", "failed"]).optional(),
    promotionOutcome: z.enum(["promoted", "not_promoted"]).optional(),
    promotionBlockers: z.array(
      z.object({
        // Backward compatibility: old reports may contain "local_only".
        // New code must not emit it; external replay candidates use gate:"registry".
        gate: z.enum(["security", "local_only", "replay", "registry"]),
        reason: z.string().min(1)
      }).passthrough()
    ).optional(),
    promotionCandidate: z.object({
      scope: z.enum(["external"]),
      status: z.enum(["external_replay_candidate"])
    }).passthrough().optional(),
    securityScanOk: z.boolean().optional(),
    securityPromotionClean: z.boolean().optional(),
    securityOk: z.boolean(),
    verifiedAt: z.string(),
    // Teardown surfacing — additive-optional.
    // teardownSteps comes from the runner report (each entry {action, ok, error?}).
    // teardownComplete is derived by verify-run: true when teardownSteps is
    // absent/empty OR all entries have ok===true.
    teardownSteps: z.array(TeardownStepResult).optional(),
    teardownComplete: z.boolean().optional(),
    // Orphan recovery sweep — additive-optional. Comes from the runner
    // report: live AX enumeration found dummy-prefixed leftovers (found[]) and
    // re-ran the teardown delete recipe per leftover (removed[]); errors[] per
    // failure. available=false when no listable AX surface / no delete recipe.
    orphanSweep: z
      .object({
        available: z.boolean(),
        found: z.array(z.string()).default([]),
        removed: z.array(z.string()).default([]),
        errors: z.array(z.object({ name: z.string(), error: z.string() }).passthrough()).default([])
      })
      .passthrough()
      .optional(),
    // Which resolver rung located each step (role+name/structuralKey/
    // relXPath/coords/atomic-fp). Surfaced from the runner report for debug + e2e.
    resolverLayers: z
      .array(z.object({ action: z.string(), layerUsed: z.string() }).passthrough())
      .optional(),
    // Drift-aware execution — write-ahead state journal (per-segment),
    // the segment index where execution HELD on a drift (evidence failure), and the
    // reason. heldAtSegment present ⇒ success false. journal enables dangling-data recovery.
    journal: z
      .array(
        z
          .object({
            segmentIndex: z.number(),
            intent: z.string().optional(),
            status: z.string(),
            created: z.array(z.string()).optional(),
            observedEndUrl: z.string().optional(),
            error: z.string().optional()
          })
          .passthrough()
      )
      .optional(),
    heldAtSegment: z.number().optional(),
    driftReason: z.string().optional(),
    // When held, the held segment + downstream segments data-dependent on it
    // (variable-binding cascade). Independent downstream is NOT listed (partial degradation).
    affectedSegments: z.array(z.number()).optional(),
    // Cleanup-only mode result — dangling artifact names requested for deletion,
    // names successfully removed, and per-name errors. Additive-optional; absent on normal runs.
    cleanup: z
      .object({
        requested: z.array(z.string()),
        removed: z.array(z.string()),
        errors: z.array(z.object({ name: z.string(), error: z.string() }).passthrough())
      })
      .passthrough()
      .optional(),
    // Heal-request emission — true when a heal-request.json artifact was written
    // during a drift-hold. Absent on normal (non-held) runs.
    healRequest: z.boolean().optional(),
    // Heal summary carried in a re-run report (status, applied keys,
    // unmatched keys). Additive-optional; absent on normal (non-healed) runs.
    healed: z
      .object({
        status: z.string(),
        applied: z.array(z.string()).optional(),
        unmatched: z.array(z.string()).optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export const VerificationArtifact = z.discriminatedUnion("schemaVersion", [VerificationV1]);

/**
 * @typedef {z.infer<typeof VerificationArtifact>} VerificationArtifact
 */

const SecurityFinding = z
  .object({
    file: z.string(),
    reason: z.string(),
    match: z.string()
  })
  .passthrough();

const SecurityV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.security),
    ok: z.boolean(),
    findings: z.array(SecurityFinding)
  })
  .passthrough();

export const SecurityArtifact = z.discriminatedUnion("schemaVersion", [SecurityV1]);

/**
 * @typedef {z.infer<typeof SecurityArtifact>} SecurityArtifact
 */

const DataResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.dataResult),
    runId: z.string().min(1),
    dataMode: z.enum(["extract", "mixed"]),
    replayOutcome: z.enum(["passed", "held", "failed", "unknown"]),
    dataOutcome: z.enum(["data", "empty", "drift", "no_schema", "unavailable"]),
    extractStatus: z.string().min(1),
    stepIndex: z.number().int().nonnegative().optional(),
    pageKey: z.string().optional(),
    cardinality: z.number().int().nonnegative().optional(),
    rowCount: z.number().int().nonnegative(),
    rows: z.array(z.record(z.string(), z.unknown())),
    previewRows: z.array(z.record(z.string(), z.unknown())),
    reason: z.string().optional(),
    summary: z.object({ headline: z.string().min(1), detail: z.string().min(1) }).passthrough()
  })
  .passthrough();

export const DataResultArtifact = z.discriminatedUnion("schemaVersion", [DataResultV1]);

/**
 * @typedef {z.infer<typeof DataResultArtifact>} DataResultArtifact
 */

const PathYamlV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.pathYaml),
    id: z.string().min(1),
    fixture: z.string().min(1),
    startUrl: z.string(),
    finalUrl: z.string(),
    steps: z.array(Step),
    verification: VerificationGate
  })
  .passthrough();

export const PathYamlArtifact = z.discriminatedUnion("schemaVersion", [PathYamlV1]);

/**
 * @typedef {z.infer<typeof PathYamlArtifact>} PathYamlArtifact
 */

const RecipeYamlV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.recipeYaml),
    id: z.string().min(1),
    fixture: z.string().min(1),
    localOnly: z.literal(true),
    artifacts: z
      .object({
        path: z.string(),
        recipe: z.string(),
        runner: z.string()
      })
      .passthrough(),
    verification: z
      .object({
        freshProfile: z.literal(true),
        requiresActionPath: z.literal(true),
        requiresTransition: z.literal(true),
        requiresEvidence: z.literal(true)
      })
      .passthrough(),
    security: SecurityClaim
  })
  .passthrough();

export const RecipeYamlArtifact = z.discriminatedUnion("schemaVersion", [RecipeYamlV1]);

/**
 * @typedef {z.infer<typeof RecipeYamlArtifact>} RecipeYamlArtifact
 */

const OpenAiAgentShared = {
  name: z.string().min(1),
  description: z.string().min(1),
  guardrails: z.array(z.string()).min(1)
};

const OpenAiEntryAgent = z
  .object({
    role_type: z.literal("entry"),
    entrypoint: z.string().min(1),
    requires_verification: z.boolean(),
    required_reports: z.array(z.string()).min(1),
    ...OpenAiAgentShared
  })
  .passthrough();

const OpenAiPhaseAgent = z
  .object({
    role_type: z.literal("phase"),
    phase: z.string().min(1),
    inputs: z.array(z.string()).min(1),
    outputs: z.array(z.string()).min(1),
    ...OpenAiAgentShared
  })
  .passthrough();

export const OpenAiAgentDef = z.discriminatedUnion("role_type", [OpenAiEntryAgent, OpenAiPhaseAgent]);

/**
 * @typedef {z.infer<typeof OpenAiAgentDef>} OpenAiAgentDef
 */

const VerifySpecV1 = z
  .object({
    schemaVersion: z.literal(1),
    answers: z.record(z.string(), z.unknown())
  })
  .strict();

export const VerifySpecArtifact = z.discriminatedUnion("schemaVersion", [VerifySpecV1]);

/**
 * @typedef {z.infer<typeof VerifySpecArtifact>} VerifySpecArtifact
 */

const ComposeDecisionV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.composeDecision),
    requestIntent: z
      .object({
        targetState: z.string().min(1),
        mustKeep: z.array(z.string()),
        maySkip: z.array(z.string()),
        requiresData: z.boolean()
      })
      .passthrough(),
    candidateHints: z
      .object({
        preferredSegments: z.array(z.number()).default([]),
        stopAfterSegment: z.number().int().nonnegative().optional()
      })
      .passthrough(),
    notes: z.array(z.string())
  })
  .passthrough();

export const ComposeDecisionArtifact = z.discriminatedUnion("schemaVersion", [ComposeDecisionV1]);

/**
 * @typedef {z.infer<typeof ComposeDecisionArtifact>} ComposeDecisionArtifact
 */

const ComposeSummaryV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.composeSummary),
    primaryRunId: z.string().min(1),
    sourceRuns: z.array(z.string()),
    status: z.enum(["planned", "composed", "broken"]),
    blockedReason: z.enum(["none", "unreachable_goal", "policy_blocked", "graph_disconnect", "iteration_limit"])
  })
  .passthrough();

export const ComposeSummaryArtifact = z.discriminatedUnion("schemaVersion", [ComposeSummaryV1]);

/**
 * @typedef {z.infer<typeof ComposeSummaryArtifact>} ComposeSummaryArtifact
 */

/**
 * Parse + validate a verify-spec.json document. Throws a path-prefixed
 * Error on shape mismatch; returns the validated object on success.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseVerifySpec(input, artifactPath = "<inline>") {
  const result = VerifySpecArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "verify-spec");
  }
  return result.data;
}

/**
 * Parse + validate a compose decision artifact.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseComposeDecision(input, artifactPath = "<inline>") {
  const result = ComposeDecisionArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "compose-decision");
  }
  return result.data;
}

/**
 * Parse + validate a compose summary artifact.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseComposeSummary(input, artifactPath = "<inline>") {
  const result = ComposeSummaryArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "compose-summary");
  }
  return result.data;
}

/**
 * Convert a Zod safeParse failure into a path-prefixed Error.
 *
 * @param {z.ZodError} error
 * @param {string} artifactPath
 * @param {string} kind
 */
function formatZodError(error, artifactPath, kind) {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"} — ${issue.message}`)
    .join("; ");
  return new Error(`${artifactPath}: ${kind} artifact failed schema validation — ${issues}`);
}

/**
 * Parse + validate a workflow.json document. Throws a path-prefixed
 * Error on shape mismatch; returns the validated object on success.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseWorkflowArtifact(input, artifactPath = "<inline>") {
  const result = WorkflowArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "workflow");
  }
  return result.data;
}

/**
 * Parse + validate a verification.json document.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseVerificationArtifact(input, artifactPath = "<inline>") {
  const result = VerificationArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "verification");
  }
  return result.data;
}

/**
 * Parse + validate a security.json document.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseSecurityArtifact(input, artifactPath = "<inline>") {
  const result = SecurityArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "security");
  }
  return result.data;
}

const RouteIntentOmittedStep = z
  .object({
    stepIndex: z.number().int().nonnegative(),
    action: z.string().min(1),
    text: z.string().optional(),
    href: z.string().optional(),
    pageUrl: z.string().optional()
  })
  .passthrough();

const RouteIntentCandidate = z
  .object({
    candidateId: z.string().min(1),
    strategy: RouteIntentStrategy,
    targetStateUrl: z.string().optional(),
    proofs: z.array(VerificationProof).default([]),
    omittedSteps: z.array(RouteIntentOmittedStep).default([]),
    risks: z.array(z.string()).default([]),
    recommendedAction: z.enum(["confirm-state-route", "keep-dom-route"])
  })
  .passthrough();

const RouteIntentPreviewV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.routeIntentPreview),
    status: z.enum(["clean", "needs_review", "unavailable"]),
    suggestions: z.array(RouteIntentCandidate).default([])
  })
  .passthrough();

const RouteIntentResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.routeIntentResult),
    runId: z.string().min(1),
    decisions: z.array(z.object({
      candidateId: z.string().min(1),
      verdict: z.enum(["confirm-state-route", "keep-dom-route"])
    }).passthrough())
  })
  .passthrough();

export const RouteIntentPreviewArtifact = z.discriminatedUnion("schemaVersion", [RouteIntentPreviewV1]);
export const RouteIntentResultArtifact = z.discriminatedUnion("schemaVersion", [RouteIntentResultV1]);

/**
 * Parse + validate a route-intent-preview.json document.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseRouteIntentPreview(input, artifactPath = "<inline>") {
  const result = RouteIntentPreviewArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "route-intent-preview");
  }
  return result.data;
}

/**
 * Parse + validate a route-intent-result.json document.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseRouteIntentResult(input, artifactPath = "<inline>") {
  const result = RouteIntentResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "route-intent-result");
  }
  return result.data;
}

/**
 * Parse + validate a data-result.json document.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseDataResult(input, artifactPath = "<inline>") {
  const result = DataResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "data-result");
  }
  return result.data;
}

/**
 * Parse + validate a path.yaml document (pre-serialization object form).
 * Called at write time on the data structure before YAML emission.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parsePathYamlArtifact(input, artifactPath = "<inline>") {
  const result = PathYamlArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "path.yaml");
  }
  return result.data;
}

/**
 * Parse + validate a recipe.yaml document (pre-serialization object form).
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseRecipeYamlArtifact(input, artifactPath = "<inline>") {
  const result = RecipeYamlArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "recipe.yaml");
  }
  return result.data;
}

/**
 * Parse + validate an `agents/<name>/openai.yaml` parsed-YAML object.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseOpenAiAgentDef(input, artifactPath = "<inline>") {
  const result = OpenAiAgentDef.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "openai.yaml");
  }
  return result.data;
}

// HealResult — output contract of the heal sub-agent.
// Either the agent produced healed locators (status "healed") or it
// could not complete (status "partial-incomplete"). superRefine enforces
// the invariant: "healed" ⇒ non-empty healedLocators, "partial-incomplete"
// ⇒ reason present.

const HealedLocatorEntry = z.object({
  match: z.object({ structuralKey: z.string().min(1) }),
  locator: LocatorShape,
  note: z.string().optional()
});

const HealResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.healResult),
    runId: z.string().min(1),
    status: z.enum(["healed", "partial-incomplete"]),
    healedLocators: z.array(HealedLocatorEntry).optional(),
    reason: z.string().optional()
  })
  .superRefine((v, ctx) => {
    if (v.status === "healed" && (!v.healedLocators || v.healedLocators.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "healed status requires non-empty healedLocators"
      });
    }
    if (v.status === "partial-incomplete" && !v.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "partial-incomplete status requires a reason"
      });
    }
  });

export const HealResultArtifact = z.discriminatedUnion("schemaVersion", [HealResultV1]);

/**
 * @typedef {z.infer<typeof HealResultArtifact>} HealResultArtifact
 */

/**
 * Parse + validate a heal-result.json document. Throws a path-prefixed
 * Error on shape mismatch; returns the validated object on success.
 *
 * @param {unknown} input
 * @param {string} [artifactPath]
 */
export function parseHealResult(input, artifactPath = "<inline>") {
  const result = HealResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "heal-result");
  }
  return result.data;
}

// Scoring-agent output. weightOverrides tune which signals the resolver
// trusts for an ambiguous element; generalizable optionally seeds patterns.json.
const ScoringResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.scoringResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    disambiguation: z.object({
      weightOverrides: z.record(z.string(), z.number()),
      note: z.string().optional()
    }),
    generalizable: z.object({
      id: z.string().min(1),
      match: z.record(z.string(), z.unknown()),
      signalWeights: z.record(z.string(), z.number())
    }).optional()
  })
  .passthrough();

export const ScoringResultArtifact = z.discriminatedUnion("schemaVersion", [ScoringResultV1]);

/**
 * Parse + validate a scoring-result.json document. Throws a path-prefixed
 * Error on shape mismatch; returns the validated object on success.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseScoringResult(input, artifactPath = "<inline>") {
  const result = ScoringResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "scoring-result");
  }
  return result.data;
}

// ScopeResult — output contract of the scope sub-agent. status "scoped"
// carries anchors (target neighbor-text) + scope rule (+ optional weights);
// "no-anchor" carries a reason. Field-level enforcement of which fields go with
// which status lives in applyScope (lenient schema, additive philosophy).
const ScopeResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.scopeResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    status: z.enum(["scoped", "no-anchor"]),
    anchors: z.array(z.string()).optional(),
    scope: z
      .object({
        ancestorUp: z.number().int().nonnegative().optional(),
        includeAncestorSiblingText: z.boolean().optional(),
        anchorRole: z.string().optional()
      })
      .passthrough()
      .optional(),
    signalWeights: z.record(z.string(), z.number()).optional(),
    // The model's resolution-method verdict for this element.
    // "A" = static anchor (default); "B" = action before/after diff tracking
    // (morphing/anonymous elements with no stable anchor).
    resolutionMethod: z.enum(["A", "B"]).optional(),
    reason: z.string().optional(),
    note: z.string().optional()
  })
  .passthrough();

export const ScopeResultArtifact = z.discriminatedUnion("schemaVersion", [ScopeResultV1]);

/**
 * Parse + validate a scope-result.json document. Throws a path-prefixed Error
 * on shape mismatch; returns the validated object on success.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseScopeResult(input, artifactPath = "<inline>") {
  const result = ScopeResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "scope-result");
  }
  return result.data;
}

const RevealResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.revealResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    status: z.enum(["stateful-affordance", "not-reveal"]),
    verification: z.literal("transition").optional(),
    hrefPolicy: z.literal("ignore").optional(),
    followupStepIndex: z.number().int().nonnegative().optional(),
    reason: z.string().optional()
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.status === "stateful-affordance") {
      if (v.verification !== "transition") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stateful-affordance status requires verification=transition" });
      }
      if (v.hrefPolicy !== "ignore") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stateful-affordance status requires hrefPolicy=ignore" });
      }
    }
    if (v.status === "not-reveal" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not-reveal status requires a reason" });
    }
  });

/**
 * Parse + validate a reveal-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseRevealResult(input, artifactPath = "<inline>") {
  const result = RevealResultV1.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "reveal-result");
  }
  return result.data;
}

// ExtractorConfig — the reusable, deterministic extraction artifact
// emitted once by the scraping sub-agent and run forever by `bf extract` with
// zero model calls (code-over-prompt). container=null → single-item page
// (article/detail); otherwise container selects the repeating unit and each
// field selector resolves relative to it.
const ExtractorFieldShape = z
  .object({
    name: z.string().min(1),
    selector: z.string().min(1),
    attribute: z.string().min(1).optional(), // default "textContent" applied in extractor
    required: z.boolean().optional(),
    fallbackSelector: z.string().min(1).nullable().optional(),
    transform: z.enum(["trim", "parseInt", "parseFloat"]).nullable().optional()
  })
  .passthrough();

const ExtractorConfigV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.extractorConfig),
    pageKey: z.string().min(1),
    container: z.string().min(1).nullable(),
    fields: z.array(ExtractorFieldShape).min(1)
  })
  .passthrough();

export const ExtractorConfigArtifact = z.discriminatedUnion("schemaVersion", [ExtractorConfigV1]);

/**
 * Parse + validate an extractor-config document. Throws a path-prefixed Error
 * on shape mismatch; returns the validated object on success.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseExtractorConfig(input, artifactPath = "<inline>") {
  const result = ExtractorConfigArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "extractor-config");
  }
  return result.data;
}

// ScrapeResult — output contract of the scraping sub-agent.
// status "extracted" carries an extractor-config body (container+fields) the
// agent verified against the snapshot + a golden sample (drift oracle);
// "no-schema" carries a reason. Mirrors ScopeResultV1; superRefine enforces the
// status↔field pairing (same shape as HealResultV1). The agent emits the config
// body WITHOUT schemaVersion/pageKey — bf extract --apply wraps it into a full
// ExtractorConfigV1 by adding those.
const ScrapeResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.scrapeResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    status: z.enum(["extracted", "no-schema"]),
    pageType: z.enum(["listing", "article", "detail", "search"]).optional(),
    extractorConfig: z
      .object({
        container: z.string().min(1).nullable(),
        fields: z.array(ExtractorFieldShape).min(1)
      })
      .passthrough()
      .optional(),
    golden: z
      .object({
        cardinality: z.number().int().nonnegative().optional(),
        sampleValues: z.array(z.record(z.string(), z.unknown())).optional()
      })
      .passthrough()
      .optional(),
    pagination: z.object({ kind: z.enum(["none", "simple", "complex"]) }).passthrough().optional(),
    reason: z.string().optional(),
    note: z.string().optional()
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.status === "extracted" && !v.extractorConfig) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "extracted status requires extractorConfig" });
    }
    if (v.status === "no-schema" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no-schema status requires a reason" });
    }
  });

/**
 * Parse + validate a scrape-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseScrapeResult(input, artifactPath = "<inline>") {
  const result = ScrapeResultV1.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "scrape-result");
  }
  return result.data;
}

// ExtractHealResult — output of the extract-heal-agent.
// "healed" carries a re-derived extractor-config body (force-written to the
// durable store); "unrepairable" carries a reason (surfaced to the user — the
// schema no longer exists on the page). Mirrors HealResultV1.
const ExtractHealResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.extractHealResult),
    runId: z.string().min(1),
    pageKey: z.string().min(1),
    status: z.enum(["healed", "unrepairable"]),
    extractorConfig: z
      .object({ container: z.string().min(1).nullable(), fields: z.array(ExtractorFieldShape).min(1) })
      .passthrough()
      .optional(),
    golden: z
      .object({
        cardinality: z.number().int().nonnegative().optional(),
        sampleValues: z.array(z.record(z.string(), z.unknown())).optional()
      })
      .passthrough()
      .optional(),
    reason: z.string().optional()
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.status === "healed" && !v.extractorConfig) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "healed status requires extractorConfig" });
    }
    if (v.status === "unrepairable" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unrepairable status requires a reason" });
    }
  });

/**
 * Parse + validate an extract-heal-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseExtractHealResult(input, artifactPath = "<inline>") {
  const result = ExtractHealResultV1.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "extract-heal-result");
  }
  return result.data;
}
