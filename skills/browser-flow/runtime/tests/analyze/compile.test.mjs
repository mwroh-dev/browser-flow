import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureRunDirs, getRunPaths, getVerifySpecPaths, pagePaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";

test("compiler normalizes built-in fixture URLs and emits workflow outputs", () => {
  const runId = `compile-fixture-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", value: "Codex", secret: false, timestamp: 950 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);

  assert.equal(workflow.startUrl, "/synthetic");
  assert.equal(workflow.finalUrl, "/synthetic/result?name=Codex");
  assert.equal(Array.isArray(workflow.steps), true);
  assert.equal(workflow.steps.length >= 3, true);
  assert.equal(getRunPaths(runId).workflowJsonPath.endsWith("workflow.json"), true);
  assert.ok(workflow.verification.expectedNetwork);
  assert.equal(workflow.verification.expectedNetwork.url, "/api/complete?mode=synthetic");
  assert.equal(workflow.security.installScope, "project-local");
  assert.equal(workflow.security.targetScope, "local");
  assert.match(readFileSync(runPaths.pathYamlPath, "utf8"), /expectedEvidence/);
  assert.match(readFileSync(runPaths.recipeYamlPath, "utf8"), /requiresTransition: true/);
});

test("compiler derives start/final URL from the first/last REAL navigation, skipping about:blank", () => {
  // Real-site capture: the daemon opens about:blank before navigating to the real
  // start URL, and trailing frame/SPA churn can emit more about:blank navigations.
  // start/final URL must come from the real pages, else replay starts on about:blank
  // and drift-holds at step 1 (gap found in real-site validation 2026-05-21).
  const runId = `compile-blank-skip-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    startUrl: "https://example.com/"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "about:blank", timestamp: 900 },
    { type: "navigate", url: "https://example.com/", text: "Example", timestamp: 910 },
    { type: "click", selector: "a", text: "More information", timestamp: 1000 },
    { type: "navigate", url: "https://www.iana.org/domains/example", text: "IANA", timestamp: 1010 },
    { type: "navigate", url: "about:blank", timestamp: 1020 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://www.iana.org/domains/example", method: "GET", status: 200, timestamp: 1015 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Example Domain", url: "https://www.iana.org/domains/example" }
  ]);

  const workflow = compileRun(runId);

  assert.equal(workflow.startUrl, "https://example.com/", "startUrl must be the first real navigation, not about:blank");
  assert.equal(workflow.finalUrl, "https://www.iana.org/domains/example", "finalUrl must be the last real navigation, not trailing about:blank");
  assert.equal(workflow.security.localOnly, false);
  assert.equal(workflow.security.installScope, "project-local");
  assert.equal(workflow.security.targetScope, "external");
});

test("compiler accepts a network proof without DOM evidence", () => {
  const runId = `compile-network-proof-no-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, []);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedNetwork);
  assert.equal(workflow.verification.expectedNetwork.url, "/api/complete?mode=synthetic");
  assert.equal(workflow.verification.expectedEvidence, null);
  assert.ok(workflow.verification.proofs.some((proof) => proof.kind === "network"));
});

test("compiler prefers bounded final detail evidence over a static heading fallback", () => {
  const runId = `compile-final-detail-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "http://127.0.0.1:59999/shop";

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: url
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, text: "Demo Shop", timestamp: 900 },
    { type: "input", selector: "#search", fieldName: "q", value: "banana", secret: false, timestamp: 950 },
    { type: "click", selector: "#search-button", text: "Search", timestamp: 1000 },
    { type: "click", selector: ".view-detail", text: "View detail", timestamp: 1100 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Demo Shop", url },
    { selector: "h2", text: "Product detail", url },
    { selector: "#view-detail", text: "View detail", url },
    { selector: "#login", text: "Login", url },
    { selector: "#detail", text: "Banana Milk costs $2.10", url }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "#detail",
    textIncludes: "Banana Milk costs $2.10"
  });
  assert.ok(workflow.verification.proofs.some(
    (proof) => proof.kind === "dom-evidence" &&
      proof.selector === "#detail" &&
      proof.textIncludes === "Banana Milk costs $2.10"
  ));
});

test("compiler prioritizes final-state heading evidence over generic text", () => {
  const runId = `compile-final-state-heading-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "http://127.0.0.1:59999/checkout";

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: url
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, text: "Checkout", timestamp: 900 },
    { type: "click", selector: "#place-order", text: "Place order", timestamp: 1000 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Success!", url },
    { selector: ".content", text: "Order page", url }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "body",
    textIncludes: "Success!"
  });
});

test("compiler prioritizes plural final-state evidence over bounded generic text", () => {
  const runId = `compile-plural-final-state-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "http://127.0.0.1:59999/search";

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: url
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, text: "Search", timestamp: 900 },
    { type: "click", selector: "#search-button", text: "Search", timestamp: 1000 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "div", text: "Available results", url },
    { selector: ".content", text: "Catalog page", url }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "body",
    textIncludes: "Available results"
  });
});

test("compiler prioritizes plural final-state heading evidence", () => {
  const runId = `compile-plural-final-state-heading-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "http://127.0.0.1:59999/orders";

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: url
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, text: "Orders", timestamp: 900 },
    { type: "click", selector: "#show-receipts", text: "Show receipts", timestamp: 1000 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Receipts", url },
    { selector: ".content", text: "Orders page", url }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "body",
    textIncludes: "Receipts"
  });
});

test("compiler demotes compact login action labels below bounded final evidence", () => {
  const runId = `compile-final-action-label-login-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "http://127.0.0.1:59999/account";

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: url
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, text: "Account", timestamp: 900 },
    { type: "click", selector: "#login", text: "Login", timestamp: 1000 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "#login", text: "Login", url },
    { selector: "#done-pane", text: "Welcome back", url }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "#done-pane",
    textIncludes: "Welcome back"
  });
});

