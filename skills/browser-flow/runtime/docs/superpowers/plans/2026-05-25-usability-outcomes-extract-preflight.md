# Browser Flow Usability Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve user-facing browser-flow usability by separating replay truth from promotion gates, surfacing concise summaries, previewing capture noise before recapture, routing data-collection requests into Extract, and preflighting runtime permission failures.

**Architecture:** Keep the runtime pipeline order unchanged: Capture -> Analyze -> Generate -> Verify -> optional Extract. Add small deterministic helpers at layer boundaries, keep raw artifacts as audit records, and add user-facing summary artifacts rather than deleting debug detail. Preserve backward compatibility by keeping legacy fields such as `verificationOutcome` and `securityOk` while adding clearer fields.

**Tech Stack:** Node.js ESM, Zod schemas in `scripts/lib/schemas.mjs`, native `node:test`, project-local browser-flow CLI, tracked source bundle under `.codex/skills/browser-flow/bundle/`, release sync to `/Users/cielo-iamdt/projects/browser-flow-released`.

---

## Scope

Included:
- Split replay outcome from registry/promotion outcome.
- Split raw security scan result from promotion-grade security cleanliness.
- Add compact verification summary output for user-facing reports.
- Add `done`-time capture noise preview so one accidental detour does not imply recapture.
- Add deterministic data-intent/schema proposal support for "current/top/latest/list/headline/value" requests.
- Add runtime dependency permission preflight before `npm ci`.

Excluded:
- Installed bundle stale detection. This was item 6 from the prior discussion and is intentionally not in this plan.

## Lane Map

Lane A - Verification semantics:
- Task 1 must land before Task 2 because the summary layer depends on the new outcome fields.

Lane B - Capture and data intent:
- Task 3 and Task 4 can proceed in parallel after Task 1 because they touch different modules.

Lane C - Runtime preflight:
- Task 5 is independent and can proceed in parallel with Lane A/B.

Release lane:
- Task 6 must run after all source commits.

## Phase Gates

Each phase closes only after:
- Eval: focused tests for the task pass.
- Result: the artifact or CLI output shows the intended user-facing behavior.
- Backlog review: any discovered root issue is either fixed immediately or recorded in this plan's backlog section with a concrete reason.
- Commit: one commit per task unless two tasks touched the same file in a way that cannot be staged cleanly without patch-level risk.

---

### Task 1: Split Replay Outcome From Promotion Outcome

**Problem:** `success:true` with `verificationOutcome:not_verified` is structurally confusing. `security.ok:true` with `securityOk:false` is also confusing because one means scan execution passed and the other means promotion-grade clean.

**Files:**
- Create: `scripts/lib/verification-outcomes.mjs`
- Create: `tests/lib/verification-outcomes.test.mjs`
- Modify: `scripts/verify/verify-run.mjs`
- Modify: `scripts/lib/schemas.mjs`
- Modify: `tests/verify/verify-run.test.mjs`
- Modify: `tests/reports/schema-versions.test.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs`

**Target Contract:**

Add optional additive fields to `reports/verification.json`:

```js
{
  replayOutcome: "passed" | "held" | "failed",
  promotionOutcome: "promoted" | "not_promoted",
  promotionBlockers: [
    { gate: "security" | "local_only" | "replay" | "registry", reason: "warning_only_findings" }
  ],
  securityScanOk: true,
  securityPromotionClean: false,
  verificationOutcome: "not_verified",
  securityOk: false
}
```

Legacy fields remain:
- `verificationOutcome` stays for current readers.
- `securityOk` stays as an alias for `securityPromotionClean`.

**Eval:**
- A replay-success real-site diagnostic report must show `replayOutcome:"passed"` and `promotionOutcome:"not_promoted"`.
- A clean local replay must show `replayOutcome:"passed"` and `promotionOutcome:"promoted"`.
- A locator drift must keep `replayOutcome:"held"` even when security has warning-only findings.

**Result:**
- Users and orchestrators can say "replay succeeded, promotion was blocked" without inferring from conflicting booleans.

**Backlog Review:**
- If schema consumers break because they assume only old fields, keep fields optional and add tests proving old minimal reports still parse.

- [ ] **Step 1: Write outcome helper tests**

Add `tests/lib/verification-outcomes.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveVerificationOutcomes } from "../../scripts/lib/verification-outcomes.mjs";

test("deriveVerificationOutcomes separates successful replay from blocked real-site promotion", () => {
  const out = deriveVerificationOutcomes({
    report: { success: true, pathComplete: true, transitionChecks: [], resultEvidence: { passed: true } },
    security: { ok: true, warningOnly: true, findings: [{ file: "x", reason: "high entropy", match: "<redacted>" }] },
    workflowUnmasked: true,
    securityClean: false
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.equal(out.securityScanOk, true);
  assert.equal(out.securityPromotionClean, false);
  assert.deepEqual(out.promotionBlockers, [
    { gate: "security", reason: "warning_only_findings" },
    { gate: "local_only", reason: "unmasked_real_site_diagnostic" }
  ]);
});

test("deriveVerificationOutcomes preserves replay holds as the primary outcome", () => {
  const out = deriveVerificationOutcomes({
    report: {
      success: false,
      pathComplete: false,
      transitionChecks: [],
      resultEvidence: { passed: false },
      failureReason: "replay-error",
      error: "ambiguous locator"
    },
    security: { ok: true, warningOnly: true, findings: [] },
    workflowUnmasked: true,
    securityClean: false
  });

  assert.equal(out.replayOutcome, "held");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.equal(out.promotionBlockers.some((b) => b.gate === "replay"), true);
});

test("deriveVerificationOutcomes marks clean local replay as promoted", () => {
  const out = deriveVerificationOutcomes({
    report: { success: true, pathComplete: true, transitionChecks: [], resultEvidence: { passed: true } },
    security: { ok: true, warningOnly: false, findings: [] },
    workflowUnmasked: false,
    securityClean: true
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "promoted");
  assert.deepEqual(out.promotionBlockers, []);
  assert.equal(out.securityScanOk, true);
  assert.equal(out.securityPromotionClean, true);
});
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
node --test tests/lib/verification-outcomes.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/lib/verification-outcomes.mjs
```

