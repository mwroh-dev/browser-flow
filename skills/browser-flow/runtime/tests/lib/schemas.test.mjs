import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkflowArtifact,
  parseScoringResult,
  parseRouteIntentPreview,
  parseRouteIntentResult
} from "../../scripts/lib/schemas.mjs";

// Minimal valid WorkflowV1 base — all required fields populated.
// Used as a template for tests that need to extend the doc.
const BASE_WORKFLOW = {
  schemaVersion: 1,
  id: "test-id",
  fixture: "manual",
  startUrl: "https://example.com",
  finalUrl: "https://example.com",
  steps: [{ action: "goto", url: "https://example.com" }],
  verification: { expectedFinalUrl: "https://example.com" },
  security: { localOnly: true }
};

test("WorkflowArtifact accepts optional preconditions/teardown/safety", () => {
  const doc = {
    ...BASE_WORKFLOW,
    preconditions: [
      { kind: "login", site: "example.com", authMode: "human-bootstrap+keychain-session", sessionRef: "kc:example" }
    ],
    teardown: { strategy: "record", steps: [], dummyNaming: { prefix: "__bf_test__", hashLen: 8 } },
    safety: { irreversibleStepIndexes: [2], consentRequired: true, sandbox: { available: false, location: null } }
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.ok(result.preconditions != null);
  assert.equal(result.preconditions[0].kind, "login");
  assert.ok(result.teardown != null);
  assert.equal(result.teardown.strategy, "record");
  assert.ok(result.safety != null);
  assert.equal(result.safety.consentRequired, true);
});

test("WorkflowArtifact still accepts a doc with none of the new fields (additive-optional)", () => {
  const doc = { ...BASE_WORKFLOW };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.preconditions, undefined);
});

test("WorkflowArtifact accepts additive verification proofs", () => {
  const doc = {
    ...BASE_WORKFLOW,
    finalUrl: "https://example.com/map?id=abc&mode=rain",
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
        },
        {
          kind: "state-control",
          stepIndex: 1,
          controlText: "Rain",
          controlRole: "button",
          stateSignals: { selectedClass: "is-selected" },
          expectedSelected: true,
          required: true
        }
      ]
    }
  };

  const result = parseWorkflowArtifact(doc, "<test>");

  assert.equal(result.verification.expectedNetwork, null);
  assert.equal(result.verification.expectedEvidence, null);
  assert.ok(result.verification.proofs);
  assert.equal(result.verification.proofs[1].kind, "url-state");
  assert.equal(result.verification.proofs[2].kind, "state-control");
});

test("WorkflowArtifact accepts additive state-url intent plans", () => {
  const doc = {
    ...BASE_WORKFLOW,
    startUrl: "https://example.com/home",
    finalUrl: "https://example.com/map?id=abc&mode=rain",
    steps: [
      { action: "goto", url: "https://example.com/map?id=abc&mode=rain" }
    ],
    intentPlan: {
      strategy: "state-url",
      source: "route-intent",
      targetStateUrl: "https://example.com/map?id=abc&mode=rain",
      omittedStepIndexes: [1, 2],
      checkpointResolved: "route_intent_review",
      proofs: [
        {
          kind: "final-url",
          expectedUrl: "https://example.com/map?id=abc&mode=rain",
          required: true
        },
        {
          kind: "url-state",
          expectedUrl: "https://example.com/map?id=abc&mode=rain",
          params: [{ key: "mode", value: "rain" }],
          required: true
        }
      ]
    }
  };

  const result = parseWorkflowArtifact(doc, "<test>");

  assert.equal(result.intentPlan?.strategy, "state-url");
  assert.equal(result.intentPlan?.source, "route-intent");
  assert.deepEqual(result.intentPlan?.omittedStepIndexes, [1, 2]);
});

