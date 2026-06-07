import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * @param {{
 *   runId: string,
 *   startUrl: string,
 *   finalUrl: string,
 *   baseUrl: string,
 *   transition: { refType: string, appeared: Array<{ role: string, name: string, structuralKey: string }>, disappeared: unknown[], changed: unknown[] }
 * }} options
 */
function writeRevealWorkflow({ runId, startUrl, finalUrl, baseUrl, transition }) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl,
    finalUrl,
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "[data-bf=\"expand\"]",
        text: "Expand menu",
        href: "/",
        locator: {
          role: "button",
          name: "Expand menu",
          structuralKey: "body>header>nav|a|role=button||Expand menu",
          href: "/",
          disambiguation: {
            weightOverrides: { href: 0, structuralKey: 0.5 }
          }
        },
        actionSemantics: {
          kind: "stateful-affordance",
          verification: "transition",
          hrefPolicy: "ignore",
          followupStepIndex: 2
        },
        transition
      },
      {
        action: "click",
        selector: "[data-bf=\"weather\"]",
        text: "Weather",
        href: `${baseUrl}/reveal/weather`,
        expectUrl: finalUrl,
        locator: {
          role: "link",
          name: "Weather",
          structuralKey: "body>header>nav>ul>li|a|||Weather",
          href: `${baseUrl}/reveal/weather`,
          disambiguation: {
            weightOverrides: { href: 1.5, structuralKey: 0.5 }
          }
        }
      }
    ],
    segments: [
      {
        range: [0, 2],
        startPageKey: "reveal",
        endPageKey: "reveal/weather",
        name: "open-weather"
      }
    ],
    verification: {
      expectedFinalUrl: finalUrl,
      expectedNetwork: null,
      expectedEvidence: { selector: "[data-bf-evidence=\"reveal-weather\"]", textIncludes: "Weather detail" },
      transitionTimeoutMs: 8000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  });
  return runPaths;
}

test("verify-stateful-affordance: reveal control ignores stale href and proves the transition before clicking revealed link", { timeout: 120000 }, async () => {
  const runId = `reveal-e2e-${Date.now()}`;
  const server = await startFixtureServer();
  try {
    const baseUrl = server.baseUrl;
    const startUrl = `${baseUrl}/reveal`;
    const finalUrl = `${baseUrl}/reveal/weather`;
    const runPaths = writeRevealWorkflow({
      runId,
      startUrl,
      finalUrl,
      baseUrl,
      transition: {
        refType: "click",
        appeared: [{ role: "link", name: "Weather", structuralKey: "body>header>nav>ul>li|a|||Weather" }],
        disappeared: [],
        changed: []
      }
    });

    generateRunner(runId);
    const result = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(result.pathComplete, true, `stateful affordance flow must complete — report: ${JSON.stringify(result)}`);
    assert.ok((result.executedSteps || []).includes("click"), `reveal flow must execute click steps — ${JSON.stringify(result.executedSteps)}`);
  } finally {
    await server.close();
  }
});

test("verify-stateful-affordance: waits for async reveal transition before declaring mismatch", { timeout: 120000 }, async () => {
  const runId = `reveal-async-e2e-${Date.now()}`;
  const server = await startFixtureServer();
  try {
    const baseUrl = server.baseUrl;
    const startUrl = `${baseUrl}/reveal/async`;
    const finalUrl = `${baseUrl}/reveal/weather`;
    writeRevealWorkflow({
      runId,
      startUrl,
      finalUrl,
      baseUrl,
      transition: {
        refType: "click",
        appeared: [{ role: "link", name: "Weather", structuralKey: "body>header>nav>ul>li|a|||Weather" }],
        disappeared: [],
        changed: []
      }
    });

    generateRunner(runId);
    const result = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(result.pathComplete, true, `async reveal flow must complete — report: ${JSON.stringify(result)}`);
    assert.equal(result.success, true, `async reveal flow must verify successfully — report: ${JSON.stringify(result)}`);
  } finally {
    await server.close();
  }
});