- [ ] **Step 3: Implement outcome helper**

Create `scripts/lib/verification-outcomes.mjs`:

```js
/**
 * @param {{
 *   report: Record<string, any>,
 *   security: { ok?: boolean, warningOnly?: boolean, findings?: any[] },
 *   workflowUnmasked: boolean,
 *   securityClean: boolean
 * }} input
 */
export function deriveVerificationOutcomes(input) {
  const report = input.report ?? {};
  const security = input.security ?? {};
  const replayPassed = report.success === true && report.pathComplete === true && report.resultEvidence?.passed !== false;
  const replayHeld = report.success === false && (
    typeof report.heldAtSegment === "number" ||
    /ambiguous locator|Action-path mismatch|method-B transition mismatch|Timeout waiting/i.test(
      `${report.failureReason ?? ""}\n${report.error ?? ""}`
    ) ||
    report.resultEvidence?.passed === false
  );

  const replayOutcome = replayPassed ? "passed" : replayHeld ? "held" : "failed";
  const promotionBlockers = [];
  if (replayOutcome !== "passed") {
    promotionBlockers.push({ gate: "replay", reason: replayOutcome === "held" ? "replay_hold" : "replay_failed" });
  }
  if (security.ok !== true) {
    promotionBlockers.push({ gate: "security", reason: "scan_failed" });
  } else if (!input.securityClean) {
    promotionBlockers.push({ gate: "security", reason: security.warningOnly ? "warning_only_findings" : "not_clean" });
  }
  if (input.workflowUnmasked) {
    promotionBlockers.push({ gate: "local_only", reason: "unmasked_real_site_diagnostic" });
  }

  return {
    replayOutcome,
    promotionOutcome: promotionBlockers.length === 0 ? "promoted" : "not_promoted",
    promotionBlockers,
    securityScanOk: security.ok === true,
    securityPromotionClean: input.securityClean === true
  };
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
node --test tests/lib/verification-outcomes.test.mjs
```

Expected:

```text
# pass 3
# fail 0
```

- [ ] **Step 5: Extend verification schema additively**

In `scripts/lib/schemas.mjs`, add these optional fields inside `VerificationV1`:

```js
    replayOutcome: z.enum(["passed", "held", "failed"]).optional(),
    promotionOutcome: z.enum(["promoted", "not_promoted"]).optional(),
    promotionBlockers: z.array(
      z.object({
        gate: z.enum(["security", "local_only", "replay", "registry"]),
        reason: z.string().min(1)
      }).passthrough()
    ).optional(),
    securityScanOk: z.boolean().optional(),
    securityPromotionClean: z.boolean().optional(),
```

- [ ] **Step 6: Wire outcomes in verify-run**

In `scripts/verify/verify-run.mjs`, import the helper:

```js
import { deriveVerificationOutcomes } from "../lib/verification-outcomes.mjs";
```

When building the final report, spread the helper output after `classifyVerificationOutcome`:

```js
  const clearOutcomes = deriveVerificationOutcomes({
    report,
    security,
    workflowUnmasked,
    securityClean
  });

  finalReport = parseVerificationArtifact(
    {
      ...finalReport,
      ...classifyVerificationOutcome(report, securityClean),
      ...clearOutcomes,
      securityOk: clearOutcomes.securityPromotionClean,
      diagnosticMode: workflowUnmasked
    },
    runPaths.verificationPath
  );
```

- [ ] **Step 7: Add verify-run regression test**

In `tests/verify/verify-run.test.mjs`, add:

```js
test("unmasked successful replay reports replay passed but promotion not promoted", async () => {
  const runId = `verify-outcome-split-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeFileSync(runPaths.workflowJsonPath, JSON.stringify({
    schemaVersion: 1,
    id: runId,
    fixture: "manual",
    startUrl: "https://example.test/",
    finalUrl: "https://example.test/news",
    steps: [],
    verification: { expectedFinalUrl: "https://example.test/news", transitionTimeoutMs: 1 },
    security: { localOnly: false }
  }, null, 2));
  writeFileSync(runPaths.runnerPath, `
    import { writeFileSync } from "node:fs";
    const report = {
      schemaVersion: 1,
      success: true,
      pathComplete: true,
      executedSteps: [],
      stepCount: 0,
      transitionChecks: [],
      resultEvidence: { passed: true, selector: "body", actualText: "뉴스", expectedText: "뉴스" },
      securityOk: false,
      verifiedAt: new Date().toISOString()
    };
    writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
  `);
  writeFileSync(join(runPaths.runRoot, "network-summary.json"), JSON.stringify([{ token: "abcdefghijklmnopqrstuvwxyz1234567890" }]));

  const result = await verifyRun(runId, { headless: true });
  assert.equal(result.report.replayOutcome, "passed");
  assert.equal(result.report.promotionOutcome, "not_promoted");
  assert.equal(result.report.securityScanOk, true);
  assert.equal(result.report.securityPromotionClean, false);
  assert.equal(result.report.securityOk, false);
});
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
node --test tests/lib/verification-outcomes.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/verify/verify-run.test.mjs tests/reports/schema-versions.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 9: Mirror runtime files into the tracked bundle**