test("compiler accepts a final URL query state proof without network or DOM evidence", () => {
  const runId = `compile-url-state-proof-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    startUrl: "https://example.com/map?id=abc&mode=rain"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.com/map?id=abc&mode=rain", text: "Map", timestamp: 900 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, []);

  const workflow = compileRun(runId);

  assert.equal(workflow.finalUrl, "https://example.com/map?id=abc&mode=rain");
  assert.equal(workflow.verification.expectedNetwork, null);
  assert.equal(workflow.verification.expectedEvidence, null);
  assert.deepEqual(
    workflow.verification.proofs.map((proof) => proof.kind),
    ["final-url", "url-state"]
  );
  assert.deepEqual(workflow.verification.proofs[1].params, [
    { key: "id", value: "abc" },
    { key: "mode", value: "rain" }
  ]);
});

test("compiler fails when no sufficient verification proof can be derived", () => {
  const runId = `compile-insufficient-proof-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo" }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, []);

  assert.throws(() => compileRun(runId), /Unable to derive sufficient verification proof set/);
});

test("compiler classifies URL-unchanged controls as state actions", () => {
  const runId = `compile-state-action-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "https://example.com/map?id=abc&mode=sat";
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", unmasked: true, startUrl: url });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, timestamp: 1000 },
    {
      type: "click",
      url,
      text: "Rain",
      role: "button",
      selector: "button.rain",
      timestamp: 1010,
      locator: { role: "button", name: "Rain", structuralKey: "main>button||rain|Rain" }
    }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [{ selector: "[data-mode]", text: "Satellite mode", url }]);

  const workflow = compileRun(runId);
  const click = workflow.steps.find((step) => step.action === "click");
  const stateProof = workflow.verification.proofs.find((proof) => proof.kind === "state-control");

  assert.equal(click.replayIntent, "state_action");
  assert.equal(click.replayPermission.level, "state-proof-replay");
  assert.equal(click.replayPermission.reasonCode, "same-page-state-control");
  assert.equal(click.replayPermission.proofRequired, true);
  assert.equal(stateProof.stepIndex, workflow.steps.indexOf(click));
  assert.equal(stateProof.controlText, "Rain");
  assert.equal(stateProof.controlRole, "button");
  assert.equal(stateProof.domEvidence.textIncludes, "Satellite mode");
});

test("compiler annotates same-page state controls with provider context", () => {
  const runId = `compile-provider-state-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const url = "https://example.com/map?id=abc&mode=sat";
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", unmasked: true, startUrl: url });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url, timestamp: 1000 },
    {
      type: "click",
      url,
      text: "Rain",
      role: "button",
      selector: "button.rain",
      timestamp: 1010,
      locator: { role: "button", name: "Rain", structuralKey: "main>button||rain|Rain" }
    }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, [{ selector: "[data-mode]", text: "Rain mode", url }]);

  const workflow = compileRun(runId);
  const click = workflow.steps.find((step) => step.action === "click");
  const stateProof = workflow.verification.proofs.find((proof) => proof.kind === "state-control");

  assert.deepEqual(click.providerContext, {
    pattern: "layered-control-surface",
    stateCarrier: "dom",
    replayStrategy: "state-proof-click",
    confidence: "medium"
  });
  assert.deepEqual(stateProof.providerContext, click.providerContext);
});

test("compiler prefers action-correlated transition and explicit evidence markers", () => {
  const runId = `compile-priority-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "docs",
    startUrl: "http://127.0.0.1:59999/docs"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/docs", text: "Workspace" },
    { type: "click", selector: "[data-bf=\"catalog-link\"]", text: "Open Catalog", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/docs/catalog", text: "Catalog", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 },
    { url: "http://127.0.0.1:59999/api/ping", method: "GET", status: 200, timestamp: 5000 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Workspace", url: "http://127.0.0.1:59999/docs/catalog" },
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/docs/catalog" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedNetwork);
  assert.ok(workflow.verification.expectedEvidence);
  assert.equal(workflow.verification.expectedNetwork.url, "/api/complete");
  assert.equal(workflow.verification.expectedEvidence.selector, "[data-bf-evidence=\"result\"]");
});

test("compiler ignores redacted secret evidence and uses a safe explicit evidence item", () => {
  const runId = `compile-safe-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"secret\"]", text: "<redacted-secret-text>", url: "http://127.0.0.1:59999/synthetic/result" },
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedEvidence);
  assert.equal(workflow.verification.expectedEvidence.selector, "[data-bf-evidence=\"result\"]");
});

test("compiler prefers final-page evidence and uses body text for generic heading selectors", () => {
  const runId = `compile-final-page-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/home"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/home", text: "Home", timestamp: 900 },
    { type: "click", selector: "a[href=\"/section/101\"]", text: "경제", href: "/section/101", role: "link", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/section/101", text: "Economy", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/section", method: "GET", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Home", url: "http://127.0.0.1:59999/home" },
    { selector: "h1", text: "뉴스", url: "http://127.0.0.1:59999/section/101" },
    { selector: "h2", text: "경제", url: "http://127.0.0.1:59999/section/101" }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.verification.expectedEvidence, {
    selector: "body",
    textIncludes: "뉴스"
  });
});

test("compiler ignores later same-window api noise after the first qualifying transition", () => {
  const runId = `compile-same-window-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1015 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 },
    { url: "http://127.0.0.1:59999/api/ping", method: "GET", status: 200, timestamp: 1008 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedNetwork);
  assert.equal(workflow.verification.expectedNetwork.url, "/api/complete");
});