test("verify-stateful-affordance: generic transition mismatch reports the transition gate", { timeout: 120000 }, async () => {
  const runId = `reveal-transition-mismatch-${Date.now()}`;
  const server = await startFixtureServer();
  try {
    const baseUrl = server.baseUrl;
    const startUrl = `${baseUrl}/reveal`;
    const finalUrl = `${baseUrl}/reveal/weather`;
    writeRevealWorkflow({
      runId,
      startUrl,
      finalUrl,
      baseUrl,
      transition: {
        refType: "click",
        appeared: [{ role: "link", name: "Weather", structuralKey: "wrong>structural>key" }],
        disappeared: [],
        changed: []
      }
    });

    generateRunner(runId);
    const result = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(result.pathComplete, false, `transition mismatch should hold the flow — report: ${JSON.stringify(result)}`);
    assert.equal(result.blockingGate, "transition", `transition mismatch must classify at the transition gate — report: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCategory, "transition_timeout", `transition mismatch must use the transition classification bucket — report: ${JSON.stringify(result)}`);
  } finally {
    await server.close();
  }
});

test("verify-stateful-affordance: reviewed rapid toggle prefixes can be excluded and still replay green", { timeout: 120000 }, async () => {
  const runId = `rvn-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startFixtureServer();
  try {
    const startUrl = `${server.baseUrl}/reveal/noise`;
    const finalUrl = `${server.baseUrl}/reveal/weather`;
    writeJson(runPaths.manifestPath, {
      runId,
      fixture: "manual",
      startUrl
    });
    writeJson(runPaths.networkSummaryPath, [
      { url: `${server.baseUrl}/api/reveal/open`, method: "POST", status: 200, timestamp: 1045 }
    ]);
    writeJson(runPaths.pageEvidencePath, [
      { selector: "[data-bf-evidence=\"reveal-weather\"]", text: "Weather detail", url: finalUrl }
    ]);
    writeJson(runPaths.sanitizedEventsPath, [
      { type: "navigate", url: startUrl, text: "Reveal Noise Demo", timestamp: 1000 },
      {
        type: "click",
        url: startUrl,
        timestamp: 1010,
        actionId: "a1",
        selector: "a",
        text: "Expand menu",
        href: `${startUrl}#closed`,
        role: "button",
        locator: { role: "button", name: "Expand menu", structuralKey: "body>header>nav|a|role=button||Expand menu", href: `${startUrl}#closed` }
      },
      {
        type: "action-diff",
        refType: "click",
        actionId: "a1",
        settleStatus: "interrupted",
        timestamp: 1011,
        beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "body>header>nav|a|role=button||Expand menu" }],
        afterSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "body>header>nav|a|role=button||Expand menu" }]
      },
      {
        type: "click",
        url: startUrl,
        timestamp: 1020,
        actionId: "a2",
        selector: "a",
        text: "Collapse menu",
        href: `${startUrl}#open`,
        role: "button",
        locator: { role: "button", name: "Collapse menu", structuralKey: "body>header>nav|a|role=button||Collapse menu", href: `${startUrl}#open` }
      },
      {
        type: "action-diff",
        refType: "click",
        actionId: "a2",
        settleStatus: "interrupted",
        timestamp: 1021,
        beforeSkeleton: [{ role: "button", name: "Collapse menu", structuralKey: "body>header>nav|a|role=button||Collapse menu" }],
        afterSkeleton: [{ role: "button", name: "Collapse menu", structuralKey: "body>header>nav|a|role=button||Collapse menu" }]
      },
      {
        type: "click",
        url: startUrl,
        timestamp: 1030,
        actionId: "a3",
        selector: "a",
        text: "Expand menu",
        href: `${startUrl}#closed`,
        role: "button",
        locator: {
          role: "button",
          name: "Expand menu",
          structuralKey: "body>header>nav|a|role=button||Expand menu",
          href: `${startUrl}#closed`,
          disambiguation: {
            weightOverrides: { href: 0, structuralKey: 0.5 }
          }
        }
      },
      {
        type: "action-diff",
        refType: "click",
        actionId: "a3",
        settleStatus: "settled",
        timestamp: 1031,
        beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "body>header>nav|a|role=button||Expand menu" }],
        afterSkeleton: [
          { role: "button", name: "Collapse menu", structuralKey: "body>header>nav|a|role=button||Collapse menu" },
          { role: "link", name: "Weather", structuralKey: "body>header>nav>ul>li|a|||Weather" }
        ]
      },
      {
        type: "click",
        url: startUrl,
        timestamp: 1040,
        actionId: "a4",
        selector: "a",
        text: "Weather",
        href: finalUrl,
        role: "link",
        locator: {
          role: "link",
          name: "Weather",
          structuralKey: "body>header>nav>ul>li|a|||Weather",
          href: finalUrl,
          disambiguation: {
            weightOverrides: { href: 1.5, structuralKey: 0.5 }
          }
        }
      },
      { type: "navigate", url: finalUrl, text: "Weather Detail", timestamp: 1050 }
    ]);
    writeJson(runPaths.captureNoisePreviewPath, {
      schemaVersion: SCHEMA_VERSIONS.captureNoisePreview,
      status: "needs_review",
      suggestions: [
        {
          candidateId: "cn1",
          kind: "ambiguous-prefix-toggle",
          pageKey: "manual/127.0.0.1/reveal/noise",
          eventIndexes: [1, 2, 3, 4],
          eventIndexRange: [1, 4],
          summary: "Rapid toggle prefix before final settled expand",
          recommendedAction: "exclude"
        }
      ]
    });
    writeJson(runPaths.captureNoiseResultPath, {
      schemaVersion: SCHEMA_VERSIONS.captureNoiseResult,
      runId,
      decisions: [{ candidateId: "cn1", verdict: "exclude" }]
    });

    compileRun(runId);
    generateRunner(runId);
    const result = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);

    assert.equal(result.success, true, `reviewed rapid-toggle flow must replay successfully — report: ${JSON.stringify(result)}`);
    assert.equal(result.pathComplete, true, `reviewed rapid-toggle flow must complete — report: ${JSON.stringify(result)}`);
    assert.equal(result.replayOutcome, "passed");
  } finally {
    await server.close();
  }
});