Run:

```bash
cp -R scripts/lib/verification-outcomes.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs
cp -R scripts/verify/verify-run.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs
cp -R scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs
```

- [ ] **Step 10: Commit Task 1**

Run:

```bash
git add scripts/lib/verification-outcomes.mjs tests/lib/verification-outcomes.test.mjs scripts/verify/verify-run.mjs scripts/lib/schemas.mjs tests/verify/verify-run.test.mjs tests/reports/schema-versions.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs
git commit -m "fix: split replay and promotion outcomes"
```

---

### Task 2: Add Compact User-Facing Verification Summary

**Problem:** Real-site verification output can dump hundreds of network entries. Users need a short summary and artifact paths; raw report remains available for debugging.

**Files:**
- Create: `scripts/lib/report-summary.mjs`
- Create: `tests/lib/report-summary.test.mjs`
- Modify: `scripts/verify/verify-run.mjs`
- Modify: `scripts/cli-main.mjs`
- Modify: `tests/verify/verify-run.test.mjs`
- Modify: `tests/bootstrap.test.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs`

**Target Contract:**

`reports/verification-summary.json`:

```js
{
  schemaVersion: 1,
  runId: "naver-market-news-20260525-01",
  headline: "Diagnostic replay succeeded; registry promotion is blocked by warning-only security findings.",
  replayOutcome: "passed",
  promotionOutcome: "not_promoted",
  route: { pathComplete: true, executedSteps: 5, stepCount: 5 },
  evidence: { passed: true, selector: "body", expectedText: "뉴스" },
  blockers: [{ gate: "security", reason: "warning_only_findings" }],
  reports: {
    verification: "artifacts/runs/<id>/reports/verification.json",
    security: "artifacts/runs/<id>/reports/security.json"
  }
}
```

`bf verify --summary --run-id <id>` returns:

```js
{
  ok: true,
  summary: { "...": "..." },
  reports: { verification: "...", security: "..." }
}
```

Default `bf verify` can keep current full output for compatibility.

**Eval:**
- `--summary` output must not contain `transitionChecks[0].actual` network arrays.
- Summary must use "diagnostic replay succeeded" when replay passed and promotion did not.

**Result:**
- The orchestrator can relay a concise result without forcing the user through raw JSON.

**Backlog Review:**
- If tests reveal consumers parse `verify` stdout directly, keep default full mode and only update skill instructions to use `--summary` for user-facing flows.

- [ ] **Step 1: Write summary helper tests**

Create `tests/lib/report-summary.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildVerificationSummary } from "../../scripts/lib/report-summary.mjs";

test("buildVerificationSummary renders diagnostic replay success without network detail", () => {
  const summary = buildVerificationSummary({
    runId: "r1",
    verificationPath: "artifacts/runs/r1/reports/verification.json",
    securityPath: "artifacts/runs/r1/reports/security.json",
    report: {
      success: true,
      pathComplete: true,
      executedSteps: ["goto", "click"],
      stepCount: 2,
      replayOutcome: "passed",
      promotionOutcome: "not_promoted",
      promotionBlockers: [{ gate: "security", reason: "warning_only_findings" }],
      resultEvidence: { passed: true, selector: "body", expectedText: "뉴스", actualText: "<redacted-secret>" },
      transitionChecks: [{ name: "network", actual: new Array(200).fill({ url: "<non-local-url>" }) }]
    }
  });

  assert.equal(summary.headline, "Diagnostic replay succeeded; registry promotion is blocked.");
  assert.equal(summary.route.executedSteps, 2);
  assert.deepEqual(summary.blockers, [{ gate: "security", reason: "warning_only_findings" }]);
  assert.equal(JSON.stringify(summary).includes("non-local-url"), false);
});
```

- [ ] **Step 2: Run summary tests to verify RED**

Run:

```bash
node --test tests/lib/report-summary.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/lib/report-summary.mjs
```

- [ ] **Step 3: Implement summary helper**

Create `scripts/lib/report-summary.mjs`:

```js
/**
 * @param {{
 *   runId: string,
 *   verificationPath: string,
 *   securityPath: string,
 *   report: Record<string, any>
 * }} input
 */
export function buildVerificationSummary(input) {
  const report = input.report ?? {};
  const replayOutcome = report.replayOutcome ?? (report.success ? "passed" : "failed");
  const promotionOutcome = report.promotionOutcome ?? (report.securityOk ? "promoted" : "not_promoted");
  const blockers = Array.isArray(report.promotionBlockers) ? report.promotionBlockers : [];
  const headline = replayOutcome === "passed" && promotionOutcome === "not_promoted"
    ? "Diagnostic replay succeeded; registry promotion is blocked."
    : replayOutcome === "passed"
      ? "Replay verified and promotion gates are green."
      : replayOutcome === "held"
        ? "Replay held at a guarded step; the workflow was not promoted."
        : "Replay failed before verification could be promoted.";

  return {
    schemaVersion: 1,
    runId: input.runId,
    headline,
    replayOutcome,
    promotionOutcome,
    route: {
      pathComplete: report.pathComplete === true,
      executedSteps: Array.isArray(report.executedSteps) ? report.executedSteps.length : 0,
      stepCount: typeof report.stepCount === "number" ? report.stepCount : 0
    },
    evidence: report.resultEvidence
      ? {
          passed: report.resultEvidence.passed === true,
          selector: String(report.resultEvidence.selector ?? ""),
          expectedText: String(report.resultEvidence.expectedText ?? "")
        }
      : undefined,
    blockers,
    reports: {
      verification: input.verificationPath,
      security: input.securityPath
    }
  };
}
```