test("compiler includes same-page final action network in the proof boundary", () => {
  const runId = `compile-same-page-final-action-network-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://example.com/map?mode=rain",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.com/map?mode=rain", text: "Map", timestamp: 900 },
    { type: "click", selector: "button[aria-label=\"refresh\"]", text: "Refresh", role: "button", timestamp: 1000 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://example.com/api/refresh", method: "GET", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, []);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedNetwork);
  assert.equal(workflow.verification.expectedNetwork.url, "https://example.com/api/refresh");
  assert.ok(workflow.verification.proofs.some((proof) => proof.kind === "network"));
});

test("compiler attaches atomicFp metadata to ambiguous click/submit steps", () => {
  const runId = `compile-atomic-fp-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://example.org/notebook",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.org/notebook", text: "App", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "delete 삭제",
      timestamp: 1000,
      ancestors: [
        { tag: "div" },
        { tag: "div", id: "cdk-overlay-3" },
        { tag: "div", id: "mat-menu-panel-279", role: "menu" }
      ],
      siblings: { totalMatchingSelector: 73, totalMatchingRole: 1 }
    },
    {
      type: "submit",
      selector: "form",
      text: "",
      submitterSelector: "button[aria-label=\"삭제 확인\"]",
      submitterText: "삭제",
      formIdentitySelector: "form",
      formMethod: "GET",
      timestamp: 1100,
      ancestors: [
        { tag: "mat-dialog-container", id: "mat-mdc-dialog-0", role: "dialog" },
        { tag: "div" },
        { tag: "div" }
      ],
      siblings: { totalMatchingSelector: 3, totalMatchingRole: 0 }
    },
    { type: "navigate", url: "https://example.org/notebook/done", text: "Done", timestamp: 1200 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://example.org/_/notebooklm/delete", method: "POST", status: 200, timestamp: 1150 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Deleted", url: "https://example.org/notebook/done" }
  ]);

  const workflow = compileRun(runId);

  const clickStep = workflow.steps.find((step) => step.action === "click");
  assert.ok(clickStep !== undefined, "expected a click step");
  assert.deepEqual(
    clickStep.atomicFp,
    { strategy: "role", role: "button", name: "delete 삭제" },
    "click step with totalMatchingRole=1 should pick role strategy"
  );

  const submitStep = workflow.steps.find((step) => step.action === "submit");
  assert.ok(submitStep !== undefined, "expected a submit step");
  assert.deepEqual(
    submitStep.atomicFp,
    { strategy: "ancestor-scope", scopeSelector: "[role=\"dialog\"]" },
    "submit step with totalMatchingRole=0 should fall back to ancestor scope"
  );
  assert.deepEqual(
    submitStep.submitterAtomicFp,
    { strategy: "role", role: "button", name: "삭제" },
    "submit step should derive submitterAtomicFp independently"
  );
});

test("compiler does NOT attach atomicFp when selector is already atomic (back-compat)", () => {
  const runId = `compile-no-atomic-fp-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    {
      type: "click",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      timestamp: 1000,
      ancestors: [],
      siblings: { totalMatchingSelector: 1, totalMatchingRole: 1 }
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);
  const clickStep = workflow.steps.find((step) => step.action === "click");
  assert.ok(clickStep !== undefined, "expected a click step");
  assert.equal(clickStep.atomicFp, undefined, "atomic selector must not carry atomicFp metadata");
});

test("compiler ignores earlier same-window api noise before the real transition", () => {
  const runId = `compile-leading-noise-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1015 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/ping", method: "GET", status: 200, timestamp: 1002 },
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedNetwork);
  assert.equal(workflow.verification.expectedNetwork.url, "/api/complete");
});

test("compiler populates safety.irreversibleStepIndexes when step contains flagged keyword", () => {
  const runId = `compile-safety-flagged-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"checkout\"]", text: "결제하기", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.safety.irreversibleStepIndexes.length > 0, "payment-keyword step must be flagged");
  assert.equal(workflow.safety.consentRequired, true, "consentRequired must be true when irreversible steps exist");
});

test("compiler emits empty irreversibleStepIndexes + consentRequired=false for benign workflow", () => {
  const runId = `compile-safety-benign-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(workflow.safety.irreversibleStepIndexes, [], "benign workflow must have no flagged steps");
  assert.equal(workflow.safety.consentRequired, false, "consentRequired must be false for benign workflow");
});

test("compiler emits default safety scaffold in workflow.json", () => {
  const runId = `compile-safety-scaffold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.safety,
    { irreversibleStepIndexes: [], consentRequired: false, sandbox: { available: false, location: null } },
    "compiled workflow must include a default safety scaffold"
  );
  assert.equal("teardown" in workflow, false, "compile must NOT emit teardown");
  assert.equal("preconditions" in workflow, false, "compile must NOT emit preconditions");
});

test("compiler populates workflow.preconditions from verify-spec with login-required=yes", () => {
  const runId = `compile-preconditions-login-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "https://notebooklm.google.com/",
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://notebooklm.google.com/", text: "NotebookLM", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"open\"]", text: "Open", timestamp: 1000 },
    { type: "navigate", url: "https://notebooklm.google.com/notebook/abc", text: "Notebook", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://notebooklm.google.com/_/notebooklm/open", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Notebook opened", url: "https://notebooklm.google.com/notebook/abc" }
  ]);

  // Write verify-spec.json with login-required=yes and a sentence-style site-url
  const verifySpecPaths = getVerifySpecPaths(runId);
  mkdirSync(dirname(verifySpecPaths.perRunPath), { recursive: true });
  writeJson(verifySpecPaths.perRunPath, {
    schemaVersion: 1,
    answers: {
      "login-required": "yes",
      "site-url": "https://notebooklm.google.com 에서 작업"
    }
  });

  const workflow = compileRun(runId);
  const wf = /** @type {any} */ (workflow);

  assert.deepEqual(
    wf.preconditions,
    [
      {
        kind: "login",
        site: "notebooklm.google.com",
        authMode: "human-bootstrap+keychain-session",
        sessionRef: "verify:notebooklm.google.com"
      }
    ],
    "workflow.preconditions must be populated from verify-spec login-required=yes"
  );
});

test("compiler leaves workflow.preconditions undefined when verify-spec absent or login-required falsy", () => {
  const runId = `compile-preconditions-absent-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  // No verify-spec.json written — preconditions must remain undefined
  const workflow = compileRun(runId);
  assert.equal("preconditions" in workflow, false, "workflow.preconditions must be undefined when no verify-spec");
});

// ---------------------------------------------------------------------------
// compile populates safety.sandbox from verify-spec sandbox-available
// ---------------------------------------------------------------------------

/**
 * Helper: write a minimal synthetic run fixture into an already-ensured run.
 * @param {ReturnType<typeof ensureRunDirs>} runPaths
 */
function writeSyntheticRun(runPaths) {
  writeJson(runPaths.manifestPath, {
    runId: runPaths.runId ?? "placeholder",
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);
}

test("compiler populates safety.sandbox.available=true + location when sandbox-available is provided", () => {
  const runId = `compile-sandbox-truthy-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeSyntheticRun(runPaths);

  const verifySpecPaths = getVerifySpecPaths(runId);
  mkdirSync(dirname(verifySpecPaths.perRunPath), { recursive: true });
  writeJson(verifySpecPaths.perRunPath, {
    schemaVersion: 1,
    answers: {
      "sandbox-available": "yes: testfolder"
    }
  });

  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.safety.sandbox,
    { available: true, location: "testfolder" },
    "sandbox-available=yes: testfolder must yield available:true, location:testfolder"
  );
});

