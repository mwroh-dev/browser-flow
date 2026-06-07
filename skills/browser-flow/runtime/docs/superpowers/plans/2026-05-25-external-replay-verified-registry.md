# External Replay-Verified Registry and Data Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real external services first-class replay-verified registry targets while preserving project-local installation, explicit operator consent, privacy-aware metadata, and durable data-result output when the user asked for data.

**Architecture:** Keep capture/analyze/generate/verify order unchanged. Treat `localOnly` as a legacy target-scope flag, not as the product definition of "local"; add explicit metadata for `installScope:"project-local"`, `targetScope:"external"`, external promotion approval, auth/profile dependency, artifact retention, data mode, and allowed origins. Add a separate `promote external` command so external workflows are not silently persisted, but they can be intentionally saved after replay proof exists. When `dataMode` is `extract` or `mixed`, materialize extracted rows into a stable report artifact and summary so a successful replay can answer the user's data request instead of leaving only logs.

**Tech Stack:** Node.js ESM, native `node:test`, Zod schemas in `scripts/lib/schemas.mjs`, existing registry in `knowledge/registry/workflows.json`, tracked source bundle under `.codex/skills/browser-flow/bundle/`, release sync to `/Users/cielo-iamdt/projects/browser-flow-released`.

---

## Product Policy

Definitions:
- **Project-local install**: Browser Flow is installed and runs inside the project-local skill/runtime footprint. This is the intended default and is unrelated to whether the target website is localhost or a cloud service.
- **Local target**: A local fixture, `localhost`, or repo-owned deterministic site.
- **External target**: A real cloud website such as Notion, NotebookLM, Keep, Naver, Gmail, or a user SaaS product.
- **Replay-verified**: The route replay proof passed at a point in time. It does not promise that an external site will never drift.
- **External registry promotion**: Explicit operator approval to save an external replay-verified workflow for reuse with origin/auth/privacy metadata.

Default privacy posture:
- Do not store raw tokens, cookies, auth headers, CSRF values, or passwords.
- Do not silently persist browser profile state.
- Default screenshots/artifact retention is minimal, but the policy model must allow the operator to opt into richer artifact retention later.
- Login/profile dependency is allowed when the operator explicitly selects it; the registry must record that dependency instead of hiding it.

Promotion policy:
- Local targets may keep the existing automatic verified registry path.
- External targets are not auto-promoted during `verify`.
- External targets become `external_replay_candidate` when replay passed and the security scan ran.
- `browser-flow promote --run-id <id> --scope external ...` persists the registry entry after explicit operator approval.
- External promotion may allow warning-only security findings, but only as visible metadata. Fatal security scan failure still blocks promotion.

Data-result policy:
- `dataMode:"route"` means the route is the result; verification reports route replay status and no data artifact is required.
- `dataMode:"extract"` means the workflow must return current page data. After replay and extraction, Browser Flow writes both `extract-result.json` and a normalized `reports/data-result.json`.
- `dataMode:"mixed"` means both route replay and extracted data matter; summaries must show replay status and a short data preview.
- Dynamic list/position data is not bound to captured text. It is represented by extractor config plus row position/count, so "top 5 current headlines" can change over time while still producing a stable data-result artifact.
- A replay can be `passed` while data extraction is `drift`; user-facing output must say "replay passed, data extraction drifted" rather than collapsing both into a generic verification failure.

Reference checks:
- Playwright authentication docs say stored browser state can contain sensitive cookies/headers, which supports defaulting profile/session persistence to off and requiring explicit opt-in: https://playwright.dev/docs/auth
- Playwright screenshot docs support explicit file screenshot capture, so screenshots should be a retention policy choice rather than a blanket prohibition: https://playwright.dev/docs/next/screenshots
- OWASP Session Management guidance treats session identifiers as security-sensitive, supporting the rule that raw cookies, tokens, auth headers, CSRF values, and passwords are not persisted: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

---

## File Map

Runtime source:
- Create: `scripts/registry/external-promotion.mjs`
- Create: `scripts/commands/promote.mjs`
- Create: `scripts/lib/data-result-summary.mjs`
- Modify: `scripts/registry/workflow-registry.mjs`
- Modify: `scripts/lib/verification-outcomes.mjs`
- Modify: `scripts/lib/report-summary.mjs`
- Modify: `scripts/lib/config.mjs`
- Modify: `scripts/lib/schema-versions.mjs`
- Modify: `scripts/lib/schemas.mjs`
- Modify: `scripts/analyze/compile.mjs`
- Modify: `scripts/commands/extract.mjs`
- Modify: `scripts/cli-main.mjs`
- Modify: `knowledge/verify-spec/questions.base.json`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `agents/orchestrator/AGENT.md`

Tests:
- Create: `tests/registry/external-promotion.test.mjs`
- Create: `tests/commands/promote.test.mjs`
- Create: `tests/lib/data-result-summary.test.mjs`
- Modify: `tests/registry/verified-gate.test.mjs`
- Modify: `tests/lib/verification-outcomes.test.mjs`
- Modify: `tests/lib/report-summary.test.mjs`
- Modify: `tests/reports/schema-versions.test.mjs`
- Modify: `tests/analyze/compile.test.mjs`
- Modify: `tests/extract/run-paths.test.mjs`
- Modify: `tests/extract/extract-command.test.mjs`
- Modify: `tests/commands/spec.test.mjs`
- Modify: `tests/skill/browser-flow-capture.test.mjs`
- Modify: `tests/bootstrap.test.mjs`

Bundle mirrors:
- Mirror each modified runtime source file into `.codex/skills/browser-flow/bundle/runtime/...`
- Mirror `.codex/skills/browser-flow/prompt.md` if a bundle prompt path exists; current bundle layout may not have one.
- Mirror `agents/orchestrator/AGENT.md` into `.codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md`.
- Mirror `knowledge/verify-spec/questions.base.json` into `.codex/skills/browser-flow/bundle/runtime/knowledge/verify-spec/questions.base.json` if that path exists in the bundle.

---

## Lane Map

Lane A - Policy and schema:
- Task 1 and Task 2 are sequential. They define the metadata contract and registry rules.

Lane B - Promotion command:
- Task 3 depends on Task 2.

Lane C - Verify/user-facing language:
- Task 4 depends on Task 1. It can run parallel with Task 3 after the helper contract exists.

Lane D - Ask-question/spec UX:
- Task 6 depends on Task 1 and Task 5 so the question text can point to the actual data-result artifact.

Lane E - Data result materialization:
- Task 5 depends on existing extraction code, Task 1's data-mode metadata, and Task 3's promotion command for the promotion/data artifact linkage.

Release lane:
- Task 7 runs after all source commits.

Each task closes only after:
- Eval: focused tests pass.
- Result: a concrete artifact, CLI output, or report field shows the intended behavior.
- Backlog review: any root issue discovered is either fixed now or recorded in `tasks/todo.md`.
- Commit: one commit per task.