- [ ] **Step 4: Persist summary in verify-run**

In `scripts/verify/verify-run.mjs`, import:

```js
import { buildVerificationSummary } from "../lib/report-summary.mjs";
```

After final `writeJson(runPaths.verificationPath, finalReport);`, add:

```js
  const summary = buildVerificationSummary({
    runId,
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    report: finalReport
  });
  writeJson(resolve(runPaths.reportsDir, "verification-summary.json"), summary);
```

Make `verifyRun` return:

```js
  return {
    ok,
    summary,
    report: finalReport,
    security
  };
```

- [ ] **Step 5: Add `--summary` CLI output mode**

In `scripts/cli-main.mjs`, update the verify command branch:

```js
  if (command === "verify") {
    const result = await verifyCommand(options);
    if (options.summary === true) {
      process.stdout.write(`${JSON.stringify({ ok: result.ok, summary: result.summary }, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return;
  }
```

The existing parser already maps `--summary` to `true` if it follows the same boolean flag pattern. If it does not, update `scripts/lib/args.mjs` in this task and add a parser test.

- [ ] **Step 6: Add CLI regression test**

In `tests/bootstrap.test.mjs`, add:

```js
test("help mentions verify --summary compact mode", () => {
  const result = spawnSync(process.execPath, ["scripts/cli-main.mjs", "help"], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify\s+Replay/);
  assert.match(result.stdout, /--summary/);
});
```

Update `helpText` in `scripts/cli-main.mjs` verify line to mention:

```text
verify    Replay the generated workflow and enforce truthfulness gates [--summary for compact user-facing output]
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/lib/report-summary.test.mjs tests/bootstrap.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/verify/verify-run.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Mirror runtime files into the tracked bundle**

Run:

```bash
cp -R scripts/lib/report-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs
cp -R scripts/verify/verify-run.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs
cp -R scripts/cli-main.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs
```

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add scripts/lib/report-summary.mjs tests/lib/report-summary.test.mjs scripts/verify/verify-run.mjs scripts/cli-main.mjs tests/verify/verify-run.test.mjs tests/bootstrap.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs
git commit -m "feat: add compact verification summaries"
```

---

### Task 3: Surface Capture Noise Preview At Done Time

**Problem:** The analyzer can trim trailing detours, but the user only learns later. `bf done` should surface "this looks like an accidental detour and will be excluded" when the final state still satisfies the goal.

**Files:**
- Create: `scripts/analyze/capture-noise.mjs`
- Create: `tests/analyze/capture-noise.test.mjs`
- Modify: `scripts/analyze/compile.mjs`
- Modify: `scripts/commands/done.mjs`
- Modify: `tests/observe/prepare-done.test.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/analyze/capture-noise.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/commands/done.mjs`

**Target Contract:**

`bf done` result includes:

```js
{
  ok: true,
  captureDiagnostics: {
    status: "clean" | "auto_trim_available" | "needs_user_choice",
    suggestions: [
      {
        kind: "backtracked-trailing-action",
        actionText: "Some headline",
        actionUrl: "https://news.naver.com/...",
        keptFinalUrl: "https://news.naver.com/section/101",
        analyzerAction: "will_trim"
      }
    ],
    artifact: "artifacts/runs/<id>/analysis/capture-noise-preview.json"
  }
}
```

**Eval:**
- Done-time preview identifies a final-page -> detail-page -> final-page trailing detour.
- Analyze uses the same helper so preview and actual trim cannot disagree.

**Result:**
- The user sees "we can exclude this" instead of "recapture because you clicked wrong."

**Backlog Review:**
- If a detour is not trailing or there are actions after returning, mark `needs_user_choice` instead of auto-trimming.

- [ ] **Step 1: Extract capture noise helper tests**

Create `tests/analyze/capture-noise.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { detectBacktrackedTrailingAction, trimBacktrackedTrailingAction } from "../../scripts/analyze/capture-noise.mjs";

const events = [
  { type: "navigate", url: "https://news.example/section/101", timestamp: 1 },
  { type: "click", selector: "a.headline", text: "Top headline", locator: { href: "/article/1", name: "Top headline" }, tabOrdinal: 0, timestamp: 2 },
  { type: "navigate", url: "https://news.example/article/1", tabOrdinal: 0, timestamp: 3 },
  { type: "navigate", url: "https://news.example/section/101", tabOrdinal: 0, timestamp: 4 }
];

test("detectBacktrackedTrailingAction reports an auto-trimmable trailing detour", () => {
  const result = detectBacktrackedTrailingAction({
    events,
    fixture: "manual",
    firstNavigate: "https://news.example/section/101",
    finalNavigate: "https://news.example/section/101"
  });

  assert.equal(result.status, "auto_trim_available");
  assert.equal(result.suggestions[0].kind, "backtracked-trailing-action");
  assert.equal(result.suggestions[0].actionText, "Top headline");
  assert.equal(result.suggestions[0].analyzerAction, "will_trim");
});

test("trimBacktrackedTrailingAction removes only the trailing detour suffix", () => {
  const result = trimBacktrackedTrailingAction(events, "manual", "https://news.example/section/101", "https://news.example/section/101");
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].type, "navigate");
  assert.equal(result.events[1].type, "navigate");
  assert.equal(result.ignored[0].reason, "backtracked-trailing-action");
});
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
node --test tests/analyze/capture-noise.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/analyze/capture-noise.mjs
```

- [ ] **Step 3: Move existing trim logic into the helper**

Create `scripts/analyze/capture-noise.mjs` by moving the existing private functions from `scripts/analyze/compile.mjs`:

```js
import { derivePageKey } from "../lib/page-key.mjs";