test("compiler populates safety.sandbox.available=true + location=null when sandbox-available is a bare truthy string", () => {
  const runId = `compile-sandbox-bare-truthy-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeSyntheticRun(runPaths);

  const verifySpecPaths = getVerifySpecPaths(runId);
  mkdirSync(dirname(verifySpecPaths.perRunPath), { recursive: true });
  writeJson(verifySpecPaths.perRunPath, {
    schemaVersion: 1,
    answers: {
      "sandbox-available": "/tmp/sandbox"
    }
  });

  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.safety.sandbox,
    { available: true, location: "/tmp/sandbox" },
    "sandbox-available=/tmp/sandbox must yield available:true, location:/tmp/sandbox"
  );
});

test("compiler keeps safety.sandbox scaffold when sandbox-available is falsy (no)", () => {
  const runId = `compile-sandbox-falsy-no-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeSyntheticRun(runPaths);

  const verifySpecPaths = getVerifySpecPaths(runId);
  mkdirSync(dirname(verifySpecPaths.perRunPath), { recursive: true });
  writeJson(verifySpecPaths.perRunPath, {
    schemaVersion: 1,
    answers: {
      "sandbox-available": "no"
    }
  });

  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.safety.sandbox,
    { available: false, location: null },
    "sandbox-available=no must keep scaffold {available:false, location:null}"
  );
});

test("compiler keeps safety.sandbox scaffold when verify-spec absent", () => {
  const runId = `compile-sandbox-absent-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeSyntheticRun(runPaths);

  // No verify-spec written — sandbox stays scaffold
  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.safety.sandbox,
    { available: false, location: null },
    "absent verify-spec must leave sandbox as scaffold {available:false, location:null}"
  );
});

// ---------------------------------------------------------------------------
// compile carries contentEditable flag from input event to fill step
// ---------------------------------------------------------------------------

test("compiler copies contentEditable=true from input event onto fill step", () => {
  const runId = `compile-ce-truthy-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"title\"]",
      fieldName: "title",
      value: "My Note",
      secret: false,
      contentEditable: true,
      timestamp: 950
    },
    { type: "click", selector: "[data-bf=\"save\"]", text: "Save", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Saved", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  const fillStep = workflow.steps.find((step) => step.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  assert.equal(fillStep.contentEditable, true, "fill step must carry contentEditable=true from input event");
});

// ---------------------------------------------------------------------------
// compile carries locator fingerprint onto fill + click steps
// ---------------------------------------------------------------------------

test("compile carries locator onto fill + click steps", () => {
  const runId = `compile-locator-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"title\"]",
      fieldName: "title",
      value: "My Note",
      secret: false,
      locator: { structuralKey: "div>input[type=text]:nth-of-type(1)", role: "textbox" },
      timestamp: 950
    },
    {
      type: "click",
      selector: "[data-bf=\"save\"]",
      text: "Save",
      locator: { role: "button", name: "Save" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Saved", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  const fillStep = workflow.steps.find((step) => step.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  // form-input pattern matches role=textbox, so disambiguation is added
  const fillLoc = /** @type {any} */ (fillStep.locator);
  assert.equal(fillLoc.structuralKey, "div>input[type=text]:nth-of-type(1)", "fill step must carry structuralKey");
  assert.equal(fillLoc.role, "textbox", "fill step must carry role");
  assert.ok(fillLoc.disambiguation?.weightOverrides?.name === 1.5, "fill step locator must get form-input weightOverrides from pattern pass");

  const clickStep = workflow.steps.find((step) => step.action === "click");
  assert.ok(clickStep !== undefined, "expected a click step");
  assert.deepEqual(
    clickStep.locator,
    { role: "button", name: "Save" },
    "click step must carry locator from click event (no pattern matches button)"
  );
});

test("compile does NOT add locator field when event has no locator", () => {
  const runId = `compile-locator-absent-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"name-input\"]",
      fieldName: "name",
      value: "Codex",
      secret: false,
      timestamp: 950
    },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  const fillStep = workflow.steps.find((step) => step.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  assert.equal(fillStep.locator, undefined, "fill step must NOT have locator when input event lacks it");

  const clickStep = workflow.steps.find((step) => step.action === "click");
  assert.ok(clickStep !== undefined, "expected a click step");
  assert.equal(clickStep.locator, undefined, "click step must NOT have locator when click event lacks it");
});