Execution policy for subagents:
- Use a fresh worker per task during `superpowers:subagent-driven-development`.
- High-reasoning lane: Task 2 (promotion policy), Task 4 (truthful verification semantics), Task 5 (data-result artifact semantics). Use `gpt-5.5` with high reasoning if dispatching these tasks.
- Standard-reasoning lane: Task 1 (schema metadata), Task 3 (CLI command), Task 6 (skill/spec wording), Task 7 (verification/release sync). Use `gpt-5.3-codex` with medium reasoning for coding tasks and `gpt-5.4-mini` with medium reasoning for docs/release-only tasks.
- Workers must not revert edits from other lanes. Each worker owns only the files listed in its task and must report changed paths.
- Do not merge a task commit until its Eval, Result, and Backlog Review criteria are satisfied.

---

### Task 1: Add External Target Metadata Without Breaking Legacy `localOnly`

**Problem:** `localOnly` currently mixes two meanings: project-local install safety and target-site locality. The product needs project-local install by default while treating external cloud sites as normal automation targets.

**Files:**
- Modify: `scripts/lib/schemas.mjs`
- Modify: `scripts/analyze/compile.mjs`
- Modify: `tests/reports/schema-versions.test.mjs`
- Modify: `tests/analyze/compile.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs`

**Target Contract:**

Workflow security remains backward compatible:

```js
{
  security: {
    localOnly: false,
    installScope: "project-local",
    targetScope: "external",
    sanitizedArtifactsOnly: true,
    screenshotsPersisted: false
  }
}
```

`localOnly` remains for existing gates:
- `true` means local target.
- `false` means external target.

New fields carry the clearer meaning:
- `installScope:"project-local"` always for this runtime.
- `targetScope:"local" | "external"`.

**Eval:**
- Compile with normal local fixture emits `installScope:"project-local"` and `targetScope:"local"`.
- Compile with unmasked external/manual emits `installScope:"project-local"` and `targetScope:"external"`.
- Old minimal workflow artifacts without the new fields still parse.

**Result:**
- `workflow.json` carries explicit install/target scope metadata while old artifacts remain readable.

**Backlog Review:**
- If renaming `localOnly` fully would touch too many call sites, keep it as legacy and add a future migration item. Do not break old artifacts in this task.

- [ ] **Step 1: Add failing schema test**

In `tests/reports/schema-versions.test.mjs`, add:

```js
test("WorkflowArtifact accepts explicit installScope and external targetScope", async () => {
  const { parseWorkflowArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseWorkflowArtifact({
    schemaVersion: 1,
    id: "external-workflow",
    fixture: "manual",
    startUrl: "https://example.com",
    finalUrl: "https://example.com/done",
    steps: [{ action: "goto", url: "https://example.com" }],
    verification: { expectedFinalUrl: "https://example.com/done" },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  }, "workflow.json");

  assert.equal(parsed.security.installScope, "project-local");
  assert.equal(parsed.security.targetScope, "external");
});
```

- [ ] **Step 2: Add failing compile tests**

In `tests/analyze/compile.test.mjs`, extend the existing local/unmasked compile coverage:

```js
assert.equal(workflow.security.installScope, "project-local");
assert.equal(workflow.security.targetScope, "local");
```

For an unmasked compile test, assert:

```js
assert.equal(workflow.security.localOnly, false);
assert.equal(workflow.security.installScope, "project-local");
assert.equal(workflow.security.targetScope, "external");
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/reports/schema-versions.test.mjs tests/analyze/compile.test.mjs
```

Expected:

```text
Expected values to be strictly equal:
+ actual - expected
+ undefined
- "project-local"
```

- [ ] **Step 4: Extend workflow schema**

In `scripts/lib/schemas.mjs`, modify `SecurityShape`:

```js
const SecurityShape = z
  .object({
    localOnly: z.boolean(),
    installScope: z.literal("project-local").optional(),
    targetScope: z.enum(["local", "external"]).optional(),
    sanitizedArtifactsOnly: z.boolean().optional(),
    screenshotsPersisted: z.boolean().optional()
  })
  .passthrough();
```

- [ ] **Step 5: Emit clearer metadata from compile**

In `scripts/analyze/compile.mjs`, where `workflow.security` is built, set:

```js
security: {
  localOnly: !unmasked,
  installScope: "project-local",
  targetScope: unmasked ? "external" : "local",
  sanitizedArtifactsOnly: true,
  screenshotsPersisted: false
}
```

For any fallback/test scaffold in the same file that currently emits `localOnly:true`, add:

```js
installScope: "project-local",
targetScope: "local",
```

- [ ] **Step 6: Mirror source into bundle**

Run:

```bash
cp -R scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs
cp -R scripts/analyze/compile.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs
```

- [ ] **Step 7: Run GREEN tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/reports/schema-versions.test.mjs tests/analyze/compile.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Commit Task 1**

```bash
git add scripts/lib/schemas.mjs scripts/analyze/compile.mjs tests/reports/schema-versions.test.mjs tests/analyze/compile.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/analyze/compile.mjs
git commit -m "feat: distinguish project install from target scope"
```

---

### Task 2: Add External Promotion Policy Helper

**Problem:** Registry promotion currently refuses every external workflow with `security.localOnly:false`, which makes Notion/NotebookLM/Naver-style reuse impossible.

**Files:**
- Create: `scripts/registry/external-promotion.mjs`
- Create: `tests/registry/external-promotion.test.mjs`
- Modify: `scripts/registry/workflow-registry.mjs`
- Modify: `tests/registry/verified-gate.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/registry/external-promotion.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/registry/workflow-registry.mjs`

**Target Contract:**

External entries are allowed only when explicitly approved:

```js
{
  status: "replay_verified",
  security: { localOnly: false, targetScope: "external" },
  promotion: {
    scope: "external",
    approved: true,
    approvedAt: "2026-05-25T00:00:00.000Z",
    origins: ["https://www.notion.so"],
    authMode: "login-required",
    profileMode: "ephemeral",
    privacyLevel: "minimal",
    screenshots: "off",
    dataMode: "route"
  }
}
```

External promotion blocks:
- no explicit approval
- no allowed origins
- fatal security scan (`security.ok !== true`)
- replay did not pass

External promotion allows:
- warning-only security findings, recorded as metadata
- login/profile dependency, recorded as metadata
- screenshots preference as policy metadata; actual screenshot artifact capture remains governed by capture/verify implementation.

**Eval:**
- Unapproved external entry is refused.
- Approved external replay-verified entry is accepted.
- Approved external verified entry with warning-only security is accepted only when status is `replay_verified`, not legacy `verified`.
- Local verified gate remains unchanged.

**Result:**
- Registry policy can distinguish unsafe automatic promotion from approved external replay promotion.

**Backlog Review:**
- If actual screenshot artifact persistence is desired, record a separate backlog item. This task adds registry policy metadata only.

- [ ] **Step 1: Write failing external promotion helper tests**

Create `tests/registry/external-promotion.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegistryPromotion,
  normalizeOrigins
} from "../../scripts/registry/external-promotion.mjs";

test("normalizeOrigins keeps explicit https origins only", () => {
  assert.deepEqual(
    normalizeOrigins("https://www.notion.so, https://notebooklm.google.com/path, http://localhost:3000"),
    ["https://www.notion.so", "https://notebooklm.google.com", "http://localhost:3000"]
  );
});

test("classifyRegistryPromotion refuses unapproved external workflows", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: { scope: "external", approved: false, origins: ["https://www.notion.so"] }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "external_requires_operator_approval");
});

test("classifyRegistryPromotion allows approved external replay-verified workflows", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });

  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
node --test tests/registry/external-promotion.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/registry/external-promotion.mjs
```