export function detectBacktrackedTrailingAction({ events, fixture, firstNavigate, finalNavigate }) {
  const trimmed = trimBacktrackedTrailingAction(events, fixture, firstNavigate, finalNavigate);
  if (trimmed.ignored.length === 0) {
    return { schemaVersion: 1, status: "clean", suggestions: [] };
  }
  return {
    schemaVersion: 1,
    status: "auto_trim_available",
    suggestions: trimmed.ignored
      .filter((event) => event.reason === "backtracked-trailing-action")
      .map((event) => ({
        kind: "backtracked-trailing-action",
        actionText: event.actionText || event.ignoredText || "",
        actionUrl: event.ignoredUrl || "",
        keptFinalUrl: event.keptFinalUrl || finalNavigate || "",
        analyzerAction: "will_trim"
      }))
  };
}

export function trimBacktrackedTrailingAction(events, fixture, firstNavigate, finalNavigate) {
  // Move the existing implementation from compile.mjs here without changing behavior.
  // Keep helper functions local to this module: isRealNavigateEvent, isInteractiveEvent,
  // isNavigationActionEvent, sameTab, ignoredBacktrackedEvent.
}
```

When moving `ignoredBacktrackedEvent`, include `actionText`:

```js
actionText: String(actionEvent.text || actionEvent.locator?.name || "")
```

- [ ] **Step 4: Update compile to use shared helper**

In `scripts/analyze/compile.mjs`, replace the private trim helper block with:

```js
import { trimBacktrackedTrailingAction } from "./capture-noise.mjs";
```

Remove the duplicated private helper functions from `compile.mjs`.

- [ ] **Step 5: Add done-time preview**

In `scripts/commands/done.mjs`, import:

```js
import { dirname, relative } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { detectBacktrackedTrailingAction } from "../analyze/capture-noise.mjs";
```

After `doneResult` is received:

```js
    const captureDiagnostics = writeCaptureNoisePreview(runPaths);
    return { ...doneResult, captureDiagnostics };
```

Add helper:

```js
function writeCaptureNoisePreview(runPaths) {
  try {
    const events = readJson(runPaths.sanitizedEventsPath);
    const manifest = readJson(runPaths.manifestPath);
    const navigates = events.filter((event) => event.type === "navigate" && event.url);
    const real = navigates.filter((event) => event.url !== "about:blank");
    const firstNavigate = real[0]?.url ?? manifest.startUrl ?? navigates[0]?.url ?? "about:blank";
    const finalNavigate = real[real.length - 1]?.url ?? firstNavigate;
    const preview = detectBacktrackedTrailingAction({
      events,
      fixture: manifest.fixture ?? "manual",
      firstNavigate,
      finalNavigate
    });
    const previewPath = runPaths.captureNoisePreviewPath ?? `${runPaths.analysisDir}/capture-noise-preview.json`;
    mkdirSync(dirname(previewPath), { recursive: true });
    writeFileSync(previewPath, JSON.stringify(preview, null, 2) + "\n", "utf8");
    return { ...preview, artifact: relative(runPaths.runRoot, previewPath) };
  } catch (error) {
    return { schemaVersion: 1, status: "unavailable", suggestions: [], error: error instanceof Error ? error.message : String(error) };
  }
}
```

If `analysisDir` or `captureNoisePreviewPath` is missing in `getRunPaths`, add it in `scripts/lib/config.mjs` and mirror to bundle.

- [ ] **Step 6: Add done command regression test**

In `tests/observe/prepare-done.test.mjs`, add a unit-style test using a small run fixture rather than launching Chrome:

```js
test("done result includes capture noise preview when trailing detour exists", async () => {
  // Use a fake doneCommand dependency only if doneCommand is refactored to accept deps.
  // If not refactoring doneCommand, put this as a pure helper test in capture-noise.test.mjs
  // and assert compile + done both call the same helper by source import tests.
});
```

If refactoring `doneCommand` for dependency injection is too invasive, add this source-level assertion instead:

```js
test("done command imports the same capture-noise helper used by analyze", () => {
  const doneSource = readFileSync(resolve(getRepoRoot(), "scripts/commands/done.mjs"), "utf8");
  const compileSource = readFileSync(resolve(getRepoRoot(), "scripts/analyze/compile.mjs"), "utf8");
  assert.match(doneSource, /detectBacktrackedTrailingAction/);
  assert.match(compileSource, /trimBacktrackedTrailingAction/);
  assert.match(doneSource, /capture-noise-preview\.json/);
});
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/analyze/capture-noise.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/analyze/compile.test.mjs tests/observe/prepare-done.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Mirror runtime files into the tracked bundle**

