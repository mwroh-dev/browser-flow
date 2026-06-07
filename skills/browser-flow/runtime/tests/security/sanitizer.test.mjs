import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJson, writeText } from "../../scripts/lib/fs.mjs";
import { sanitizeEvent } from "../../scripts/sanitize/event-sanitizer.mjs";
import { scanArtifacts } from "../../scripts/security/scan-artifacts.mjs";

test("sanitizer redacts secret input values and sensitive headers", () => {
  const input = sanitizeEvent({
    type: "input",
    selector: "[data-bf=\"password\"]",
    fieldName: "password",
    value: "super-secret-value"
  });
  const network = sanitizeEvent({
    type: "network.response",
    url: "http://127.0.0.1:4010/api?token=abcdefghijklmnopqrstuvwxyz",
    headers: {
      authorization: "Bearer abc",
      accept: "application/json"
    }
  });

  assert.equal("value" in input ? input.value : "", "<redacted-secret>");
  assert.equal("fieldName" in input ? input.fieldName : "", "<redacted-field>");
  assert.equal("headers" in network ? Object.hasOwn(network.headers, "authorization") : false, false);
  assert.match("url" in network ? String(network.url) : "", /token=%3Credacted%3E/);
});

test("page evidence redacts semantic secret text", () => {
  const evidence = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"secret\"]",
    text: "password=letmein"
  });

  assert.equal("text" in evidence ? evidence.text : "", "<redacted-secret-text>");
});

test("sanitizer preserves role + contentEditable on input/click events (SPA capture)", () => {
  // Regression: these fields were silently dropped by the field allowlist, so the
  // enhancement never reached the workflow in the real capture pipeline
  // (the e2e gate authored the workflow directly, bypassing sanitize). Lock them in.
  const ceInput = sanitizeEvent({
    type: "input",
    selector: "div",
    fieldName: "",
    role: "textbox",
    contentEditable: true,
    value: "hello"
  });
  assert.equal("role" in ceInput ? ceInput.role : "", "textbox");
  assert.equal("contentEditable" in ceInput ? ceInput.contentEditable : false, true);
  assert.equal("value" in ceInput ? ceInput.value : "", "hello");

  const roleClick = sanitizeEvent({
    type: "click",
    selector: "div",
    role: "button",
    text: "Create"
  });
  assert.equal("role" in roleClick ? roleClick.role : "", "button");

  // A non-contenteditable input must NOT gain a contentEditable field.
  const plainInput = sanitizeEvent({ type: "input", selector: "input", fieldName: "q", value: "x" });
  assert.equal("contentEditable" in plainInput ? plainInput.contentEditable : undefined, undefined);
});

test("page evidence redacts quoted json-like secret text but not benign toggles", () => {
  const quoted = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"secret\"]",
    text: "\"password\":\"letmein\""
  });
  const benign = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"status\"]",
    text: "token=disabled"
  });

  assert.equal("text" in quoted ? quoted.text : "", "<redacted-secret-text>");
  assert.equal("text" in benign ? benign.text : "", "token=disabled");
});

test("page evidence redacts short token-like session secrets", () => {
  const token = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"token\"]",
    text: "token=abc123"
  });
  const session = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"session\"]",
    text: "\"session\":\"deadbeef\""
  });

  assert.equal("text" in token ? token.text : "", "<redacted-secret-text>");
  assert.equal("text" in session ? session.text : "", "<redacted-secret-text>");
});

test("page evidence redacts short auth and api-key variants", () => {
  const auth = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"auth\"]",
    text: "authorization=x"
  });
  const authAlias = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"auth\"]",
    text: "auth=x"
  });
  const apiUnderscore = sanitizeEvent({
    type: "page-evidence",
    selector: "[data-bf-evidence=\"api\"]",
    text: "api_key=abc123"
  });

  assert.equal("text" in auth ? auth.text : "", "<redacted-secret-text>");
  assert.equal("text" in authAlias ? authAlias.text : "", "<redacted-secret-text>");
  assert.equal("text" in apiUnderscore ? apiUnderscore.text : "", "<redacted-secret-text>");
});

test("artifact scanner flags seeded secret leaks", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-scan-"));
  const output = join(root, "security.json");
  writeJson(join(root, "safe.json"), { ok: true });
  writeText(join(root, "leak.txt"), "authorization: Bearer abcdefghijklmnopqrstuvwxyz");

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.length > 0, true);
  assert.equal(JSON.stringify(report).includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(readFileSync(output, "utf8").includes("abcdefghijklmnopqrstuvwxyz"), false);
});

test("artifact scanner flags persisted forbidden header names even with short values", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-header-"));
  const output = join(root, "security.json");
  writeJson(join(root, "headers.json"), {
    headers: {
      authorization: "Bearer short"
    }
  });

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret header name"), true);
});

test("artifact scanner flags plain-text forbidden header lines with short values", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-header-text-"));
  const output = join(root, "security.json");
  writeText(join(root, "headers.txt"), "authorization: x");

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret header name"), true);
});