- [ ] **Step 3: Implement `external-promotion.mjs`**

Create `scripts/registry/external-promotion.mjs`:

```js
/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
export function normalizeOrigins(csv) {
  return String(csv ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item);
      return url.origin;
    });
}

/**
 * @param {Record<string, any>} entry
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifyRegistryPromotion(entry) {
  const external = entry.security?.localOnly === false || entry.security?.targetScope === "external";
  if (!external) {
    return { ok: true };
  }

  if (entry.status !== "replay_verified") {
    return { ok: false, reason: "external_requires_replay_verified_status" };
  }
  const promotion = entry.promotion ?? {};
  if (promotion.scope !== "external" || promotion.approved !== true) {
    return { ok: false, reason: "external_requires_operator_approval" };
  }
  if (!Array.isArray(promotion.origins) || promotion.origins.length === 0) {
    return { ok: false, reason: "external_requires_allowed_origins" };
  }
  return { ok: true };
}

/**
 * @param {string} reason
 * @param {string | number | symbol | undefined} id
 */
export function formatPromotionRefusal(reason, id) {
  return `registry: not promoted "${String(id ?? "unknown")}" — ${reason}.`;
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
node --test tests/registry/external-promotion.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Replace unconditional external refusal**

In `scripts/registry/workflow-registry.mjs`, import:

```js
import { classifyRegistryPromotion, formatPromotionRefusal } from "./external-promotion.mjs";
```

Replace the `security.localOnly === false` branch in `registryPromotionRefusal(entry)` with:

```js
  const promotion = classifyRegistryPromotion(entry);
  if (!promotion.ok) {
    return {
      code: promotion.reason,
      message: formatPromotionRefusal(promotion.reason, entry.id)
    };
  }
```

- [ ] **Step 6: Keep local verified security gate strict, add external replay gate**

In `upsertRegistryEntry(entry)`, keep the current `entry.status === "verified"` clean-security gate unchanged.

Add a new branch below it:

```js
  if (entry.status === "replay_verified") {
    const vPath = /** @type {string | undefined} */ (entry.verificationPath);
    const sPath = /** @type {string | undefined} */ (entry.securityPath);
    if (!vPath || !existsSync(vPath) || !sPath || !existsSync(sPath)) {
      throw new Error(
        `registry: refusing "replay_verified" upsert for "${entry.id}" — both verification.json and security.json must exist.`
      );
    }
    const verification = /** @type {{ replayOutcome?: string, success?: boolean, pathComplete?: boolean }} */ (readJson(vPath));
    const scanResult = /** @type {{ ok?: boolean }} */ (readJson(sPath));
    if (!(verification.replayOutcome === "passed" || (verification.success === true && verification.pathComplete === true))) {
      throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — replay did not pass.`);
    }
    if (scanResult.ok !== true) {
      throw new Error(`registry: refusing "replay_verified" upsert for "${entry.id}" — security scan failed.`);
    }
  }
```

- [ ] **Step 7: Update existing registry tests**

In `tests/registry/verified-gate.test.mjs`, replace `unmasked real-site entries are not promoted` with:

```js
test("unapproved external entries are not promoted", () => {
  const entry = {
    id: `vgate-unapproved-external-${Date.now()}`,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: { scope: "external", approved: false, origins: ["https://www.notion.so"] }
  };

  const refusal = registryPromotionRefusal(entry);

  assert.equal(refusal.code, "external_requires_operator_approval");
  assert.match(refusal.message, /not promoted/);
  assert.doesNotMatch(refusal.message, /localhost|local-only/i);
});
```

Add:

```js
test("approved external replay-verified entries are allowed past promotion refusal", () => {
  const entry = {
    id: `vgate-approved-external-${Date.now()}`,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  };

  assert.equal(registryPromotionRefusal(entry), null);
});
```

- [ ] **Step 8: Mirror source into bundle**

Run:

```bash
cp -R scripts/registry/external-promotion.mjs .codex/skills/browser-flow/bundle/runtime/scripts/registry/external-promotion.mjs
cp -R scripts/registry/workflow-registry.mjs .codex/skills/browser-flow/bundle/runtime/scripts/registry/workflow-registry.mjs
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --test tests/registry/external-promotion.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/registry/verified-gate.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 10: Commit Task 2**

```bash
git add scripts/registry/external-promotion.mjs scripts/registry/workflow-registry.mjs tests/registry/external-promotion.test.mjs tests/registry/verified-gate.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/registry/external-promotion.mjs .codex/skills/browser-flow/bundle/runtime/scripts/registry/workflow-registry.mjs
git commit -m "feat: allow approved external replay promotion"
```

---

### Task 3: Add `promote external` Command

**Problem:** External registry promotion needs an explicit operator-approved path with origin/auth/privacy/data metadata. Running `verify` should not silently persist external workflows.

**Files:**
- Create: `scripts/commands/promote.mjs`
- Create: `tests/commands/promote.test.mjs`
- Modify: `scripts/cli-main.mjs`
- Modify: `tests/bootstrap.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs`

**Target CLI:**

```bash
browser-flow promote --run-id <id> --scope external \
  --origins https://www.notion.so,https://notebooklm.google.com \
  --auth-mode login-required \
  --profile-mode ephemeral \
  --privacy-level minimal \
  --screenshots off \
  --data-mode extract
```

Allowed option values:
- `--scope external`
- `--auth-mode none | login-required | keychain-session | attach | persistent-profile`
- `--profile-mode ephemeral | named-profile | attached-browser`
- `--privacy-level minimal | profile | full`
- `--screenshots off | allowed`
- `--data-mode route | extract | mixed`

**Eval:**
- Missing `--origins` fails.
- Missing verification/security artifacts fails.
- Failed replay fails.
- Successful external replay with `security.ok:true` and warning-only findings is saved as `status:"replay_verified"`.
- CLI help mentions `promote`.

**Result:**
- Operators have a concrete command to intentionally save external replay-verified workflows with origin/auth/privacy/data metadata.

**Backlog Review:**
- If users need interactive prompts for missing flags, keep CLI strict for now and record interactive promote wizard as backlog unless required for this release.

- [ ] **Step 1: Write failing command tests**

Create `tests/commands/promote.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { promoteCommand } from "../../scripts/commands/promote.mjs";
import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";

function writeExternalRun(runId, overrides = {}) {
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.reportsDir, { recursive: true });
  writeFileSync(runPaths.workflowJsonPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://www.notion.so",
    finalUrl: "https://www.notion.so/page",
    steps: [{ action: "goto", url: "https://www.notion.so" }],
    verification: { expectedFinalUrl: "https://www.notion.so/page" },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  }));
  writeFileSync(runPaths.verificationPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.verification,
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true },
    replayOutcome: "passed",
    promotionOutcome: "not_promoted",
    securityOk: false,
    verifiedAt: new Date().toISOString(),
    ...overrides.verification
  }));
  writeFileSync(runPaths.securityPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.security,
    ok: true,
    warningOnly: true,
    findings: [{ file: "reports/verification.json", reason: "external warning", match: "<redacted>" }],
    ...overrides.security
  }));
  return runPaths;
}