Run:

```bash
cp -R scripts/analyze/capture-noise.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/capture-noise.mjs
cp -R scripts/analyze/compile.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs
cp -R scripts/commands/done.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/done.mjs
cp -R scripts/lib/config.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/config.mjs
```

Only copy `config.mjs` if Step 5 added new paths.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add scripts/analyze/capture-noise.mjs tests/analyze/capture-noise.test.mjs scripts/analyze/compile.mjs scripts/commands/done.mjs tests/observe/prepare-done.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/capture-noise.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/done.mjs
git commit -m "feat: preview trimmable capture detours"
```

Include `scripts/lib/config.mjs` and bundle copy in the `git add` if changed.

---

### Task 4: Route Data-Collection Intent Into Extract Schema Proposal

**Problem:** "Check the current top 5 headlines" means data collection. The workflow should stop on the list/data page and use Extract for current values instead of replaying fixed historical text.

**Files:**
- Create: `scripts/lib/data-intent.mjs`
- Create: `tests/lib/data-intent.test.mjs`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `agents/orchestrator/AGENT.md`
- Modify: `tests/skill/browser-flow-capture.test.mjs`
- Mirror docs into `.codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md`
- Mirror source helper into `.codex/skills/browser-flow/bundle/runtime/scripts/lib/data-intent.mjs`
- Mirror prompt into `.codex/skills/browser-flow/bundle/skills/browser-flow/prompt.md` if that path exists; otherwise validate the current bundle layout and mirror the tracked prompt path that exists.

**Target Contract:**

`inferDataIntent("open news economy and check top 5 headlines")` returns:

```js
{
  kind: "list",
  itemName: "headline",
  limit: 5,
  dynamic: true,
  recommendedStop: "listing-page",
  schema: {
    fields: [
      { name: "rank", type: "number" },
      { name: "title", type: "string" },
      { name: "url", type: "string" }
    ],
    limit: 5
  }
}
```

The public skill instruction says:
- If the user asks for current/top/latest/list/table/value data, route to Extract.
- If they click the first visible dynamic item, preserve ordinal intent only if the goal includes opening that item.
- If the goal is to read top N data, stop on the listing page and extract N rows.

**Eval:**
- Skill tests assert top/current/latest/list/headline/value requests route to Extract.
- The helper classifies English and Korean forms: `top 5`, `상위 5개`, `최신`, `현재`, `헤드라인`, `수치`, `가격`.

**Result:**
- The agent has a deterministic way to recognize data mode and propose a schema before running Extract.

**Backlog Review:**
- If target schema cannot be inferred, ask one short clarification instead of replaying fixed text.

- [ ] **Step 1: Write data intent tests**

Create `tests/lib/data-intent.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { inferDataIntent } from "../../scripts/lib/data-intent.mjs";

test("inferDataIntent detects top headline list extraction", () => {
  const intent = inferDataIntent("go to economy news and check the top 5 headlines");
  assert.equal(intent.kind, "list");
  assert.equal(intent.itemName, "headline");
  assert.equal(intent.limit, 5);
  assert.equal(intent.dynamic, true);
  assert.equal(intent.recommendedStop, "listing-page");
  assert.equal(intent.schema.fields.some((field) => field.name === "title"), true);
});

test("inferDataIntent detects Korean top N headline request", () => {
  const intent = inferDataIntent("경제 섹션에서 헤드라인 뉴스 5개를 확인");
  assert.equal(intent.kind, "list");
  assert.equal(intent.limit, 5);
  assert.equal(intent.itemName, "headline");
});

test("inferDataIntent detects current numeric value extraction", () => {
  const intent = inferDataIntent("오늘의 증시에서 코스피 수치 확인");
  assert.equal(intent.kind, "value");
  assert.equal(intent.itemName, "value");
  assert.equal(intent.schema.fields[0].name, "label");
  assert.equal(intent.schema.fields[1].name, "value");
});

test("inferDataIntent returns null for pure navigation request", () => {
  assert.equal(inferDataIntent("open the settings page"), null);
});
```

- [ ] **Step 2: Run data intent tests to verify RED**

Run:

```bash
node --test tests/lib/data-intent.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/lib/data-intent.mjs
```

- [ ] **Step 3: Implement deterministic data-intent helper**

Create `scripts/lib/data-intent.mjs`:

```js
const LIST_WORDS = /\b(top|latest|current|headlines?|rows?|list|items?)\b|상위|최신|현재|헤드라인|목록|뉴스\s*\d*개/u;
const VALUE_WORDS = /\b(value|price|quote|number|rate|index)\b|수치|가격|환율|지수|코스피|코스닥/u;