test("artifact scanner flags semantic secret assignment text", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-secret-text-"));
  const output = join(root, "security.json");
  writeText(join(root, "evidence.txt"), "password=letmein");

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(JSON.stringify(report).includes("letmein"), false);
  assert.equal(readFileSync(output, "utf8").includes("letmein"), false);
});

test("artifact scanner flags quoted secret assignment text but not benign toggles", () => {
  const flaggedRoot = mkdtempSync(join(tmpdir(), "browser-flow-secret-quoted-"));
  const flaggedOutput = join(flaggedRoot, "security.json");
  writeText(join(flaggedRoot, "quoted.txt"), "\"password\":\"letmein\"");
  const flagged = scanArtifacts(flaggedRoot, flaggedOutput);

  assert.equal(flagged.ok, false);
  assert.equal(flagged.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(readFileSync(flaggedOutput, "utf8").includes("letmein"), false);

  const benignRoot = mkdtempSync(join(tmpdir(), "browser-flow-secret-benign-"));
  const benignOutput = join(benignRoot, "security.json");
  writeText(join(benignRoot, "benign.txt"), "token=disabled");
  const benign = scanArtifacts(benignRoot, benignOutput);

  assert.equal(benign.ok, true);
});

test("artifact scanner flags short token-like secret assignments", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-secret-short-"));
  const output = join(root, "security.json");
  writeText(join(root, "short.txt"), "token=abc123\nsession=deadbeef\ncsrf=xyz789");

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(readFileSync(output, "utf8").includes("deadbeef"), false);
  assert.equal(readFileSync(output, "utf8").includes("xyz789"), false);
});

test("artifact scanner flags short auth and api-key variants", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-secret-auth-"));
  const output = join(root, "security.json");
  writeText(join(root, "auth.txt"), "authorization=x\nauth=x\napi_key=abc123");

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(readFileSync(output, "utf8").includes("abc123"), false);
});

test("sanitizer preserves the locator fingerprint (capture→sanitize)", () => {
  const ev = sanitizeEvent({
    type: "click",
    selector: "div",
    role: "button",
    text: "Save",
    locator: { role: "button", name: "Save", structuralKey: "main>form|button||btn|Save", relXPath: "//*[@id='f']/button[1]", box: { cx: 10, cy: 20, w: 5, h: 5 } }
  });
  const loc = /** @type {any} */ (ev).locator;
  assert.ok(loc, "locator must survive sanitize");
  assert.equal(loc.structuralKey, "main>form|button||btn|Save");
  assert.equal(loc.name, "Save");
  assert.equal(loc.relXPath, "//*[@id='f']/button[1]");
});
test("sanitizer redacts a forbidden locator name", () => {
  const ev = sanitizeEvent({ type: "input", selector: "input", fieldName: "x", value: "y", locator: { role: "textbox", name: "password" } });
  assert.equal(/** @type {any} */ (ev).locator.name, "<redacted-field>");
});

test("artifact scanner under --unmasked downgrades findings to warn-not-block", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-unmasked-"));
  const output = join(root, "security.json");
  writeText(join(root, "leak.txt"), "authorization: Bearer abcdefghijklmnopqrstuvwxyz");

  const masked = scanArtifacts(root, output, { unmasked: false });
  assert.equal(masked.ok, false, "default mode must still block when findings present");
  assert.equal(masked.warningOnly, false);

  const unmasked = scanArtifacts(root, output, { unmasked: true });
  assert.equal(unmasked.ok, true, "unmasked must allow pipeline progress despite findings");
  assert.equal(unmasked.warningOnly, true, "warningOnly distinguishes warned-only from clean");
  assert.equal(unmasked.findings.length > 0, true, "findings still populated for operator visibility");

  const clean = mkdtempSync(join(tmpdir(), "browser-flow-unmasked-clean-"));
  const cleanOutput = join(clean, "security.json");
  writeJson(join(clean, "fine.json"), { ok: true });
  const cleanReport = scanArtifacts(clean, cleanOutput, { unmasked: true });
  assert.equal(cleanReport.ok, true);
  assert.equal(cleanReport.warningOnly, false, "warningOnly false when no findings even under unmasked");
});

test("artifact scanner ignores sanitized screenshot PNGs under reports/screenshots", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-screenshot-scan-"));
  const output = join(root, "security.json");
  mkdirSync(join(root, "reports", "screenshots"), { recursive: true });
  writeText(join(root, "reports", "screenshots", "final.png"), "authorization: Bearer abcdefghijklmnopqrstuvwxyz");

  const report = scanArtifacts(root, output, { unmasked: false });
  assert.equal(report.ok, true, "sanitized screenshot artifacts must not trip the text scanner");
  assert.deepEqual(report.findings, []);
});