test("RouteIntentPreview validates state route review candidates", () => {
  const result = parseRouteIntentPreview({
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "ri1",
        strategy: "state-url",
        targetStateUrl: "https://example.com/map?id=abc&mode=rain",
        omittedSteps: [
          { stepIndex: 1, action: "click", text: "More", href: "/map?id=abc&mode=rain" }
        ],
        proofs: [
          {
            kind: "url-state",
            expectedUrl: "https://example.com/map?id=abc&mode=rain",
            params: [{ key: "mode", value: "rain" }],
            required: true
          }
        ],
        risks: ["omits captured DOM clicks"],
        recommendedAction: "confirm-state-route"
      }
    ]
  }, "<test>");

  assert.equal(result.status, "needs_review");
  assert.equal(result.suggestions[0].candidateId, "ri1");
  assert.equal(result.suggestions[0].recommendedAction, "confirm-state-route");
});

test("RouteIntentResult accepts only route intent verdicts", () => {
  const result = parseRouteIntentResult({
    schemaVersion: 1,
    runId: "route-intent-result",
    decisions: [
      { candidateId: "ri1", verdict: "confirm-state-route" },
      { candidateId: "ri2", verdict: "keep-dom-route" }
    ]
  }, "<test>");

  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[0].verdict, "confirm-state-route");
});

test("RouteIntentResult rejects capture-noise style verdicts", () => {
  assert.throws(
    () => parseRouteIntentResult({
      schemaVersion: 1,
      runId: "route-intent-invalid",
      decisions: [{ candidateId: "ri1", verdict: "exclude" }]
    }, "<test>"),
    /verdict|Invalid/i
  );
});

test("WorkflowArtifact accepts screenshotMode on security claims", () => {
  const doc = {
    ...BASE_WORKFLOW,
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotMode: "both",
      screenshotsPersisted: true
    }
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.security.screenshotMode, "both");
  assert.equal(result.security.screenshotsPersisted, true);
});

test("WorkflowArtifact rejects an unknown screenshotMode", () => {
  const doc = {
    ...BASE_WORKFLOW,
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotMode: "everywhere"
    }
  };
  assert.throws(() => parseWorkflowArtifact(doc, "<test>"), /screenshotMode|Invalid/i);
});

test("WorkflowArtifact accepts additive compound annotations", () => {
  const doc = {
    ...BASE_WORKFLOW,
    compounds: [
      {
        kind: "reveal-select",
        range: [1, 2],
        pageKey: "manual/example.com/home",
        surfaceKey: "manual/example.com/home#reveal:1",
        triggerStepIndex: 1,
        followupStepIndex: 2
      }
    ]
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.compounds?.[0]?.kind, "reveal-select");
  assert.equal(result.compounds?.[0]?.followupStepIndex, 2);
});

test("WorkflowArtifact accepts additive workflowGraph edges", () => {
  const doc = {
    ...BASE_WORKFLOW,
    workflowGraph: {
      edges: [
        {
          kind: "reveal",
          fromStepIndex: 1,
          toStepIndex: 2,
          pageKey: "manual/example.com/home",
          surfaceKey: "manual/example.com/home#reveal:1"
        }
      ]
    }
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.workflowGraph?.edges?.[0]?.kind, "reveal");
  assert.equal(result.workflowGraph?.edges?.[0]?.toStepIndex, 2);
});

test("WorkflowArtifact rejects unknown workflowGraph edge kinds", () => {
  const doc = {
    ...BASE_WORKFLOW,
    workflowGraph: {
      edges: [
        {
          kind: "teleport",
          fromStepIndex: 1,
          toStepIndex: 2
        }
      ]
    }
  };
  assert.throws(() => parseWorkflowArtifact(doc, "<test>"), /workflowGraph|kind|Invalid/i);
});

test("WorkflowArtifact accepts weather-map surfaceContext on steps", () => {
  const doc = {
    ...BASE_WORKFLOW,
    steps: [
      {
        action: "click",
        surfaceContext: {
          kind: "weather-map",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer"
        }
      }
    ]
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.steps[0].surfaceContext?.kind, "weather-map");
  assert.equal(result.steps[0].surfaceContext?.controlGroup, "visual-layer");
});