test("promote external requires origins", async () => {
  const runId = `promote-no-origin-${Date.now()}`;
  writeExternalRun(runId);
  assert.throws(() => promoteCommand({ "run-id": runId, scope: "external" }), /--origins/);
});

test("promote external saves approved replay-verified entry", async () => {
  const runId = `promote-external-${Date.now()}`;
  writeExternalRun(runId);
  const result = promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "route"
  });

  assert.equal(result.status, "replay_verified");
  assert.equal(result.promotion.scope, "external");
  assert.deepEqual(result.promotion.origins, ["https://www.notion.so"]);
  assert.equal(result.promotion.dataMode, "route");
  const saved = readRegistry().find((entry) => entry.id === runId);
  assert.equal(saved?.status, "replay_verified");
  assert.equal(saved?.promotion?.approved, true);
});
```

- [ ] **Step 2: Run command tests to verify RED**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/commands/promote.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/commands/promote.mjs
```

- [ ] **Step 3: Implement `scripts/commands/promote.mjs`**

Create:

```js
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { normalizeOrigins } from "../registry/external-promotion.mjs";
import { upsertRegistryEntry } from "../registry/workflow-registry.mjs";

const AUTH_MODES = new Set(["none", "login-required", "keychain-session", "attach", "persistent-profile"]);
const PROFILE_MODES = new Set(["ephemeral", "named-profile", "attached-browser"]);
const PRIVACY_LEVELS = new Set(["minimal", "profile", "full"]);
const SCREENSHOTS = new Set(["off", "allowed"]);
const DATA_MODES = new Set(["route", "extract", "mixed"]);

/**
 * @param {Record<string, string | boolean>} options
 */
export function promoteCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("promote requires --run-id.");
  const scope = getStringOption(options, "scope", undefined);
  if (scope !== "external") throw new Error('promote currently requires --scope external.');
  const origins = normalizeOrigins(getStringOption(options, "origins", undefined));
  if (origins.length === 0) throw new Error("promote external requires --origins.");
  const authMode = requiredEnum(options, "auth-mode", AUTH_MODES);
  const profileMode = requiredEnum(options, "profile-mode", PROFILE_MODES);
  const privacyLevel = requiredEnum(options, "privacy-level", PRIVACY_LEVELS);
  const screenshots = requiredEnum(options, "screenshots", SCREENSHOTS);
  const dataMode = requiredEnum(options, "data-mode", DATA_MODES);

  const runPaths = getRunPaths(runId);
  const workflow = readJson(runPaths.workflowJsonPath);
  const verification = readJson(runPaths.verificationPath);
  const security = readJson(runPaths.securityPath);
  if (!(verification.replayOutcome === "passed" || (verification.success === true && verification.pathComplete === true))) {
    throw new Error("promote external requires a passed replay verification.");
  }
  if (security.ok !== true) {
    throw new Error("promote external requires security scan ok:true.");
  }

  const entry = {
    id: runId,
    fixture: workflow.fixture ?? "manual",
    runId,
    pathYamlPath: runPaths.pathYamlPath,
    recipeYamlPath: runPaths.recipeYamlPath,
    runnerPath: runPaths.runnerPath,
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    status: "replay_verified",
    security: workflow.security,
    promotion: {
      scope: "external",
      approved: true,
      approvedAt: new Date().toISOString(),
      origins,
      authMode,
      profileMode,
      privacyLevel,
      screenshots,
      dataMode,
      warningOnly: security.warningOnly === true,
      findingsCount: Array.isArray(security.findings) ? security.findings.length : 0
    }
  };
  upsertRegistryEntry(entry);
  return entry;
}

function requiredEnum(options, key, allowed) {
  const value = getStringOption(options, key, undefined);
  if (!value || !allowed.has(value)) {
    throw new Error(`promote external requires --${key} (${Array.from(allowed).join("|")}).`);
  }
  return value;
}
```

- [ ] **Step 4: Wire CLI**

In `scripts/cli-main.mjs`, import:

```js
import { promoteCommand } from "./commands/promote.mjs";
```

Add help line:

```text
  promote   Save a replay-verified external workflow after explicit approval — --run-id <id> --scope external --origins <csv> ...
```

Add command branch:

```js
  if (command === "promote") {
    process.stdout.write(`${JSON.stringify(promoteCommand(options), null, 2)}\n`);
    return;
  }
```

- [ ] **Step 5: Update bootstrap/help tests**

In `tests/bootstrap.test.mjs`, add assertion:

```js
assert.match(stdout, /promote\s+Save a replay-verified external workflow/i);
```

- [ ] **Step 6: Mirror source into bundle**

Run:

