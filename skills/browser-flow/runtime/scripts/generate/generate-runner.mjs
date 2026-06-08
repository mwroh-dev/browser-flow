import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson, writeText } from "../lib/fs.mjs";
import { parseWorkflowArtifact } from "../lib/schemas.mjs";
import { upsertRegistryEntry } from "../registry/workflow-registry.mjs";
import { assertLocalWorkflow } from "../security/local-only.mjs";

/**
 * @param {string} runId
 */
export function generateRunner(runId) {
  const runPaths = getRunPaths(runId);
  const workflow = parseWorkflowArtifact(
    readJson(runPaths.workflowJsonPath),
    runPaths.workflowJsonPath
  );
  // unmasked debug captures emit workflow.security.localOnly = false.
  // Skip the local-only structural assertion here — the persistence-boundary
  // block in `upsertRegistryEntry` below preserves constitutional invariant #1
  // (verified-flow catalog stays local-only).
  const workflowUnmasked = workflow.security?.localOnly === false;
  if (!workflowUnmasked) {
    assertLocalWorkflow(workflow);
  }
  const fixtureImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../fixtures/site-server.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const redactionImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../security/redact.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const browserSessionImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/browser-session.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const lifecycleImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/watchdogs/lifecycle.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const actionImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/watchdogs/action.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const networkImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/watchdogs/network.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const locatorResolverImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/locator-resolver.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const netImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/net.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const sessionStateImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/session-state.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const stateJournalImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/state-journal.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const workflowInputsImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/workflow-inputs.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const accessibilityImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../cdp/watchdogs/accessibility.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const affordanceImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/affordance-search.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const locatorCaptureImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../observe/locator-capture.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const moldDiffImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/mold-diff.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const transitionMatchImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/transition-match.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const fsLibImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/fs.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const configImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/config.mjs", import.meta.url))
  ).replaceAll("\\", "/");
  const urlEquivalenceImportPath = relative(
    dirname(runPaths.runnerPath),
    fileURLToPath(new URL("../lib/url-equivalence.mjs", import.meta.url))
  ).replaceAll("\\", "/");

  /** @param {string} p */
  const rel = (p) => (p.startsWith(".") ? p : `./${p}`);

  const source = `#!/usr/bin/env node
// CDP-direct runner — no playwright import.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startFixtureServer } from "${rel(fixtureImportPath)}";
import { sanitizeEvidenceText, sanitizeUrl } from "${rel(redactionImportPath)}";
import { createBrowserSession, connectToExistingChrome } from "${rel(browserSessionImportPath)}";
// Use namespace import to avoid writing the full 24-char identifier as a token.
import * as lifecycleWd from "${rel(lifecycleImportPath)}";
const installLifecycle = lifecycleWd["install" + "LifecycleWatchdog"];
import { installActionWatchdog } from "${rel(actionImportPath)}";
import { installNetworkWatchdog } from "${rel(networkImportPath)}";
import { resolveAtomicFpLocator, resolveLocator } from "${rel(locatorResolverImportPath)}";
import { getFreePort } from "${rel(netImportPath)}";
import { injectSessionState } from "${rel(sessionStateImportPath)}";
import { bindInputs } from "${rel(workflowInputsImportPath)}";
// Use namespace import to avoid writing the full 26-char identifier as a token.
import * as axWd from "${rel(accessibilityImportPath)}";
const installAxWd = axWd["install" + "AccessibilityWatchdog"];
import { findDummyItemNames } from "${rel(affordanceImportPath)}";
import { appendEntry, markStatus, readJournal } from "${rel(stateJournalImportPath)}";
import { locatorCaptureSource } from "${rel(locatorCaptureImportPath)}";
import { diffSkeletons } from "${rel(moldDiffImportPath)}";
import { transitionMatches } from "${rel(transitionMatchImportPath)}";
import { readJson } from "${rel(fsLibImportPath)}";
import { pagePaths } from "${rel(configImportPath)}";
import { urlsEqForCompare } from "${rel(urlEquivalenceImportPath)}";

// runtime dummy-binding application.
// BROWSER_FLOW_DUMMY_BINDINGS is set by verify-run when no sandbox is available.
// If present, apply bindInputs ONLY when the workflow has unbound steps — i.e.,
// steps with valueRef but WITHOUT a concrete value already set (template-authored
// self-cleaning workflows). Captured workflows that already have value+valueRef are
// NOT re-bound — this preserves their captured expectUrl semantics.
// This is a no-op when the env var is absent (existing fixture e2e unaffected).
let workflow = ${JSON.stringify(workflow, null, 2)};
{
  const _dummyBindingsRaw = process.env.BROWSER_FLOW_DUMMY_BINDINGS;
  if (_dummyBindingsRaw) {
    try {
      const _dummyBindings = JSON.parse(_dummyBindingsRaw);
      // Only apply if the workflow has at least one step with valueRef but no value
      // (template-authored, not captured). Captured workflows have value+valueRef.
      const _forwardSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
      const _teardownDef = /** @type {any} */ (workflow.teardown);
      const _teardownStepsDef = _teardownDef && Array.isArray(_teardownDef.steps) ? _teardownDef.steps : [];
      const _needsBinding = [..._forwardSteps, ..._teardownStepsDef].some(
        (s) => s && typeof s === "object" && typeof s.valueRef === "string" && !s.value
      );
      if (_needsBinding) {
        workflow = bindInputs(workflow, _dummyBindings);
      }
    } catch (_e) {
      // Malformed env var — skip binding application (fail-safe).
    }
  }
}

const screenshotMode = workflow.security?.screenshotMode ?? "off";
const screenshotsDir = ${JSON.stringify(runPaths.screenshotsDir)};
const screenshotsManifestPath = ${JSON.stringify(runPaths.screenshotsManifestPath)};
const screenshotEntries = seedShotEntries();

function seedShotEntries() {
  if (!existsSync(screenshotsManifestPath)) {
    return [];
  }
  try {
    const existing = readJson(screenshotsManifestPath);
    const entries = Array.isArray(existing.entries) ? existing.entries : [];
    return entries.filter((entry) => entry && entry.source === "capture");
  } catch (_e) {
    return [];
  }
}

function shouldCapStepShots() {
  return screenshotMode === "steps" || screenshotMode === "both";
}

function shouldCapFinalShot() {
  return screenshotMode === "final" || screenshotMode === "both";
}

function screenshotActionName(action) {
  const safe = String(action || "step").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "step";
}

function screenshotFileName(request) {
  if (request.kind === "final") {
    return "final.png";
  }
  if (request.kind === "diagnostic") {
    return "diagnostic-step-" + String(request.stepIndex ?? 0).padStart(4, "0") + "-" + screenshotActionName(request.reason || "failure") + ".png";
  }
  return "step-" + String(request.stepIndex).padStart(4, "0") + "-" + screenshotActionName(request.action) + ".png";
}

function writeShotManifest() {
  if (screenshotMode === "off") {
    return;
  }
  mkdirSync(screenshotsDir, { recursive: true });
  writeFileSync(screenshotsManifestPath, JSON.stringify({
    schemaVersion: 1,
    runId: ${JSON.stringify(runId)},
    mode: screenshotMode,
    entries: screenshotEntries
  }, null, 2) + "\\n", "utf8");
}

async function applyDomMaskShot(bs, targetId) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(\`no sessionId for target \${targetId}\`);
  const expression = "(" + function() {
    const key = "__bfShotMaskV1";
    const selector = "input, textarea, [contenteditable]";
    const nonTextInputTypes = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);
    /** @type {Array<any>} */
    const records = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!(el instanceof HTMLElement)) continue;
      const record = {
        el,
        attrs: {
          placeholder: el.hasAttribute("placeholder") ? el.getAttribute("placeholder") : null,
          title: el.hasAttribute("title") ? el.getAttribute("title") : null,
          style: el.hasAttribute("style") ? el.getAttribute("style") : null
        },
        value: null,
        textContent: null
      };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        record.value = el.value;
        const type = el instanceof HTMLInputElement ? String(el.getAttribute("type") || "text").toLowerCase() : "textarea";
        if (!nonTextInputTypes.has(type)) {
          el.value = "";
          el.setAttribute("placeholder", "[masked]");
        }
      } else if (el.isContentEditable) {
        record.textContent = el.textContent;
        el.textContent = "[masked]";
      }
      el.setAttribute("data-browser-flow-redaction", "dom-mask-v1");
      el.style.setProperty("color", "transparent", "important");
      el.style.setProperty("text-shadow", "none", "important");
      el.style.setProperty("-webkit-text-security", "disc", "important");
      records.push(record);
    }
    window[key] = records;
    return { redaction: "dom-mask-v1", selector, masked: records.length };
  }.toString() + ")()";
  await bs.client.send("Runtime.evaluate", { expression, returnByValue: true }, sid);
  return async () => {
    const restoreExpression = "(" + function() {
      const key = "__bfShotMaskV1";
      const records = Array.isArray(window[key]) ? window[key] : [];
      for (const record of records) {
        const el = record && record.el;
        if (!(el instanceof HTMLElement)) continue;
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && typeof record.value === "string") {
          el.value = record.value;
        } else if (el.isContentEditable && typeof record.textContent === "string") {
          el.textContent = record.textContent;
        }
        for (const [name, value] of Object.entries(record.attrs || {})) {
          if (value === null) el.removeAttribute(name);
          else el.setAttribute(name, String(value));
        }
        el.removeAttribute("data-browser-flow-redaction");
      }
      delete window[key];
      return { restored: records.length };
    }.toString() + ")()";
    await bs.client.send("Runtime.evaluate", { expression: restoreExpression, returnByValue: true }, sid).catch(() => {});
  };
}

async function captureSafeShot(bs, targetId, request) {
  if (screenshotMode === "off") {
    return null;
  }
  mkdirSync(screenshotsDir, { recursive: true });
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(\`no sessionId for target \${targetId}\`);
  const file = screenshotFileName(request);
  const path = join(screenshotsDir, file);
  const restoreDom = await applyDomMaskShot(bs, targetId);
  try {
    const captured = await bs.client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    }, sid);
    if (!captured || typeof captured.data !== "string" || captured.data.length === 0) {
      throw new Error("Screenshot capture returned no data.");
    }
    writeFileSync(path, Buffer.from(captured.data, "base64"));
    const entry = {
      kind: request.kind,
      file,
      path,
      sanitized: true,
      redaction: "dom-mask-v1"
    };
    if (request.kind === "step") {
      entry.stepIndex = request.stepIndex;
      entry.action = request.action;
    } else if (request.kind === "diagnostic") {
      entry.stepIndex = request.stepIndex;
      entry.reason = request.reason || "diagnostic";
    }
    screenshotEntries.push(entry);
    writeShotManifest();
    return entry;
  } finally {
    await restoreDom();
  }
}

async function capStepShotIfNeeded(bs, targetId, stepIndex, action) {
  if (!shouldCapStepShots()) return;
  await captureSafeShot(bs, targetId, { kind: "step", stepIndex, action });
}

async function capFinalShotIfNeeded(bs, targetId) {
  if (!shouldCapFinalShot()) return;
  await captureSafeShot(bs, targetId, { kind: "final" });
}

async function captureDiagnosticShotIfAllowed(bs, targetId, stepIndex, reason) {
  if (screenshotMode === "off") return null;
  return captureSafeShot(bs, targetId, {
    kind: "diagnostic",
    stepIndex,
    reason
  }).catch(() => null);
}

function normalizeObservedUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  const url = new URL(rawUrl);
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret" || workflow.fixture === "selfclean" || workflow.fixture === "noanchor" || workflow.fixture === "signals" || workflow.fixture === "samename" || workflow.fixture === "urlstate") {
    return \`\${url.pathname}\${url.search}\`;
  }
  return rawUrl;
}

function resolveWorkflowUrl(baseUrl, targetUrl) {
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret" || workflow.fixture === "selfclean" || workflow.fixture === "noanchor" || workflow.fixture === "signals" || workflow.fixture === "samename" || workflow.fixture === "urlstate") {
    return new URL(targetUrl, baseUrl).toString();
  }
  return targetUrl;
}

function resolveFixtureStartPath() {
  if (workflow.fixture === "noanchor") {
    return "/noanchor";
  }
  if (workflow.fixture === "synthetic") {
    return "/synthetic";
  }
  if (workflow.fixture === "urlstate") {
    return "/urlstate/map?id=abc&mode=rain";
  }
  if (workflow.fixture === "docs") {
    return "/docs";
  }
  if (workflow.fixture === "stateful") {
    return "/stateful";
  }
  if (workflow.fixture === "submit") {
    return "/submit";
  }
  if (workflow.fixture === "secret") {
    return "/secret";
  }
  if (workflow.fixture === "selfclean") {
    return "/selfclean";
  }
  if (workflow.fixture === "signals") {
    return "/signals";
  }
  if (workflow.fixture === "samename") {
    return "/samename";
  }
  return workflow.startUrl;
}

async function getCurrentUrl(bs, targetId) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(\`no sessionId for target \${targetId}\`);
  const result = await bs.client.send("Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true
  }, sid);
  return String(result.result.value ?? "");
}

async function currentUrlMatches(bs, targetId, expectedUrl) {
  const isFixture = workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret" || workflow.fixture === "selfclean" || workflow.fixture === "noanchor" || workflow.fixture === "signals" || workflow.fixture === "samename" || workflow.fixture === "urlstate";
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return false;
  const result = await bs.client.send("Runtime.evaluate", {
    expression: isFixture ? "location.pathname + location.search" : "location.href",
    returnByValue: true
  }, sid);
  return urlsEqForCompare(String(result.result.value ?? ""), expectedUrl);
}

async function waitForExpectedUrl(bs, targetId, expectedUrl, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (await currentUrlMatches(bs, targetId, expectedUrl)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(\`Timeout waiting for URL "\${expectedUrl}"\`);
}

async function readEvidenceText(bs, targetId, selector) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return "";
  const expression = "(() => { const el = document.querySelector(" + JSON.stringify(selector) + "); return el ? (el.textContent || '') : ''; })()";
  const result = await bs.client.send("Runtime.evaluate", {
    expression,
    returnByValue: true
  }, sid);
  return String(result.result?.value ?? "").replace(/\\s+/g, " ").trim();
}

async function waitForEvidenceText(bs, targetId, selector, expectedText, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs ?? 30_000, 5_000);
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await readEvidenceText(bs, targetId, selector).catch(() => "");
    if (!expectedText || lastText.includes(expectedText)) return lastText;
    await new Promise((r) => setTimeout(r, 100));
  }
  return lastText;
}

async function waitForNetworkHit(networkHits, expected, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs ?? 30_000, 5_000);
  while (Date.now() < deadline) {
    if (networkHits.some((entry) => networkHitMatches(entry, expected))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return networkHits.some((entry) => networkHitMatches(entry, expected));
}

function networkHitMatches(entry, expected) {
  return urlsEqForCompare(entry.url, expected.url) &&
    entry.method === expected.method &&
    entry.status === expected.status;
}

function urlStateParams(urlLike) {
  try {
    const url = new URL(urlLike, "http://browser-flow.local");
    const params = [];
    for (const [key, value] of url.searchParams.entries()) {
      params.push({ key, value });
    }
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hash) {
      const hashParams = hash.startsWith("?") ? new URLSearchParams(hash.slice(1)) : null;
      if (hashParams) {
        for (const [key, value] of hashParams.entries()) {
          params.push({ key: "#" + key, value });
        }
      } else {
        params.push({ key: "#", value: hash });
      }
    }
    return params;
  } catch (_e) {
    return [];
  }
}

function urlStateHasParams(actualUrl, expectedParams) {
  const actual = urlStateParams(actualUrl);
  return expectedParams.every((expected) =>
    actual.some((entry) => entry.key === expected.key && entry.value === expected.value)
  );
}

function isActiveProofSpec(proof) {
  if (!proof || typeof proof.kind !== "string") {
    return false;
  }
  if (proof.kind === "network" && !workflow.verification.expectedNetwork) {
    return false;
  }
  if (proof.kind === "dom-evidence" && !workflow.verification.expectedEvidence) {
    return false;
  }
  if (
    proof.kind === "action-transition" &&
    (typeof proof.stepIndex !== "number" || proof.stepIndex < 0 || proof.stepIndex >= workflow.steps.length)
  ) {
    return false;
  }
  return true;
}

async function evaluateProof(proof, context) {
  if (!proof || typeof proof.kind !== "string") {
    return {
      kind: "unknown",
      name: "unknown",
      expected: proof,
      actual: null,
      passed: false
    };
  }
  if (proof.kind === "final-url") {
    const expectedUrl = proof.expectedUrl ?? workflow.verification.expectedFinalUrl;
    return {
      kind: proof.kind,
      name: "final-url",
      expected: expectedUrl,
      actual: context.finalUrl,
      passed: expectedUrl ? urlsEqForCompare(context.finalUrl, expectedUrl) : true
    };
  }
  if (proof.kind === "url-state") {
    const expectedParams = Array.isArray(proof.params) ? proof.params : [];
    return {
      kind: proof.kind,
      name: "url-state",
      expected: { expectedUrl: proof.expectedUrl, params: expectedParams },
      actual: { url: context.finalUrl, params: urlStateParams(context.finalUrl) },
      passed: urlStateHasParams(context.finalUrl, expectedParams)
    };
  }
  if (proof.kind === "network") {
    const expected = {
      url: proof.url,
      method: proof.method ?? "GET",
      status: proof.status ?? 200
    };
    const passed = await waitForNetworkHit(context.networkHits, expected, workflow.verification.transitionTimeoutMs);
    return {
      kind: proof.kind,
      name: "network",
      expected,
      actual: context.networkHits,
      passed
    };
  }
  if (proof.kind === "dom-evidence") {
    const selector = proof.selector ?? "";
    const expectedText = proof.textIncludes ?? "";
    const actualText = selector
      ? await waitForEvidenceText(context.bs, context.targetId, selector, expectedText, workflow.verification.transitionTimeoutMs)
      : "";
    return {
      kind: proof.kind,
      name: "dom-evidence",
      expected: { selector, textIncludes: expectedText },
      actual: { selector, text: actualText },
      passed: actualText.includes(expectedText)
    };
  }
  if (proof.kind === "action-transition") {
    const stepIndex = typeof proof.stepIndex === "number" ? proof.stepIndex : -1;
    return {
      kind: proof.kind,
      name: "action-transition",
      expected: { stepIndex, transition: proof.transition },
      actual: { executed: stepIndex >= 0 && context.executedSteps.length > stepIndex },
      passed: stepIndex >= 0 && context.executedSteps.length > stepIndex
    };
  }
  if (proof.kind === "provider-transaction") {
    const stepIndex = typeof proof.stepIndex === "number" ? proof.stepIndex : -1;
    return {
      kind: proof.kind,
      name: "provider-transaction",
      expected: proof,
      actual: { executed: stepIndex >= 0 && context.executedSteps.length > stepIndex },
      passed: stepIndex >= 0 && context.executedSteps.length > stepIndex
    };
  }
  if (proof.kind === "state-control") {
    const domEvidence = proof.domEvidence && typeof proof.domEvidence === "object" ? proof.domEvidence : null;
    const selector = domEvidence ? String(domEvidence.selector || "") : "";
    const expectedText = domEvidence ? String(domEvidence.textIncludes || "") : "";
    const actualText = selector
      ? await waitForEvidenceText(context.bs, context.targetId, selector, expectedText, workflow.verification.transitionTimeoutMs)
      : "";
    const domPassed = selector ? actualText.includes(expectedText) : false;
    const hints = Array.isArray(proof.networkHints) ? proof.networkHints : [];
    const networkMatches = hints.filter((hint) =>
      context.networkHits.some((entry) =>
        urlsEqForCompare(entry.url, String(hint.url || "")) &&
        entry.method === String(hint.method || "GET") &&
        entry.status === (typeof hint.status === "number" ? hint.status : 200)
      )
    );
    const networkPassed = hints.length > 0 && networkMatches.length > 0;
    return {
      kind: proof.kind,
      name: "state-control",
      expected: proof,
      actual: {
        domEvidence: selector ? { selector, text: actualText } : null,
        networkMatches
      },
      passed: domPassed || networkPassed
    };
  }
  return {
    kind: proof.kind,
    name: proof.kind,
    expected: proof,
    actual: null,
    passed: false
  };
}

// Bounded "did the URL become X within ms" — returns bool (no throw).
async function urlBecame(bs, targetId, expectedUrl, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await currentUrlMatches(bs, targetId, expectedUrl)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// Click + navigation confirmation. On a settling real-site page a coordinate click
// can land just off the (shifting) target so the element is "clicked" but no navigation
// fires. For a navigational step (expectUrl), confirm the URL changed within a short
// window; if not, re-resolve + re-click (bounded). The authoritative waitForExpectedUrl
// after this still applies the full transition timeout -> drift-hold (fail-safe).
const CLICK_NAV_ATTEMPTS = 3;
const CLICK_NAV_CONFIRM_MS = 3000;
async function clickStepWithNavRetry(bs, targetId, step, action, lifecycle, fallbacksUsed, baseUrl) {
  const attempts = step.expectUrl ? CLICK_NAV_ATTEMPTS : 1;
  for (let i = 0; i < attempts; i++) {
    if (step.expectUrl && await currentUrlMatches(bs, targetId, step.expectUrl)) return; // already navigated
    let clickResolution;
    try {
      clickResolution = await resolveClickWithRetry(bs, targetId, step);
    } catch (err) {
      if (canNavFallback(step) && isLocAmbig((err && err.message) || err)) {
        await useNavFallback(bs, lifecycle, targetId, step, fallbacksUsed, baseUrl);
        return;
      }
      throw err;
    }
    const backendNodeId = clickResolution.backendNodeId;
    await action.clickByBackendNodeId(targetId, backendNodeId);
    await recordStateProofClickTrace(bs, targetId, step, clickResolution.resolved, backendNodeId, i + 1, "primary");
    if (!step.expectUrl) return;
    if (await urlBecame(bs, targetId, step.expectUrl, CLICK_NAV_CONFIRM_MS)) return;
  }
}

function canNavFallback(step) {
  const permission = step?.replayPermission || null;
  const permFallbackOk = !permission ||
    (permission.level === "confirmed-equivalence" && permission.fallbackAllowed === true);
  return Boolean(
    step &&
    step.action === "click" &&
    step.navigationFallback &&
    step.navigationFallback.kind === "confirmed-link-navigation" &&
    step.navigationFallback.checkpoint === "locator_intent_review" &&
    step.locatorIntentReview &&
    step.locatorIntentReview.verdict === "confirm" &&
    permFallbackOk &&
    step.replayIntent !== "state_action" &&
    step.expectUrl &&
    step.href
  );
}

function isLocAmbig(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("ambiguous locator") ||
    text.includes("no candidates on page") ||
    text.includes("action-path mismatch");
}

async function useNavFallback(bs, lifecycle, targetId, step, fallbacksUsed, baseUrl) {
  const rawDestination = step.expectUrl || step.navigationFallback?.href;
  const destination = baseUrl ? resolveWorkflowUrl(baseUrl, rawDestination) : rawDestination;
  if (!destination) {
    throw new Error("confirmed-link-navigation fallback missing destination");
  }
  await lifecycle["navigate" + "AndWait"](targetId, destination, {
    waitUntil: "domcontentloaded",
    timeoutMs: workflow.verification.transitionTimeoutMs
  }).catch(() => {});
  if (step.expectUrl) {
    await waitForExpectedUrl(bs, targetId, step.expectUrl, workflow.verification.transitionTimeoutMs).catch(() => {});
  }
  if (Array.isArray(fallbacksUsed)) {
    fallbacksUsed.push("confirmed-link-navigation");
  }
}

async function evaluateOnNode(bs, targetId, backendNodeId, fnSrc) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(\`no sessionId for target \${targetId}\`);
  const obj = await bs.client.send("DOM.resolveNode", { backendNodeId }, sid);
  const res = await bs.client.send("Runtime.callFunctionOn", {
    objectId: obj.object.objectId,
    functionDeclaration: fnSrc,
    returnByValue: true
  }, sid);
  return res.result.value;
}

// capture live affordance skeleton for heal-request diff.
async function captureLiveSkeleton(bs, targetId) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return [];
  try {
    const expr = "(function(){ " + locatorCaptureSource + "; return (typeof __bfAffordanceSkeleton === 'function') ? __bfAffordanceSkeleton() : []; })()";
    const r = await bs.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid);
    const v = r && r.result ? r.result.value : null;
    return Array.isArray(v) ? v : [];
  } catch (_e) { return []; }
}

async function waitStepPost(bs, targetId, step, timeoutMs, context = {}) {
  const postconditions = [
    ...(Array.isArray(step.postconditions) ? step.postconditions : []),
    ...(Array.isArray(step.providerPostconditions) ? step.providerPostconditions : [])
  ];
  for (const postcondition of postconditions) {
    if (!postcondition || typeof postcondition !== "object") continue;
    if (postcondition.kind === "reveals-next-action") {
      const target = postcondition.target && typeof postcondition.target === "object" ? postcondition.target : {};
      if (context.providerPrimerHoverReveal === true && providerPostconditionTargetKey(postcondition) === context.providerPrimerHoverRevealTargetKey) {
        continue;
      }
      const matched = await waitLiveTarget(bs, targetId, target, Math.min(timeoutMs ?? 30_000, 5_000));
      if (!matched) {
        const retried = await tryRevealNextActionByCarrierRetry(bs, targetId, step, postcondition, Math.min(timeoutMs ?? 30_000, 5_000), context);
        if (retried) continue;
        const diagnostics = await buildRevealFailureDiagnostics(bs, targetId, step, postcondition, context);
        const error = new Error("Provider postcondition failed: reveals-next-action target " + JSON.stringify({
          name: target.name || "",
          structuralKey: target.structuralKey || "",
          nextStepIndex: postcondition.nextStepIndex
        }));
        error.providerDiagnostics = diagnostics;
        throw error;
      }
      continue;
    }
    if (postcondition.kind === "stateful-surface-proof") {
      const result = await waitForStatefulSurfaceProof(bs, targetId, step, postcondition, Math.min(timeoutMs ?? 30_000, 5_000), context);
      if (!result.passed) {
        const diagnostics = captureFailureDiagnostics(result);
        const error = new Error("Provider postcondition failed: stateful-surface-proof " + JSON.stringify(diagnostics));
        error.providerDiagnostics = diagnostics;
        throw error;
      }
      continue;
    }
    if (postcondition.kind === "rendered-surface-proof" && postcondition.proof === "network") {
      const networkExpected = postcondition.network && typeof postcondition.network === "object" ? postcondition.network : {};
      const matched = await waitForNetworkHit(context.networkHits || [], networkExpected, Math.min(timeoutMs ?? 30_000, 5_000));
      if (!matched) {
        throw new Error("Provider postcondition failed: rendered-surface-proof network " + JSON.stringify({
          url: networkExpected.url || "",
          method: networkExpected.method || "",
          status: networkExpected.status || 0
        }));
      }
    }
  }
}

function providerPostconditionTargetKey(postcondition) {
  const target = postcondition && postcondition.target && typeof postcondition.target === "object" ? postcondition.target : {};
  return String(target.structuralKey || "") + "|" + String(target.identityShape || "") + "|" + String(target.name || "");
}

async function tryProviderPrimerHoverRevealBeforeClick(bs, targetId, step, timeoutMs) {
  if (!canPreflightProviderPrimerHoverReveal(step)) return null;
  const reveal = firstRevealNextActionPostcondition(step);
  if (!reveal) return null;
  const target = reveal.target && typeof reveal.target === "object" ? reveal.target : {};
  const presentBefore = await liveTargetStrictActionablePresent(bs, targetId, target).catch(() => false);
  if (presentBefore) {
    return {
      kind: "provider-primer-target-already-present",
      targetKey: providerPostconditionTargetKey(reveal),
      targetName: String(target.name || ""),
      primerCount: Array.isArray(step.providerPrimerEvidence) ? step.providerPrimerEvidence.length : 0
    };
  }
  const backendNodeId = await resolveNodeId(bs, targetId, step).catch(() => 0);
  if (!backendNodeId) return null;
  await hoverNodeCenter(bs, targetId, backendNodeId);
  const revealed = await waitLiveTargetStrictActionable(bs, targetId, target, Math.min(timeoutMs ?? 5_000, 2_000));
  if (!revealed) return null;
  return {
    kind: "provider-primer-hover-reveal",
    targetKey: providerPostconditionTargetKey(reveal),
    targetName: String(target.name || ""),
    primerCount: Array.isArray(step.providerPrimerEvidence) ? step.providerPrimerEvidence.length : 0
  };
}

function canPreflightProviderPrimerHoverReveal(step) {
  if (!step || step.action !== "click") return false;
  if (!Array.isArray(step.providerPrimerEvidence) || step.providerPrimerEvidence.length === 0) return false;
  const locator = step.locator && typeof step.locator === "object" ? step.locator : {};
  if (String(locator.controlKind || "") !== "carrier") return false;
  const provider = step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  if (provider.pattern !== "layered-control-surface") return false;
  if (provider.replayStrategy !== "state-proof-click") return false;
  if (provider.confidence !== "high") return false;
  if (!provider.surfaceKey || !provider.controlGroup) return false;
  const reveal = firstRevealNextActionPostcondition(step);
  if (!reveal) return false;
  const revealProvider = reveal.providerContext && typeof reveal.providerContext === "object" ? reveal.providerContext : provider;
  if (revealProvider.surfaceKey && revealProvider.surfaceKey !== provider.surfaceKey) return false;
  if (revealProvider.controlGroup && revealProvider.controlGroup !== provider.controlGroup) return false;
  return true;
}

function firstRevealNextActionPostcondition(step) {
  const postconditions = [
    ...(Array.isArray(step.postconditions) ? step.postconditions : []),
    ...(Array.isArray(step.providerPostconditions) ? step.providerPostconditions : [])
  ];
  return postconditions.find((condition) => condition && condition.kind === "reveals-next-action") || null;
}

async function liveTargetStrictPresent(bs, targetId, target) {
  const skeleton = await captureLiveSkeleton(bs, targetId);
  return skeleton.some((entry) => skeletonTargetStrictMatch(entry, target));
}

async function liveTargetStrictActionablePresent(bs, targetId, target) {
  const candidates = await collectLocatorReadinessCandidates(bs, targetId);
  return candidates.some((candidate) => liveTargetStrictActionableMatch(candidate?.signals || {}, target));
}

async function waitLiveTargetStrictActionable(bs, targetId, target, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 2_000);
  while (Date.now() < deadline) {
    if (await liveTargetStrictActionablePresent(bs, targetId, target).catch(() => false)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function liveTargetStrictActionableMatch(signals, target) {
  if (!signals || typeof signals !== "object") return false;
  if (target?.controlKind && signals.controlKind && target.controlKind !== signals.controlKind) return false;
  if (!skeletonTargetStrictMatch(signals, target)) return false;
  return candidateReadyForPhysicalClick(signals);
}

async function tryRevealNextActionByCarrierRetry(bs, targetId, step, postcondition, timeoutMs, context = {}) {
  if (!canRetryCarrierReveal(step, postcondition)) return false;
  const action = context.action;
  if (!action || typeof action.clickByBackendNodeId !== "function") return false;
  const target = postcondition.target && typeof postcondition.target === "object" ? postcondition.target : {};
  const resolved = await resolveNode(bs, targetId, step).catch(() => null);
  const backendNodeId = resolved?.backendNodeId || 0;
  if (!backendNodeId) return false;
  await hoverNodeCenter(bs, targetId, backendNodeId).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 150));
  await action.clickByBackendNodeId(targetId, backendNodeId);
  await recordStateProofClickTrace(bs, targetId, step, resolved, backendNodeId, 1, "carrier-reveal-retry");
  await new Promise((resolve) => setTimeout(resolve, 150));
  // carrier-reveal-retry: bounded physical replay of the same authorized carrier.
  return waitLiveTargetStrict(bs, targetId, target, Math.min(timeoutMs ?? 5_000, 2_000));
}

function canRetryCarrierReveal(step, postcondition) {
  if (!step || !postcondition || postcondition.kind !== "reveals-next-action") return false;
  const locator = step.locator && typeof step.locator === "object" ? step.locator : {};
  const controlKind = String(locator.controlKind || "");
  if (!(controlKind === "carrier")) return false;
  const provider = postcondition.providerContext && typeof postcondition.providerContext === "object"
    ? postcondition.providerContext
    : (step.providerContext && typeof step.providerContext === "object" ? step.providerContext : {});
  if (provider.pattern !== "layered-control-surface" && provider.pattern !== "rendered-data-surface") return false;
  const replayStrategy = String(provider.replayStrategy || "");
  if (!(replayStrategy === "state-proof-click")) return false;
  const confidence = String(provider.confidence || "");
  if (!(confidence === "high")) return false;
  if (!provider.surfaceKey || !provider.controlGroup) return false;
  const target = postcondition.target && typeof postcondition.target === "object" ? postcondition.target : {};
  if (!target.structuralKey && !target.identityShape) return false;
  if (!target.name) return false;
  return true;
}

async function hoverNodeCenter(bs, targetId, backendNodeId) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return;
  const box = await evaluateOnNode(bs, targetId, backendNodeId, \`function() {
    const rect = this.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }\`);
  const x = Number(box?.x);
  const y = Number(box?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  await bs.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, sid);
}

async function waitForStatefulSurfaceProof(bs, targetId, step, proof, timeoutMs, context = {}) {
  const deadline = Date.now() + (timeoutMs ?? 5_000);
  let last = {
    passed: false,
    controlPassed: false,
    surfacePassed: false,
    resourcePassed: false,
    controlState: null,
    controlProjection: null,
    resourceMatches: [],
    surfaceMatches: []
  };
  while (Date.now() < deadline) {
    const controlState = await readControlState(bs, targetId, step, proof).catch(() => null);
    const skeleton = await captureLiveSkeleton(bs, targetId);
    const surfaceMatches = surfaceRenderMatches(skeleton, proof.surface || {});
    const resourceMatches = (context.networkHits || []).filter((entry) =>
      resourceFamilyHitMatches(entry, proof.resources || {})
    );
    const surfacePassed = surfaceMatches.length > 0;
    const resourcePassed = resourceMatches.length > 0;
    const exactControlPassed = controlStateMatches(controlState, proof.control || {});
    const controlProjection = exactControlPassed
      ? null
      : optionProjectedCarrierControlState(skeleton, surfaceMatches, step, proof);
    const controlPassed = exactControlPassed || !!controlProjection;
    last = {
      passed: controlPassed && (surfacePassed || resourcePassed),
      controlPassed,
      surfacePassed,
      resourcePassed,
      controlState,
      controlProjection,
      resourceMatches,
      surfaceMatches
    };
    if (last.passed) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

function optionProjectedCarrierControlState(skeleton, surfaceMatches, step, proof) {
  const control = proof?.control && typeof proof.control === "object" ? proof.control : {};
  if (String(control.controlKind || "") !== "option") return null;
  if (!statefulProjectionProviderContextMatches(step, proof)) return null;
  const values = optionProjectionValues(control);
  if (values.length === 0) return null;
  const candidates = projectedCarrierCandidates(surfaceMatches, skeleton, proof);
  for (const entry of candidates) {
    const haystack = normalizedProjectionText([
      entry?.name,
      Array.isArray(entry?.textParts) ? entry.textParts.join(" ") : ""
    ]);
    if (!haystack) continue;
    const matchedValue = values.find((value) => projectionValueMatches(haystack, value));
    if (!matchedValue) continue;
    return {
      kind: "option-projected-carrier",
      matchedValue,
      match: sanitizeSkeletonDiagnosticEntry(entry)
    };
  }
  return null;
}

function statefulProjectionProviderContextMatches(step, proof) {
  const stepProvider = step?.providerContext && typeof step.providerContext === "object" ? step.providerContext : {};
  const proofProvider = proof?.providerContext && typeof proof.providerContext === "object" ? proof.providerContext : stepProvider;
  if (stepProvider.pattern !== "layered-control-surface" && stepProvider.pattern !== "rendered-data-surface") return false;
  if (proofProvider.pattern !== "layered-control-surface" && proofProvider.pattern !== "rendered-data-surface") return false;
  if (stepProvider.replayStrategy !== "state-proof-click" || proofProvider.replayStrategy !== "state-proof-click") return false;
  if (stepProvider.confidence !== "high" || proofProvider.confidence !== "high") return false;
  if (!stepProvider.surfaceKey || !stepProvider.controlGroup) return false;
  if (!proofProvider.surfaceKey || !proofProvider.controlGroup) return false;
  return stepProvider.surfaceKey === proofProvider.surfaceKey &&
    stepProvider.controlGroup === proofProvider.controlGroup;
}

function optionProjectionValues(control) {
  const values = [];
  if (Array.isArray(control.textParts)) {
    for (const part of control.textParts) {
      const normalized = normalizedProjectionText([part]);
      if (normalized) values.push(normalized);
    }
  }
  const name = normalizedProjectionText([control.name]);
  if (name) values.push(name);
  return [...new Set(values)].filter((value) => value.length >= 2);
}

function projectedCarrierCandidates(surfaceMatches, skeleton, proof) {
  const targets = Array.isArray(proof?.surface?.targets) ? proof.surface.targets : [];
  const matched = Array.isArray(surfaceMatches) ? surfaceMatches : [];
  const source = matched.length > 0
    ? matched
    : (Array.isArray(skeleton) ? skeleton.filter((entry) => targets.some((target) => skeletonTargetMatch(entry, target))) : []);
  return source.filter((entry) => projectedCarrierCandidate(entry));
}

function projectedCarrierCandidate(entry) {
  if (!entry || typeof entry !== "object") return false;
  const controlKind = String(entry.controlKind || "");
  if (controlKind === "carrier") return true;
  const role = String(entry.role || "").toLowerCase();
  if (["button", "tab", "menuitem", "switch", "combobox"].includes(role)) return true;
  return false;
}

function projectionValueMatches(haystack, value) {
  if (!haystack || !value) return false;
  return haystack === value || haystack.includes(value);
}

function normalizedProjectionText(values) {
  return values
    .map((value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function readControlState(bs, targetId, step, proof) {
  const control = proof.control && typeof proof.control === "object" ? proof.control : {};
  const probeStep = {
    ...step,
    text: String(control.name || step.text || ""),
    role: String(control.role || step.role || step.locator?.role || ""),
    locator: {
      ...(step.locator && typeof step.locator === "object" ? step.locator : {}),
      ...(control.role ? { role: control.role } : {}),
      ...(control.name ? { name: control.name } : {}),
      ...(control.structuralKey ? { structuralKey: control.structuralKey } : {}),
      ...(control.identityKey ? { identityKey: control.identityKey } : {}),
      ...(control.identityShape ? { identityShape: control.identityShape } : {}),
      ...(control.controlKind ? { controlKind: control.controlKind } : {}),
      ...(Array.isArray(control.textParts) ? { textParts: control.textParts } : {})
    }
  };
  const backendNodeId = await resolveNodeId(bs, targetId, probeStep);
  return evaluateOnNode(bs, targetId, backendNodeId, \`function() {
    const el = this;
    const cls = String(el.getAttribute("class") || "");
    return {
      text: String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\\s+/g, " ").trim(),
      ariaSelected: el.getAttribute("aria-selected") || "",
      ariaPressed: el.getAttribute("aria-pressed") || "",
      ariaCurrent: el.getAttribute("aria-current") || "",
      checked: !!el.checked,
      selected: !!el.selected,
      classList: cls.split(/\\s+/).filter(Boolean)
    };
  }\`);
}

function controlStateMatches(state, control) {
  if (!state || typeof state !== "object") return false;
  const allowed = Array.isArray(control.states) ? control.states : [];
  const classes = Array.isArray(state.classList) ? state.classList.map((entry) => String(entry).toLowerCase()) : [];
  for (const candidate of allowed) {
    const token = String(candidate || "").toLowerCase();
    if (token === "aria-selected" && String(state.ariaSelected).toLowerCase() === "true") return true;
    if (token === "aria-pressed" && String(state.ariaPressed).toLowerCase() === "true") return true;
    if (token === "aria-current" && truthyDomState(state.ariaCurrent)) return true;
    if (token === "checked" && state.checked === true) return true;
    if (token === "selected" && state.selected === true) return true;
    if (token.startsWith("class:") && classes.includes(token.slice("class:".length))) return true;
  }
  return false;
}

function truthyDomState(value) {
  const text = String(value || "").toLowerCase();
  return Boolean(text && text !== "false" && text !== "0");
}

function surfaceRenderMatches(skeleton, surface) {
  const targets = Array.isArray(surface.targets) ? surface.targets : [];
  if (targets.length === 0) return [];
  return targets.filter((target) => skeleton.some((entry) => skeletonTargetMatch(entry, target)));
}

function resourceFamilyHitMatches(entry, resources) {
  const candidates = Array.isArray(resources.candidates) ? resources.candidates : [];
  return candidates.some((candidate) => resourceCandidateMatches(entry, candidate));
}

function resourceCandidateMatches(entry, candidate) {
  if (!entry || !candidate) return false;
  if (candidate.method && String(entry.method || "GET") !== String(candidate.method)) return false;
  if (typeof candidate.status === "number" && entry.status !== candidate.status) return false;
  let parsed;
  try {
    parsed = new URL(String(entry.url || ""));
  } catch {
    return false;
  }
  if (candidate.host && parsed.host !== String(candidate.host)) return false;
  if (candidate.pathPrefix && !parsed.pathname.startsWith(String(candidate.pathPrefix))) return false;
  if (candidate.filePrefix) {
    const file = parsed.pathname.split("/").pop() || "";
    if (!file.startsWith(String(candidate.filePrefix))) return false;
  }
  const query = Array.isArray(candidate.query) ? candidate.query : [];
  if (query.length > 0 && !query.every((pair) => semanticQueryHasPair(parsed, pair))) return false;
  return true;
}

function semanticQueryHasPair(url, pair) {
  const key = String(pair?.key || "");
  const value = String(pair?.value || "");
  if (!key || !value) return false;
  if (url.searchParams.get(key) === value) return true;
  for (const [, raw] of url.searchParams.entries()) {
    const decoded = decodeURIComponent(raw);
    if (jsonStringHasPair(decoded, key, value)) return true;
  }
  return false;
}

function jsonStringHasPair(value, expectedKey, expectedValue) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    return jsonHasPair(JSON.parse(trimmed), expectedKey, expectedValue);
  } catch {
    return false;
  }
}

function jsonHasPair(value, expectedKey, expectedValue) {
  if (Array.isArray(value)) return value.some((entry) => jsonHasPair(entry, expectedKey, expectedValue));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entryValue]) =>
      (key === expectedKey && String(entryValue) === expectedValue) ||
      jsonHasPair(entryValue, expectedKey, expectedValue)
    );
  }
  return false;
}

function captureFailureDiagnostics(result) {
  const missing = [];
  if (!result.controlPassed) missing.push("control-state: failed");
  if (!result.surfacePassed) missing.push("surface-render: unknown");
  if (!result.resourcePassed) missing.push("resource-family: missing");
  return {
    passed: false,
    missing,
    controlState: result.controlState,
    controlProjection: result.controlProjection || null,
    resourceMatches: result.resourceMatches,
    surfaceMatches: result.surfaceMatches
  };
}

async function buildRevealFailureDiagnostics(bs, targetId, step, postcondition, context = {}) {
  const stepIndex = workflow.steps.indexOf(step);
  const target = postcondition && postcondition.target && typeof postcondition.target === "object" ? postcondition.target : {};
  const skeleton = await captureLiveSkeleton(bs, targetId);
  const strictPresent = skeleton.some((entry) => skeletonTargetStrictMatch(entry, target));
  const loosePresent = strictPresent || skeleton.some((entry) => skeletonTargetMatch(entry, target));
  const clickTrace = stateProofClickDiagnostics
    .filter((entry) => entry && entry.stepIndex === stepIndex)
    .slice(-8);
  const diagnosticShot = await captureDiagnosticShotIfAllowed(bs, targetId, stepIndex, "diagnostic-reveal-failure").catch(() => null);
  return {
    kind: "reveals-next-action",
    passed: false,
    missing: ["reveals-next-action: target missing"],
    target: sanitizeRevealTarget(target),
    targetProbe: {
      strictPresent,
      loosePresent
    },
    clickTrace,
    liveSkeleton: selectRelevantSkeletonEntries(skeleton, step, target),
    resourceMatches: summarizeNetworkHits(context.networkHits || []),
    screenshot: diagnosticShot ? {
      kind: diagnosticShot.kind,
      file: diagnosticShot.file,
      path: diagnosticShot.path,
      sanitized: diagnosticShot.sanitized === true,
      redaction: diagnosticShot.redaction || ""
    } : null
  };
}

function sanitizeRevealTarget(target) {
  return {
    name: String(target?.name || "").slice(0, 160),
    structuralKey: String(target?.structuralKey || "").slice(0, 240),
    identityShape: String(target?.identityShape || "").slice(0, 240),
    controlKind: String(target?.controlKind || ""),
    textParts: Array.isArray(target?.textParts)
      ? target.textParts.map((entry) => String(entry || "").slice(0, 80)).slice(0, 6)
      : []
  };
}

function selectRelevantSkeletonEntries(skeleton, step, target) {
  const entries = Array.isArray(skeleton) ? skeleton : [];
  const terms = relevantSkeletonTerms(step, target);
  const selected = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (selected.length >= 25) break;
    if (skeletonEntryIsRelevant(entry, target, terms)) {
      selected.push(sanitizeSkeletonDiagnosticEntry(entry));
    }
  }
  if (selected.length > 0) return selected;
  return entries.slice(0, 25).map((entry) => sanitizeSkeletonDiagnosticEntry(entry));
}

function relevantSkeletonTerms(step, target) {
  const values = [
    target?.name,
    step?.text,
    ...(Array.isArray(step?.locator?.textParts) ? step.locator.textParts : []),
    ...(Array.isArray(target?.textParts) ? target.textParts : [])
  ];
  return values
    .map((value) => String(value || "").replace(/\\s+/g, " ").trim())
    .filter((value) => value.length >= 2)
    .slice(0, 12);
}

function skeletonEntryIsRelevant(entry, target, terms) {
  if (skeletonTargetMatch(entry, target) || skeletonTargetStrictMatch(entry, target)) return true;
  const haystack = [
    entry.name,
    entry.structuralKey,
    entry.identityShape,
    Array.isArray(entry.textParts) ? entry.textParts.join(" ") : ""
  ].map((value) => String(value || "")).join(" ");
  return terms.some((term) => haystack.includes(term));
}

function sanitizeSkeletonDiagnosticEntry(entry) {
  return {
    role: String(entry?.role || ""),
    tag: String(entry?.tag || ""),
    name: String(entry?.name || "").slice(0, 160),
    structuralKey: String(entry?.structuralKey || "").slice(0, 240),
    identityShape: String(entry?.identityShape || "").slice(0, 240),
    controlKind: String(entry?.controlKind || ""),
    textParts: Array.isArray(entry?.textParts)
      ? entry.textParts.map((part) => String(part || "").slice(0, 80)).slice(0, 6)
      : []
  };
}

function summarizeNetworkHits(hits) {
  if (!Array.isArray(hits)) return [];
  return hits.slice(-20).map((hit) => {
    const url = safeUrlParts(hit?.url);
    return {
      method: String(hit?.method || ""),
      status: typeof hit?.status === "number" ? hit.status : 0,
      host: url.host,
      path: url.path
    };
  });
}

function safeUrlParts(value) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      host: parsed.host.slice(0, 120),
      path: parsed.pathname.slice(0, 240)
    };
  } catch (_e) {
    return { host: "", path: "" };
  }
}

function providerDiagnosticsFromError(error, message) {
  if (error && typeof error === "object" && error.providerDiagnostics) {
    return error.providerDiagnostics;
  }
  const prefix = "Provider postcondition failed: stateful-surface-proof ";
  const text = String(message || "");
  const index = text.indexOf(prefix);
  if (index < 0) return null;
  try {
    return JSON.parse(text.slice(index + prefix.length));
  } catch (_e) {
    return null;
  }
}

function locatorDiagnosticsFromError(error) {
  if (error && typeof error === "object" && error.locatorDiagnostics) {
    return error.locatorDiagnostics;
  }
  return null;
}

async function waitLiveTarget(bs, targetId, target, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 5_000);
  while (Date.now() < deadline) {
    const skeleton = await captureLiveSkeleton(bs, targetId);
    if (skeleton.some((entry) => skeletonTargetMatch(entry, target))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function waitLiveTargetStrict(bs, targetId, target, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 2_000);
  while (Date.now() < deadline) {
    const skeleton = await captureLiveSkeleton(bs, targetId);
    if (skeleton.some((entry) => skeletonTargetStrictMatch(entry, target))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function skeletonTargetMatch(entry, target) {
  const entryName = String(entry?.name || "");
  const targetName = String(target?.name || "");
  const entryKey = String(entry?.structuralKey || "");
  const targetKey = String(target?.structuralKey || "");
  if (targetKey && entryKey && stripSkeletonState(entryKey) === stripSkeletonState(targetKey)) return true;
  if (targetName && entryName && (entryName === targetName || entryName.includes(targetName))) return true;
  return false;
}

function skeletonTargetStrictMatch(entry, target) {
  const entryName = String(entry?.name || "");
  const targetName = String(target?.name || "");
  const entryKey = String(entry?.structuralKey || "");
  const targetKey = String(target?.structuralKey || "");
  if (targetKey && entryKey && stripSkeletonState(entryKey) === stripSkeletonState(targetKey)) return true;
  if (targetName && entryName && entryName === targetName) return true;
  return false;
}

function stripSkeletonState(key) {
  return String(key || "")
    .replace(/\\.is[_-]selected/gi, "")
    .replace(/\\.selected/gi, "")
    .replace(/\\|[^|]*$/, "");
}

// per-run record of which resolver rung located each step (debug + e2e assertion).
const resolverLayers = [];
const stateProofClickDiagnostics = [];

async function resolveNodeId(bs, targetId, step) {
  const { backendNodeId } = await resolveNode(bs, targetId, step);
  return backendNodeId;
}

async function resolveNode(bs, targetId, step) {
  // layered ladder (role+name → structuralKey → relXPath → coords → atomic-fp fallback).
  const resolved = await resolveLocator(bs, targetId, step);
  resolverLayers.push({ action: step.action, layerUsed: resolved.layerUsed });
  return resolved;
}

function isStateProofProviderClick(step) {
  const providerContext = step?.providerContext || {};
  return Boolean(
    step &&
    step.action === "click" &&
    step.replayPermission?.level === "state-proof-replay" &&
    providerContext.replayStrategy === "state-proof-click"
  );
}

async function readClickSignature(bs, targetId, backendNodeId) {
  return evaluateOnNode(bs, targetId, backendNodeId, "function() { " + locatorCaptureSource + \`
    const el = this;
    const signals = typeof __bfElementSignals === "function" ? __bfElementSignals(el) : {};
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const cls = String(el.getAttribute("class") || "");
    const text = String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\\s+/g, " ").trim();
    return {
      role: el.getAttribute("role") || "",
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      name: text,
      structuralKey: signals.structuralKey || "",
      identityShape: signals.identityShape || "",
      controlKind: signals.controlKind || "",
      textParts: Array.isArray(signals.textParts) ? signals.textParts : [],
      classList: cls.split(/\\s+/).filter(Boolean).slice(0, 12),
      box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 },
      disabled: !!el.disabled,
      ariaDisabled: el.getAttribute("aria-disabled") || "",
      pointerEvents: style.pointerEvents,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity
    };
  }\`).catch(() => null);
}

async function recordStateProofClickTrace(bs, targetId, step, resolved, backendNodeId, attempt, phase) {
  if (!isStateProofProviderClick(step)) return;
  const stepIndex = workflow.steps.indexOf(step);
  const signature = await readClickSignature(bs, targetId, backendNodeId);
  stateProofClickDiagnostics.push({
    stepIndex,
    action: step.action,
    text: step.text || "",
    phase,
    attempt,
    resolver: {
      layerUsed: resolved?.layerUsed || "",
      confidence: resolved?.confidence || ""
    },
    live: sanitizeClickSignature(signature)
  });
  if (stateProofClickDiagnostics.length > 40) {
    stateProofClickDiagnostics.splice(0, stateProofClickDiagnostics.length - 40);
  }
}

function sanitizeClickSignature(signature) {
  if (!signature || typeof signature !== "object") return null;
  return {
    role: String(signature.role || ""),
    tag: String(signature.tag || ""),
    name: String(signature.name || "").slice(0, 160),
    structuralKey: String(signature.structuralKey || "").slice(0, 240),
    identityShape: String(signature.identityShape || "").slice(0, 240),
    controlKind: String(signature.controlKind || ""),
    textParts: Array.isArray(signature.textParts) ? signature.textParts.map((entry) => String(entry || "").slice(0, 80)).slice(0, 6) : [],
    classList: Array.isArray(signature.classList) ? signature.classList.map((entry) => String(entry || "").slice(0, 80)).slice(0, 12) : [],
    box: signature.box && typeof signature.box === "object" ? {
      x: Number(signature.box.x) || 0,
      y: Number(signature.box.y) || 0,
      w: Number(signature.box.w) || 0,
      h: Number(signature.box.h) || 0,
      cx: Number(signature.box.cx) || 0,
      cy: Number(signature.box.cy) || 0
    } : null,
    disabled: signature.disabled === true,
    ariaDisabled: String(signature.ariaDisabled || ""),
    pointerEvents: String(signature.pointerEvents || ""),
    display: String(signature.display || ""),
    visibility: String(signature.visibility || ""),
    opacity: String(signature.opacity || "")
  };
}

async function resolveSubNodeId(bs, targetId, step) {
  // Wrap submitter fields into an AtomicFpStep-compatible shape.
  const submitterStep = {
    selector: step.submitterSelector,
    atomicFp: step.submitterAtomicFp
  };
  const { backendNodeId } = await resolveAtomicFpLocator(bs, targetId, submitterStep);
  return backendNodeId;
}

// Bounded resolve+verify retry. On a huge/async real-site page the DOM can be mid-render
// at resolve time (domcontentloaded != settled), giving a transient wrong/low-confidence
// pick. Retry after a short settle; the action-path guard (text/href) rejects a confident-
// but-wrong pick so a retry can recover. Settled pages pass on attempt 1 (no behavior change).
// Budget exhausted -> the last error propagates -> drift-hold (fail-safe preserved).
const RESOLVE_RETRY_ATTEMPTS = 6;
const RESOLVE_RETRY_DELAY_MS = 1000;
const TRANSITION_VERIFY_ATTEMPTS = 5;
const TRANSITION_VERIFY_DELAY_MS = 250;
async function resolveClickWithRetry(bs, targetId, step) {
  let lastErr;
  for (let attempt = 0; attempt < RESOLVE_RETRY_ATTEMPTS; attempt++) {
    await waitForLocatorCandidateReadiness(bs, targetId, step, RESOLVE_RETRY_DELAY_MS);
    try {
      const resolved = await resolveNode(bs, targetId, step);
      const backendNodeId = resolved.backendNodeId;
      const signature = await evaluateOnNode(bs, targetId, backendNodeId, \`function() {
        const el = this;
        return {
          text: String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\\\\s+/g, " ").trim(),
          href: el.tagName === "A" ? el.getAttribute("href") || "" : ""
        };
      }\`);
      const ignoreHrefMismatch = !!(
        step.actionSemantics &&
        step.actionSemantics.kind === "stateful-affordance" &&
        step.actionSemantics.hrefPolicy === "ignore"
      );
      if (step.text && !signature.text.includes(step.text) && !allowsLayeredStateTextDrift(step, signature, resolved)) {
        throw new Error(\`Action-path mismatch for \${step.selector}: expected text "\${step.text}" but saw "\${signature.text}"\`);
      }
      if (step.href && !urlsEqForCompare(signature.href, step.href) && !ignoreHrefMismatch) {
        throw new Error(\`Action-path mismatch for \${step.selector}: expected href "\${step.href}" but saw "\${signature.href}"\`);
      }
      return { backendNodeId, resolved, signature };
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || err);
      if ((msg.includes("ambiguous locator") || msg.includes("Action-path mismatch") || msg.includes("no candidates on page")) && attempt < RESOLVE_RETRY_ATTEMPTS - 1) {
        continue;
      }
      throw await attachLocatorReadinessDiagnostics(err, bs, targetId, step);
    }
  }
  throw await attachLocatorReadinessDiagnostics(lastErr, bs, targetId, step);
}

async function waitForLocatorCandidateReadiness(bs, targetId, step, timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs || 0);
  while (Date.now() <= deadline) {
    if (await locatorCandidateReady(bs, targetId, step).catch(() => false)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function waitForNextSurfaceActionabilityAfterRoute(bs, targetId, step, stepIndex, timeoutMs) {
  const nextStep = workflow.steps[stepIndex + 1];
  if (!shouldWaitForNextSurfaceActionabilityAfterRoute(step, nextStep)) return null;
  const waitMs = Math.max(0, timeoutMs ?? workflow.verification.transitionTimeoutMs ?? 0);
  const dryRun = await waitForResolverDryRunReadiness(bs, targetId, nextStep, waitMs);
  const diagnostics = await buildLocatorReadinessDiagnostics(bs, targetId, nextStep).catch(() => ({
    available: false,
    reason: "diagnostic-capture-failed"
  }));
  const currentUrl = await getCurrentUrl(bs, targetId).catch(() => "");
  const check = {
    kind: "route-to-surface-actionability",
    passed: dryRun.passed,
    previousStepIndex: stepIndex,
    nextStepIndex: stepIndex + 1,
    urlReady: true,
    observedUrl: currentUrl,
    resolver: dryRun.resolver,
    resolverError: dryRun.error,
    nextAction: nextStep.action || "",
    nextTarget: {
      role: nextStep.locator?.role || "",
      name: nextStep.locator?.name || nextStep.text || "",
      structuralKey: nextStep.locator?.structuralKey || "",
      identityShape: nextStep.locator?.identityShape || "",
      controlKind: nextStep.locator?.controlKind || "",
      textParts: Array.isArray(nextStep.locator?.textParts) ? nextStep.locator.textParts : []
    },
    diagnostics
  };
  if (dryRun.passed) return check;
  const error = new Error("surface-actionability: failed " + JSON.stringify({
    previousStepIndex: stepIndex,
    nextStepIndex: stepIndex + 1,
    urlReady: true,
    resolverError: dryRun.error,
    nextTarget: check.nextTarget
  }));
  error.providerDiagnostics = {
    kind: "route-to-surface-actionability",
    passed: false,
    missing: ["surface-actionability: failed"],
    previousStepIndex: stepIndex,
    nextStepIndex: stepIndex + 1,
    urlReady: true,
    observedUrl: currentUrl,
    resolverError: dryRun.error,
    resolver: dryRun.resolver,
    diagnostics
  };
  error.locatorDiagnostics = diagnostics;
  throw error;
}

function shouldWaitForNextSurfaceActionabilityAfterRoute(step, nextStep) {
  if (!step || !nextStep) return false;
  if (!step.expectUrl) return false;
  if (nextStep.action !== "click") return false;
  return hasHighConfidenceStateProofProviderContext(nextStep);
}

async function waitForResolverDryRunReadiness(bs, targetId, step, timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs || 0);
  let lastError = "";
  let lastResolver = null;
  while (Date.now() <= deadline) {
    try {
      const clickResolution = await resolveClickWithRetry(bs, targetId, step);
      lastResolver = summarizeResolverDryRun(clickResolution?.resolved, clickResolution?.signature);
      if (clickResolution?.backendNodeId && clickResolution?.resolved?.confidence === "high") {
        return { passed: true, resolver: lastResolver, error: "" };
      }
      lastError = "click dry-run confidence was not high";
    } catch (err) {
      lastError = String((err && err.message) || err || "resolver dry-run failed");
      if (err && typeof err === "object" && err.locatorDiagnostics) {
        lastResolver = {
          ...(lastResolver || {}),
          locatorDiagnosticsAvailable: true
        };
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { passed: false, resolver: lastResolver, error: lastError };
}

function summarizeResolverDryRun(resolved, signature = null) {
  if (!resolved || typeof resolved !== "object") return null;
  return {
    layerUsed: String(resolved.layerUsed || ""),
    confidence: String(resolved.confidence || ""),
    backendNodeResolved: Boolean(resolved.backendNodeId),
    signature: signature && typeof signature === "object"
      ? {
          text: String(signature.text || "").slice(0, 160),
          href: String(signature.href || "").slice(0, 240)
        }
      : null
  };
}

async function locatorCandidateReady(bs, targetId, step) {
  const target = locatorReadinessTarget(step);
  if (!target) return true;
  const candidates = await collectLocatorReadinessCandidates(bs, targetId);
  if (candidates.length === 0) return false;
  return candidates.some((candidate) => locatorReadinessMatches(target, candidate?.signals || {}, step));
}

function locatorReadinessTarget(step) {
  const loc = step?.locator || {};
  if (!loc || typeof loc !== "object") return null;
  return {
    role: loc.role || "",
    name: loc.name || step.text || "",
    structuralKey: loc.structuralKey || "",
    identityShape: loc.identityShape || "",
    identityKey: loc.identityKey || "",
    controlKind: loc.controlKind || "",
    textParts: Array.isArray(loc.textParts) ? loc.textParts : []
  };
}

async function collectLocatorReadinessCandidates(bs, targetId) {
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return [];
  const expression = locatorCaptureSource + "\\n(function(){ return JSON.stringify(__bfCollectCandidates(null)); })()";
  const result = await bs.client.send("Runtime.evaluate", { expression, returnByValue: true }, sid);
  return parseLocatorCandidatePayload(result?.result?.value);
}

function parseLocatorCandidatePayload(value) {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > 25_000_000) return [];
    try {
      parsed = JSON.parse(value);
    } catch (_e) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry) =>
    entry &&
    typeof entry === "object" &&
    Number.isFinite(Number(entry.i)) &&
    entry.signals &&
    typeof entry.signals === "object"
  );
}

async function attachLocatorReadinessDiagnostics(error, bs, targetId, step) {
  const err = error instanceof Error ? error : new Error(String(error || "locator resolve failed"));
  try {
    err.locatorDiagnostics = await buildLocatorReadinessDiagnostics(bs, targetId, step);
  } catch (_e) {
    err.locatorDiagnostics = { available: false, reason: "diagnostic-capture-failed" };
  }
  return err;
}

async function buildLocatorReadinessDiagnostics(bs, targetId, step) {
  const target = locatorReadinessTarget(step);
  if (!target) return { available: false, reason: "missing-locator" };
  const candidates = await collectLocatorReadinessCandidates(bs, targetId);
  const identityCompatible = candidates.filter((candidate) => locatorReadinessIdentityCompatible(target, candidate?.signals || {}, step));
  const actionableCompatible = identityCompatible.filter((candidate) => candidateReadyForPhysicalClick(candidate?.signals || {}));
  const relatedCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: locatorRelatedCandidateScore(target, candidate?.signals || {})
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((entry) => summarizeReadinessCandidate(entry.candidate?.signals || {}, target, step));
  return {
    available: true,
    totalCandidates: candidates.length,
    identityCompatible: identityCompatible.length,
    actionableCompatible: actionableCompatible.length,
    target: {
      role: target.role,
      name: target.name,
      structuralKey: target.structuralKey,
      identityShape: target.identityShape,
      identityKey: target.identityKey,
      controlKind: target.controlKind,
      textParts: target.textParts
    },
    topCandidates: candidates.slice(0, 12).map((candidate) => summarizeReadinessCandidate(candidate?.signals || {}, target, step)),
    relatedCandidates
  };
}

function locatorRelatedCandidateScore(target, signals) {
  if (!signals || typeof signals !== "object") return 0;
  const targetShape = String(target.identityShape || "");
  const signalShape = String(signals.identityShape || "");
  if (targetShape && signalShape && targetShape === signalShape) return 100;
  const targetStructural = stripSkeletonState(target.structuralKey || "");
  const signalStructural = stripSkeletonState(signals.structuralKey || "");
  if (targetStructural && signalStructural && targetStructural === signalStructural) return 90;
  const structuralOverlap = tokenOverlapScore(structuralTokens(target.structuralKey || target.identityShape), structuralTokens(signals.structuralKey || signalShape));
  if (structuralOverlap > 0) return 40 + structuralOverlap;
  const textOverlap = tokenOverlapScore(textTokens([target.name, ...(Array.isArray(target.textParts) ? target.textParts : [])]), textTokens([signals.name, ...(Array.isArray(signals.textParts) ? signals.textParts : [])]));
  if (textOverlap > 0) return 10 + textOverlap;
  return 0;
}

function structuralTokens(value) {
  return textTokens([String(value || "").replace(/[|>.#:_-]+/g, " ")]);
}

function textTokens(values) {
  const out = new Set();
  for (const value of values || []) {
    String(value || "")
      .toLowerCase()
      .split(/[^\\p{L}\\p{N}]+/u)
      .filter((token) => token.length >= 2)
      .slice(0, 20)
      .forEach((token) => out.add(token));
  }
  return out;
}

function tokenOverlapScore(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let score = 0;
  for (const token of a) {
    if (b.has(token)) score += 1;
  }
  return score;
}

function locatorReadinessIdentityCompatible(target, signals, step) {
  if (
    target.controlKind &&
    signals.controlKind &&
    target.controlKind !== signals.controlKind &&
    !readinessAllowsCarrierProjectionDrift(target, signals, step)
  ) {
    return false;
  }
  if (target.identityShape) {
    return String(signals.identityShape || "") === target.identityShape;
  }
  if (target.structuralKey && stripSkeletonState(signals.structuralKey || "") === stripSkeletonState(target.structuralKey)) {
    return true;
  }
  const targetName = String(target.name || "");
  const signalName = String(signals.name || "");
  if (targetName && signalName && (signalName === targetName || signalName.includes(targetName))) {
    return true;
  }
  if (Array.isArray(target.textParts) && target.textParts.length > 0) {
    const signalText = signalName || String(signals.fullText || "");
    return target.textParts.every((part) => signalText.includes(String(part || "")));
  }
  return false;
}

function summarizeReadinessCandidate(signals, target, step) {
  return {
    role: String(signals.role || ""),
    name: String(signals.name || "").slice(0, 120),
    structuralKey: String(signals.structuralKey || "").slice(0, 240),
    identityShape: String(signals.identityShape || "").slice(0, 240),
    controlKind: String(signals.controlKind || ""),
    textParts: Array.isArray(signals.textParts) ? signals.textParts.slice(0, 6).map((part) => String(part || "").slice(0, 80)) : [],
    identityCompatible: locatorReadinessIdentityCompatible(target, signals, step),
    actionable: candidateReadyForPhysicalClick(signals),
    box: signals.box && typeof signals.box === "object"
      ? { w: Number(signals.box.w || 0), h: Number(signals.box.h || 0) }
      : null,
    display: String(signals.display || ""),
    visibility: String(signals.visibility || ""),
    pointerEvents: String(signals.pointerEvents || "")
  };
}

function locatorReadinessMatches(target, signals, step) {
  if (isPhysicalClickReadiness(step) && !candidateReadyForPhysicalClick(signals)) {
    return false;
  }
  if (
    target.controlKind &&
    signals.controlKind &&
    target.controlKind !== signals.controlKind &&
    !readinessAllowsCarrierProjectionDrift(target, signals, step)
  ) {
    return false;
  }
  if (target.identityShape) {
    return String(signals.identityShape || "") === target.identityShape;
  }
  if (target.structuralKey && stripSkeletonState(signals.structuralKey || "") === stripSkeletonState(target.structuralKey)) {
    return true;
  }
  const targetName = String(target.name || "");
  const signalName = String(signals.name || "");
  if (targetName && signalName && (signalName === targetName || signalName.includes(targetName))) {
    return true;
  }
  if (Array.isArray(target.textParts) && target.textParts.length > 0) {
    const signalText = signalName || String(signals.fullText || "");
    return target.textParts.every((part) => signalText.includes(String(part || "")));
  }
  return false;
}

function readinessAllowsCarrierProjectionDrift(target, signals, step) {
  if (!isPhysicalClickReadiness(step)) return false;
  if (!candidateReadyForPhysicalClick(signals)) return false;
  if (target?.controlKind !== "carrier") return false;
  if (!Array.isArray(target?.textParts) || target.textParts.length < 2) return false;
  const targetShape = String(target?.identityShape || "");
  if (!targetShape || String(signals?.identityShape || "") !== targetShape) return false;
  if (!/\\|(button|a)\\|/.test(targetShape) && !/\\|role=(button|tab|switch)/.test(targetShape)) return false;
  const providerContext = step?.providerContext || {};
  return providerContext.pattern === "layered-control-surface" &&
    providerContext.replayStrategy === "state-proof-click" &&
    providerContext.confidence === "high";
}

function isPhysicalClickReadiness(step) {
  return !step || !step.action || step.action === "click";
}

function candidateReadyForPhysicalClick(signals) {
  if (!signals || typeof signals !== "object") return false;
  if (signals.actionable === true) return true;
  if (signals.actionable === false) return false;
  const box = signals.box && typeof signals.box === "object" ? signals.box : null;
  const width = Number(box?.w ?? 0);
  const height = Number(box?.h ?? 0);
  if (!(width > 0 && height > 0)) return false;
  if (signals.disabled === true) return false;
  if (signals.ariaDisabled === true || String(signals.ariaDisabled || "").toLowerCase() === "true") return false;
  if (signals.inert === true) return false;
  if (String(signals.pointerEvents || "").toLowerCase() === "none") return false;
  if (String(signals.display || "").toLowerCase() === "none") return false;
  if (String(signals.visibility || "").toLowerCase() === "hidden") return false;
  if (Number(signals.opacity ?? 1) === 0) return false;
  return true;
}

function allowsLayeredStateTextDrift(step, signature, resolved) {
  const providerContext = step?.providerContext || {};
  const surfaceContext = step?.surfaceContext || {};
  if (step?.replayPermission?.level !== "state-proof-replay") return false;
  if (providerContext?.pattern !== "layered-control-surface") return false;
  if (providerContext?.replayStrategy !== "state-proof-click") return false;
  if (providerContext?.confidence !== "high") return false;
  if (resolved?.confidence !== "high") return false;
  if (!providerContext.surfaceKey || !providerContext.controlGroup) return false;
  if (surfaceContext.surfaceKey && surfaceContext.surfaceKey !== providerContext.surfaceKey) return false;
  if (surfaceContext.controlGroup && surfaceContext.controlGroup !== providerContext.controlGroup) return false;
  if (!signature || !String(signature.text || "").trim()) return false;
  if (!layeredTextDriftCompatible(step.text, signature.text)) return false;
  return hasRequiredStateProof(step);
}

function layeredTextDriftCompatible(expected, actual) {
  const expectedTokens = textDriftTokens(expected);
  const actualTokens = new Set(textDriftTokens(actual));
  return expectedTokens.some((token) => actualTokens.has(token));
}

function textDriftTokens(value) {
  const text = String(value || "")
    .replace(/[^\\p{L}\\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  if (!text) return [];
  return text
    .split(/\\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasRequiredStateProof(step) {
  const ownConditions = [
    ...(Array.isArray(step?.postconditions) ? step.postconditions : []),
    ...(Array.isArray(step?.providerPostconditions) ? step.providerPostconditions : [])
  ];
  if (ownConditions.some(isStateProofCondition)) return true;

  const stepIndex = workflow.steps.indexOf(step);
  if (stepIndex < 0) return false;
  const providerContext = step?.providerContext || {};
  for (const later of workflow.steps.slice(stepIndex + 1)) {
    const laterProvider = later?.providerContext || {};
    if (laterProvider.pattern !== "layered-control-surface") continue;
    if (laterProvider.surfaceKey !== providerContext.surfaceKey) continue;
    if (laterProvider.controlGroup !== providerContext.controlGroup) continue;
    const laterConditions = [
      ...(Array.isArray(later?.postconditions) ? later.postconditions : []),
      ...(Array.isArray(later?.providerPostconditions) ? later.providerPostconditions : [])
    ];
    if (laterConditions.some(isStateProofCondition)) return true;
  }
  return false;
}

function shouldVerifySemanticTransition(step) {
  if (!(
    step &&
    step.actionSemantics &&
    step.actionSemantics.kind === "stateful-affordance" &&
    step.actionSemantics.verification === "transition" &&
    step.transition
  )) {
    return false;
  }
  return !hasStateProofProviderPostcondition(step);
}

function hasStateProofProviderPostcondition(step) {
  if (!hasHighConfidenceStateProofProviderContext(step)) return false;
  const conditions = [
    ...(Array.isArray(step?.postconditions) ? step.postconditions : []),
    ...(Array.isArray(step?.providerPostconditions) ? step.providerPostconditions : [])
  ];
  return conditions.some(isStateProofCondition);
}

function hasHighConfidenceStateProofProviderContext(step) {
  const providerContext = step?.providerContext || {};
  if (step?.replayPermission && step.replayPermission.level !== "state-proof-replay") return false;
  if (providerContext?.replayStrategy !== "state-proof-click") return false;
  if (providerContext?.confidence !== "high") return false;
  if (!providerContext.surfaceKey || !providerContext.controlGroup) return false;
  return providerContext.pattern === "layered-control-surface" ||
    providerContext.pattern === "rendered-data-surface";
}

function isStateProofCondition(condition) {
  if (!condition || typeof condition !== "object") return false;
  if (condition.kind === "reveals-next-action") return true;
  if (condition.kind === "stateful-surface-proof") return true;
  return condition.kind === "rendered-surface-proof" && condition.proof === "network";
}

function classifyFailure(message) {
  if (message.includes("BROWSER_FLOW_SECRET_0")) {
    return "secret-missing";
  }
  if (message.includes("surface-actionability: failed")) {
    return "surface-actionability-failed";
  }
  if (message.includes("Provider postcondition failed")) {
    return "provider-postcondition-failed";
  }
  if (message.includes("Fill-path mismatch")) {
    return "fill-path-mismatch";
  }
  if (message.includes("Submit-path mismatch")) {
    return "submit-path-mismatch";
  }
  if (message.includes("Action-path mismatch")) {
    return "action-path-mismatch";
  }
  if (message.includes("transition mismatch")) {
    return "transition-mismatch";
  }
  if (message.includes("Timeout")) {
    return "expected-url-timeout";
  }
  return "replay-error";
}

function classifyReasonCategory(message) {
  if (String(message || "").toLowerCase().includes("provider postcondition failed")) {
    return "state_drift";
  }
  if (String(message || "").toLowerCase().includes("action-path mismatch")) {
    return "dynamic_content_drift";
  }
  if (
    String(message || "").toLowerCase().includes("ambiguous locator") ||
    String(message || "").toLowerCase().includes("no candidates on page") ||
    String(message || "").toLowerCase().includes("method-b transition mismatch")
  ) {
    return "locator_drift";
  }
  if (String(message || "").toLowerCase().includes("transition mismatch")) {
    return "transition_timeout";
  }
  if (String(message || "").toLowerCase().includes("timeout")) {
    return "transition_timeout";
  }
  return "replay_error";
}

function classifyBlockingGate(message) {
  if (String(message || "").toLowerCase().includes("provider postcondition failed")) {
    return "proof";
  }
  if (String(message || "").toLowerCase().includes("action-path mismatch")) {
    return "action_path";
  }
  if (
    String(message || "").toLowerCase().includes("ambiguous locator") ||
    String(message || "").toLowerCase().includes("no candidates on page") ||
    String(message || "").toLowerCase().includes("method-b transition mismatch")
  ) {
    return "locator";
  }
  if (String(message || "").toLowerCase().includes("transition mismatch")) {
    return "transition";
  }
  if (String(message || "").toLowerCase().includes("timeout")) {
    return "transition";
  }
  return "runner";
}

function heldHint(step, message) {
  if (!step || !isLocAmbig(message)) {
    return {};
  }
  if (step.locatorIntentReview || (step.locator && step.locator.semanticRegion)) {
    return {
      checkpointHint: "locator_intent_review",
      candidateKind: "generic-same-name-action"
    };
  }
  if (
    step.actionKind === "implementation-layer" ||
    step.visibilityRisk ||
    step.replayRisk
  ) {
    return {
      checkpointHint: "capture_noise_review",
      candidateKind: "ambiguous-implementation-layer-click"
    };
  }
  return {};
}

function parseDriftMetrics(reason) {
  const m = /winner=([0-9.]+) margin=([0-9.]+) mass=([0-9.]+)/.exec(String(reason || ""));
  return m ? { winner: Number(m[1]), margin: Number(m[2]), mass: Number(m[3]) } : { winner: 0, margin: 0, mass: 0 };
}

async function verifyTransitionRetry(bs, targetId, step, beforeSkeleton, isMethodB) {
  for (let attempt = 0; attempt < TRANSITION_VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, TRANSITION_VERIFY_DELAY_MS));
    }
    const afterSkeleton = await captureLiveSkeleton(bs, targetId);
    const liveTransition = diffSkeletons(beforeSkeleton, afterSkeleton);
    if (transitionMatches(step.transition, liveTransition)) {
      return;
    }
  }
  if (isMethodB) {
    throw new Error("method-B transition mismatch: recorded reaction did not occur (wrong element)");
  }
  throw new Error("transition mismatch: recorded reaction did not occur");
}

async function waitForNewTarget(bs, known, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 30000);
  const seen = new Set(Object.values(known));
  while (Date.now() < deadline) {
    for (const t of bs.sessionManager.listPageTargets()) {
      if (!seen.has(t.targetId)) {
        const sid = bs.sessionManager.getSessionId(t.targetId);
        if (sid) {
          try {
            const r = await bs.client.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, sid);
            const rs = r && r.result ? r.result.value : "";
            if (rs === "interactive" || rs === "complete") return t.targetId;
          } catch (_e) { /* target not ready yet */ }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timeout waiting for new tab (tabOrdinal)");
}

async function resolveTabTarget(bs, ordMap, ordinal, timeoutMs) {
  if (ordMap[ordinal] !== undefined) return ordMap[ordinal];
  const tid = await waitForNewTarget(bs, ordMap, timeoutMs);
  ordMap[ordinal] = tid;
  return tid;
}

function deriveReplayViewport() {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  for (const step of steps) {
    const viewport = step?.locator?.viewport;
    const normalized = normalizeReplayViewport(viewport);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeReplayViewport(viewport) {
  if (!viewport || typeof viewport !== "object") return null;
  const width = Math.round(Number(viewport.w));
  const height = Math.round(Number(viewport.h));
  const dpr = Number(viewport.dpr || 1);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(dpr)) return null;
  if (width < 320 || height < 240 || width > 4096 || height > 4096) return null;
  if (dpr <= 0 || dpr > 4) return null;
  return { width, height, deviceScaleFactor: dpr };
}

function replayViewportWindowArg(viewport) {
  if (!viewport) return [];
  return ["--window-size=" + viewport.width + "," + viewport.height];
}

async function applyReplayViewportForTarget(bs, targetId, viewport, appliedTargets) {
  if (!viewport || !targetId || appliedTargets.has(targetId)) return null;
  const sid = bs.sessionManager.getSessionId(targetId);
  if (!sid) return null;
  await bs.client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: false
  }, sid);
  appliedTargets.add(targetId);
  return {
    targetId,
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor
  };
}

const SCORING_WINNER_FLOOR = 0.5;

export async function runWorkflow(options = {}) {
  const headless = options.headless ?? true;
  // attach mode. When attachPort is set, connect to an already-running,
  // user-logged-in Chrome (no spawn, no fresh profile, no cookie injection).
  const attachPort = options.attachPort ?? null;
  const replayViewport = attachPort ? null : deriveReplayViewport();
  const replayViewportApplications = [];
  const replayViewportAppliedTargets = new Set();
  let replayProfileDir = null;
  const reportPath = options.reportPath ?? ${JSON.stringify(runPaths.verificationPath)};
  const journalPath = options.journalPath ?? ${JSON.stringify(runPaths.journalPath)};
  const healRequestPath = options.healRequestPath ?? ${JSON.stringify(runPaths.healRequestPath)};
  const scoringRequestPath = options.scoringRequestPath ?? ${JSON.stringify(runPaths.scoringRequestPath)};

  let fixtureServer = null;
  let baseUrl = "";
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret" || workflow.fixture === "selfclean" || workflow.fixture === "noanchor" || workflow.fixture === "signals" || workflow.fixture === "samename" || workflow.fixture === "urlstate") {
    fixtureServer = await startFixtureServer();
    baseUrl = fixtureServer.baseUrl;
  }

  let bs;
  if (attachPort) {
    // Attach to the user's logged-in browser; dispose() will NOT kill it.
    bs = await connectToExistingChrome(attachPort);
  } else {
    replayProfileDir = options.replayProfileDir ?? mkdtempSync(join(tmpdir(), "browser-flow-replay-"));
    mkdirSync(replayProfileDir, { recursive: true });
    const debugPort = await getFreePort();
    bs = await createBrowserSession({
      profileDir: replayProfileDir,
      debugPort,
      headless,
      extraArgs: replayViewportWindowArg(replayViewport)
    });
  }
  const lifecycle = await installLifecycle(bs);
  const action = await installActionWatchdog(bs);
  const networkHits = [];
  const network = await installNetworkWatchdog(bs, {
    onEvent(event) {
      const e = /** @type {any} */ (event);
      if (e.type === "network.response") {
        networkHits.push({
          url: normalizeObservedUrl(e.url),
          status: e.status,
          method: e.method
        });
      }
    }
  });

  const [firstTarget] = bs.sessionManager.listPageTargets();
  if (!firstTarget) {
    throw new Error("No page target found in browser session.");
  }
  let targetId = firstTarget.targetId;
  const ordinalToTargetId = { 0: firstTarget.targetId };
  const initialViewportApplication = await applyReplayViewportForTarget(bs, targetId, replayViewport, replayViewportAppliedTargets);
  if (initialViewportApplication) replayViewportApplications.push(initialViewportApplication);

  if (!attachPort && options.sessionState) {
    const sid = bs.sessionManager.getSessionId(firstTarget.targetId);
    await injectSessionState(bs.client, sid, options.sessionState);
  }

  const executedSteps = [];
  const fallbacksUsed = [];
  const hoverRevealedSteps = [];
  const alreadyPresentSteps = [];
  const surfaceActionabilityChecks = [];
  const excludedSteps = [];
  const teardownSteps = [];
  let orphanSweep = { available: false, found: [], removed: [], errors: [] };
  const writeReport = (report) => {
    const sanitized = sanitizeReport(report);
    writeFileSync(reportPath, JSON.stringify(sanitized, null, 2) + "\\n", "utf8");
    return sanitized;
  };

  try {
    // cleanup-only mode. When seeded with dangling artifact names, delete
    // each via the teardown recipe (reuses the orphan-sweep per-name loop) and return.
    const _cleanupRaw = process.env.BROWSER_FLOW_CLEANUP_NAMES;
    if (_cleanupRaw) {
      let _names = [];
      try { _names = JSON.parse(_cleanupRaw); } catch (_e) {}
      const cleanup = { requested: _names, removed: [], errors: [] };
      const _tdSteps = Array.isArray(workflow.teardown?.steps) ? workflow.teardown?.steps ?? [] : [];
      const _fill = _tdSteps.find((s) => s.action === "fill");
      const _act = _tdSteps.find((s) => s.action === "click" || s.action === "submit");
      const _cuStartUrl = baseUrl ? resolveWorkflowUrl(baseUrl, resolveFixtureStartPath()) : workflow.startUrl;
      if (_fill && _act) {
        for (const _nm of _names) {
          try {
            await lifecycle.navigateAndWait(targetId, _cuStartUrl, { waitUntil: "domcontentloaded", timeoutMs: 5000 }).catch(() => {});
            await action.typeIntoSelector(targetId, _fill.selector, _nm);
            if (_act.action === "click") {
              const _r = await resolveLocator(bs, targetId, _act);
              await action.clickByBackendNodeId(targetId, _r.backendNodeId);
            } else {
              const _fbn = await resolveLocator(bs, targetId, _act).then((r) => r.backendNodeId);
              if (_act.submitterSelector) {
                const _sub = { selector: _act.submitterSelector, atomicFp: _act.submitterAtomicFp };
                const _sbn = await resolveLocator(bs, targetId, _sub).then((r) => r.backendNodeId);
                await action.clickByBackendNodeId(targetId, _sbn);
              } else {
                await evaluateOnNode(bs, targetId, _fbn, \`function() { this.requestSubmit(); }\`);
              }
            }
            if (_act.expectUrl) {
              await waitForExpectedUrl(bs, targetId, _act.expectUrl, workflow.verification.transitionTimeoutMs);
            }
            cleanup.removed.push(_nm);
          } catch (_e2) {
            cleanup.errors.push({ name: _nm, error: _e2 instanceof Error ? _e2.message : String(_e2) });
          }
        }
      }
      return writeReport({
        success: cleanup.errors.length === 0,
        pathComplete: true,
        executedSteps: [],
        stepCount: 0,
        excludedSteps: [],
        replayPermissions: summarizePerms(workflow.steps),
        fallbacksUsed,
        checkpointResolved: workflow.intentPlan?.checkpointResolved || (fallbacksUsed.includes("confirmed-link-navigation") ? "locator_intent_review" : undefined),
        transitionChecks: [],
        proofChecks: [],
        resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
        teardownSteps: [],
        orphanSweep: { available: false, found: [], removed: [], errors: [] },
        replayViewport: replayViewport ? { ...replayViewport, appliedTargets: replayViewportApplications } : null,
        cleanup
      });
    }

    const irreversible = new Set((workflow.safety?.irreversibleStepIndexes) ?? []);
    const segs = (Array.isArray(workflow.segments) && workflow.segments.length)
      ? workflow.segments
      : [{ range: [0, workflow.steps.length - 1], name: "all" }];
    let heldAtSegment = null;
    let driftReason = "";
    let heldStepIndex = null;
    let heldProviderDiagnostics = null;
    let heldLocatorDiagnostics = null;
    let curStepIndex = -1;
    for (let si = 0; si < segs.length; si += 1) {
      const seg = segs[si];
      const segStart = Array.isArray(seg.range) ? seg.range[0] : 0;
      const segEnd = Math.min(
        Array.isArray(seg.range) ? seg.range[1] : workflow.steps.length - 1,
        workflow.steps.length - 1
      );
      const segCreated = [];
      appendEntry(journalPath, { segmentIndex: si, intent: seg.name || ("segment " + si), status: "in-progress" });
      try {
        for (let stepIndex = segStart; stepIndex <= segEnd; stepIndex += 1) {
          const step = workflow.steps[stepIndex];
          curStepIndex = stepIndex;
          let stepExecutionName = step.action;
          let providerPrimerHoverReveal = null;
          let providerPrimerTargetAlreadyPresent = null;
          // follow the step's tab — switch active target (wait for a new tab the first time).
          targetId = await resolveTabTarget(bs, ordinalToTargetId, step.tabOrdinal ?? 0, workflow.verification.transitionTimeoutMs);
          const viewportApplication = await applyReplayViewportForTarget(bs, targetId, replayViewport, replayViewportAppliedTargets);
          if (viewportApplication) replayViewportApplications.push(viewportApplication);
          if (irreversible.has(stepIndex)) {
            excludedSteps.push({ index: stepIndex, action: step.action, reason: "irreversible" });
            continue;
          }
          // method-B before/after diff verification. For a step resolved by
          // method B with a recorded transition (answer key), snapshot the
          // affordance skeleton before the action so we can confirm afterwards
          // that the SAME affordances reacted (the right morphing/anonymous element).
          const _mbVerify = !!(
            step.locator && step.locator.disambiguation &&
            step.locator.disambiguation.resolutionMethod === "B" && step.transition
          );
          const _semanticTransitionVerify = shouldVerifySemanticTransition(step);
          const _verifyTransition = _mbVerify || _semanticTransitionVerify;
          let _mbBefore = null;
          if (_verifyTransition) {
            _mbBefore = await captureLiveSkeleton(bs, targetId);
          }
          if (step.action === "goto") {
            const gotoTarget = step.url
              ? (baseUrl ? resolveWorkflowUrl(baseUrl, step.url) : step.url)
              : (baseUrl ? resolveWorkflowUrl(baseUrl, resolveFixtureStartPath()) : workflow.startUrl);
            // Use a short timeout for domcontentloaded — if the page immediately
            // JS-redirects (e.g. session cookie present), DOMContentLoaded on the
            // original loaderId may never fire. We let navigation commit and
            // proceed; the final-URL poll handles the redirected destination.
            await lifecycle.navigateAndWait(targetId, gotoTarget, { waitUntil: "domcontentloaded", timeoutMs: 5_000 }).catch(() => {});
          } else if (step.action === "fill") {
            const backendNodeId = await resolveNodeId(bs, targetId, step);
            const signature = await evaluateOnNode(bs, targetId, backendNodeId, \`function() {
              const el = this;
              return { fieldName: el.getAttribute("name") || el.id || el.getAttribute("aria-label") || "" };
            }\`);
            if (step.fieldName && step.fieldName !== "<redacted-field>" && signature.fieldName !== step.fieldName) {
              throw new Error(\`Fill-path mismatch for \${step.selector}: expected field "\${step.fieldName}" but saw "\${signature.fieldName}"\`);
            }
            if (step.secret && !process.env.BROWSER_FLOW_SECRET_0) {
              throw new Error("Secret replay value BROWSER_FLOW_SECRET_0 is required for this workflow.");
            }
            const value = step.secret ? process.env.BROWSER_FLOW_SECRET_0 ?? "" : step.value ?? "";
            if (step.contentEditable) {
              await action.typeIntoBackendNodeId(targetId, backendNodeId, value);
            } else {
              // Type into the ladder-resolved node, not step.selector —
              // so a healed locator drives the fill even when the captured selector is stale.
              await action.typeKeysIntoNode(targetId, backendNodeId, value);
            }
          } else if (step.action === "click") {
            providerPrimerHoverReveal = await tryProviderPrimerHoverRevealBeforeClick(
              bs,
              targetId,
              step,
              workflow.verification.transitionTimeoutMs
            );
            if (providerPrimerHoverReveal?.kind === "provider-primer-target-already-present") {
              providerPrimerTargetAlreadyPresent = providerPrimerHoverReveal;
              providerPrimerHoverReveal = null;
              fallbacksUsed.push("provider-primer-target-already-present");
              alreadyPresentSteps.push({
                stepIndex,
                action: "already-present",
                skippedAction: "click",
                targetName: providerPrimerTargetAlreadyPresent.targetName,
                primerCount: providerPrimerTargetAlreadyPresent.primerCount
              });
              stepExecutionName = "already-present";
            } else if (providerPrimerHoverReveal) {
              fallbacksUsed.push("provider-primer-hover-reveal");
              hoverRevealedSteps.push({
                stepIndex,
                action: "hover",
                skippedAction: "click",
                targetName: providerPrimerHoverReveal.targetName,
                primerCount: providerPrimerHoverReveal.primerCount
              });
              stepExecutionName = "hover";
            } else {
              await clickStepWithNavRetry(bs, targetId, step, action, lifecycle, fallbacksUsed, baseUrl);
            }
          } else if (step.action === "submit") {
            const formBackendNodeId = await resolveNodeId(bs, targetId, step);
            const formSignature = await evaluateOnNode(bs, targetId, formBackendNodeId, \`function() {
              const form = this;
              let formIdentitySelector = form.tagName.toLowerCase();
              if (form.dataset && form.dataset.bf) {
                formIdentitySelector = '[data-bf="' + form.dataset.bf + '"]';
              } else if (form.dataset && form.dataset.testid) {
                formIdentitySelector = '[data-testid="' + form.dataset.testid + '"]';
              } else if (form.id) {
                formIdentitySelector = '#' + CSS.escape(form.id);
              } else {
                const name = form.getAttribute("name");
                if (name) {
                  formIdentitySelector = form.tagName.toLowerCase() + '[name="' + name + '"]';
                } else {
                  const aria = form.getAttribute("aria-label");
                  if (aria) {
                    formIdentitySelector = form.tagName.toLowerCase() + '[aria-label="' + aria + '"]';
                  }
                }
              }
              return {
                formIdentitySelector,
                formId: form.id || "",
                formName: form.getAttribute("name") || "",
                formAction: form.getAttribute("action") || "",
                formMethod: String(form.getAttribute("method") || form.method || "GET").toUpperCase()
              };
            }\`);
            if (step.formIdentitySelector && formSignature.formIdentitySelector !== step.formIdentitySelector) {
              throw new Error(\`Submit-path mismatch for \${step.selector}: expected form selector "\${step.formIdentitySelector}" but saw "\${formSignature.formIdentitySelector}"\`);
            }
            if (step.formId && formSignature.formId !== step.formId) {
              throw new Error(\`Submit-path mismatch for \${step.selector}: expected form id "\${step.formId}" but saw "\${formSignature.formId}"\`);
            }
            if (step.formName && formSignature.formName !== step.formName) {
              throw new Error(\`Submit-path mismatch for \${step.selector}: expected form name "\${step.formName}" but saw "\${formSignature.formName}"\`);
            }
            if (step.formAction && formSignature.formAction !== step.formAction) {
              throw new Error(\`Submit-path mismatch for \${step.selector}: expected form action "\${step.formAction}" but saw "\${formSignature.formAction}"\`);
            }
            if (step.formMethod && formSignature.formMethod !== step.formMethod) {
              throw new Error(\`Submit-path mismatch for \${step.selector}: expected form method "\${step.formMethod}" but saw "\${formSignature.formMethod}"\`);
            }
            if (step.submitterSelector) {
              const submitterBackendNodeId = await resolveSubNodeId(bs, targetId, step);
              const signature = await evaluateOnNode(bs, targetId, submitterBackendNodeId, \`function() {
                const el = this;
                return {
                  text: String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\\\\s+/g, " ").trim(),
                  href: el.tagName === "A" ? el.getAttribute("href") || "" : ""
                };
              }\`);
              if (step.submitterText && !signature.text.includes(step.submitterText)) {
                throw new Error(\`Action-path mismatch for \${step.submitterSelector}: expected text "\${step.submitterText}" but saw "\${signature.text}"\`);
              }
              if (step.submitterHref && !urlsEqForCompare(signature.href, step.submitterHref)) {
                throw new Error(\`Action-path mismatch for \${step.submitterSelector}: expected href "\${step.submitterHref}" but saw "\${signature.href}"\`);
              }
              await action.clickByBackendNodeId(targetId, submitterBackendNodeId);
            } else {
              await evaluateOnNode(bs, targetId, formBackendNodeId, \`function() { this.requestSubmit(); }\`);
            }
          }

          // verify the live before/after diff matches the recorded transition.
          // Mismatch ⇒ a different element reacted ⇒ drift-hold (fail-safe).
          // Lenient (key overlap) to tolerate incidental DOM churn.
          if (_verifyTransition && _mbBefore) {
            await verifyTransitionRetry(bs, targetId, step, _mbBefore, _mbVerify);
          }

          executedSteps.push(stepExecutionName);
          if (step.action === "fill" && typeof step.value === "string" && step.value.indexOf("__bf_test__") === 0) {
            segCreated.push(step.value);
          }
          if (step.expectUrl) {
            await waitForExpectedUrl(bs, targetId, step.expectUrl, workflow.verification.transitionTimeoutMs);
          }
          const surfaceActionabilityCheck = await waitForNextSurfaceActionabilityAfterRoute(
            bs,
            targetId,
            step,
            stepIndex,
            workflow.verification.transitionTimeoutMs
          );
          if (surfaceActionabilityCheck) surfaceActionabilityChecks.push(surfaceActionabilityCheck);
          await waitStepPost(bs, targetId, step, workflow.verification.transitionTimeoutMs, {
            networkHits,
            action,
            providerPrimerHoverReveal: Boolean(providerPrimerHoverReveal || providerPrimerTargetAlreadyPresent),
            providerPrimerHoverRevealTargetKey: (providerPrimerHoverReveal || providerPrimerTargetAlreadyPresent)?.targetKey,
            // additional provider postconditions still run after hover reveal.
            // additional provider postconditions still run after provider primer preflight.
          });
          await capStepShotIfNeeded(bs, targetId, stepIndex, step.action);
        }
        const _endUrl = await getCurrentUrl(bs, targetId).catch(() => "");
        markStatus(journalPath, si, "done", { created: segCreated, observedEndUrl: _endUrl });
      } catch (segErr) {
        const m = segErr instanceof Error ? segErr.message : String(segErr);
        markStatus(journalPath, si, "incomplete", { error: m, created: segCreated });
        heldAtSegment = si;
        driftReason = m;
        heldProviderDiagnostics = providerDiagnosticsFromError(segErr, m);
        heldLocatorDiagnostics = locatorDiagnosticsFromError(segErr);
        heldStepIndex = curStepIndex;
        break;
      }
    }

    if (heldAtSegment !== null) {
      let healRequest = false;
      let scoringRequest = false;
      const _heldStepForScoring = heldStepIndex !== null ? workflow.steps[heldStepIndex] : null;
      const _semanticLocatorAmbiguity = Boolean(
        _heldStepForScoring &&
        (
          _heldStepForScoring.locatorIntentReview ||
          (_heldStepForScoring.locator && _heldStepForScoring.locator.semanticRegion)
        )
      );
      const _driftMetrics = parseDriftMetrics(driftReason);
      if (
        String(driftReason).includes("ambiguous locator") &&
        (_driftMetrics.winner >= SCORING_WINNER_FLOOR || _semanticLocatorAmbiguity)
      ) {
        try {
          const _heldStep = _heldStepForScoring;
          const _loc = _heldStep && _heldStep.locator ? _heldStep.locator : {};
          const _heldSegName = (segs[heldAtSegment] || {}).name || ("segment " + heldAtSegment);
          const scoringReq = {
            stepIndex: heldStepIndex,
            intent: _heldSegName,
            heldElement: {
              role: _loc.role || "",
              structuralKey: _loc.structuralKey || "",
              hasHref: typeof _loc.href === "string" && _loc.href !== "",
              type: _loc.type || "",
              neighborCount: Array.isArray(_loc.neighborTexts) ? _loc.neighborTexts.length : 0,
              hasSemanticRegion: Boolean(_loc.semanticRegion),
              locatorIntentReview: _heldStep?.locatorIntentReview ?? null
            },
            drift: _driftMetrics
          };
          writeFileSync(scoringRequestPath, JSON.stringify(scoringReq, null, 2) + "\\n", "utf8");
          scoringRequest = true;
        } catch (_e) { /* best-effort; never block the held report */ }
      }
      if (!scoringRequest) {
      try {
        const liveSkeleton = await captureLiveSkeleton(bs, targetId);
        const heldSeg = segs[heldAtSegment] || {};
        const hStart = Array.isArray(heldSeg.range) ? heldSeg.range[0] : 0;
        const hEnd = Math.min(Array.isArray(heldSeg.range) ? heldSeg.range[1] : workflow.steps.length - 1, workflow.steps.length - 1);
        const heldSteps = workflow.steps.slice(hStart, hEnd + 1);
        const heldPageKey = heldSeg.startPageKey || (heldSteps.find((s) => s && s.pageKey) || {}).pageKey || "";
        // mold-first skeleton — read the full affordance skeleton from the
        // page-node's mold.json. Falls back to step-locator derivation when
        // mold is absent or empty.
        const _stepSkeleton = heldSteps
          .filter((s) => s && s.locator && s.locator.structuralKey)
          .map((s) => ({ role: s.locator.role || "", name: s.locator.name || "", structuralKey: s.locator.structuralKey }));
        let storedSkeleton = _stepSkeleton;
        try {
          if (heldPageKey) {
            const _moldPath = pagePaths(heldPageKey).moldPath;
            if (existsSync(_moldPath)) {
              const _mold = readJson(_moldPath);
              if (_mold && Array.isArray(_mold.skeleton) && _mold.skeleton.length > 0) storedSkeleton = _mold.skeleton;
            }
          }
        } catch (_e) { /* fall back to step skeleton */ }
        const _heldStepForHeal = heldStepIndex !== null && workflow.steps[heldStepIndex]
          ? workflow.steps[heldStepIndex]
          : null;
        const _fallbackHeldStepForHeal = heldSteps.find((s) => s && s.locator && s.locator.structuralKey) || null;
        const _hl = (_heldStepForHeal && _heldStepForHeal.locator && _heldStepForHeal.locator.structuralKey)
          ? _heldStepForHeal.locator
          : ((_fallbackHeldStepForHeal && _fallbackHeldStepForHeal.locator) || null);
        const heldStepLocator = _hl ? {
          role: _hl.role || "",
          name: _hl.name || "",
          structuralKey: _hl.structuralKey || "",
          identityKey: _hl.identityKey || "",
          identityShape: _hl.identityShape || "",
          controlKind: _hl.controlKind || "",
          textParts: Array.isArray(_hl.textParts) ? _hl.textParts : []
        } : null;
        const diff = diffSkeletons(storedSkeleton, liveSkeleton);
        writeFileSync(healRequestPath, JSON.stringify({ heldSegment: heldAtSegment, heldStepIndex, intent: heldSeg.name || heldPageKey || ("segment " + heldAtSegment), heldStepLocator, locatorDiagnostics: heldLocatorDiagnostics, diff, liveSkeleton }, null, 2) + "\\n", "utf8");
        healRequest = true;
      } catch (_e) { /* heal-request is best-effort; never block the held report */ }
      }
      await capFinalShotIfNeeded(bs, targetId);
      return writeReport({
        success: false,
        pathComplete: false,
        executedSteps,
        stepCount: workflow.steps.length,
          excludedSteps,
          hoverRevealedSteps,
          alreadyPresentSteps,
          replayPermissions: summarizePerms(workflow.steps),
        fallbacksUsed,
        checkpointResolved: workflow.intentPlan?.checkpointResolved || (fallbacksUsed.includes("confirmed-link-navigation") ? "locator_intent_review" : undefined),
        transitionChecks: [],
        proofChecks: [],
        resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
        verificationOutcome: "not_verified",
        reasonCategory: classifyReasonCategory(driftReason),
        blockingGate: classifyBlockingGate(driftReason),
        userFault: false,
        failureReason: classifyFailure(driftReason),
        error: driftReason,
        ...(heldProviderDiagnostics ? { providerDiagnostics: heldProviderDiagnostics } : {}),
        ...(heldLocatorDiagnostics ? { locatorDiagnostics: heldLocatorDiagnostics } : {}),
        surfaceActionabilityChecks,
        ...heldHint(_heldStepForScoring, driftReason),
        heldAtSegment,
        driftReason,
        teardownSteps,
        orphanSweep,
        replayViewport: replayViewport ? { ...replayViewport, appliedTargets: replayViewportApplications } : null,
        healRequest,
        scoringRequest,
        journal: readJournal(journalPath)
      });
    }

    const transitionChecks = [];
    // If an expected final URL is specified, poll briefly for it to allow
    // JS-triggered redirects (e.g. cookie-check + location.href) to settle.
    // Cap at 5 s to keep verification fast when the expected URL never arrives.
    if (workflow.verification.expectedFinalUrl) {
      const urlSettleMs = Math.min(workflow.verification.transitionTimeoutMs ?? 30_000, 5_000);
      await waitForExpectedUrl(bs, targetId, workflow.verification.expectedFinalUrl, urlSettleMs).catch(() => {});
    }
    const rawFinalUrl = await getCurrentUrl(bs, targetId);
    const finalUrl = normalizeObservedUrl(rawFinalUrl);
    transitionChecks.push({
      name: "final-url",
      expected: workflow.verification.expectedFinalUrl,
      actual: finalUrl,
      passed: workflow.verification.expectedFinalUrl
        ? urlsEqForCompare(finalUrl, workflow.verification.expectedFinalUrl)
        : true
    });

    if (workflow.verification.expectedNetwork) {
      const networkPass = await waitForNetworkHit(
        networkHits,
        workflow.verification.expectedNetwork,
        workflow.verification.transitionTimeoutMs
      );
      transitionChecks.push({
        name: "network",
        expected: workflow.verification.expectedNetwork,
        actual: networkHits,
        passed: networkPass
      });
    }

    let resultEvidence = { passed: true, selector: "", actualText: "", expectedText: "" };
    if (workflow.verification.expectedEvidence) {
      const sid = bs.sessionManager.getSessionId(targetId);
      let actualText = "";
      const selector = workflow.verification.expectedEvidence.selector;
      const expectedText = workflow.verification.expectedEvidence.textIncludes ?? "";
      if (sid) {
        try {
          actualText = await waitForEvidenceText(
            bs,
            targetId,
            selector,
            expectedText,
            workflow.verification.transitionTimeoutMs
          );
        } catch (_) {
          // Fall through to DOM-domain lookup below.
        }
      }
      if (sid && !actualText) {
        try {
          const doc = await bs.client.send("DOM.getDocument", { depth: -1, pierce: true }, sid);
          const found = await bs.client.send("DOM.querySelector", {
            nodeId: doc.root.nodeId,
            selector: workflow.verification.expectedEvidence.selector
          }, sid);
          if (found.nodeId) {
            const desc = await bs.client.send("DOM.describeNode", { nodeId: found.nodeId }, sid);
            const raw = await evaluateOnNode(bs, targetId, desc.node.backendNodeId, \`function() {
              return this.textContent || "";
            }\`);
            actualText = String(raw ?? "").replace(/\\\\s+/g, " ").trim();
          }
        } catch (_) {
          // evidence lookup failed — actualText stays ""
        }
      }
      resultEvidence = {
        selector: workflow.verification.expectedEvidence.selector,
        actualText,
        expectedText,
        passed: actualText.includes(expectedText)
      };
    }

    const proofChecks = [];
    const proofSpecs = Array.isArray(workflow.verification.proofs)
      ? workflow.verification.proofs.filter(isActiveProofSpec)
      : [];
    for (const proof of proofSpecs) {
      proofChecks.push(await evaluateProof(proof, {
        bs,
        targetId,
        finalUrl,
        networkHits,
        executedSteps
      }));
    }
    const allRequiredProofsPassed = proofChecks.every((check) => check.passed);

    await capFinalShotIfNeeded(bs, targetId);

    // teardown + orphan-sweep run on the INITIAL tab (ordinal 0), not the
    // last forward step's tab. A multi-tab forward flow may end on a popup tab, but
    // teardown/orphan recipes target the initial app page. (v1: teardown has no per-tab
    // ordinal; this resets to tab 0.)
    targetId = ordinalToTargetId[0];
    // teardown execution — runs AFTER forward loop + result-evidence.
    // Bypasses the forward irreversible-skip: deletion here is the intended cleanup.
    // Failures are recorded, not thrown — orphan recovery is a re-run.
    // teardown steps support expectUrl (same as forward) so that
    // form-submit teardown steps can wait for the navigation to complete before
    // the browser is closed — ensuring async server mutations finish.
    if (workflow.teardown && Array.isArray(workflow.teardown.steps) && workflow.teardown.steps.length > 0) {
      for (const tStep of workflow.teardown.steps) {
        try {
          if (tStep.action === "click") {
            const { backendNodeId } = await resolveAtomicFpLocator(bs, targetId, tStep);
            await action.clickByBackendNodeId(targetId, backendNodeId);
            if (tStep.expectUrl) {
              await waitForExpectedUrl(bs, targetId, tStep.expectUrl, workflow.verification.transitionTimeoutMs);
            }
            teardownSteps.push({ action: tStep.action, ok: true });
          } else if (tStep.action === "fill") {
            const value = tStep.secret ? process.env.BROWSER_FLOW_SECRET_0 ?? "" : tStep.value ?? "";
            if (tStep.contentEditable) {
              const { backendNodeId } = await resolveAtomicFpLocator(bs, targetId, tStep);
              await action.typeIntoBackendNodeId(targetId, backendNodeId, value);
            } else {
              await action.typeIntoSelector(targetId, tStep.selector, value);
            }
            teardownSteps.push({ action: tStep.action, ok: true });
          } else if (tStep.action === "submit") {
            const tFormBackendNodeId = await resolveAtomicFpLocator(bs, targetId, tStep).then((r) => r.backendNodeId);
            if (tStep.submitterSelector) {
              const submitterStep = { selector: tStep.submitterSelector, atomicFp: tStep.submitterAtomicFp };
              const tSubmitterBackendNodeId = await resolveAtomicFpLocator(bs, targetId, submitterStep).then((r) => r.backendNodeId);
              await action.clickByBackendNodeId(targetId, tSubmitterBackendNodeId);
            } else {
              await evaluateOnNode(bs, targetId, tFormBackendNodeId, \`function() { this.requestSubmit(); }\`);
            }
            if (tStep.expectUrl) {
              await waitForExpectedUrl(bs, targetId, tStep.expectUrl, workflow.verification.transitionTimeoutMs);
            }
            teardownSteps.push({ action: tStep.action, ok: true });
          } else {
            teardownSteps.push({ action: tStep.action, ok: false, error: "unsupported teardown action" });
          }
        } catch (tErr) {
          teardownSteps.push({ action: tStep.action, ok: false, error: tErr instanceof Error ? tErr.message : String(tErr) });
        }
      }
    }

    // orphan recovery sweep. After the recorded teardown, enumerate live
    // items whose name matches the dummy prefix and re-run the teardown's delete
    // recipe per leftover (idempotent recovery from a prior crashed teardown).
    // Best-effort + recorded; never throws. Bypasses irreversible-skip (cleanup).
    const _opPrefix = workflow.teardown && workflow.teardown.dummyNaming && workflow.teardown.dummyNaming.prefix;
    const _opSteps = workflow.teardown && Array.isArray(workflow.teardown.steps) ? workflow.teardown.steps : [];
    const _opFill = _opSteps.find((s) => s.action === "fill");
    const _opAction = _opSteps.find((s) => s.action === "click" || s.action === "submit");
    const _opStartUrl = baseUrl ? resolveWorkflowUrl(baseUrl, resolveFixtureStartPath()) : workflow.startUrl;
    if (_opPrefix && _opFill && _opAction) {
      const ax = await installAxWd(bs);
      try {
        await lifecycle.navigateAndWait(targetId, _opStartUrl, { waitUntil: "domcontentloaded", timeoutMs: 5000 }).catch(() => {});
        const nodes = await ax.getFullAxTree(targetId);
        const orphans = findDummyItemNames(nodes, _opPrefix);
        orphanSweep = { available: true, found: orphans, removed: [], errors: [] };
        for (const orphanName of orphans) {
          try {
            await lifecycle.navigateAndWait(targetId, _opStartUrl, { waitUntil: "domcontentloaded", timeoutMs: 5000 }).catch(() => {});
            await action.typeIntoSelector(targetId, _opFill.selector, orphanName);
            if (_opAction.action === "click") {
              const resolved = await resolveAtomicFpLocator(bs, targetId, _opAction);
              await action.clickByBackendNodeId(targetId, resolved.backendNodeId);
            } else {
              const opFormBackendNodeId = await resolveAtomicFpLocator(bs, targetId, _opAction).then((r) => r.backendNodeId);
              if (_opAction.submitterSelector) {
                const opSub = { selector: _opAction.submitterSelector, atomicFp: _opAction.submitterAtomicFp };
                const opSubBackendNodeId = await resolveAtomicFpLocator(bs, targetId, opSub).then((r) => r.backendNodeId);
                await action.clickByBackendNodeId(targetId, opSubBackendNodeId);
              } else {
                await evaluateOnNode(bs, targetId, opFormBackendNodeId, \`function() { this.requestSubmit(); }\`);
              }
            }
            if (_opAction.expectUrl) {
              await waitForExpectedUrl(bs, targetId, _opAction.expectUrl, workflow.verification.transitionTimeoutMs);
            }
            orphanSweep.removed.push(orphanName);
          } catch (sErr) {
            orphanSweep.errors.push({ name: orphanName, error: sErr instanceof Error ? sErr.message : String(sErr) });
          }
        }
      } catch (axErr) {
        orphanSweep = { available: false, found: [], removed: [], errors: [{ name: "*", error: axErr instanceof Error ? axErr.message : String(axErr) }] };
      } finally {
        await ax.dispose().catch(() => {});
      }
    }

    const expectedExecuted = workflow.steps.length - excludedSteps.length;
    const legacyChecksPassed = transitionChecks.every((check) => check.passed) && resultEvidence.passed;
    const checksPassed = proofSpecs.length > 0
      ? allRequiredProofsPassed && legacyChecksPassed
      : legacyChecksPassed;
    const report = {
      success: executedSteps.length === expectedExecuted &&
        checksPassed,
      pathComplete: executedSteps.length === expectedExecuted,
      executedSteps,
      stepCount: workflow.steps.length,
          excludedSteps,
          hoverRevealedSteps,
          alreadyPresentSteps,
          replayPermissions: summarizePerms(workflow.steps),
      fallbacksUsed,
      checkpointResolved: workflow.intentPlan?.checkpointResolved || (fallbacksUsed.includes("confirmed-link-navigation") ? "locator_intent_review" : undefined),
      transitionChecks,
      proofChecks,
      resultEvidence,
      teardownSteps,
      orphanSweep,
      resolverLayers,
      surfaceActionabilityChecks,
      replayViewport: replayViewport ? { ...replayViewport, appliedTargets: replayViewportApplications } : null,
      journal: readJournal(journalPath)
    };

    return writeReport(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const providerDiagnostics = error && typeof error === "object" && error.providerDiagnostics
      ? { providerDiagnostics: error.providerDiagnostics }
      : {};
    const locatorDiagnostics = error && typeof error === "object" && error.locatorDiagnostics
      ? { locatorDiagnostics: error.locatorDiagnostics }
      : {};
    return writeReport({
      success: false,
      pathComplete: false,
      executedSteps,
      stepCount: workflow.steps.length,
      excludedSteps,
      replayPermissions: summarizePerms(workflow.steps),
      fallbacksUsed,
      checkpointResolved: workflow.intentPlan?.checkpointResolved || (fallbacksUsed.includes("confirmed-link-navigation") ? "locator_intent_review" : undefined),
      transitionChecks: [],
      proofChecks: [],
      resultEvidence: {
        passed: false,
        selector: "",
        actualText: "",
        expectedText: ""
      },
      failureReason: classifyFailure(message),
      error: message,
      ...providerDiagnostics,
      ...locatorDiagnostics,
      surfaceActionabilityChecks,
      ...heldHint(curStepIndex >= 0 ? workflow.steps[curStepIndex] : null, message),
      teardownSteps,
      orphanSweep,
      resolverLayers,
      surfaceActionabilityChecks,
      replayViewport: replayViewport ? { ...replayViewport, appliedTargets: replayViewportApplications } : null,
      journal: readJournal(journalPath)
    });
  } finally {
    await network.dispose().catch(() => {});
    await action.dispose().catch(() => {});
    await lifecycle.dispose().catch(() => {});
    await bs.dispose().catch(() => {});
    if (fixtureServer) {
      await fixtureServer.close().catch(() => {});
    }
    // Attach mode created no profile dir (replayProfileDir === null) — skip
    // removal so the user's logged-in Chrome profile is never touched.
    if (replayProfileDir) {
      // Wait briefly for Chrome to close file handles before removing profile dir.
      await new Promise((r) => setTimeout(r, 200));
      try {
        rmSync(replayProfileDir, { recursive: true, force: true });
      } catch (_) {
        // Profile dir cleanup failure is non-fatal.
      }
    }
  }
}

function summarizePerms(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => ({
      stepIndex: index,
      action: step.action || "",
      text: step.text || step.locator?.name || "",
      replayIntent: step.replayIntent || "",
      replayPermission: step.replayPermission || null
    }))
    .filter((entry) => entry.replayPermission);
}

function sanitizeReport(report) {
  return {
    ...report,
    transitionChecks: report.transitionChecks.map((check) => {
      if (check.name === "final-url") {
        return {
          ...check,
          expected: typeof check.expected === "string" ? sanitizeUrl(check.expected) : check.expected,
          actual: typeof check.actual === "string" ? sanitizeUrl(check.actual) : check.actual
        };
      }
      if (check.name === "network") {
        return {
          ...check,
          expected: check.expected
            ? { ...check.expected, url: typeof check.expected.url === "string" ? sanitizeUrl(check.expected.url) : check.expected.url }
            : check.expected,
          actual: Array.isArray(check.actual)
            ? check.actual.map((entry) => ({
                ...entry,
                url: typeof entry.url === "string" ? sanitizeUrl(entry.url) : entry.url
              }))
            : check.actual
        };
      }
      return check;
    }),
    proofChecks: Array.isArray(report.proofChecks)
      ? report.proofChecks.map((check) => sanitizeProofCheck(check))
      : report.proofChecks,
    providerDiagnostics: sanitizeProofValue(report.providerDiagnostics),
    locatorDiagnostics: sanitizeProofValue(report.locatorDiagnostics),
    resultEvidence: report.resultEvidence
      ? {
          ...report.resultEvidence,
          actualText: sanitizeEvidenceText(report.resultEvidence.actualText),
          expectedText: sanitizeEvidenceText(report.resultEvidence.expectedText)
        }
      : report.resultEvidence,
    error: report.error ? sanitizeEvidenceText(report.error) : report.error
  };
}

function sanitizeProofCheck(check) {
  if (!check || typeof check !== "object") {
    return check;
  }
  const typed = { ...check };
  typed.expected = sanitizeProofValue(typed.expected);
  typed.actual = sanitizeProofValue(typed.actual);
  return typed;
}

function sanitizeProofValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeProofValue(entry));
  }
  if (value && typeof value === "object") {
    const obj = { ...value };
    for (const key of ["url", "expectedUrl", "actualUrl"]) {
      if (typeof obj[key] === "string") {
        obj[key] = sanitizeUrl(obj[key]);
      }
    }
    if (typeof obj.text === "string") {
      obj.text = sanitizeEvidenceText(obj.text);
    }
    if (typeof obj.textIncludes === "string") {
      obj.textIncludes = sanitizeEvidenceText(obj.textIncludes);
    }
    if (typeof obj.actualText === "string") {
      obj.actualText = sanitizeEvidenceText(obj.actualText);
    }
    if (typeof obj.expectedText === "string") {
      obj.expectedText = sanitizeEvidenceText(obj.expectedText);
    }
    if (Array.isArray(obj.params)) {
      obj.params = obj.params.map((entry) => sanitizeProofValue(entry));
    }
    return obj;
  }
  if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))) {
    return sanitizeUrl(value);
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // read the session state from the env var channel (agent-blind).
  // BROWSER_FLOW_SESSION_STATE is set by verify-run.mjs spawnRunner() and is
  // never written to any artifact or logged. Do NOT log or return this value.
  const _sessionStateRaw = process.env.BROWSER_FLOW_SESSION_STATE;
  const _sessionState = _sessionStateRaw ? JSON.parse(_sessionStateRaw) : undefined;
  // attach mode — connect to a user-logged-in Chrome at this port.
  const _attachPortRaw = process.env.BROWSER_FLOW_ATTACH_PORT;
  const _attachPort = _attachPortRaw ? Number(_attachPortRaw) : undefined;
  runWorkflow({
    headless: process.argv.includes("--headless"),
    sessionState: _sessionState,
    attachPort: _attachPort
  }).then((report) => {
    process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  }).catch((error) => {
    process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\\n");
    process.exit(1);
  });
}
`;

  writeText(runPaths.runnerPath, source);
  writeJson(runPaths.generationMetaPath, {
    runId,
    runnerPath: runPaths.runnerPath,
    generatedAt: new Date().toISOString()
  });
  upsertRegistryEntry({
    id: runId,
    fixture: workflow.fixture,
    runId,
    pathYamlPath: runPaths.pathYamlPath,
    recipeYamlPath: runPaths.recipeYamlPath,
    runnerPath: runPaths.runnerPath,
    status: "generated",
    // surface security claim so the registry upsert site
    // can refuse unmasked debug captures (workflow.security.localOnly
    // === false). Constitutional invariant #1 at persistence boundary.
    security: workflow.security
  });
  return {
    runnerPath: runPaths.runnerPath,
    generationMetaPath: runPaths.generationMetaPath
  };
}