export function inferDataIntent(text) {
  const raw = String(text ?? "");
  const normalized = raw.toLowerCase();
  const limit = parseLimit(raw);

  if (LIST_WORDS.test(normalized)) {
    const itemName = /headline|헤드라인|뉴스/u.test(normalized) ? "headline" : "item";
    return {
      kind: "list",
      itemName,
      limit: limit ?? 5,
      dynamic: /\b(current|latest|top)\b|현재|최신|상위/u.test(normalized),
      recommendedStop: "listing-page",
      schema: {
        fields: [
          { name: "rank", type: "number" },
          { name: itemName === "headline" ? "title" : "text", type: "string" },
          { name: "url", type: "string" }
        ],
        limit: limit ?? 5
      }
    };
  }

  if (VALUE_WORDS.test(normalized) && /확인|check|read|get|수집|extract/u.test(normalized)) {
    return {
      kind: "value",
      itemName: "value",
      limit: 1,
      dynamic: /\b(current|today|latest)\b|오늘|현재|최신/u.test(normalized),
      recommendedStop: "data-page",
      schema: {
        fields: [
          { name: "label", type: "string" },
          { name: "value", type: "string" },
          { name: "change", type: "string", optional: true }
        ],
        limit: 1
      }
    };
  }

  return null;
}