```bash
cp -R scripts/commands/promote.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs
cp -R scripts/cli-main.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/commands/promote.test.mjs tests/bootstrap.test.mjs tests/registry/verified-gate.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Commit Task 3**

```bash
git add scripts/commands/promote.mjs scripts/cli-main.mjs tests/commands/promote.test.mjs tests/bootstrap.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs .codex/skills/browser-flow/bundle/runtime/scripts/cli-main.mjs
git commit -m "feat: add explicit external workflow promotion"
```

---

### Task 4: Update Verification Outcomes And User-Facing Summary

**Problem:** Verification currently treats `workflowUnmasked` as a promotion blocker named `local_only`, which misleads users into thinking cloud services are unsupported.

**Files:**
- Modify: `scripts/lib/verification-outcomes.mjs`
- Modify: `scripts/lib/report-summary.mjs`
- Modify: `scripts/verify/verify-run.mjs`
- Modify: `tests/lib/verification-outcomes.test.mjs`
- Modify: `tests/lib/report-summary.test.mjs`
- Modify: `tests/verify/verify-run.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs`

**Target Contract:**

For external unmasked replay success:

```js
{
  replayOutcome: "passed",
  promotionOutcome: "not_promoted",
  promotionBlockers: [
    { gate: "registry", reason: "external_requires_operator_approval" }
  ],
  promotionCandidate: {
    scope: "external",
    status: "external_replay_candidate"
  }
}
```

For warning-only security:

```js
promotionBlockers includes:
{ gate: "security", reason: "warning_only_findings" }
```

Only if the external promotion command later accepts warning-only findings does the registry persist it as metadata.

**Eval:**
- No user-facing message says external sites are local-only.
- Summary says replay succeeded and external promotion requires operator approval.
- Legacy `securityOk` remains alias for clean security, not pipeline success.

**Result:**
- Verification reports separate replay proof from registry promotion eligibility and explain external candidates truthfully.

**Backlog Review:**
- If adding `promotionCandidate` to schema breaks old readers, keep it optional and add schema compatibility tests.

- [ ] **Step 1: Write failing outcome tests**

In `tests/lib/verification-outcomes.test.mjs`, replace the first test expectation:

```js
assert.deepEqual(out.promotionBlockers, [
  { gate: "security", reason: "warning_only_findings" },
  { gate: "registry", reason: "external_requires_operator_approval" }
]);
assert.deepEqual(out.promotionCandidate, {
  scope: "external",
  status: "external_replay_candidate"
});
```

Add:

```js
test("deriveVerificationOutcomes marks passed external replay as a promotion candidate", () => {
  const out = deriveVerificationOutcomes({
    report: { success: true, pathComplete: true, transitionChecks: [], resultEvidence: { passed: true } },
    security: { ok: true, warningOnly: false, findings: [] },
    workflowUnmasked: true,
    securityClean: true
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.deepEqual(out.promotionBlockers, [
    { gate: "registry", reason: "external_requires_operator_approval" }
  ]);
  assert.equal(out.promotionCandidate.status, "external_replay_candidate");
});
```

- [ ] **Step 2: Add schema test for `promotionCandidate`**

In `tests/reports/schema-versions.test.mjs`, extend the verification report acceptance test with:

```js
promotionCandidate: { scope: "external", status: "external_replay_candidate" },
```

and assert:

```js
assert.equal(parsed.promotionCandidate?.scope, "external");
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --test tests/lib/verification-outcomes.test.mjs tests/lib/report-summary.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/reports/schema-versions.test.mjs
```

Expected:

```text
Expected values to be strictly deep-equal
```

- [ ] **Step 4: Update schema**

In `scripts/lib/schemas.mjs`, add optional field to `VerificationV1`:

```js
    promotionCandidate: z.object({
      scope: z.enum(["external"]),
      status: z.enum(["external_replay_candidate"])
    }).passthrough().optional(),
```

Keep `promotionBlockers.gate` backward compatible so old reports still parse:

```js
z.enum(["security", "local_only", "replay", "registry"])
```

Add a comment next to the enum:

```js
// Backward compatibility: old reports may contain "local_only".
// New code must not emit it; external replay candidates use gate:"registry".
```

- [ ] **Step 5: Update outcome helper**

In `scripts/lib/verification-outcomes.mjs`, replace:

```js
  if (input.workflowUnmasked) {
    promotionBlockers.push({
      gate: "local_only",
      reason: "unmasked_real_site_diagnostic"
    });
  }
```

with:

```js
  const promotionCandidate = input.workflowUnmasked && replayOutcome === "passed"
    ? { scope: "external", status: "external_replay_candidate" }
    : undefined;

  if (input.workflowUnmasked && replayOutcome === "passed") {
    promotionBlockers.push({
      gate: "registry",
      reason: "external_requires_operator_approval"
    });
  } else if (input.workflowUnmasked) {
    promotionBlockers.push({
      gate: "registry",
      reason: "external_replay_not_promotable_until_replay_passes"
    });
  }
```

Return:

```js
    ...(promotionCandidate ? { promotionCandidate } : {})
```

- [ ] **Step 6: Update report summary**

In `scripts/lib/report-summary.mjs`, when `report.promotionCandidate?.status === "external_replay_candidate"`, headline:

```js
"External replay succeeded; save it with explicit promotion approval."
```

And include next action:

```js
`Run browser-flow promote --run-id ${runId} --scope external ... after confirming origins, auth, privacy, screenshots, and data mode.`
```

If the selected data mode is `extract` or `mixed`, include:

```js
`Run bf extract first so reports/data-result.json contains the requested data output.`
```

- [ ] **Step 7: Update verify tests**

In `tests/verify/verify-run.test.mjs`, replace assertions that expect:

```js
{ gate: "local_only", reason: "unmasked_real_site_diagnostic" }
```

with:

```js
{ gate: "registry", reason: "external_requires_operator_approval" }
```

Assert:

```js
assert.equal(verificationJson.promotionCandidate.status, "external_replay_candidate");
assert.equal(result.summary.headline, "External replay succeeded; save it with explicit promotion approval.");
```

- [ ] **Step 8: Mirror source into bundle**

Run:

```bash
cp -R scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs
cp -R scripts/lib/verification-outcomes.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs
cp -R scripts/lib/report-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs
cp -R scripts/verify/verify-run.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --test tests/lib/verification-outcomes.test.mjs tests/lib/report-summary.test.mjs
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/reports/schema-versions.test.mjs tests/verify/verify-run.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 10: Commit Task 4**

```bash
git add scripts/lib/schemas.mjs scripts/lib/verification-outcomes.mjs scripts/lib/report-summary.mjs scripts/verify/verify-run.mjs tests/lib/verification-outcomes.test.mjs tests/lib/report-summary.test.mjs tests/reports/schema-versions.test.mjs tests/verify/verify-run.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/verification-outcomes.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/report-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/verify/verify-run.mjs
git commit -m "fix: report external replay as promotion candidate"
```

---

### Task 5: Materialize Data Results For `extract` And `mixed` Data Modes

**Problem:** When the user says they want data, a successful replay plus extraction must leave a concrete result artifact and a short human-readable summary. Today `runner.mjs --headless` mostly prints console JSON, `verify` writes replay/security reports, and `extract` writes `extract-result.json`; there is no canonical "this is the requested data output" report.

**Files:**
- Create: `scripts/lib/data-result-summary.mjs`
- Create: `tests/lib/data-result-summary.test.mjs`
- Modify: `scripts/lib/config.mjs`
- Modify: `scripts/lib/schema-versions.mjs`
- Modify: `scripts/lib/schemas.mjs`
- Modify: `scripts/commands/extract.mjs`
- Modify: `scripts/commands/promote.mjs`
- Modify: `tests/extract/run-paths.test.mjs`
- Modify: `tests/extract/extract-command.test.mjs`
- Modify: `tests/commands/promote.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/config.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/schema-versions.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/data-result-summary.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/commands/extract.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs`

**Target Contract:**

After `bf extract --run-id <id> --apply ...` or `bf extract --run-id <id> --reuse`, the run contains:

```text
artifacts/runs/<id>/extract-result.json
artifacts/runs/<id>/reports/data-result.json
```

When `browser-flow promote --data-mode extract|mixed` is used, promotion requires `reports/data-result.json` and records its path/outcome/count in registry metadata. `--data-mode route` does not require a data result.

`reports/data-result.json` is the canonical user-facing data artifact:

```js
{
  schemaVersion: 1,
  runId: "naver-market-news-20260525",
  dataMode: "extract",
  replayOutcome: "passed",
  dataOutcome: "data",
  extractStatus: "data",
  stepIndex: 4,
  pageKey: "manual/news.naver.com/section/101",
  cardinality: 5,
  rowCount: 5,
  rows: [
    { title: "Current top headline" }
  ],
  previewRows: [
    { title: "Current top headline" }
  ],
  summary: {
    headline: "Data extraction produced 5 rows.",
    detail: "Replay passed; data was read from the current page snapshot."
  }
}
```

**Eval:**
- Data extraction writes `reports/data-result.json`.
- Data result schema parses.
- Drift reports become `dataOutcome:"drift"` and summary says replay and data are separate outcomes.
- Existing `extract-result.json` behavior remains unchanged.
- External promotion with `dataMode:"extract"` refuses to save when `reports/data-result.json` is missing.

**Result:**
- A workflow that is meant to return data leaves a stable result file and preview, not only terminal output or raw snapshots.

**Backlog Review:**
- If full automatic `verify --data-mode extract` orchestration is larger than this task, record it in `tasks/todo.md`. This task must still make the data output artifact deterministic once `bf extract` runs.

- [ ] **Step 1: Add failing run path test**

In `tests/extract/run-paths.test.mjs`, extend the existing test:

```js
assert.match(p.dataResultPath, /demo-run\/reports\/data-result\.json$/);
```

- [ ] **Step 2: Add failing data-result summary tests**

Create `tests/lib/data-result-summary.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDataResultArtifact,
  formatDataResultSummary
} from "../../scripts/lib/data-result-summary.mjs";

test("buildDataResultArtifact records extracted rows as the user-facing data result", () => {
  const artifact = buildDataResultArtifact({
    runId: "run-1",
    dataMode: "extract",
    verification: { replayOutcome: "passed", success: true, pathComplete: true },
    extractResult: {
      status: "data",
      stepIndex: 4,
      pageKey: "manual/news.example/section",
      cardinality: 2,
      rows: [{ title: "A" }, { title: "B" }]
    }
  });

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.replayOutcome, "passed");
  assert.equal(artifact.dataOutcome, "data");
  assert.equal(artifact.rowCount, 2);
  assert.deepEqual(artifact.previewRows, [{ title: "A" }, { title: "B" }]);
  assert.match(artifact.summary.headline, /2 rows/);
});

test("buildDataResultArtifact keeps replay success separate from extraction drift", () => {
  const artifact = buildDataResultArtifact({
    runId: "run-2",
    dataMode: "mixed",
    verification: { replayOutcome: "passed", success: true, pathComplete: true },
    extractResult: {
      status: "drift",
      stepIndex: 4,
      pageKey: "manual/news.example/section",
      cardinality: 0,
      rows: [],
      reason: "container missing"
    }
  });

  assert.equal(artifact.replayOutcome, "passed");
  assert.equal(artifact.dataOutcome, "drift");
  assert.match(formatDataResultSummary(artifact), /Replay passed; data extraction drifted/);
});
```

- [ ] **Step 3: Add failing extract command test**

In `tests/extract/extract-command.test.mjs`, inside the `runExtractCommand --apply` test after `const res = R(readJson(runPaths.extractResultPath));`, add:

```js
  const dataResult = R(readJson(runPaths.dataResultPath));
  assert.equal(dataResult.dataMode, "extract");
  assert.equal(dataResult.replayOutcome, "unknown");
  assert.equal(dataResult.dataOutcome, "data");
  assert.equal(dataResult.rowCount, 2);
  assert.equal(dataResult.rows[0].title, "First");
  assert.match(dataResult.summary.headline, /2 rows/);
```

Add a reuse drift assertion in the `runExtractCommand --reuse drift emits extract-heal-request` test:

```js
  const dataResult = R(readJson(runPaths.dataResultPath));
  assert.equal(dataResult.dataOutcome, "drift");
  assert.match(dataResult.summary.headline, /Data extraction drifted/);
```

In `tests/commands/promote.test.mjs`, add:

```js
test("promote external with extract data mode requires a data-result artifact", async () => {
  const runId = `promote-extract-no-data-${Date.now()}`;
  writeExternalRun(runId);

  assert.throws(() => promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "extract"
  }), /reports\/data-result\.json/);
});

test("promote external with extract data mode records data-result metadata", async () => {
  const runId = `promote-extract-data-${Date.now()}`;
  const runPaths = writeExternalRun(runId);
  writeFileSync(runPaths.dataResultPath, JSON.stringify({
    schemaVersion: 1,
    runId,
    dataMode: "extract",
    replayOutcome: "passed",
    dataOutcome: "data",
    extractStatus: "data",
    rowCount: 2,
    rows: [{ title: "A" }, { title: "B" }],
    previewRows: [{ title: "A" }, { title: "B" }],
    summary: { headline: "Data extraction produced 2 rows.", detail: "Replay passed; data was read from the current page snapshot." }
  }, null, 2));

  const result = promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "extract"
  });

  assert.equal(result.promotion.dataMode, "extract");
  assert.equal(result.promotion.dataResultPath, runPaths.dataResultPath);
  assert.equal(result.promotion.dataOutcome, "data");
  assert.equal(result.promotion.rowCount, 2);
});
```

- [ ] **Step 4: Run RED tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/extract/run-paths.test.mjs tests/lib/data-result-summary.test.mjs tests/extract/extract-command.test.mjs tests/commands/promote.test.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../scripts/lib/data-result-summary.mjs
```

- [ ] **Step 5: Add run path and schema version**

In `scripts/lib/config.mjs`, add to `getRunPaths()` after `securityPath`:

```js
    dataResultPath: resolve(runRoot, "reports", "data-result.json"),
```

In `scripts/lib/schema-versions.mjs`, add `dataResult: 1` to both `SCHEMA_VERSIONS` and `ACCEPTED_VERSIONS`:

```js
  dataResult: 1,
```

```js
  dataResult: Object.freeze([1]),
```

- [ ] **Step 6: Add data result schema**

In `scripts/lib/schemas.mjs`, after `SecurityArtifact`, add:

```js
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
    summary: z
      .object({
        headline: z.string().min(1),
        detail: z.string().min(1)
      })
      .passthrough()
  })
  .passthrough();