test("compiler coalesces same-gesture click noise and writes ignored-events audit", () => {
  const runId = `compile-coalesce-click-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      selector: "#header",
      text: "",
      role: "banner",
      gestureId: "g1",
      clickX: 100,
      clickY: 50,
      timestamp: 1000
    },
    {
      type: "click",
      selector: "a[href=\"/finance\"]",
      text: "증권",
      href: "/finance",
      role: "link",
      gestureId: "g1",
      clickX: 102,
      clickY: 51,
      timestamp: 1005
    },
    { type: "navigate", url: "http://127.0.0.1:59999/finance", text: "Finance", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1007 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Finance", url: "http://127.0.0.1:59999/finance" }
  ]);

  const workflow = compileRun(runId);
  const clicks = /** @type {any[]} */ (workflow.steps.filter((step) => step.action === "click"));

  assert.equal(clicks.length, 1, "same-gesture header/link click noise must compile to one click");
  assert.equal(clicks[0].text, "증권");
  assert.equal(clicks[0].selector, "a[href=\"/finance\"]");

  const ignored = JSON.parse(readFileSync(runPaths.ignoredEventsPath, "utf8"));
  assert.equal(ignored.schemaVersion, 1);
  assert.equal(ignored.runId, runId);
  assert.equal(ignored.ignored.length, 1);
  assert.equal(ignored.ignored[0].reason, "same-gesture-less-actionable-target");
});

test("compiler keeps action-diff queues aligned after coalescing duplicate clicks", () => {
  const runId = `compile-coalesce-action-diff-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "#header", text: "", role: "banner", gestureId: "g1", timestamp: 1000 },
    { type: "click", selector: "a[href=\"/finance\"]", text: "증권", href: "/finance", role: "link", gestureId: "g1", timestamp: 1005 },
    {
      type: "action-diff",
      refType: "click",
      beforeSkeleton: [{ role: "link", name: "ignored before", structuralKey: "ignored-before" }],
      afterSkeleton: [{ role: "link", name: "ignored after", structuralKey: "ignored-after" }]
    },
    {
      type: "action-diff",
      refType: "click",
      beforeSkeleton: [{ role: "link", name: "kept before", structuralKey: "kept-before" }],
      afterSkeleton: [{ role: "link", name: "kept after", structuralKey: "kept-after" }]
    },
    { type: "click", selector: "button", text: "Refresh", role: "button", gestureId: "g2", timestamp: 2000 },
    {
      type: "action-diff",
      refType: "click",
      beforeSkeleton: [{ role: "button", name: "second before", structuralKey: "second-before" }],
      afterSkeleton: [{ role: "button", name: "second after", structuralKey: "second-after" }]
    },
    { type: "navigate", url: "http://127.0.0.1:59999/finance", text: "Finance", timestamp: 2010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 2005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Finance", url: "http://127.0.0.1:59999/finance" }
  ]);

  const workflow = compileRun(runId);
  const clicks = /** @type {any[]} */ (workflow.steps.filter((step) => step.action === "click"));

  assert.equal(clicks.length, 2);
  assert.equal(clicks[0].transition.appeared[0].structuralKey, "kept-after");
  assert.equal(clicks[1].transition.appeared[0].structuralKey, "second-after");
});

test("compiler excludes a trailing click that navigated away and returned to the final page", () => {
  const runId = `compile-backtracked-trailing-click-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/home"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/home", text: "Home", timestamp: 900 },
    {
      type: "click",
      selector: "a[href=\"/section/101\"]",
      text: "경제",
      href: "/section/101",
      role: "link",
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/section/101", text: "Economy", timestamp: 1010 },
    {
      type: "click",
      selector: ".headline-list li:first-child a",
      text: "Top headline at capture time",
      href: "/article/1",
      role: "link",
      locator: {
        role: "link",
        name: "Top headline at capture time",
        href: "/article/1",
        ordinal: 0,
        structuralKey: "main>ul>li>a"
      },
      ancestors: [
        { tag: "ul", id: "SECTION_HEADLINE_LIST" },
        { tag: "li" }
      ],
      timestamp: 1100
    },
    { type: "navigate", url: "http://127.0.0.1:59999/article/1", text: "Article", timestamp: 1110 },
    { type: "navigate", url: "http://127.0.0.1:59999/section/101", text: "Economy", timestamp: 1120 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/section", method: "GET", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Economy", url: "http://127.0.0.1:59999/section/101" }
  ]);

  const workflow = compileRun(runId);
  const clicks = /** @type {any[]} */ (workflow.steps.filter((step) => step.action === "click"));

  assert.equal(workflow.finalUrl, "/section/101");
  assert.equal(workflow.verification.expectedFinalUrl, "/section/101");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].text, "경제");
  assert.equal(
    workflow.steps.some((step) => /** @type {any} */ (step).textAtCapture === "Top headline at capture time"),
    false,
    "backtracked headline click must not remain in the replay path"
  );

  const ignored = JSON.parse(readFileSync(runPaths.ignoredEventsPath, "utf8"));
  assert.equal(ignored.ignored.length, 2);
  assert.equal(ignored.ignored[0].reason, "backtracked-trailing-action");
  assert.equal(ignored.ignored[0].ignoredText, "Top headline at capture time");
  assert.equal(ignored.ignored[1].reason, "backtracked-trailing-action");
  assert.equal(ignored.ignored[1].ignoredUrl, "http://127.0.0.1:59999/article/1");
});

test("compiler preserves ordinal intent for first dynamic headline clicks", () => {
  const runId = `compile-ordinal-headline-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      selector: ".news-list article:first-child a.headline",
      text: "Captured headline title",
      href: "/news/2026/05/story",
      role: "link",
      locator: {
        role: "link",
        name: "Captured headline title",
        href: "/news/2026/05/story",
        neighborTexts: ["Captured headline title", "Related old headline"],
        ordinal: 0,
        structuralKey: "main>section>article>a"
      },
      ancestors: [
        { tag: "main" },
        { tag: "section", ariaLabel: "News" },
        { tag: "article", role: "listitem" }
      ],
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/news/2026/05/story", text: "Story", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Story", url: "http://127.0.0.1:59999/news/2026/05/story" }
  ]);

  const workflow = compileRun(runId);
  const click = /** @type {any} */ (workflow.steps.find((step) => step.action === "click"));

  assert.ok(click, "expected click step");
  assert.deepEqual(click.ordinalIntent, {
    kind: "dynamic-list-item",
    ordinal: 0,
    description: "current list item #1",
    titleAtCapture: "Captured headline title"
  });
  assert.equal(click.textAtCapture, "Captured headline title");
  assert.equal(click.text, "", "dynamic headline replay must not guard on the old title");
  assert.equal(click.hrefAtCapture, "/news/2026/05/story");
  assert.equal(click.href, "", "dynamic headline replay must not guard on the old href");
  assert.equal(click.locator.name, "", "dynamic headline resolver must not favor the old title");
  assert.equal(click.locator.href, "", "dynamic headline resolver must not favor the old href");
  assert.deepEqual(click.locator.neighborTexts, [], "dynamic headline resolver must not favor old neighboring text");
  assert.equal(click.locator.disambiguation.resolutionMethod, "B");
  assert.equal(click.locator.disambiguation.ordinalHint, 0);
});

