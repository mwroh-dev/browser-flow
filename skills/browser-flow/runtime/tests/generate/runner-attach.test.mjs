import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { withAssembledPackage } from "../helpers/assembled-package.mjs";

/**
 * the generated runner must support attach mode — connect to a
 * user-logged-in Chrome (no spawn, no cookie injection, no profile cleanup).
 */
test("generated runner emits the attach branch (connect, skip injection, guard profile cleanup)", () => {
  const runId = `runner-attach-${Date.now()}`;
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

  // Imports the attach primitive (connect-only, does NOT kill Chrome on dispose).
  assert.match(source, /connectToExistingChrome/);
  // Reads attachPort from options.
  assert.match(source, /const attachPort = options\.attachPort/);
  // Branches: attach -> connect; else -> spawn fresh profile.
  assert.match(source, /if \(attachPort\)[\s\S]*connectToExistingChrome\(attachPort\)/);
  // Cookie injection is skipped in attach mode (auth comes from the attached browser).
  assert.match(source, /if \(!attachPort && options\.sessionState\)/);
  // Profile cleanup is guarded so the user's profile is never deleted (attach => null).
  assert.match(source, /if \(replayProfileDir\)/);
  // CLI entry reads the attach port from the agent-blind env channel.
  assert.match(source, /BROWSER_FLOW_ATTACH_PORT/);
  assert.match(source, /attachPort: _attachPort/);
});

test("generated runner emits method-B before/after transition verification", () => {
  const runId = `runner-methodb-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
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

  assert.match(source, /transitionMatches/);
  // Method-B steps capture a before-skeleton and verify the live diff post-action.
  assert.match(source, /_mbVerify/);
  assert.match(source, /resolutionMethod === "B" && step\.transition/);
  assert.match(source, /method-B transition mismatch/);
});

test("generated runner emits stateful-affordance href-policy bypass for reveal controls", () => {
  const runId = `runner-reveal-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/reveal",
    finalUrl: "http://127.0.0.1:59999/reveal/weather",
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
        transition: {
          refType: "click",
          appeared: [{ role: "link", name: "Weather", structuralKey: "body>header>nav>ul>li|a|||Weather" }],
          disappeared: [],
          changed: []
        }
      },
      {
        action: "click",
        selector: "[data-bf=\"weather\"]",
        text: "Weather",
        href: "http://127.0.0.1:59999/reveal/weather",
        locator: {
          role: "link",
          name: "Weather",
          structuralKey: "body>header>nav>ul>li|a|||Weather",
          href: "http://127.0.0.1:59999/reveal/weather",
          disambiguation: {
            weightOverrides: { href: 1.5, structuralKey: 0.5 }
          }
        }
      }
    ],
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/reveal/weather",
      expectedNetwork: null,
      expectedEvidence: null
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /step\.actionSemantics/);
  assert.match(source, /hrefPolicy === "ignore"/);
  assert.match(source, /stateful-affordance/);
});

test("generated runner emits screenshot mode handling and DOM-mask capture logic", () => {
  const runId = `runner-screenshots-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/screenshot",
    finalUrl: "http://127.0.0.1:59999/screenshot/done",
    steps: [
      { action: "goto" },
      { action: "fill", selector: "input[name='email']", value: "test@example.com" },
      { action: "click", selector: "button[type='submit']" }
    ],
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/screenshot/done",
      expectedNetwork: null,
      expectedEvidence: null
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotMode: "both",
      screenshotsPersisted: true
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /const screenshotMode = workflow\.security\?\.screenshotMode \?\? "off"/);
  assert.match(source, /captureSafeShot/);
  assert.match(source, /input, textarea, \[contenteditable\]/);
  assert.match(source, /Page\.captureScreenshot/);
  assert.match(source, /dom-mask-v1/);
  assert.match(source, /screenshotsManifestPath/);
  assert.match(source, /seedShotEntries/);
  assert.match(source, /entry\.source === "capture"/);
});

test("assembled runtime mirrors reveal runner semantics and fixture routes", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const bundledRunner = readFileSync(resolve(packageRoot, "runtime/scripts/generate/generate-runner.mjs"), "utf8");
    const bundledFixture = readFileSync(resolve(packageRoot, "runtime/scripts/fixtures/site-server.mjs"), "utf8");

    assert.match(bundledRunner, /step\.actionSemantics/);
    assert.match(bundledRunner, /hrefPolicy === "ignore"/);
    assert.match(bundledRunner, /stateful-affordance/);
    assert.match(bundledRunner, /transition mismatch: recorded reaction did not occur/);
    assert.match(bundledRunner, /seedShotEntries/);
    assert.match(bundledFixture, /function revealPage\(delayMs = 0\)/);
    assert.match(bundledFixture, /\/reveal\/weather/);
    assert.match(bundledFixture, /\/reveal\/async/);
  });
});

test("assembled runtime mirrors HTTP URL equivalence helper usage", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const bundledRunner = readFileSync(resolve(packageRoot, "runtime/scripts/generate/generate-runner.mjs"), "utf8");
    const bundledUrlEquivalence = readFileSync(resolve(packageRoot, "runtime/scripts/lib/url-equivalence.mjs"), "utf8");

    assert.match(bundledRunner, /urlsEqForCompare/);
    assert.match(bundledRunner, /currentUrlMatches/);
    assert.match(bundledRunner, /Action-path mismatch/);
    assert.match(bundledUrlEquivalence, /normalizeHttpUrlForComparison/);
    assert.match(bundledUrlEquivalence, /urlsEqForCompare/);
  });
});