export const DataResultArtifact = z.discriminatedUnion("schemaVersion", [DataResultV1]);

/**
 * Parse + validate a data-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseDataResult(input, artifactPath = "<inline>") {
  const result = DataResultArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "data-result");
  }
  return result.data;
}
```

In `tests/reports/schema-versions.test.mjs`, add a parser assertion:

```js
test("DataResultArtifact accepts extracted data output", async () => {
  const { parseDataResult } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseDataResult({
    schemaVersion: 1,
    runId: "run-1",
    dataMode: "extract",
    replayOutcome: "passed",
    dataOutcome: "data",
    extractStatus: "data",
    rowCount: 1,
    rows: [{ title: "A" }],
    previewRows: [{ title: "A" }],
    summary: { headline: "Data extraction produced 1 row.", detail: "Replay passed; data was read from the current page snapshot." }
  }, "data-result.json");

  assert.equal(parsed.dataOutcome, "data");
});
```

- [ ] **Step 7: Implement data-result summary helper**

Create `scripts/lib/data-result-summary.mjs`:

```js
import { SCHEMA_VERSIONS } from "./schema-versions.mjs";

const DATA_MODES = new Set(["extract", "mixed"]);

/**
 * @param {{ runId: string, dataMode?: string, verification?: Record<string, any>, extractResult?: Record<string, any>, maxPreviewRows?: number }} input
 */
export function buildDataResultArtifact(input) {
  const extractResult = input.extractResult ?? {};
  const rows = Array.isArray(extractResult.rows) ? extractResult.rows : [];
  const extractStatus = String(extractResult.status ?? "missing");
  const dataOutcome = classifyDataOutcome(extractStatus, rows.length);
  const replayOutcome = classifyReplayOutcome(input.verification);
  const dataMode = DATA_MODES.has(String(input.dataMode)) ? String(input.dataMode) : "extract";
  const previewRows = rows.slice(0, input.maxPreviewRows ?? 5);
  const artifact = {
    schemaVersion: SCHEMA_VERSIONS.dataResult,
    runId: input.runId,
    dataMode,
    replayOutcome,
    dataOutcome,
    extractStatus,
    ...(typeof extractResult.stepIndex === "number" ? { stepIndex: extractResult.stepIndex } : {}),
    ...(extractResult.pageKey ? { pageKey: String(extractResult.pageKey) } : {}),
    ...(typeof extractResult.cardinality === "number" ? { cardinality: extractResult.cardinality } : {}),
    rowCount: rows.length,
    rows,
    previewRows,
    ...(extractResult.reason ? { reason: String(extractResult.reason) } : {})
  };
  return { ...artifact, summary: buildSummary(artifact) };
}