test("compiler does NOT add contentEditable field when input event has no contentEditable", () => {
  const runId = `compile-ce-absent-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"name-input\"]",
      fieldName: "name",
      value: "Codex",
      secret: false,
      timestamp: 950
    },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  const fillStep = workflow.steps.find((step) => step.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  assert.equal(fillStep.contentEditable, undefined, "fill step must NOT have contentEditable when input event lacks it");
});

// ---------------------------------------------------------------------------
// compile writes per-page-node affordance-skeleton mold.json
// ---------------------------------------------------------------------------

test("compile writes mold.json with skeleton entries for locator-bearing steps", () => {
  const runId = `compile-mold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"title\"]",
      fieldName: "title",
      value: "My Note",
      secret: false,
      locator: { role: "textbox", name: "Title", structuralKey: "form>input[type=text]:nth-of-type(1)" },
      timestamp: 950
    },
    {
      type: "click",
      selector: "[data-bf=\"save\"]",
      text: "Save",
      locator: { role: "button", name: "Save", structuralKey: "form>button:nth-of-type(1)" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Saved", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  compileRun(runId);

  // The starting page-node key for http://127.0.0.1:59999/synthetic with
  // fixture=synthetic is the normalized path "/synthetic" — derive it via
  // pagePaths to remain decoupled from derivePageKey internals.
  // Both steps above occur on the initial page before the navigate event.
  // Read mold.json from the page-node the input step belongs to.
  const moldRaw = readFileSync(pagePaths("synthetic/synthetic").moldPath, "utf8");
  const mold = JSON.parse(moldRaw);

  assert.ok(Array.isArray(mold.skeleton), "mold.skeleton must be an array");
  assert.equal(typeof mold.pageKey, "string", "mold.pageKey must be present");
  assert.equal(typeof mold.schemaVersion, "number", "mold.schemaVersion must be present");

  const textboxEntry = mold.skeleton.find(
    (/** @type {any} */ e) => e.structuralKey === "form>input[type=text]:nth-of-type(1)"
  );
  assert.ok(textboxEntry !== undefined, "skeleton must include the textbox entry");
  assert.equal(textboxEntry.role, "textbox", "textbox entry role must match");
  assert.equal(textboxEntry.name, "Title", "textbox entry name must match");

  const buttonEntry = mold.skeleton.find(
    (/** @type {any} */ e) => e.structuralKey === "form>button:nth-of-type(1)"
  );
  assert.ok(buttonEntry !== undefined, "skeleton must include the button entry");
  assert.equal(buttonEntry.role, "button", "button entry role must match");
  assert.equal(buttonEntry.name, "Save", "button entry name must match");
});

test("compile writes mold.json with empty skeleton when no locator-bearing steps", () => {
  const runId = `compile-mold-empty-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  compileRun(runId);

  const moldRaw = readFileSync(pagePaths("synthetic/synthetic").moldPath, "utf8");
  const mold = JSON.parse(moldRaw);

  assert.deepEqual(mold.skeleton, [], "skeleton must be empty when no steps have a locator");
});

// ---------------------------------------------------------------------------
// compile writes mold.json from captured full affordance skeleton
// ---------------------------------------------------------------------------

test("compile writes mold.json from captured skeleton (affordance not in any touched step)", () => {
  const runId = `compile-mold-captured-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  // One touched step with a locator — but the captured skeleton adds an extra affordance
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      locator: { role: "button", name: "Run Demo", structuralKey: "form>button:nth-of-type(1)" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  // Write skeleton manifest with an extra affordance (structuralKey "form>input:nth-of-type(1)")
  // that was NOT touched in any captured step — the full-skeleton path must include it.
  writeJson(runPaths.skeletonManifestPath, {
    schemaVersion: 1,
    entries: [
      {
        url: "http://127.0.0.1:59999/synthetic",
        skeleton: [
          { role: "button", name: "Run Demo", structuralKey: "form>button:nth-of-type(1)" },
          { role: "textbox", name: "Extra Field", structuralKey: "form>input:nth-of-type(1)" }
        ]
      }
    ]
  });

  compileRun(runId);

  const moldRaw = readFileSync(pagePaths("synthetic/synthetic").moldPath, "utf8");
  const mold = JSON.parse(moldRaw);

  assert.ok(Array.isArray(mold.skeleton), "mold.skeleton must be an array");

  const extraEntry = mold.skeleton.find(
    (/** @type {any} */ e) => e.structuralKey === "form>input:nth-of-type(1)"
  );
  assert.ok(
    extraEntry !== undefined,
    "mold.skeleton must include the non-touched affordance structuralKey from the captured skeleton"
  );
  assert.equal(extraEntry.role, "textbox", "extra entry role must match captured skeleton");
  assert.equal(extraEntry.name, "Extra Field", "extra entry name must match captured skeleton");
});

test("compile writes mold.json from action-time pageSkeleton when navigation skeleton is missing", () => {
  const runId = `compile-mold-page-skeleton-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      url: "http://127.0.0.1:59999/synthetic",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      locator: { role: "button", name: "Run Demo", structuralKey: "form>button:nth-of-type(1)" },
      pageSkeleton: [
        { role: "button", name: "Run Demo", structuralKey: "form>button:nth-of-type(1)" },
        { role: "link", name: "Untouched Link", structuralKey: "form>a:nth-of-type(1)" }
      ],
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  compileRun(runId);

  const moldRaw = readFileSync(pagePaths("synthetic/synthetic").moldPath, "utf8");
  const mold = JSON.parse(moldRaw);
  const extraEntry = mold.skeleton.find(
    (/** @type {any} */ e) => e.structuralKey === "form>a:nth-of-type(1)"
  );
  assert.ok(extraEntry !== undefined, "mold.skeleton must include non-touched pageSkeleton affordances");
});

test("compile falls back to touched-locator derivation when no skeleton manifest exists", () => {
  const runId = `compile-mold-fallback-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      locator: { role: "button", name: "Run Demo", structuralKey: "form>button:nth-of-type(2)" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);
  // No skeletonManifestPath written — fallback to touched-locator derivation

  compileRun(runId);

  const moldRaw = readFileSync(pagePaths("synthetic/synthetic").moldPath, "utf8");
  const mold = JSON.parse(moldRaw);

  assert.ok(Array.isArray(mold.skeleton), "mold.skeleton must be an array");
  const touchedEntry = mold.skeleton.find(
    (/** @type {any} */ e) => e.structuralKey === "form>button:nth-of-type(2)"
  );
  assert.ok(
    touchedEntry !== undefined,
    "fallback mold.skeleton must include the touched step's structuralKey"
  );
  assert.equal(touchedEntry.role, "button", "touched entry role must match");
  assert.equal(touchedEntry.name, "Run Demo", "touched entry name must match");
});

// ---------------------------------------------------------------------------
// evidence-gate real-site relaxation
// ---------------------------------------------------------------------------

test("compiler falls back to typed-content evidence when DOM evidence has no usable text (real-site SPA)", () => {
  // Real-site finding (Google Keep): collectPageEvidence's fixed selector set
  // ([data-bf-evidence],[role=status],[aria-live],h1,h2) matches only an empty
  // aria-live/status live-region div on content-creation SPAs, so the captured
  // evidence has empty text. The note the user actually created lives in a
  // contenteditable/textbox outside that selector set. The truthful evidence of
  // "create note succeeded" is "the text I typed is present in the page" — derive
  // it from the last non-secret fill step's value.
  const runId = `compile-typed-evidence-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    startUrl: "https://keep.google.com/"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://keep.google.com/", text: "Keep", timestamp: 900 },
    { type: "click", selector: "div", role: "presentation", text: "", timestamp: 950 },
    {
      type: "input",
      selector: "div",
      role: "textbox",
      fieldName: "",
      value: "테스트 진행한다. 20260622",
      secret: false,
      contentEditable: true,
      timestamp: 1000
    },
    { type: "navigate", url: "https://keep.google.com/", text: "Keep", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://notes-pa.clients6.google.com/notes/save", method: "POST", status: 200, timestamp: 1005 }
  ]);
  // The collector returned an empty-text live-region div — no usable DOM evidence.
  writeJson(runPaths.pageEvidencePath, [
    { selector: "div", text: "", url: "https://keep.google.com/" }
  ]);

  const workflow = compileRun(runId);

  assert.deepEqual(
    workflow.verification.expectedEvidence,
    { selector: "body", textIncludes: "테스트 진행한다. 20260622" },
    "evidence must fall back to the typed note content asserted against body"
  );
});

test("typed-content fallback does NOT override a usable DOM evidence marker (back-compat)", () => {
  // When the collector DOES find usable evidence text, the DOM marker wins —
  // the typed-content fallback only fires when no safe DOM evidence exists.
  const runId = `compile-typed-evidence-backcompat-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", value: "Codex", secret: false, timestamp: 950 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(workflow.verification.expectedEvidence);
  assert.equal(
    workflow.verification.expectedEvidence.selector,
    "[data-bf-evidence=\"result\"]",
    "usable DOM evidence marker must win over typed-content fallback"
  );
});

// ---------------------------------------------------------------------------
// signal-poor gate — flag steps needing the scope-agent
// ---------------------------------------------------------------------------

test("compiler flags signal-poor steps in scopeCandidates", () => {
  const runId = `compile-scope-candidates-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, { runId, fixture: "manual", unmasked: true, startUrl: "https://keep.google.com/" });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://keep.google.com/", text: "Keep", timestamp: 900 },
    // Keep "take a note": empty-name <p role=presentation>, no anchor/id/href → signal-poor.
    {
      type: "click",
      selector: "p",
      role: "presentation",
      locator: { role: "presentation", name: "", structuralKey: "div>div>p|role=presentation||", neighborTexts: [], cleanId: "", href: "" },
      timestamp: 950
    },
    { type: "input", selector: "div", role: "textbox", value: "내용", secret: false, timestamp: 1000 },
    { type: "navigate", url: "https://keep.google.com/", text: "Keep", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://notes-pa.clients6.google.com/notes/save", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "div", text: "", url: "https://keep.google.com/" }]);

  const workflow = compileRun(runId);
  const clickIdx = workflow.steps.findIndex((s) => s.action === "click");
  assert.ok(clickIdx >= 0, "expected a click step");
  assert.ok(
    workflow.scopeCandidates.includes(clickIdx),
    `signal-poor click step must be flagged (scopeCandidates=${JSON.stringify(workflow.scopeCandidates)})`
  );
});

test("well-signposted fixture has empty scopeCandidates (no false flags)", () => {
  const runId = `compile-scope-none-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "input",
      selector: "[data-bf=\"name-input\"]",
      fieldName: "name",
      value: "Codex",
      secret: false,
      locator: { role: "textbox", name: "Name", structuralKey: "form>input" },
      timestamp: 950
    },
    {
      type: "click",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      locator: { role: "button", name: "Run Demo", structuralKey: "form>button" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [{ url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }]);

  const workflow = compileRun(runId);
  assert.deepEqual(workflow.scopeCandidates, [], "named/href elements must not be flagged signal-poor");
});

test("compile defaults screenshot security policy to off + not persisted", () => {
  const runId = `compile-screenshot-default-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);
  assert.equal(workflow.security.screenshotMode, "off");
  assert.equal(workflow.security.screenshotsPersisted, false);
});

test("compile freezes stateful-affordance semantics for a reveal control that exposes the next clicked affordance", () => {
  const runId = `compile-reveal-autofreeze-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const baseUrl = "http://127.0.0.1:59999/reveal";

  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: baseUrl });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: baseUrl, text: "Reveal", timestamp: 900 },
    {
      type: "click",
      selector: "a",
      text: "Expand menu",
      href: "/",
      role: "button",
      locator: {
        role: "button",
        name: "Expand menu",
        structuralKey: "header>nav>a|role=button||Expand menu",
        href: "/"
      },
      timestamp: 950
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 951,
      beforeSkeleton: [
        { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" }
      ],
      afterSkeleton: [
        { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" },
        { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" }
      ]
    },
    {
      type: "click",
      selector: "a",
      text: "Weather",
      href: `${baseUrl}/weather`,
      locator: {
        role: "link",
        name: "Weather",
        structuralKey: "nav>ul>li>a|||Weather",
        href: `${baseUrl}/weather`
      },
      timestamp: 960
    },
    { type: "navigate", url: `${baseUrl}/weather`, text: "Weather", timestamp: 970 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/reveal/open", method: "POST", status: 200, timestamp: 955 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"weather\"]", text: "Weather", url: `${baseUrl}/weather` }
  ]);

  const workflow = compileRun(runId);
  assert.deepEqual(
    workflow.steps[1].actionSemantics,
    {
      kind: "stateful-affordance",
      verification: "transition",
      hrefPolicy: "ignore",
      followupStepIndex: 2
    },
    `expand control must freeze reveal semantics — got ${JSON.stringify(workflow.steps[1].actionSemantics)}`
  );
  assert.deepEqual(workflow.revealCandidates, [], "deterministic reveal match should not require a reveal-agent dispatch");
  assert.deepEqual(
    workflow.compounds,
    [
      {
        kind: "reveal-select",
        range: [1, 2],
        pageKey: "synthetic/reveal",
        surfaceKey: "synthetic/reveal#reveal:1",
        triggerStepIndex: 1,
        followupStepIndex: 2
      }
    ],
    `reveal-select compounds must be derived from frozen reveal semantics — got ${JSON.stringify(workflow.compounds)}`
  );
  assert.deepEqual(
    workflow.workflowGraph,
    {
      edges: [
        {
          kind: "reveal",
          fromStepIndex: 1,
          toStepIndex: 2,
          pageKey: "synthetic/reveal",
          surfaceKey: "synthetic/reveal#reveal:1"
        }
      ]
    },
    `workflowGraph reveal edges must be emitted from reveal-select compounds — got ${JSON.stringify(workflow.workflowGraph)}`
  );
});

