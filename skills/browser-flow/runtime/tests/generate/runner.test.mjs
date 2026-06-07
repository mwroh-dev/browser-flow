import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { ensureRunDirs, getPaths } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("generated runner uses a fresh persistent Chrome profile and explicit gate checks", () => {
  const runId = `runner-structure-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // CDP-direct runner — no playwright import.
  assert.doesNotMatch(source, /from "playwright"/);
  assert.match(source, /createBrowserSession/);
  assert.match(source, /resolveAtomicFpLocator/);
  assert.match(source, /mkdtempSync/);
  assert.match(source, /waitForExpectedUrl/);
  assert.match(source, /submitterSelector/);
  assert.match(source, /resultEvidence/);
});

test("generated runner preserves captured viewport for spawned replay only", () => {
  const runId = `runner-viewport-parity-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://example.com/start",
    finalUrl: "https://example.com/done",
    steps: [
      { action: "goto", url: "https://example.com/start", pageKey: "manual/example.com/start" },
      {
        action: "click",
        selector: "button",
        text: "Open",
        pageKey: "manual/example.com/start",
        locator: {
          role: "button",
          name: "Open",
          structuralKey: "main>div|button|type=button|open|Open",
          identityShape: "main>div|button|type=button|open|",
          controlKind: "option",
          viewport: { w: 1200, h: 1643, dpr: 2 }
        }
      }
    ],
    segments: [{ range: [0, 1], name: "viewport", startPageKey: "manual/example.com/start", endPageKey: "manual/example.com/done" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://example.com/done",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /function deriveReplayViewport/);
  assert.match(source, /normalizeReplayViewport/);
  assert.match(source, /replayViewportWindowArg/);
  assert.match(source, /"--window-size=" \+ viewport\.width \+ "," \+ viewport\.height/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride/);
  assert.match(source, /const replayViewport = attachPort \? null : deriveReplayViewport\(\);/);
  assert.match(source, /extraArgs: replayViewportWindowArg\(replayViewport\)/);
  assert.match(source, /applyReplayViewportForTarget\(bs, targetId, replayViewport, replayViewportAppliedTargets\)/);
  assert.match(source, /replayViewport: replayViewport \? \{ \.\.\.replayViewport, appliedTargets: replayViewportApplications \} : null/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner evaluates proofChecks for URL-state workflows", () => {
  const runId = `runner-proof-checks-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://example.com/map?id=abc&mode=rain",
    finalUrl: "https://example.com/map?id=abc&mode=rain",
    steps: [
      {
        action: "goto",
        url: "https://example.com/map?id=abc&mode=rain",
        pageKey: "manual/example.com/map",
        tabOrdinal: 0
      }
    ],
    segments: [],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://example.com/map?id=abc&mode=rain",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [
        {
          kind: "final-url",
          expectedUrl: "https://example.com/map?id=abc&mode=rain",
          required: true
        },
        {
          kind: "url-state",
          expectedUrl: "https://example.com/map?id=abc&mode=rain",
          params: [
            { key: "id", value: "abc" },
            { key: "mode", value: "rain" }
          ],
          required: true
        }
      ],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /proofChecks/);
  assert.match(source, /evaluateProof/);
  assert.match(source, /url-state/);
  assert.match(source, /allRequiredProofsPassed/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner navigates goto steps to step.url for state-url intent routes", () => {
  const runId = `runner-state-url-goto-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "urlstate",
    startUrl: "/urlstate/map?id=abc&mode=default",
    finalUrl: "/urlstate/map?id=abc&mode=rain",
    steps: [
      { action: "goto", url: "/urlstate/map?id=abc&mode=rain" }
    ],
    segments: [{ range: [0, 0], name: "state route", startPageKey: "", endPageKey: "" }],
    compounds: [],
    workflowGraph: { edges: [] },
    intentPlan: {
      strategy: "state-url",
      source: "route-intent",
      targetStateUrl: "/urlstate/map?id=abc&mode=rain",
      omittedStepIndexes: [1],
      checkpointResolved: "route_intent_review"
    },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "/urlstate/map?id=abc&mode=rain",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [
        { kind: "final-url", expectedUrl: "/urlstate/map?id=abc&mode=rain", required: true },
        {
          kind: "url-state",
          expectedUrl: "/urlstate/map?id=abc&mode=rain",
          params: [{ key: "mode", value: "rain" }],
          required: true
        }
      ],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: true,
      installScope: "project-local",
      targetScope: "local",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /const gotoTarget = step\.url/);
  assert.match(source, /checkpointResolved: workflow\.intentPlan/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner emits confirmed semantic link navigation fallback", () => {
  const runId = `runner-locator-intent-fallback-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto", url: "/synthetic", pageKey: "synthetic", tabOrdinal: 0 },
      {
        action: "click",
        selector: "section:nth-of-type(2) a",
        text: "More",
        href: "/synthetic/result",
        expectUrl: "/synthetic/result",
        pageKey: "synthetic",
        tabOrdinal: 0,
        locator: {
          role: "link",
          name: "More",
          href: "/synthetic/result",
          structuralKey: "main>section>h2|a||more|More",
          semanticRegion: {
            role: "section",
            headingText: "Satellite imagery",
            label: "Satellite imagery",
            sameNameCountPage: 3,
            sameNameCountRegion: 1
          }
        },
        locatorIntentReview: {
          candidateId: "li1",
          checkpoint: "locator_intent_review",
          verdict: "confirm"
        },
        navigationFallback: {
          kind: "confirmed-link-navigation",
          checkpoint: "locator_intent_review",
          href: "/synthetic/result"
        },
        replayPermission: {
          level: "confirmed-equivalence",
          reasonCode: "confirmed-pure-navigation",
          decisionSource: "user-review",
          fallbackAllowed: true,
          proofRequired: false
        }
      }
    ],
    segments: [{ range: [0, 1], name: "all", startPageKey: "synthetic", endPageKey: "synthetic-result" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: { url: "/api/complete", method: "GET", status: 200 },
      expectedEvidence: { selector: "body", textIncludes: "Workflow Complete" },
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");
  assert.match(source, /useNavFallback/);
  assert.match(source, /navigationFallback/);
  assert.match(source, /confirmed-link-navigation/);
  assert.match(source, /permission\.level === "confirmed-equivalence"/);
  assert.match(source, /step\.replayIntent !== "state_action"/);
  assert.match(source, /summarizePerms/);
  assert.match(source, /fallbacksUsed\.push\("confirmed-link-navigation"\)/);
  assert.match(source, /checkpointResolved/);
  assert.match(source, /resolveWorkflowUrl\(baseUrl, rawDestination\)/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner uses getByRole when atomicFp.strategy=role (sibling-unique accessible name)", () => {
  const runId = `runner-phase59-role-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://example.org/menu",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.org/menu", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "delete 삭제",
      timestamp: 1000,
      ancestors: [{ tag: "div", role: "menu" }],
      siblings: { totalMatchingSelector: 73, totalMatchingRole: 1 }
    },
    { type: "navigate", url: "https://example.org/menu/done", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://example.org/_/x/delete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Done", url: "https://example.org/menu/done" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");
  // CDP-direct — resolveAtomicFpLocator replaces inline locator helpers.
  assert.doesNotMatch(source, /from "playwright"/);
  assert.match(source, /resolveAtomicFpLocator/);
  // atomicFp metadata still lands in the embedded workflow JSON.
  assert.match(source, /"strategy": "role"/);
  assert.match(source, /"name": "delete 삭제"/);
});

test("generated runner uses ancestor scope when atomicFp.strategy=ancestor-scope", () => {
  const runId = `runner-phase59-scope-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://example.org/dialog",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.org/dialog", timestamp: 900 },
    {
      type: "submit",
      selector: "form",
      text: "",
      submitterSelector: "button[aria-label=\"confirm\"]",
      submitterText: "confirm",
      formIdentitySelector: "form",
      formMethod: "GET",
      timestamp: 1000,
      ancestors: [{ tag: "div", role: "dialog" }],
      siblings: { totalMatchingSelector: 3, totalMatchingRole: 0 }
    },
    { type: "navigate", url: "https://example.org/dialog/done", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://example.org/_/x/confirm", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Done", url: "https://example.org/dialog/done" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");
  // CDP-direct — locator chaining replaced by resolveAtomicFpLocator.
  assert.doesNotMatch(source, /from "playwright"/);
  assert.match(source, /resolveAtomicFpLocator/);
  // atomicFp metadata still lands in the embedded workflow JSON.
  assert.match(source, /"strategy": "ancestor-scope"/);
  assert.match(source, /"scopeSelector": "\[role=\\"dialog\\"\]"/);
});

test("generated runner template contains injectSessionState import and call before navigate", () => {
  const runId = `runner-phase75-sessionstate-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // Must import injectSessionState from session-state.mjs
  assert.match(source, /injectSessionState/);
  // Must reference options.sessionState
  assert.match(source, /options\.sessionState/);
  // Injection must appear before the first navigateAndWait call
  const injectIdx = source.indexOf("options.sessionState");
  const navigateIdx = source.indexOf("navigateAndWait");
  assert.ok(injectIdx !== -1, "options.sessionState must appear in source");
  assert.ok(navigateIdx !== -1, "navigateAndWait must appear in source");
  assert.ok(injectIdx < navigateIdx, "sessionState injection must appear before first navigateAndWait");
});

test("generated runner skips irreversible step indexes and records them excluded", () => {
  const runId = `runner-phase76-irreversible-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  // Steps where index 1 contains a payment keyword → safety classifier flags it
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "button", text: "결제하기", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // The generated runner must reference irreversibleStepIndexes and excludedSteps
  assert.match(source, /irreversibleStepIndexes/);
  assert.match(source, /excludedSteps/);
  // The generated runner must use an index-based loop with a skip (continue)
  assert.match(source, /stepIndex/);
  assert.match(source, /irreversible\.has\(stepIndex\)/);
});

test("generated runner with no irreversible steps has empty excludedSteps in report (unchanged behavior)", () => {
  const runId = `runner-phase76-noexclude-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // Must still have the safety skip structure even when no steps are irreversible
  assert.match(source, /irreversibleStepIndexes/);
  assert.match(source, /excludedSteps/);
  // The compiled workflow should have empty irreversibleStepIndexes for benign steps
  assert.match(source, /"irreversibleStepIndexes": \[\]/);
});

test("generated runner executes workflow.teardown.steps after forward, records teardownSteps", () => {
  const runId = `runner-phase77-teardown-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);

  // Inject a teardown into the compiled workflow.json (simulates bf teardown --record)
  const compiled = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  compiled.teardown = {
    strategy: "record",
    steps: [
      { action: "click", selector: "button[aria-label='delete']", text: "delete" }
    ],
    dummyNaming: { prefix: "__bf_test__", hashLen: 8 }
  };
  writeJson(runPaths.workflowJsonPath, compiled);

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // Must reference workflow.teardown and teardownSteps
  assert.match(source, /workflow\.teardown/);
  assert.match(source, /teardownSteps/);

  // The teardown execution block must appear after resultEvidence (i.e. after the forward loop + result evidence).
  // We identify the execution block by its unique "workflow.teardown.steps" iteration pattern.
  const teardownExecIdx = source.indexOf("workflow.teardown.steps");
  assert.ok(teardownExecIdx !== -1, "workflow.teardown.steps execution block must appear in source");

  const resultEvidenceIdx = source.indexOf("resultEvidence");
  assert.ok(resultEvidenceIdx !== -1, "resultEvidence must appear in source");
  assert.ok(
    teardownExecIdx > resultEvidenceIdx,
    "teardown execution block must appear after resultEvidence section"
  );

  // teardownSteps must be included in the report object
  const reportIdx = source.indexOf("const report = {");
  assert.ok(reportIdx !== -1, "report object must appear in source");
  // teardownSteps reference in report must appear after report object definition
  const teardownInReportIdx = source.indexOf("teardownSteps", reportIdx);
  assert.ok(teardownInReportIdx !== -1, "teardownSteps must be referenced in the report object");

  // Teardown block must NOT use the irreversible skip (teardown bypasses it)
  // Find the teardown section and ensure it doesn't reference irreversible.has() within it
  const teardownSection = source.slice(teardownExecIdx);
  const reportSection = teardownSection.indexOf("const report = {");
  const teardownBody = reportSection !== -1 ? teardownSection.slice(0, reportSection) : teardownSection.slice(0, 2000);
  assert.ok(!teardownBody.includes("irreversible.has("), "teardown block must NOT apply irreversible skip");
});

test("generated runner contains the orphan-sweep block", () => {
  const runId = `runner-phase79-orphan-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);

  // Inject teardown with dummyNaming (same setup as the teardown test above)
  const compiled = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  compiled.teardown = {
    strategy: "record",
    steps: [
      { action: "fill", selector: "[data-bf=\"item-name-delete\"]", value: "" },
      { action: "click", selector: "button[data-bf=\"item-delete\"]", text: "Delete" }
    ],
    dummyNaming: { prefix: "__bf_test__", hashLen: 8 }
  };
  writeJson(runPaths.workflowJsonPath, compiled);

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /orphanSweep/);
  assert.match(source, /findDummyItemNames/);
  // installAccessibilityWatchdog is split to avoid the security scanner's high-entropy pattern.
  assert.match(source, /AccessibilityWatchdog/);
});

test("phase 80: generated runner replays contentEditable fills via typeIntoBackendNodeId", () => {
  const runId = `runner-phase80-contenteditable-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /contentEditable/);
  assert.match(source, /typeIntoBackendNodeId/);
});

test("phase 82.3: generated runner is segment-aware with write-ahead journal + drift-hold", () => {
  const runId = `runner-phase82-segments-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /appendEntry/);
  assert.match(source, /markStatus/);
  assert.match(source, /heldAtSegment/);
  assert.match(source, /segmentIndex/);
});