test("WorkflowArtifact accepts providerContext on steps", () => {
  const doc = {
    ...BASE_WORKFLOW,
    steps: [
      {
        action: "click",
        providerContext: {
          pattern: "layered-control-surface",
          stateCarrier: "canvas-tile",
          replayStrategy: "state-proof-click",
          surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
          controlGroup: "visual-layer",
          confidence: "high"
        }
      }
    ],
    verification: {
      expectedFinalUrl: "https://example.com",
      proofs: [
        {
          kind: "state-control",
          stepIndex: 0,
          providerContext: {
            pattern: "layered-control-surface",
            stateCarrier: "canvas-tile",
            replayStrategy: "state-proof-click",
            surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
            controlGroup: "visual-layer",
            confidence: "high"
          },
          required: true
        }
      ]
    }
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.steps[0].providerContext?.pattern, "layered-control-surface");
  assert.equal(result.steps[0].providerContext?.replayStrategy, "state-proof-click");
  assert.equal(result.verification.proofs[0].providerContext?.controlGroup, "visual-layer");
});

test("WorkflowArtifact rejects unknown providerContext patterns", () => {
  const doc = {
    ...BASE_WORKFLOW,
    steps: [
      {
        action: "click",
        providerContext: {
          pattern: "consumer-outcome",
          stateCarrier: "dom",
          replayStrategy: "state-proof-click"
        }
      }
    ]
  };
  assert.throws(() => parseWorkflowArtifact(doc, "<test>"), /providerContext|pattern|Invalid/i);
});

test("WorkflowArtifact rejects unknown surfaceContext kinds", () => {
  const doc = {
    ...BASE_WORKFLOW,
    steps: [
      {
        action: "click",
        surfaceContext: {
          kind: "spaceship-map",
          surfaceKey: "x",
          controlGroup: "visual-layer"
        }
      }
    ]
  };
  assert.throws(() => parseWorkflowArtifact(doc, "<test>"), /surfaceContext|kind|Invalid/i);
});

test("WorkflowArtifact rejects a malformed precondition (missing required sub-fields)", () => {
  const doc = { ...BASE_WORKFLOW, preconditions: [{ kind: "login" }] }; // missing site/authMode/sessionRef
  assert.throws(() => parseWorkflowArtifact(doc, "<test>"), /site|authMode|sessionRef|Invalid/i);
});

test("LocatorShape accepts disambiguation (weightOverrides/patternId/note) additively", () => {
  const doc = {
    ...BASE_WORKFLOW,
    steps: [{ action: "click", locator: { role: "link", href: "/y",
      disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 }, patternId: "nav-tab", note: "nav tab" } } }]
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  const locator = result.steps[0].locator;
  assert.ok(locator?.disambiguation, "disambiguation must survive parse");
  assert.equal(locator?.disambiguation?.patternId, "nav-tab");
  assert.deepEqual(locator?.disambiguation?.weightOverrides, { href: 1.5, structuralKey: 0.5 });
});

test("LocatorShape still parses without disambiguation (additive-optional)", () => {
  const doc = { ...BASE_WORKFLOW, steps: [{ action: "click", locator: { role: "link", href: "/y" } }] };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.steps[0].locator?.disambiguation, undefined);
});

test("parseScoringResult accepts a weightOverride result with optional generalizable", () => {
  const r = parseScoringResult({
    schemaVersion: 1, runId: "r1", stepIndex: 2,
    disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 }, note: "nav tab" },
    generalizable: { id: "nav-tab", match: { structuralKeyIncludes: "nav>", hasHref: true }, signalWeights: { href: 1.5, structuralKey: 0.5 } }
  }, "<test>");
  assert.equal(r.stepIndex, 2);
  assert.equal(r.disambiguation.weightOverrides.href, 1.5);
  assert.equal(/** @type {any} */ (r).generalizable.id, "nav-tab");
});

test("parseScoringResult rejects a result missing disambiguation", () => {
  assert.throws(() => parseScoringResult({ schemaVersion: 1, runId: "r1", stepIndex: 0 }, "<test>"));
});