/**
 * @param {Record<string, any>} artifact
 */
export function formatDataResultSummary(artifact) {
  return `${artifact.summary?.headline ?? "Data result unavailable"} ${artifact.summary?.detail ?? ""}`.trim();
}

function classifyReplayOutcome(verification) {
  if (verification?.replayOutcome === "passed" || verification?.replayOutcome === "held" || verification?.replayOutcome === "failed") {
    return verification.replayOutcome;
  }
  if (verification?.success === true && verification?.pathComplete === true) return "passed";
  if (verification?.success === false) return "failed";
  return "unknown";
}

function classifyDataOutcome(status, rowCount) {
  if (status === "data") return rowCount > 0 ? "data" : "empty";
  if (status === "confident-zero") return "empty";
  if (status === "drift") return "drift";
  if (status === "no-schema") return "no_schema";
  return "unavailable";
}

function buildSummary(artifact) {
  if (artifact.dataOutcome === "data") {
    return {
      headline: `Data extraction produced ${artifact.rowCount} ${artifact.rowCount === 1 ? "row" : "rows"}.`,
      detail: `${replayText(artifact.replayOutcome)}; data was read from the current page snapshot.`
    };
  }
  if (artifact.dataOutcome === "empty") {
    return {
      headline: "Data extraction produced 0 rows.",
      detail: `${replayText(artifact.replayOutcome)}; the extractor matched the page but found no rows.`
    };
  }
  if (artifact.dataOutcome === "drift") {
    return {
      headline: "Data extraction drifted.",
      detail: `${replayText(artifact.replayOutcome)}; data extraction drifted and needs extractor healing.`
    };
  }
  if (artifact.dataOutcome === "no_schema") {
    return {
      headline: "No reusable data extractor was created.",
      detail: `${replayText(artifact.replayOutcome)}; the data schema was not reliable enough to extract.`
    };
  }
  return {
    headline: "Data result unavailable.",
    detail: `${replayText(artifact.replayOutcome)}; run bf extract to materialize requested data.`
  };
}

function replayText(replayOutcome) {
  if (replayOutcome === "passed") return "Replay passed";
  if (replayOutcome === "held") return "Replay held";
  if (replayOutcome === "failed") return "Replay failed";
  return "Replay outcome unknown";
}
```

- [ ] **Step 8: Write data-result from extract command**

In `scripts/commands/extract.mjs`, add imports:

```js
import { existsSync } from "node:fs";
import { buildDataResultArtifact } from "../lib/data-result-summary.mjs";
```

Extend the `runExtractCommand` JSDoc input type:

```js
 * @param {{ runId: string, applyPath?: string, schemaPath?: string, stepIndex?: number, reuse?: boolean, paged?: boolean, dataMode?: "extract" | "mixed" }} input
```

Add helper near `emitHealOnDrift`:

```js
function writeDataResult(runPaths, input, extractOut) {
  const verification = existsSync(runPaths.verificationPath) ? readJson(runPaths.verificationPath) : undefined;
  const dataResult = buildDataResultArtifact({
    runId: input.runId,
    dataMode: input.dataMode ?? "extract",
    verification,
    extractResult: extractOut
  });
  writeJson(runPaths.dataResultPath, dataResult);
  return dataResult;
}
```

Before every `writeJson(runPaths.extractResultPath, out)` call, add:

```js
    out.dataResultPath = runPaths.dataResultPath;
    out.dataResult = writeDataResult(runPaths, input, out);
```

For the `no-schema` branch, replace the direct return with:

```js
    const out = { runId: input.runId, status: "no-schema", stepIndex: applied.stepIndex, pageKey: applied.pageKey, reason: scrapeResult.reason };
    out.dataResultPath = runPaths.dataResultPath;
    out.dataResult = writeDataResult(runPaths, input, out);
    return out;
```

In `extractCommand(options)`, parse `--data-mode`:

```js
  const dataModeRaw = getStringOption(options, "data-mode", undefined);
  const dataMode = dataModeRaw === undefined ? undefined : dataModeRaw;
  if (dataMode !== undefined && dataMode !== "extract" && dataMode !== "mixed") {
    throw new Error("bf extract --data-mode must be extract or mixed.");
  }
  return runExtractCommand({ runId, applyPath, schemaPath, stepIndex, reuse, paged, dataMode });
```

- [ ] **Step 9: Require data-result for extract/mixed promotion**

In `scripts/commands/promote.mjs`, import:

```js
import { existsSync } from "node:fs";
```

After `const security = readJson(runPaths.securityPath);`, add:

```js
  let dataResult = null;
  if (dataMode === "extract" || dataMode === "mixed") {
    if (!existsSync(runPaths.dataResultPath)) {
      throw new Error("promote external with --data-mode extract|mixed requires reports/data-result.json. Run bf extract first.");
    }
    dataResult = readJson(runPaths.dataResultPath);
  }
```

In the `promotion` object, after `dataMode`, add:

```js
      ...(dataResult ? {
        dataResultPath: runPaths.dataResultPath,
        dataOutcome: dataResult.dataOutcome,
        rowCount: dataResult.rowCount
      } : {}),