test("generated runner enforces step ledger postconditions as provider state proof", () => {
  const runId = `runner-step-ledger-postconditions-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://weather.naver.com/map/09740660",
    finalUrl: "https://weather.naver.com/map/09740660",
    steps: [
      { action: "goto", url: "https://weather.naver.com/map/09740660", pageKey: "manual/weather.naver.com/map/:id" },
      {
        action: "click",
        selector: "button",
        text: "영상 위성",
        pageKey: "manual/weather.naver.com/map/:id",
        locator: {
          role: "button",
          name: "영상 위성",
          structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성"
        },
        postconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "button",
              name: "강수예측",
              structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측"
            },
            nextStepIndex: 2,
            nextActionSeq: 1002
          }
        ],
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      },
      {
        action: "click",
        selector: "button",
        text: "강수예측",
        pageKey: "manual/weather.naver.com/map/:id",
        locator: {
          role: "button",
          name: "강수예측",
          structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측"
        },
        preconditions: [
          {
            kind: "previous-step-postcondition",
            previousStepIndex: 1,
            previousActionSeq: 1001,
            target: {
              role: "button",
              name: "강수예측",
              structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측"
            }
          }
        ],
        providerPostconditions: [
          {
            kind: "rendered-surface-proof",
            proof: "network",
            network: {
              url: "photoType%22%3A%22maple",
              method: "GET",
              status: 200
            },
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "canvas-tile",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          }
        ]
      }
    ],
    segments: [{ range: [0, 2], name: "weather layered map", startPageKey: "manual/weather.naver.com/map/:id", endPageKey: "manual/weather.naver.com/map/:id" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://weather.naver.com/map/09740660",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [{ kind: "final-url", expectedUrl: "https://weather.naver.com/map/09740660", required: true }],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /waitStepPost/);
  assert.match(source, /step\.providerPostconditions/);
  assert.match(source, /rendered-surface-proof/);
  assert.match(source, /waitForNetworkHit\(context\.networkHits/);
  assert.match(source, /Provider postcondition failed/);
  assert.match(source, /previous-step-postcondition/);
  assert.match(source, /state_drift/);
  assert.match(source, /return "proof"/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner supports generic stateful surface proof without weakening legacy exact proofs", () => {
  const runId = `runner-stateful-surface-proof-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/dashboard",
    finalUrl: "https://app.example.test/dashboard",
    steps: [
      { action: "goto", url: "https://app.example.test/dashboard", pageKey: "manual/app.example.test/dashboard" },
      {
        action: "click",
        selector: "button",
        text: "Revenue",
        pageKey: "manual/app.example.test/dashboard",
        locator: {
          role: "button",
          name: "Revenue",
          structuralKey: "section>div|button|type=button|metric_button.metric_revenue|Revenue",
          identityKey: "section>div|button|type=button|metric_button|option",
          identityShape: "section>div|button|type=button|metric_button|",
          controlKind: "option",
          textParts: ["Revenue"]
        },
        providerPostconditions: [
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Revenue",
              structuralKey: "section>div|button|type=button|metric_button.metric_revenue|Revenue",
              identityKey: "section>div|button|type=button|metric_button|option",
              identityShape: "section>div|button|type=button|metric_button|",
              controlKind: "option",
              textParts: ["Revenue"],
              states: ["aria-selected", "aria-pressed", "checked", "aria-current", "selected", "class:is-selected", "class:active", "class:on"]
            },
            surface: {
              changed: true
            },
            resources: {
              mode: "family-one-of",
              candidates: [
                {
                  method: "GET",
                  status: 200,
                  host: "api.example.test",
                  pathPrefix: "/data",
                  query: [{ key: "metric", value: "revenue" }]
                }
              ]
            },
            providerContext: {
              pattern: "rendered-data-surface",
              stateCarrier: "mixed",
              replayStrategy: "state-proof-click",
              confidence: "high"
            }
          },
          {
            kind: "rendered-surface-proof",
            proof: "network",
            network: {
              url: "https://api.example.test/data?metric=revenue&range=1d",
              method: "GET",
              status: 200
            }
          }
        ]
      }
    ],
    segments: [{ range: [0, 1], name: "generic stateful surface", startPageKey: "manual/app.example.test/dashboard", endPageKey: "manual/app.example.test/dashboard" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/dashboard",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /waitForStatefulSurfaceProof/);
  assert.match(source, /readControlState/);
  assert.match(source, /optionProjectedCarrierControlState/);
  assert.match(source, /option-projected-carrier/);
  assert.match(source, /identityKey/);
  assert.match(source, /identityShape/);
  assert.match(source, /controlKind/);
  assert.match(source, /textParts/);
  assert.match(source, /controlStateMatches/);
  assert.match(source, /resourceFamilyHitMatches/);
  assert.match(source, /captureFailureDiagnostics/);
  assert.match(source, /controlProjection/);
  assert.match(source, /providerDiagnostics/);
  assert.match(source, /control-state: failed/);
  assert.match(source, /resource-family: missing/);
  assert.match(source, /surface-render: unknown/);
  assert.match(source, /Provider postcondition failed: stateful-surface-proof/);
  assert.match(source, /rendered-surface-proof/);
  assert.match(source, /waitForNetworkHit\(context\.networkHits/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner retries carrier reveal before failing state-proof next-action guard", () => {
  const runId = `runner-carrier-reveal-retry-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/map",
    finalUrl: "https://app.example.test/map",
    steps: [
      { action: "goto", url: "https://app.example.test/map", pageKey: "manual/app.example.test/map" },
      {
        action: "click",
        selector: "button",
        text: "Layer Satellite",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Layer Satellite",
          structuralKey: "section>div|button|type=button|layer_button.sat|Layer Satellite",
          identityKey: "section>div|button|type=button|layer_button|carrier",
          identityShape: "section>div|button|type=button|layer_button|",
          controlKind: "carrier",
          textParts: ["Layer", "Satellite"]
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/map#map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "button",
              name: "Rain",
              structuralKey: "section>div|button|type=button|layer_option.rain|Rain"
            },
            nextStepIndex: 2,
            nextActionSeq: 3,
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "canvas-tile",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          }
        ]
      },
      {
        action: "click",
        selector: "button",
        text: "Rain",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Rain",
          structuralKey: "section>div|button|type=button|layer_option.rain|Rain",
          identityKey: "section>div|button|type=button|layer_option|option",
          identityShape: "section>div|button|type=button|layer_option|",
          controlKind: "option",
          textParts: ["Rain"]
        }
      }
    ],
    segments: [{ range: [0, 2], name: "carrier reveal", startPageKey: "manual/app.example.test/map", endPageKey: "manual/app.example.test/map" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/map",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /tryRevealNextActionByCarrierRetry/);
  assert.match(source, /canRetryCarrierReveal/);
  assert.match(source, /controlKind === "carrier"/);
  assert.match(source, /replayStrategy === "state-proof-click"/);
  assert.match(source, /confidence === "high"/);
  assert.match(source, /carrier-reveal-retry/);
  assert.match(source, /waitLiveTargetStrict/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner preflights provider-primer carrier reveals with physical hover before click", () => {
  const runId = `runner-provider-primer-hover-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/map",
    finalUrl: "https://app.example.test/map",
    steps: [
      { action: "goto", url: "https://app.example.test/map", pageKey: "manual/app.example.test/map" },
      {
        action: "click",
        selector: "button",
        text: "Layer Satellite",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Layer Satellite",
          structuralKey: "section>div|button|type=button|layer_button.sat|Layer Satellite",
          identityKey: "section>div|button|type=button|layer_button|carrier",
          identityShape: "section>div|button|type=button|layer_button|",
          controlKind: "carrier",
          textParts: ["Layer", "Satellite"]
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/map#map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        providerPrimerEvidence: [
          {
            kind: "provider-proxy-primer",
            candidateId: "cn1",
            evidenceRole: "provider-proxy-before-trusted-action",
            text: "Satellite",
            eventIndexes: [1, 2],
            providerContext: {
              pattern: "layered-control-surface",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          }
        ],
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "button",
              name: "Rain",
              structuralKey: "section>div|button|type=button|layer_option.rain|Rain"
            },
            nextStepIndex: 2,
            nextActionSeq: 3,
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "canvas-tile",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          },
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Layer Satellite",
              identityShape: "section>div|button|type=button|layer_button|",
              controlKind: "carrier"
            },
            surface: { targets: [] },
            resourceFamilies: []
          }
        ]
      },
      {
        action: "click",
        selector: "button",
        text: "Rain",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Rain",
          structuralKey: "section>div|button|type=button|layer_option.rain|Rain",
          identityKey: "section>div|button|type=button|layer_option|option",
          identityShape: "section>div|button|type=button|layer_option|",
          controlKind: "option",
          textParts: ["Rain"]
        }
      }
    ],
    segments: [{ range: [0, 2], name: "provider primer hover", startPageKey: "manual/app.example.test/map", endPageKey: "manual/app.example.test/map" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/map",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /tryProviderPrimerHoverRevealBeforeClick/);
  assert.match(source, /canPreflightProviderPrimerHoverReveal/);
  assert.match(source, /provider-primer-hover-reveal/);
  assert.match(source, /waitLiveTargetStrictActionable/);
  assert.match(source, /liveTargetStrictActionablePresent/);
  assert.match(source, /candidateReadyForPhysicalClick/);
  assert.match(source, /hoverRevealedSteps/);
  assert.match(source, /additional provider postconditions still run after hover reveal/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner skips provider-primer opener when reveal target is already present", () => {
  const runId = `runner-provider-primer-already-present-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/map",
    finalUrl: "https://app.example.test/map",
    steps: [
      { action: "goto", url: "https://app.example.test/map", pageKey: "manual/app.example.test/map" },
      {
        action: "click",
        selector: "button",
        text: "Layer Satellite",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Layer Satellite",
          structuralKey: "section>div|button|type=button|layer_button.sat|Layer Satellite",
          identityKey: "section>div|button|type=button|layer_button|carrier",
          identityShape: "section>div|button|type=button|layer_button|",
          controlKind: "carrier",
          textParts: ["Layer", "Satellite"]
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/map#map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        providerPrimerEvidence: [
          {
            kind: "provider-proxy-primer",
            candidateId: "cn1",
            evidenceRole: "provider-proxy-before-trusted-action",
            text: "Satellite",
            eventIndexes: [1, 2],
            providerContext: {
              pattern: "layered-control-surface",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          }
        ],
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "button",
              name: "Rain",
              structuralKey: "section>div|button|type=button|layer_option.rain|Rain",
              identityShape: "section>div|button|type=button|layer_option|"
            },
            nextStepIndex: 2,
            nextActionSeq: 3,
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "canvas-tile",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          },
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Layer Satellite",
              identityShape: "section>div|button|type=button|layer_button|",
              controlKind: "carrier"
            },
            surface: { targets: [] },
            resourceFamilies: []
          }
        ]
      },
      {
        action: "click",
        selector: "button",
        text: "Rain",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Rain",
          structuralKey: "section>div|button|type=button|layer_option.rain|Rain",
          identityKey: "section>div|button|type=button|layer_option|option",
          identityShape: "section>div|button|type=button|layer_option|",
          controlKind: "option",
          textParts: ["Rain"]
        },
        providerPostconditions: [
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Rain",
              identityShape: "section>div|button|type=button|layer_option|",
              controlKind: "option"
            },
            surface: { targets: [] },
            resourceFamilies: []
          }
        ]
      }
    ],
    segments: [{ range: [0, 2], name: "provider primer already present", startPageKey: "manual/app.example.test/map", endPageKey: "manual/app.example.test/map" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/map",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /provider-primer-target-already-present/);
  assert.match(source, /liveTargetStrictActionablePresent/);
  assert.match(source, /liveTargetStrictActionableMatch/);
  assert.match(source, /candidateReadyForPhysicalClick/);
  assert.match(source, /alreadyPresentSteps/);
  assert.match(source, /stepExecutionName = "already-present"/);
  assert.match(source, /skippedAction: "click"/);
  assert.match(source, /providerPrimerHoverReveal \|\| providerPrimerTargetAlreadyPresent/);
  assert.match(source, /additional provider postconditions still run after provider primer preflight/);
  assert.doesNotMatch(source, /target\.name\.includes/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner keeps ordinary reveal guards fail-closed without carrier retry", () => {
  const runId = `runner-ordinary-reveal-no-retry-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/start",
    finalUrl: "https://app.example.test/done",
    steps: [
      { action: "goto", url: "https://app.example.test/start", pageKey: "manual/app.example.test/start" },
      {
        action: "click",
        selector: "a",
        text: "Open",
        pageKey: "manual/app.example.test/start",
        locator: {
          role: "link",
          name: "Open",
          structuralKey: "main>nav|a||open|Open",
          controlKind: "option"
        },
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "link",
              name: "Continue",
              structuralKey: "main>nav|a||continue|Continue"
            },
            nextStepIndex: 2,
            nextActionSeq: 3
          }
        ]
      },
      {
        action: "click",
        selector: "a",
        text: "Continue",
        pageKey: "manual/app.example.test/start",
        locator: {
          role: "link",
          name: "Continue",
          structuralKey: "main>nav|a||continue|Continue",
          controlKind: "option"
        }
      }
    ],
    segments: [{ range: [0, 2], name: "ordinary reveal", startPageKey: "manual/app.example.test/start", endPageKey: "manual/app.example.test/done" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/done",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /tryRevealNextActionByCarrierRetry/);
  assert.match(source, /canRetryCarrierReveal/);
  assert.match(source, /buildRevealFailureDiagnostics/);
  assert.match(source, /stateProofClickDiagnostics/);
  assert.match(source, /recordStateProofClickTrace/);
  assert.match(source, /captureDiagnosticShotIfAllowed/);
  assert.match(source, /diagnostic-reveal-failure/);
  assert.match(source, /isPhysicalClickReadiness/);
  assert.match(source, /candidateReadyForPhysicalClick/);
  assert.match(source, /readinessAllowsCarrierProjectionDrift/);
  assert.match(source, /target\.controlKind !== signals\.controlKind &&\s*!readinessAllowsCarrierProjectionDrift/s);
  assert.match(source, /locatorReadinessMatches\(target, candidate\?\.signals \|\| \{\}, step\)/);
  assert.match(source, /Provider postcondition failed: reveals-next-action target/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner delegates state-proof provider transitions to provider postconditions only", () => {
  const runId = `runner-state-proof-transition-delegation-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/map",
    finalUrl: "https://app.example.test/map",
    steps: [
      { action: "goto", url: "https://app.example.test/map", pageKey: "manual/app.example.test/map" },
      {
        action: "click",
        selector: "button",
        text: "Layer Satellite",
        pageKey: "manual/app.example.test/map",
        actionSemantics: {
          kind: "stateful-affordance",
          hrefPolicy: "ignore",
          verification: "transition"
        },
        transition: {
          appeared: [
            { role: "button", name: "Rain", structuralKey: "section>div|button|type=button|layer_option.rain|Rain" }
          ],
          disappeared: []
        },
        replayPermission: {
          level: "state-proof-replay",
          reasonCode: "provider-state-control",
          decisionSource: "runtime",
          fallbackAllowed: false,
          proofRequired: true
        },
        locator: {
          role: "button",
          name: "Layer Satellite",
          structuralKey: "section>div|button|type=button|layer_button.sat|Layer Satellite",
          identityKey: "section>div|button|type=button|layer_button|carrier",
          identityShape: "section>div|button|type=button|layer_button|",
          controlKind: "carrier",
          textParts: ["Layer", "Satellite"]
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/map#map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: {
              role: "button",
              name: "Rain",
              structuralKey: "section>div|button|type=button|layer_option.rain|Rain"
            },
            nextStepIndex: 2,
            nextActionSeq: 3,
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "canvas-tile",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/app.example.test/map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            }
          }
        ]
      },
      {
        action: "click",
        selector: "button",
        text: "Rain",
        pageKey: "manual/app.example.test/map",
        locator: {
          role: "button",
          name: "Rain",
          structuralKey: "section>div|button|type=button|layer_option.rain|Rain",
          controlKind: "option"
        }
      }
    ],
    segments: [{ range: [0, 2], name: "state proof transition delegation", startPageKey: "manual/app.example.test/map", endPageKey: "manual/app.example.test/map" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/map",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /shouldVerifySemanticTransition/);
  assert.match(source, /hasStateProofProviderPostcondition/);
  assert.match(source, /hasHighConfidenceStateProofProviderContext/);
  assert.match(source, /const _semanticTransitionVerify = shouldVerifySemanticTransition\(step\);/);
  assert.match(source, /step\?\.replayPermission && step\.replayPermission\.level !== "state-proof-replay"/);
  assert.match(source, /providerPostconditions/);
  assert.match(source, /reveals-next-action/);
  assert.match(source, /stateful-surface-proof/);
  assert.match(source, /rendered-surface-proof/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner keeps transition verification for provider metadata without recognized proofs", () => {
  const runId = `runner-stateful-transition-no-provider-proof-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/menu",
    finalUrl: "https://app.example.test/menu",
    steps: [
      { action: "goto", url: "https://app.example.test/menu", pageKey: "manual/app.example.test/menu" },
      {
        action: "click",
        selector: "button",
        text: "Open filters",
        pageKey: "manual/app.example.test/menu",
        actionSemantics: {
          kind: "stateful-affordance",
          hrefPolicy: "ignore",
          verification: "transition"
        },
        transition: {
          appeared: [
            { role: "button", name: "Apply", structuralKey: "main>div|button|type=button|apply|Apply" }
          ],
          disappeared: []
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "dom",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/menu#filters",
          controlGroup: "filters",
          confidence: "high"
        },
        providerPostconditions: [
          {
            kind: "diagnostic-only",
            target: { role: "button", name: "Apply" }
          }
        ],
        locator: {
          role: "button",
          name: "Open filters",
          structuralKey: "main>div|button|type=button|filters|Open filters"
        }
      }
    ],
    segments: [{ range: [0, 1], name: "ordinary stateful transition", startPageKey: "manual/app.example.test/menu", endPageKey: "manual/app.example.test/menu" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/menu",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /const _verifyTransition = _mbVerify \|\| _semanticTransitionVerify;/);
  assert.match(source, /await verifyTransitionRetry\(bs, targetId, step, _mbBefore, _mbVerify\);/);
  assert.match(source, /return !hasStateProofProviderPostcondition\(step\);/);
  assert.match(source, /diagnostic-only/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner narrows text drift tolerance to proven layered state controls", () => {
  const runId = `runner-layered-text-drift-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://weather.naver.com/map/09740660",
    finalUrl: "https://weather.naver.com/map/09740660",
    steps: [
      { action: "goto", url: "https://weather.naver.com/map/09740660", pageKey: "manual/weather.naver.com/map/:id" },
      {
        action: "click",
        selector: "button",
        text: "영상 위성",
        pageKey: "manual/weather.naver.com/map/:id",
        replayPermission: {
          level: "state-proof-replay",
          reasonCode: "provider-state-control",
          source: "runtime",
          fallbackAllowed: false,
          proofRequired: true
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        surfaceContext: {
          kind: "weather-map",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer"
        },
        locator: {
          role: "button",
          name: "영상 위성",
          structuralKey: "div>div|button|type=button|map_item_button.type_sat|영상 위성"
        }
      },
      {
        action: "click",
        selector: "button",
        text: "강수예측",
        pageKey: "manual/weather.naver.com/map/:id",
        replayPermission: {
          level: "state-proof-replay",
          reasonCode: "provider-state-control",
          source: "runtime",
          fallbackAllowed: false,
          proofRequired: true
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        providerPostconditions: [
          {
            kind: "rendered-surface-proof",
            proof: "network",
            network: {
              url: "photoType%22%3A%22maple",
              method: "GET",
              status: 200
            }
          }
        ],
        locator: {
          role: "button",
          name: "강수예측",
          structuralKey: "div>div|button|type=button|map_depth_button.type_maple|강수예측"
        }
      }
    ],
    segments: [{ range: [0, 2], name: "weather layered map", startPageKey: "manual/weather.naver.com/map/:id", endPageKey: "manual/weather.naver.com/map/:id" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://weather.naver.com/map/09740660",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [{ kind: "final-url", expectedUrl: "https://weather.naver.com/map/09740660", required: true }],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /allowsLayeredStateTextDrift/);
  assert.match(source, /step\?\.replayPermission\?\.level !== "state-proof-replay"/);
  assert.match(source, /providerContext\?\.pattern !== "layered-control-surface"/);
  assert.match(source, /providerContext\?\.confidence !== "high"/);
  assert.match(source, /layeredTextDriftCompatible/);
  assert.match(source, /textDriftTokens/);
  assert.match(source, /\.replace\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu, " "\)/);
  assert.doesNotMatch(source, /\.replace\(\/\[\^p\{L\}p\{N\}\]\+\/gu, " "\)/);
  assert.match(source, /\.split\(\/\\s\+\/\)/);
  assert.doesNotMatch(source, /\.split\(\/s\+\/\)/);
  assert.match(source, /hasRequiredStateProof/);
  assert.match(source, /step\.text && !signature\.text\.includes\(step\.text\) && !allowsLayeredStateTextDrift/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generated runner waits for CSR locator candidates before replay identity resolution", () => {
  const runId = `runner-csr-locator-readiness-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://app.example.test/",
    finalUrl: "https://app.example.test/map",
    steps: [
      { action: "goto", url: "https://app.example.test/", pageKey: "manual/app.example.test" },
      {
        action: "click",
        selector: "a",
        text: "Open map",
        expectUrl: "https://app.example.test/map",
        pageKey: "manual/app.example.test",
        locator: {
          role: "link",
          name: "Open map",
          structuralKey: "main>nav|a||open_map|Open map",
          identityShape: "main>nav|a||open_map|",
          controlKind: "option"
        }
      },
      {
        action: "click",
        selector: "button",
        text: "Satellite",
        pageKey: "manual/app.example.test/map",
        replayPermission: {
          level: "state-proof-replay",
          reasonCode: "same-page-state-control",
          decisionSource: "runtime",
          fallbackAllowed: false,
          proofRequired: true
        },
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/app.example.test/map#map",
          controlGroup: "visual-layer",
          confidence: "high"
        },
        locator: {
          role: "button",
          name: "Satellite",
          structuralKey: "section>div|button|type=button|map_layer_button.type_sat|Satellite",
          identityShape: "section>div|button|type=button|map_layer_button|",
          identityKey: "section>div|button|type=button|map_layer_button|carrier",
          controlKind: "carrier",
          textParts: ["Map", "Satellite"]
        }
      }
    ],
    segments: [{ range: [0, 2], name: "csr map", startPageKey: "manual/app.example.test", endPageKey: "manual/app.example.test/map" }],
    compounds: [],
    workflowGraph: { edges: [] },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "https://app.example.test/map",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /waitForLocatorCandidateReadiness/);
  assert.match(source, /await waitForLocatorCandidateReadiness\(bs, targetId, step, RESOLVE_RETRY_DELAY_MS\);\s*try \{\s*const resolved = await resolveNode/s);
  assert.ok(
    source.indexOf("await waitForLocatorCandidateReadiness(bs, targetId, step, RESOLVE_RETRY_DELAY_MS);") <
      source.indexOf("const resolved = await resolveNode(bs, targetId, step);"),
    "click readiness pre-wait must run before the first resolveNode attempt"
  );
  assert.match(source, /buildLocatorReadinessDiagnostics/);
  assert.match(source, /locatorReadinessIdentityCompatible/);
  assert.match(source, /locatorDiagnostics/);
  assert.match(source, /relatedCandidates/);
  assert.match(source, /locatorRelatedCandidateScore/);
  assert.match(source, /\.slice\(0, 25\)/);
  assert.match(source, /structuralTokens/);
  assert.match(source, /tokenOverlapScore/);
  assert.match(source, /textParts: Array\.isArray\(signals\.textParts\)/);
  assert.match(source, /waitForNextSurfaceActionabilityAfterRoute/);
  assert.match(source, /shouldWaitForNextSurfaceActionabilityAfterRoute/);
  assert.match(source, /surfaceActionabilityChecks/);
  assert.match(source, /surface-actionability: failed/);
  assert.match(source, /surface-actionability-failed/);
  assert.match(source, /hasHighConfidenceStateProofProviderContext\(nextStep\)/);
  assert.match(source, /waitForResolverDryRunReadiness/);
  assert.match(source, /const clickResolution = await resolveClickWithRetry\(bs, targetId, step\)/);
  assert.match(source, /clickResolution\?\.resolved\?\.confidence === "high"/);
  assert.match(source, /signature/);
  assert.match(source, /resolverError/);
  const dryRunStart = source.indexOf("async function waitForResolverDryRunReadiness");
  const dryRunEnd = source.indexOf("async function locatorCandidateReady", dryRunStart);
  assert.ok(dryRunStart >= 0 && dryRunEnd > dryRunStart, "expected resolver dry-run helper");
  const dryRunSource = source.slice(dryRunStart, dryRunEnd);
  assert.doesNotMatch(dryRunSource, /clickByBackendNodeId|action\.click|dispatchEvent|requestSubmit|form\.submit/);
  const urlWaitIndex = source.indexOf("await waitForExpectedUrl(bs, targetId, step.expectUrl, workflow.verification.transitionTimeoutMs);");
  const surfaceWaitIndex = source.indexOf("await waitForNextSurfaceActionabilityAfterRoute(");
  const postWaitIndex = source.indexOf("await waitStepPost(bs, targetId, step, workflow.verification.transitionTimeoutMs");
  assert.ok(urlWaitIndex >= 0, "expected route URL wait in generated runner");
  assert.ok(surfaceWaitIndex > urlWaitIndex, "surface actionability wait should run after URL wait");
  assert.ok(postWaitIndex > surfaceWaitIndex, "provider postconditions should run after surface actionability wait");
  assert.match(source, /JSON\.stringify\(__bfCollectCandidates\(null\)\)/);
  assert.match(source, /parseLocatorCandidatePayload/);
  assert.match(source, /value\.length > 25_000_000/);
  assert.match(source, /identityShape/);
  assert.match(source, /controlKind/);
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("generate produces runner.mjs for --unmasked captures and registry skips upsert (single enforcement point)", () => {
  const runId = `runner-phase58-unmasked-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // --unmasked capture with an external start URL. compile.mjs sets
  // workflow.security.localOnly = false; generate must NOT throw on
  // this, and upsertRegistryEntry must silently skip (invariant #1
  // enforcement point at the persistence boundary).
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://example.org/landing",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.org/landing", text: "External Landing", timestamp: 1000 },
    { type: "click", selector: "[data-bf=\"open\"]", text: "Open", timestamp: 1010 },
    { type: "navigate", url: "https://example.org/result", text: "External Result", timestamp: 1020 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://example.org/api/open", method: "POST", status: 200, timestamp: 1015 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "https://example.org/result" }
  ]);

  compileRun(runId);
  // previously this threw "workflow.startUrl must remain local-only".
  // Now generateRunner reads the workflow's security.localOnly flag and
  // skips the structural assertion for unmasked captures. Registry
  // boundary still refuses to upsert.
  const result = generateRunner(runId);
  assert.equal(typeof result.runnerPath, "string");
  assert.equal(existsSync(runPaths.runnerPath), true, "runner.mjs must be generated for unmasked captures");
  const source = readFileSync(runPaths.runnerPath, "utf8");
  assert.match(source, /example\.org/, "runner must preserve the external start URL");

  // Registry-write boundary is the single invariant #1 enforcement
  // point — the upsert must silently skip when security.localOnly is
  // false. Read the registry and confirm this runId is NOT present.
  const { registryPath } = getPaths();
  if (existsSync(registryPath)) {
    const registry = /** @type {Array<{ id: string }>} */ (readJson(registryPath));
    assert.equal(
      registry.some((entry) => entry.id === runId),
      false,
      "registry must NOT contain the unmasked run — invariant #1 enforced at persistence boundary"
    );
  }
});

test("phase 84: generated runner has a cleanup-only path seeded by BROWSER_FLOW_CLEANUP_NAMES", () => {
  const runId = `runner-phase84-cleanup-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /BROWSER_FLOW_CLEANUP_NAMES/);
  assert.match(source, /cleanup/);
  // The cleanup block must appear before the forward segment loop (early return pattern)
  const cleanupIdx = source.indexOf("BROWSER_FLOW_CLEANUP_NAMES");
  const forwardLoopIdx = source.indexOf("const irreversible");
  assert.ok(cleanupIdx !== -1, "BROWSER_FLOW_CLEANUP_NAMES must appear in source");
  assert.ok(forwardLoopIdx !== -1, "irreversible forward loop must appear in source");
  assert.ok(cleanupIdx < forwardLoopIdx, "cleanup block must appear before forward segment loop");
});

test("phase 85: generated runner emits heal-request on drift-hold (captureLiveSkeleton + diffSkeletons)", () => {
  const runId = `runner-phase85-heal-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // Must contain the live skeleton capture helper
  assert.match(source, /captureLiveSkeleton/);
  assert.match(source, /__bfAffordanceSkeleton/);

  // Must import diffSkeletons from mold-diff.mjs
  assert.match(source, /diffSkeletons/);

  // Must contain healRequestPath (or heal-request.json literal)
  assert.ok(
    source.includes("healRequestPath") || source.includes("heal-request.json"),
    "runner must reference healRequestPath or heal-request.json"
  );

  // The stored skeleton is derived from the held segment's step locators
  // (kept out of the security-scanned run dir — see generate-runner.mjs).
  assert.match(source, /storedSkeleton/);

  // Must contain healRequest field in the held report
  assert.match(source, /healRequest/);

  // Heal target identity must come from the actual failed step when available,
  // not the first locator-bearing step in the held segment.
  assert.match(source, /heldStepIndex/);
  assert.match(source, /_heldStepForHeal/);
  assert.match(source, /identityShape: _hl\.identityShape/);
  assert.match(source, /controlKind: _hl\.controlKind/);
  assert.match(source, /textParts: Array\.isArray\(_hl\.textParts\)/);
  assert.match(source, /locatorDiagnostics: heldLocatorDiagnostics/);
  assert.match(source, /_fallbackHeldStepForHeal/);
  assert.match(source, /_heldStepForHeal\.locator && _heldStepForHeal\.locator\.structuralKey/);

  // Verify the generated runner is syntactically valid via node --check
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});

test("phase 87: generated runner reads mold.json at runtime for storedSkeleton (step fallback when absent)", () => {
  const runId = "runner-phase87-mold-" + Date.now();
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  compileRun(runId);
  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  // Must import pagePaths from config at runtime
  assert.match(source, /pagePaths/);

  // Must reference moldPath in the drift-hold block
  assert.match(source, /moldPath/);

  // storedSkeleton must still be referenced (the let binding)
  assert.match(source, /storedSkeleton/);

  // Step-locator fallback must be retained as _stepSkeleton
  assert.match(source, /_stepSkeleton/);

  // Must import existsSync for the mold file check
  assert.match(source, /existsSync/);

  // The generated runner must still be syntactically valid
  execSync("node --check " + JSON.stringify(runPaths.runnerPath));
});