test("artifact scanner does not treat long JSON schema keys as high entropy values", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-long-json-key-"));
  const output = join(root, "security.json");
  writeJson(join(root, "events.json"), {
    visibleActionableAncestor: { selector: "button", name: "Visible" },
    viewportIntersectionRatio: 1
  });

  const report = scanArtifacts(root, output, { unmasked: false });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test("artifact scanner ignores generated source identifiers and arbitrary JSON keys", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-identifiers-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    async function captureDiagnosticShotIfAllowed() {}
    const token = String(candidate || "").toLowerCase();
    await client.send("Emulation.setDeviceMetricsOverride", {});
  `);
  writeJson(join(root, "verification.json"), {
    surfaceActionabilityChecks: [],
    proofProviderContext: { status: "passed" }
  });

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test("artifact scanner still flags high entropy string literals in generated source", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-literal-leak-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const leaked = "Abcdefghijklmnopqrstuvwxyz";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner flags dotted high entropy string literals in generated source", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-dotted-literal-leak-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const leaked = "AbcdefghijklmnopqrstuvwxyzABCDEF.BbcdefghijklmnopqrstuvwxyzABCDEF.CbcdefghijklmnopqrstuvwxyzABCDEF";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner flags JS string literals before ternary colons", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-ternary-literal-leak-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const mode = isProd ? "Abcdefghijklmnopqrstuvwxyz" : "dev";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner ignores JS comment quotes when scanning string literal secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-comment-literal-leak-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    // user's diagnostic token marker
    const leaked = 'Abcdefghijklmnopqrstuvwxyz';
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner flags high entropy values in JS regex literals", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-regex-literal-leak-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const leakedPattern = /Abcdefghijklmnopqrstuvwxyz/;
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner flags semantic secret assignments in JS source", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-semantic-secret-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const password = "letmein";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(readFileSync(output, "utf8").includes("letmein"), false);
});

test("artifact scanner flags high entropy values in JS comments", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-comment-secret-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    // leaked diagnostic token: Abcdefghijklmnopqrstuvwxyz
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner ignores generated source symbols among mixed quote literals", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-mixed-quotes-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const before = "safe"; await client.send('Emulation.setDeviceMetricsOverride', {}); const after = "safe";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test("artifact scanner flags escaped-prefix dotted high entropy literals in JS source", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-escaped-dotted-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const leaked = "\\"AbcdefghijklmnopqrstuvWxy.MbcdefghijklmnopqrstuvWxy";
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "high entropy token candidate"), true);
});

test("artifact scanner flags template literal semantic secret assignments in JS source", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-source-template-secret-"));
  const output = join(root, "security.json");
  writeText(join(root, "runner.mjs"), `
    const token = \`letmein\`;
  `);

  const report = scanArtifacts(root, output, { unmasked: false });

  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.reason === "secret assignment text"), true);
  assert.equal(readFileSync(output, "utf8").includes("letmein"), false);
});

test("artifact scanner classifies known CDP opaque runtime IDs as non-blocking audit findings", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-cdp-ids-"));
  const output = join(root, "security.json");
  mkdirSync(join(root, "analysis"), { recursive: true });
  mkdirSync(join(root, "events"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  writeJson(join(root, "analysis", "step-ledger.json"), {
    steps: [
      {
        before: { enrichment: [{ frameId: "A".repeat(32) }] },
        after: { enrichment: [{ frameId: "B".repeat(32) }] }
      }
    ]
  });
  writeText(join(root, "events", "journal.jsonl"), `${JSON.stringify({ type: "click", frameId: "C".repeat(32) })}\n`);
  writeJson(join(root, "reports", "verification.json"), {
    replayViewport: { appliedTargets: [{ targetId: "D".repeat(32) }] }
  });

  const report = scanArtifacts(root, output, { unmasked: false });
  const cdpFindings = report.findings.filter((finding) => finding.category === "cdp-opaque-runtime-id");

  assert.equal(report.ok, true);
  assert.equal(report.warningOnly, false);
  assert.equal(cdpFindings.length, 4);
  assert.equal(cdpFindings.every((finding) => finding.severity === "info" && finding.blocking === false), true);
  assert.equal(readFileSync(output, "utf8").includes("AAAAAAAA"), false);
});

test("artifact scanner still blocks same-shaped high-entropy values outside known CDP metadata paths", () => {
  const unrelatedRoot = mkdtempSync(join(tmpdir(), "browser-flow-cdp-unrelated-"));
  const unrelatedOutput = join(unrelatedRoot, "security.json");
  mkdirSync(join(unrelatedRoot, "reports"), { recursive: true });
  writeJson(join(unrelatedRoot, "reports", "other.json"), {
    frameId: "E".repeat(32)
  });

  const unrelated = scanArtifacts(unrelatedRoot, unrelatedOutput, { unmasked: false });

  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.findings.some((finding) => finding.category === "cdp-opaque-runtime-id"), false);

  const secretRoot = mkdtempSync(join(tmpdir(), "browser-flow-cdp-secret-key-"));
  const secretOutput = join(secretRoot, "security.json");
  mkdirSync(join(secretRoot, "reports"), { recursive: true });
  writeJson(join(secretRoot, "reports", "verification.json"), {
    replayViewport: { appliedTargets: [{ token: "F".repeat(32) }] }
  });

  const secret = scanArtifacts(secretRoot, secretOutput, { unmasked: false });

  assert.equal(secret.ok, false);
  assert.equal(secret.findings.some((finding) => finding.blocking !== false), true);
});