test("compile flags ambiguous reveal controls in revealCandidates without auto-freezing semantics", () => {
  const runId = `compile-reveal-candidate-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const baseUrl = "http://127.0.0.1:59999/reveal";

  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: baseUrl });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: baseUrl, text: "Reveal", timestamp: 900 },
    {
      type: "click",
      selector: "a",
      text: "Expand menu",
      href: "/",
      role: "button",
      locator: {
        role: "button",
        name: "Expand menu",
        structuralKey: "header>nav>a|role=button||Expand menu",
        href: "/"
      },
      timestamp: 950
    },
    {
      type: "action-diff",
      refType: "click",
      timestamp: 951,
      beforeSkeleton: [
        { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" }
      ],
      afterSkeleton: [
        { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" },
        { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" },
        { role: "link", name: "Sports", structuralKey: "nav>ul>li>a|||Sports" }
      ]
    },
    {
      type: "input",
      selector: "[data-bf=\"search\"]",
      fieldName: "search",
      value: "forecast",
      secret: false,
      locator: {
        role: "textbox",
        name: "Search",
        structuralKey: "header>form>input"
      },
      timestamp: 960
    },
    { type: "navigate", url: baseUrl, text: "Reveal", timestamp: 970 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/reveal/open", method: "POST", status: 200, timestamp: 955 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"reveal\"]", text: "Reveal", url: baseUrl }
  ]);

  const workflow = compileRun(runId);
  assert.equal(workflow.steps[1].actionSemantics, undefined, "ambiguous reveal controls must not be auto-frozen");
  assert.deepEqual(workflow.revealCandidates, [1], `ambiguous reveal control must be queued for reveal-agent review — got ${JSON.stringify(workflow.revealCandidates)}`);
  assert.deepEqual(workflow.compounds, [], "ambiguous reveal controls must not emit compounds before reveal semantics are frozen");
  assert.deepEqual(workflow.workflowGraph, { edges: [] }, "ambiguous reveal controls must not emit workflowGraph edges");
});

test("compile annotates weather-map layer controls with a surface context", () => {
  const runId = `compile-weather-map-surface-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const mapUrl = "https://weather.naver.com/map/09740660?visualMapType=sat";

  writeJson(runPaths.manifestPath, { runId, fixture: "manual", unmasked: true, startUrl: mapUrl });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: mapUrl, text: "Naver Weather", timestamp: 900 },
    {
      type: "click",
      selector: "button",
      text: "위성",
      role: "button",
      locator: {
        role: "button",
        name: "위성",
        structuralKey: "div>div>div>div>div|button|type=button|map_depth_button.type_sat|위성",
        neighborTexts: ["레이더"],
        type: "button"
      },
      timestamp: 950
    },
    {
      type: "click",
      selector: "button",
      text: "관측",
      role: "button",
      locator: {
        role: "button",
        name: "관측",
        structuralKey: "div>div>div>div>div|button|type=button|map_item_button|관측",
        neighborTexts: ["1H 강수일 강수량적설량"],
        type: "button"
      },
      timestamp: 980
    },
    { type: "navigate", url: mapUrl, text: "Naver Weather", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://weather.naver.com/choiceApi/api?layer=sat", method: "GET", status: 200, timestamp: 955 }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "body", text: "NAVER 날씨", url: mapUrl }]);

  const workflow = compileRun(runId);
  assert.deepEqual(workflow.steps[1].surfaceContext, {
    kind: "weather-map",
    surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
    controlGroup: "visual-layer"
  });
  assert.deepEqual(workflow.steps[1].providerContext, {
    pattern: "layered-control-surface",
    stateCarrier: "canvas-tile",
    replayStrategy: "state-proof-click",
    surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
    controlGroup: "visual-layer",
    confidence: "high"
  });
  assert.deepEqual(workflow.steps[2].surfaceContext, {
    kind: "weather-map",
    surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
    controlGroup: "observation-layer"
  });
  assert.deepEqual(workflow.steps[2].providerContext, {
    pattern: "layered-control-surface",
    stateCarrier: "canvas-tile",
    replayStrategy: "state-proof-click",
    surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
    controlGroup: "observation-layer",
    confidence: "high"
  });
});

test("compile does not over-classify unrelated same-page controls as weather-map surfaces", () => {
  const runId = `compile-non-weather-surface-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    {
      type: "click",
      selector: "[data-bf=\"launch\"]",
      text: "Run Demo",
      locator: { role: "button", name: "Run Demo", structuralKey: "form>button", type: "button" },
      timestamp: 1000
    },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", text: "Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }
  ]);

  const workflow = compileRun(runId);
  assert.equal(workflow.steps[1].surfaceContext, undefined);
});