function parseLimit(text) {
  const ascii = String(text).match(/\b(\d{1,2})\b/);
  if (ascii) return Number(ascii[1]);
  const korean = String(text).match(/(\d{1,2})\s*개/u);
  if (korean) return Number(korean[1]);
  return null;
}
```

- [ ] **Step 4: Update skill/orchestrator instructions**

In `.codex/skills/browser-flow/prompt.md`, replace the current dynamic-data sentence with a stricter contract:

```md
When the user asks for current/top/latest/list/table/value data, first classify the request as DATA mode. In DATA mode, the navigational workflow should stop on the page that contains the data, and Extract owns the current values. Do not encode captured titles, prices, or top-row text as fixed replay evidence unless the user explicitly asks to reopen that exact item.
```

In `agents/orchestrator/AGENT.md`, add:

```md
- DATA mode is mandatory for current/top/latest/list/table/value requests. The orchestrator stops the replay route on the listing/data page and invokes Extract with a schema proposal. A click on "the first visible item" is ordinal only when the user wants to open that item, not when the user wants the top N rows.
```

- [ ] **Step 5: Update skill tests**

In `tests/skill/browser-flow-capture.test.mjs`, add:

```js
test("browser-flow data mode stops on data page and routes current values to Extract", () => {
  const prompt = readFileSync(resolve(getRepoRoot(), ".codex/skills/browser-flow/prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /DATA mode/i);
  assert.match(prompt, /current\/top\/latest\/list\/table\/value data/i);
  assert.match(prompt, /Extract owns the current values/i);
  assert.match(prompt, /Do not encode captured titles, prices, or top-row text as fixed replay evidence/i);
  assert.match(orchestrator, /DATA mode is mandatory/i);
  assert.match(orchestrator, /schema proposal/i);
});
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/lib/data-intent.test.mjs tests/skill/browser-flow-capture.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Mirror source helper and docs into tracked bundle**

Run:

```bash
cp -R scripts/lib/data-intent.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/data-intent.mjs
cp -R agents/orchestrator/AGENT.md .codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md
```

Then inspect the bundle prompt location:

```bash
find .codex/skills/browser-flow/bundle -path '*prompt.md' -maxdepth 5
```

Copy `.codex/skills/browser-flow/prompt.md` to the matching bundled prompt path if one exists.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add scripts/lib/data-intent.mjs tests/lib/data-intent.test.mjs .codex/skills/browser-flow/prompt.md agents/orchestrator/AGENT.md tests/skill/browser-flow-capture.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/data-intent.mjs .codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md
git commit -m "feat: route dynamic data requests to extract"
```

Add the bundled prompt file to `git add` if Step 7 found one.

---

### Task 5: Add Runtime Dependency Permission Preflight

**Problem:** Dependency installation currently fails after attempting `npm ci`. The CLI should detect non-writable runtime paths up front and emit a permission-specific diagnostic.

**Files:**
- Create: `scripts/lib/runtime-preflight.mjs`
- Create: `tests/cli/runtime-preflight.test.mjs`
- Modify: `scripts/cli.mjs`
- Modify: `tests/cli/runtime-dependencies.test.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/lib/runtime-preflight.mjs`
- Mirror source changes into `.codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs`

**Target Contract:**

When dependencies are missing and runtime root is not writable, CLI exits before `npm ci` with:

```text
Unable to prepare browser-flow runtime dependencies inside <runtimeRoot>.
Permission preflight failed: runtime directory is not writable.
Run from a writable project-local install, repair ownership, or approve an elevated dependency install.
```

**Eval:**
- Unit test covers EACCES preflight.
- Existing EACCES install-output test still passes.

**Result:**
- The user sees an actionable permission issue before a noisy npm failure.

**Backlog Review:**
- If `accessSync` is unreliable on macOS sandbox paths, keep npm failure formatting as fallback and test both paths.

- [ ] **Step 1: Write preflight tests**

Create `tests/cli/runtime-preflight.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { checkRuntimeDependencyPreflight, formatRuntimePreflightError } from "../../scripts/lib/runtime-preflight.mjs";

test("checkRuntimeDependencyPreflight reports non-writable runtime root", () => {
  const result = checkRuntimeDependencyPreflight("/runtime", {
    accessSync() {
      const err = new Error("EACCES: permission denied");
      err.code = "EACCES";
      throw err;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "runtime_not_writable");
  assert.match(formatRuntimePreflightError("/runtime", result), /Permission preflight failed/);
  assert.match(formatRuntimePreflightError("/runtime", result), /approve an elevated dependency install/);
});

test("checkRuntimeDependencyPreflight passes writable runtime root", () => {
  const result = checkRuntimeDependencyPreflight("/runtime", { accessSync() {} });
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/cli/runtime-preflight.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/lib/runtime-preflight.mjs
```

- [ ] **Step 3: Implement preflight helper**

Create `scripts/lib/runtime-preflight.mjs`:

```js
import { constants, accessSync } from "node:fs";

export function checkRuntimeDependencyPreflight(runtimeRoot, deps = { accessSync }) {
  try {
    deps.accessSync(runtimeRoot, constants.W_OK);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "runtime_not_writable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export function formatRuntimePreflightError(runtimeRoot, result) {
  const detail = result.detail ? `\n${result.detail}` : "";
  return [
    `Unable to prepare browser-flow runtime dependencies inside ${runtimeRoot}.`,
    "Permission preflight failed: runtime directory is not writable.",
    "Run from a writable project-local install, repair ownership, or approve an elevated dependency install.",
    detail.trim()
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Wire preflight into cli.mjs**

In `scripts/cli.mjs`, import:

```js
import { checkRuntimeDependencyPreflight, formatRuntimePreflightError } from "./lib/runtime-preflight.mjs";
```

Before spawning `npm ci`:

```js
  const preflight = checkRuntimeDependencyPreflight(runtimeRoot);
  if (!preflight.ok) {
    throw new Error(formatRuntimePreflightError(runtimeRoot, preflight));
  }
```

- [ ] **Step 5: Keep existing npm failure formatting test green**

Update `tests/cli/runtime-dependencies.test.mjs` only if the expected string needs the new "approve an elevated dependency install" sentence. Keep the existing test for npm stderr EACCES because `npm ci` can still fail after preflight.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/cli/runtime-preflight.test.mjs tests/cli/runtime-dependencies.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Mirror runtime files into the tracked bundle**

Run:

```bash
cp -R scripts/lib/runtime-preflight.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/runtime-preflight.mjs
cp -R scripts/cli.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs
```

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add scripts/lib/runtime-preflight.mjs tests/cli/runtime-preflight.test.mjs scripts/cli.mjs tests/cli/runtime-dependencies.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/runtime-preflight.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs
git commit -m "fix: preflight runtime dependency permissions"
```

---

### Task 6: Full Verification And Release Sync

**Files:**
- Modify: `/Users/cielo-iamdt/projects/browser-flow-released` via the existing release sync hook or `node scripts/publish/build-bundle.mjs`

**Eval:**
- Full source checks pass.
- E2E passes.
- Release repo is clean and has a `release: sync from <source-sha>` commit.

**Result:**
- Source and released folder carry the same usability improvements.

**Backlog Review:**
- If release sync fails because source or release repo is dirty, stop and inspect `git status` in both repos. Do not overwrite unrelated user changes.

- [ ] **Step 1: Run full source check**

Run:

```bash
npm run check
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run E2E**

Run:

```bash
npm run test:e2e
```

Expected:

```text
[run-suite] PASS
```

- [ ] **Step 3: Validate skill bundle explicitly**

Run:

```bash
node .codex/skills/browser-flow/scripts/validate-skill.mjs
```

Expected:

```text
browser-flow skill validated
```

- [ ] **Step 4: Confirm source working tree is clean**

Run:

```bash
git status --short
```

Expected:

```text

```

- [ ] **Step 5: Confirm release sync**

If commit hooks already created the release commit, run:

```bash
git -C /Users/cielo-iamdt/projects/browser-flow-released log --oneline -1
git -C /Users/cielo-iamdt/projects/browser-flow-released status --short
```

Expected:

```text
<sha> release: sync from <source-sha>
```

and no status output.

If no release commit exists, run:

```bash
node scripts/publish/build-bundle.mjs
git -C /Users/cielo-iamdt/projects/browser-flow-released status --short
git -C /Users/cielo-iamdt/projects/browser-flow-released add .
git -C /Users/cielo-iamdt/projects/browser-flow-released commit -m "release: sync from <source-sha>"
```

- [ ] **Step 6: Final source and release status**

Run:

```bash
git status --short
git -C /Users/cielo-iamdt/projects/browser-flow-released status --short
```

Expected:

```text

```

---

## Self-Review Checklist

Spec coverage:
- Item 1, confusing `verificationOutcome:not_verified` despite replay success: Task 1.
- Item 2, confusing `security.ok:true` vs `securityOk:false`: Task 1.
- Item 3, late capture-noise diagnosis: Task 3.
- Item 4, data extraction intent weak: Task 4.
- Item 5, verbose real-site report: Task 2.
- Item 7, permission preflight: Task 5.
- Item 6, stale installed bundle detection: excluded by user request.

Placeholder scan:
- No task defers implementation or leaves an unspecified test.
- Each task has files, test commands, expected result, and commit command.

Type consistency:
- `replayOutcome` values are `passed | held | failed` in helper, schema, and summary.
- `promotionOutcome` values are `promoted | not_promoted` in helper, schema, and summary.
- `securityScanOk` means raw scan result.
- `securityPromotionClean` and legacy `securityOk` mean promotion-grade security cleanliness.

## Backlog

- Consider a future schema version bump only if optional fields become required. This plan keeps additive fields optional.
- Consider making `bf verify --summary` the default only after downstream CLI consumers are audited.
- Consider interactive "exclude this detour?" only for non-trailing ambiguous capture noise. This plan auto-previews the current deterministic trailing-detour case and marks unclear cases for user choice.