```

- [ ] **Step 10: Mirror source into bundle**

Run:

```bash
cp -R scripts/lib/config.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/config.mjs
cp -R scripts/lib/schema-versions.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schema-versions.mjs
cp -R scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs
cp -R scripts/lib/data-result-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/data-result-summary.mjs
cp -R scripts/commands/extract.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/extract.mjs
cp -R scripts/commands/promote.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs
```

- [ ] **Step 11: Run focused tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/extract/run-paths.test.mjs tests/lib/data-result-summary.test.mjs tests/reports/schema-versions.test.mjs tests/extract/extract-command.test.mjs tests/commands/promote.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 12: Commit Task 5**

```bash
git add scripts/lib/config.mjs scripts/lib/schema-versions.mjs scripts/lib/schemas.mjs scripts/lib/data-result-summary.mjs scripts/commands/extract.mjs scripts/commands/promote.mjs tests/extract/run-paths.test.mjs tests/lib/data-result-summary.test.mjs tests/reports/schema-versions.test.mjs tests/extract/extract-command.test.mjs tests/commands/promote.test.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/config.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schema-versions.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/schemas.mjs .codex/skills/browser-flow/bundle/runtime/scripts/lib/data-result-summary.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/extract.mjs .codex/skills/browser-flow/bundle/runtime/scripts/commands/promote.mjs
git commit -m "feat: materialize requested data results"
```

---

### Task 6: Add Ask-Question Policy For External Reuse

**Problem:** The operator should be asked about login/profile/data/privacy choices up front instead of discovering registry limitations after verification.

**Files:**
- Modify: `knowledge/verify-spec/questions.base.json`
- Modify: `tests/commands/spec.test.mjs`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `agents/orchestrator/AGENT.md`
- Modify: `tests/skill/browser-flow-capture.test.mjs`
- Mirror: `.codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md`
- Mirror verify-spec questions into bundle if present.

**Target Questions:**

Add base questions:

```json
{
  "id": "external-promotion-intent",
  "prompt": "Should this external-site workflow be saved for reuse after replay verification? Default: no. Answer one of: no, ask-after-verify, yes.",
  "category": "registry",
  "requiredWhen": "external-target"
}
```

```json
{
  "id": "external-auth-profile-policy",
  "prompt": "How should login/profile dependency be handled? Default: no persistent profile. Answer one of: none, login-required, keychain-session, attach, persistent-profile.",
  "category": "auth",
  "requiredWhen": "external-target"
}
```

```json
{
  "id": "external-data-mode",
  "prompt": "Does this workflow need current dynamic data from a position/list, fixed replay only, or both? Answer one of: route, extract, mixed. If you choose extract or mixed, Browser Flow will write reports/data-result.json after extraction.",
  "category": "data",
  "requiredWhen": "external-target"
}
```

```json
{
  "id": "external-artifact-retention",
  "prompt": "Artifact retention policy? Default: minimal. Answer one of: minimal, profile, full. Screenshots remain off unless explicitly allowed.",
  "category": "privacy",
  "requiredWhen": "external-target"
}
```

**Eval:**
- `bf spec` asks these questions for external target requests.
- Skill text says default is privacy-preserving but operator can opt into profile persistence and richer artifacts.
- Orchestrator text uses project-local language, not localhost-only language.
- Data-mode text tells the user that `extract`/`mixed` produces `reports/data-result.json`, not only console output.

**Result:**
- The first interview captures external reuse, auth/profile, privacy, screenshot, and dynamic-data intent before the pipeline makes irreversible assumptions.

**Backlog Review:**
- If conditional `requiredWhen:"external-target"` is not enforced by current `detectGaps`, add the questions as detectable via raw request now and record full conditional question routing as backlog.

- [ ] **Step 1: Add failing spec test**

In `tests/commands/spec.test.mjs`, add:

```js
test("runSpecCommand asks external reuse policy questions for external workflow requests", async () => {
  const runId = `spec-external-${Date.now()}`;
  const answers = ["ask-after-verify", "login-required", "extract", "minimal"];
  let index = 0;

  const result = await runSpecCommand({
    runId,
    request: "Capture a NotebookLM workflow and save it for reuse",
    ask: async () => answers[index++]
  });

  assert.equal(result.asked.includes("external-promotion-intent"), true);
  assert.equal(result.asked.includes("external-auth-profile-policy"), true);
  assert.equal(result.asked.includes("external-data-mode"), true);
  assert.equal(result.asked.includes("external-artifact-retention"), true);
});
```

- [ ] **Step 2: Run spec test to verify RED**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/commands/spec.test.mjs
```

Expected:

```text
Expected values to be strictly equal:
+ actual - expected
+ false
- true
```

- [ ] **Step 3: Add verify-spec base questions**

Append the four target question objects to `knowledge/verify-spec/questions.base.json`.

If `detectGaps` only uses `detectInRawRequest`, add:

```json
"detectInRawRequest": "notion|notebooklm|keep|naver|gmail|external|reuse|save"
```

to the relevant questions so external workflow requests trigger them.

- [ ] **Step 4: Update skill/orchestrator wording**

In `.codex/skills/browser-flow/prompt.md`, replace local-only registry wording with:

```md
Browser Flow is project-local by installation/runtime footprint. External cloud services are normal workflow targets when the user opts into `--unmasked`. External workflows are replay-verified first and saved to the registry only after explicit operator approval with origin, auth/profile, privacy, screenshot, and data-mode metadata.
```

Add:

```md
For external workflows, ask before promotion: whether to save for reuse, which origins are allowed, whether login/profile persistence is acceptable, whether screenshots/richer artifacts are allowed, and whether dynamic data should be captured through Extract rather than fixed replay text. When the user chooses `extract` or `mixed`, run the extraction phase after replay verification and report `reports/data-result.json` as the user's data output.
```

In `agents/orchestrator/AGENT.md`, add the same policy under constraints.

- [ ] **Step 5: Update skill tests**

In `tests/skill/browser-flow-capture.test.mjs`, add:

```js
test("browser-flow treats external services as first-class replay-verified targets", () => {
  const prompt = readFileSync(resolve(getRepoRoot(), ".codex/skills/browser-flow/prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /project-local by installation\/runtime footprint/i);
  assert.match(prompt, /External cloud services are normal workflow targets/i);
  assert.match(prompt, /explicit operator approval/i);
  assert.match(prompt, /origin, auth\/profile, privacy, screenshot, and data-mode metadata/i);
  assert.match(prompt, /reports\/data-result\.json/i);
  assert.match(orchestrator, /External workflows are replay-verified/i);
});
```

- [ ] **Step 6: Mirror docs/questions into bundle**

Run:

```bash
cp -R agents/orchestrator/AGENT.md .codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md
```

If bundle has the verify-spec base file:

```bash
cp -R knowledge/verify-spec/questions.base.json .codex/skills/browser-flow/bundle/runtime/knowledge/verify-spec/questions.base.json
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --import=./tests/_setup.mjs --test --test-concurrency=1 tests/commands/spec.test.mjs tests/skill/browser-flow-capture.test.mjs
git diff --check
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Commit Task 6**

```bash
git add knowledge/verify-spec/questions.base.json .codex/skills/browser-flow/prompt.md agents/orchestrator/AGENT.md tests/commands/spec.test.mjs tests/skill/browser-flow-capture.test.mjs .codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md
git commit -m "docs: ask external workflow promotion policy"
```

Add the bundled verify-spec file to `git add` if it exists.

---

### Task 7: Full Verification And Release Sync

**Files:**
- Modify: `/Users/cielo-iamdt/projects/browser-flow-released` via the existing release sync hook.

**Eval:**
- Full source checks pass.
- E2E passes.
- Release repo is clean and has `release: sync from <source-sha>`.

**Result:**
- Source and released skill bundle both contain the external replay registry and data-result changes.

**Backlog Review:**
- If screenshot artifact capture is requested as more than metadata, add a separate implementation plan. Do not silently claim screenshot persistence works unless a test proves an actual screenshot file is written and sanitized.

- [ ] **Step 1: Run full check**

Run:

```bash
npm run check
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run e2e**

Run:

```bash
npm run test:e2e
```

Expected:

```text
[run-suite] PASS
```

- [ ] **Step 3: Validate skill explicitly**

Run:

```bash
node .codex/skills/browser-flow/scripts/validate-skill.mjs
```

Expected:

```text
browser-flow skill validated
```

- [ ] **Step 4: Confirm source and release status**

Run:

```bash
git status --short
git -C /Users/cielo-iamdt/projects/browser-flow-released status --short
git -C /Users/cielo-iamdt/projects/browser-flow-released log --oneline -1
```

Expected:

```text
<no source status>
<no release status>
<sha> release: sync from <source-sha>
```

- [ ] **Step 5: Commit any release sync gap only if needed**

If the release sync hook did not create a release commit:

```bash
node scripts/publish/build-bundle.mjs
git -C /Users/cielo-iamdt/projects/browser-flow-released status --short
git -C /Users/cielo-iamdt/projects/browser-flow-released add .
git -C /Users/cielo-iamdt/projects/browser-flow-released commit -m "release: sync from <source-sha>"
```

Do not overwrite unrelated release repo changes.
