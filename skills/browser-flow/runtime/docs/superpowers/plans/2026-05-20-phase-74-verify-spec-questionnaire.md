# Phase 74 — verifiable-spec Questionnaire (①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Front bookend — gather the verifiable spec (site / login / file / inputs / teardown-strategy / sandbox / safety-consent), asking the operator only the gaps the raw request didn't already answer, backed by a managed base⊕override question dataset.

**Architecture:** Deterministic core (project invariant: pipeline stays LLM-free) does keyword-based gap detection + interactive ask + base⊕override merge. LLM refinement is an offline sub-skill contract (`.codex/skills/spec-agent/`), mirroring Phase 61 variable-agent. Builds on Phase 73 (`getVerifySpecPaths`, workflow schema) + Phase 61 interaction helpers (`createReadlineAsk`/`createScriptedAsk` in `scripts/lib/variable-agent-interaction.mjs`).

**Tech Stack:** Node ESM `.mjs`, Zod (`scripts/lib/schemas.mjs`), `node --test` (`--import=./tests/_setup.mjs`, NODE_TEST_CONTEXT guard), TS strict + checkJs (keep `npm run check` GREEN).

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` §①.

---

## File Structure

- Create: `knowledge/verify-spec/questions.base.json` — canonical seed questions (committed)
- Create: `scripts/lib/verify-spec.mjs` — merge(base⊕override) + verify-spec read/write + schema
- Create: `scripts/lib/spec-agent.mjs` — deterministic gap detection
- Create: `scripts/commands/spec.mjs` — `bf spec` CLI
- Create: `.codex/skills/spec-agent/SKILL.md` — LLM refinement sub-skill contract
- Modify: `scripts/cli.mjs` — register `bf spec`
- Modify: `scripts/lib/schemas.mjs` — VerifySpec Zod schema
- Tests: `tests/lib/verify-spec.test.mjs`, `tests/lib/spec-agent.test.mjs`, `tests/commands/spec.test.mjs`

---

## Task 74.1: base question dataset

**Files:** Create `knowledge/verify-spec/questions.base.json`; Test `tests/lib/verify-spec.test.mjs`

- [ ] **Step 1: failing test**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getVerifySpecPaths } from "../../scripts/lib/config.mjs";

test("questions.base.json is a non-empty array of well-formed questions", () => {
  const { basePath } = getVerifySpecPaths("any");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  assert.ok(Array.isArray(base) && base.length >= 5);
  for (const q of base) {
    assert.ok(typeof q.id === "string" && q.id.length > 0);
    assert.ok(typeof q.prompt === "string" && q.prompt.length > 0);
    assert.ok(["site","credential","file","input","teardown","sandbox","safety"].includes(q.category));
  }
  const ids = base.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const required of ["site-url","login-required","file-location","teardown-strategy","irreversible-ops-consent"]) {
    assert.ok(ids.includes(required), `missing seed question ${required}`);
  }
});
```

- [ ] **Step 2: run, expect fail** — `node --import=./tests/_setup.mjs --test tests/lib/verify-spec.test.mjs` → file not found.

- [ ] **Step 3: create `knowledge/verify-spec/questions.base.json`**
```json
[
  { "id": "site-url", "prompt": "어떤 사이트 주소에서 작업하나요? (전체 URL)", "category": "site", "requiredWhen": "always", "detectInRawRequest": "https?://|사이트|주소|url" },
  { "id": "login-required", "prompt": "로그인이 필요한가요? 필요하면 로그인 방식(아이디/비번, OAuth 등)을 알려주세요.", "category": "credential", "requiredWhen": "external-url", "detectInRawRequest": "로그인|login|계정|account|인증" },
  { "id": "file-location", "prompt": "업로드할 파일이 있나요? 있으면 파일 경로를 알려주세요.", "category": "file", "requiredWhen": "flow-has-file-input", "detectInRawRequest": "파일|file|업로드|upload|경로|path" },
  { "id": "input-values", "prompt": "입력값(검색어, 노트 내용 등)에 무엇이 들어가야 하나요?", "category": "input", "requiredWhen": "flow-has-text-input", "detectInRawRequest": "입력|검색|노트|내용|쿼리|query|값" },
  { "id": "teardown-strategy", "prompt": "verify가 만든 데이터를 어떻게 정리할까요? record(정리 과정도 녹화) 또는 search(시스템이 조회해서 정리)?", "category": "teardown", "requiredWhen": "always", "detectInRawRequest": "정리|teardown|cleanup|삭제|record|search" },
  { "id": "sandbox-available", "prompt": "테스트용 sandbox/playground(폴더·파일·테스트 계정 등)가 있나요? (있으면 위치)", "category": "sandbox", "requiredWhen": "always", "detectInRawRequest": "sandbox|playground|테스트.?계정|test.?account|샌드박스" },
  { "id": "irreversible-ops-consent", "prompt": "이 플로우에 비가역 동작(결제/이메일발송/외부공유 등)이 있나요? 있으면 verify에서 제외됩니다 — 동의하시나요?", "category": "safety", "requiredWhen": "always", "detectInRawRequest": "결제|payment|이메일|email|공유|share|전송|송금" }
]
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit**
```bash
git add knowledge/verify-spec/questions.base.json tests/lib/verify-spec.test.mjs
git commit -m "phase 74: verify-spec base question dataset (7 seed questions)"
```

## Task 74.2: base⊕override merge (base immutable)

**Files:** Create `scripts/lib/verify-spec.mjs`; Test `tests/lib/verify-spec.test.mjs`

- [ ] **Step 1: failing test** (append)
```js
import { loadMergedQuestions } from "../../scripts/lib/verify-spec.mjs";
import { mkdtempSync, writeFileSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("loadMergedQuestions merges override by id without mutating base", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec-"));
  const basePath = join(dir, "base.json");
  const overridePath = join(dir, "override.json");
  const base = [{ id: "site-url", prompt: "base prompt", category: "site" }, { id: "login-required", prompt: "p2", category: "credential" }];
  writeFileSync(basePath, JSON.stringify(base));
  writeFileSync(overridePath, JSON.stringify([
    { id: "site-url", prompt: "OVERRIDDEN", category: "site" },
    { id: "custom-q", prompt: "new", category: "input" }
  ]));
  const merged = loadMergedQuestions(basePath, overridePath);
  const byId = Object.fromEntries(merged.map((q) => [q.id, q]));
  assert.equal(byId["site-url"].prompt, "OVERRIDDEN");
  assert.equal(byId["custom-q"].prompt, "new");
  assert.equal(byId["login-required"].prompt, "p2");
  // base file on disk unchanged
  assert.equal(JSON.parse(rf(basePath, "utf8"))[0].prompt, "base prompt");
});

test("loadMergedQuestions returns base when override absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec2-"));
  const basePath = join(dir, "base.json");
  writeFileSync(basePath, JSON.stringify([{ id: "x", prompt: "p", category: "site" }]));
  const merged = loadMergedQuestions(basePath, join(dir, "nonexistent.json"));
  assert.equal(merged.length, 1);
});
```

- [ ] **Step 2: run, expect fail** — module missing.

- [ ] **Step 3: implement `scripts/lib/verify-spec.mjs`**
```js
import { existsSync, readFileSync } from "node:fs";

/**
 * @typedef {{ id: string, prompt: string, category: string, requiredWhen?: string, detectInRawRequest?: string }} SpecQuestion
 */

/**
 * Merge override onto base by question id. Override replaces a base
 * question with the same id and appends new ids. The base array/objects
 * are never mutated (a fresh merged array of fresh objects is returned).
 *
 * @param {string} basePath
 * @param {string} overridePath
 * @returns {SpecQuestion[]}
 */
export function loadMergedQuestions(basePath, overridePath) {
  const base = /** @type {SpecQuestion[]} */ (JSON.parse(readFileSync(basePath, "utf8")));
  const override = existsSync(overridePath)
    ? /** @type {SpecQuestion[]} */ (JSON.parse(readFileSync(overridePath, "utf8")))
    : [];
  const byId = new Map();
  for (const q of base) byId.set(q.id, { ...q });
  for (const q of override) byId.set(q.id, { ...q });
  return Array.from(byId.values());
}
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit**
```bash
git add scripts/lib/verify-spec.mjs tests/lib/verify-spec.test.mjs
git commit -m "phase 74: loadMergedQuestions (base⊕override by id, base immutable)"
```

## Task 74.3: deterministic gap detection

**Files:** Create `scripts/lib/spec-agent.mjs`; Test `tests/lib/spec-agent.test.mjs`

- [ ] **Step 1: failing test**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { detectGaps } from "../../scripts/lib/spec-agent.mjs";

const QS = [
  { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" },
  { id: "login-required", category: "credential", detectInRawRequest: "로그인|login" },
  { id: "teardown-strategy", category: "teardown", detectInRawRequest: "정리|teardown|cleanup" }
];

test("detectGaps marks a question answered when raw request matches its pattern", () => {
  const { answered, missing } = detectGaps(QS, "https://notebooklm.google.com 에서 로그인 후 작업", {});
  assert.deepEqual(answered.sort(), ["login-required", "site-url"]);
  assert.deepEqual(missing, ["teardown-strategy"]);
});

test("detectGaps treats knownAnswers as answered regardless of raw text", () => {
  const { answered, missing } = detectGaps(QS, "", { "teardown-strategy": "record" });
  assert.ok(answered.includes("teardown-strategy"));
  assert.ok(missing.includes("site-url"));
});

test("detectGaps with no detectInRawRequest pattern is always missing unless known", () => {
  const { missing } = detectGaps([{ id: "q1", category: "input" }], "anything", {});
  assert.deepEqual(missing, ["q1"]);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/lib/spec-agent.mjs`**
```js
/**
 * Deterministic gap detection. A question is "answered" if the operator
 * already provided it in knownAnswers, OR the raw request text matches the
 * question's detectInRawRequest regex (case-insensitive). Otherwise it is
 * "missing" and must be asked. No LLM here — the deterministic pipeline
 * stays LLM-free (LLM refinement is the offline spec-agent sub-skill).
 *
 * @param {Array<{ id: string, detectInRawRequest?: string }>} questions
 * @param {string} rawRequest
 * @param {Record<string, unknown>} knownAnswers
 * @returns {{ answered: string[], missing: string[] }}
 */
export function detectGaps(questions, rawRequest, knownAnswers) {
  const raw = String(rawRequest ?? "");
  const answered = [];
  const missing = [];
  for (const q of questions) {
    if (knownAnswers && Object.prototype.hasOwnProperty.call(knownAnswers, q.id)) {
      answered.push(q.id);
      continue;
    }
    const pattern = q.detectInRawRequest;
    if (pattern && new RegExp(pattern, "i").test(raw)) {
      answered.push(q.id);
    } else {
      missing.push(q.id);
    }
  }
  return { answered, missing };
}
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit**
```bash
git add scripts/lib/spec-agent.mjs tests/lib/spec-agent.test.mjs
git commit -m "phase 74: deterministic gap detection (raw-request pattern + knownAnswers)"
```

## Task 74.4: VerifySpec schema + read/write

**Files:** Modify `scripts/lib/schemas.mjs`; Modify `scripts/lib/verify-spec.mjs`; Test `tests/lib/verify-spec.test.mjs`

- [ ] **Step 1: failing test** (append)
```js
import { writeVerifySpec, readVerifySpec } from "../../scripts/lib/verify-spec.mjs";

test("writeVerifySpec + readVerifySpec round-trip with schema validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec3-"));
  const p = join(dir, "verify-spec.json");
  const spec = { schemaVersion: 1, answers: { "site-url": "https://x", "teardown-strategy": "record" } };
  writeVerifySpec(p, spec);
  const back = readVerifySpec(p);
  assert.equal(back.answers["site-url"], "https://x");
});

test("readVerifySpec throws on malformed (missing schemaVersion)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec4-"));
  const p = join(dir, "bad.json");
  writeFileSync(p, JSON.stringify({ answers: {} }));
  assert.throws(() => readVerifySpec(p), /schemaVersion|Invalid/i);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in `scripts/lib/schemas.mjs` add:
```js
const VerifySpecV1 = z.object({
  schemaVersion: z.literal(1),
  answers: z.record(z.string(), z.unknown())
}).strict();
export const VerifySpecArtifact = z.discriminatedUnion("schemaVersion", [VerifySpecV1]);
export function parseVerifySpec(input, artifactPath = "<inline>") {
  const result = VerifySpecArtifact.safeParse(input);
  if (!result.success) {
    throw new Error(`${artifactPath}: ${formatZodError(result.error)}`);
  }
  return result.data;
}
```
(match the file's existing `formatZodError` + discriminatedUnion + parse-wrapper pattern used by `parseWorkflowArtifact`.)

In `scripts/lib/verify-spec.mjs` add:
```js
import { writeFileSync } from "node:fs";
import { parseVerifySpec } from "./schemas.mjs";

/** @param {string} path @param {unknown} spec */
export function writeVerifySpec(path, spec) {
  const validated = parseVerifySpec(spec, path);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`);
}

/** @param {string} path */
export function readVerifySpec(path) {
  return parseVerifySpec(JSON.parse(readFileSync(path, "utf8")), path);
}
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit**
```bash
git add scripts/lib/schemas.mjs scripts/lib/verify-spec.mjs tests/lib/verify-spec.test.mjs
git commit -m "phase 74: VerifySpec Zod schema + read/write round-trip"
```

## Task 74.5: `bf spec` command

**Files:** Create `scripts/commands/spec.mjs`; Modify `scripts/cli.mjs`; Test `tests/commands/spec.test.mjs`

- [ ] **Step 1: failing test** — uses `createScriptedAsk` to answer the missing questions, asserts `verify-spec.json` written with merged answers (raw-answered skipped, missing asked).
```js
import test from "node:test";
import assert from "node:assert/strict";
import { runSpecCommand } from "../../scripts/commands/spec.mjs";
import { createScriptedAsk } from "../../scripts/lib/variable-agent-interaction.mjs";
import { getVerifySpecPaths } from "../../scripts/lib/config.mjs";
import { readVerifySpec } from "../../scripts/lib/verify-spec.mjs";
import { mkdirSync } from "node:fs";

test("runSpecCommand asks only the gaps and writes verify-spec.json", async () => {
  const runId = `spec-${Date.now()}`;
  const { perRunPath } = getVerifySpecPaths(runId);
  mkdirSync(perRunPath.replace(/\/verify-spec\.json$/, ""), { recursive: true });
  // raw request answers site-url; the rest are asked via scripted ask
  const ask = createScriptedAsk([
    "y", // login-required
    "/path/file", // file-location
    "노트 내용", // input-values
    "record", // teardown-strategy
    "n", // sandbox-available
    "n"  // irreversible-ops-consent
  ]);
  await runSpecCommand({ runId, request: "https://notebooklm.google.com 에서 작업", ask });
  const spec = readVerifySpec(perRunPath);
  assert.equal(spec.answers["site-url"], "https://notebooklm.google.com 에서 작업"); // detected from raw
  assert.equal(spec.answers["teardown-strategy"], "record");
});
```
Note: confirm the gap-detected `site-url` value semantics — store the raw request as the site-url answer or extract the URL? For this task, store the raw request string for raw-answered questions (extraction refinement is the LLM sub-skill's job). Adjust the assertion to match the chosen semantic and document it.

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/commands/spec.mjs`**
```js
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getStringOption } from "../lib/args.mjs";
import { getVerifySpecPaths } from "../lib/config.mjs";
import { loadMergedQuestions, writeVerifySpec } from "../lib/verify-spec.mjs";
import { detectGaps } from "../lib/spec-agent.mjs";
import { createReadlineAsk } from "../lib/variable-agent-interaction.mjs";

/**
 * @param {{ runId: string, request?: string, ask?: (prompt: string) => Promise<string> }} input
 */
export async function runSpecCommand(input) {
  const runId = input.runId;
  const request = input.request ?? "";
  const { basePath, overridePath, perRunPath } = getVerifySpecPaths(runId);
  const questions = loadMergedQuestions(basePath, overridePath);
  const { answered, missing } = detectGaps(questions, request, {});

  /** @type {Record<string, unknown>} */
  const answers = {};
  for (const id of answered) answers[id] = request; // raw-answered: store raw (LLM refines later)

  const asker = input.ask ? { ask: input.ask, close() {} } : createReadlineAsk();
  try {
    for (const id of missing) {
      const q = questions.find((x) => x.id === id);
      answers[id] = await asker.ask(`${q?.prompt ?? id}\n> `);
    }
  } finally {
    asker.close?.();
  }

  mkdirSync(dirname(perRunPath), { recursive: true });
  writeVerifySpec(perRunPath, { schemaVersion: 1, answers });
  return { runId, verifySpecPath: perRunPath, asked: missing, detected: answered };
}

/** CLI entry (parsed options) */
export async function specCommand(options) {
  const runId = getStringOption(options, "run-id");
  if (!runId) throw new Error("bf spec requires --run-id");
  const request = getStringOption(options, "request") ?? "";
  return runSpecCommand({ runId, request });
}
```
Register in `scripts/cli.mjs`: import `specCommand`, add the help line, and:
```js
  if (command === "spec") {
    const result = await specCommand(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
```

- [ ] **Step 4: run, expect pass** — `node --import=./tests/_setup.mjs --test tests/commands/spec.test.mjs`.

- [ ] **Step 5: commit**
```bash
git add scripts/commands/spec.mjs scripts/cli.mjs tests/commands/spec.test.mjs
git commit -m "phase 74: bf spec command — gap-only questionnaire writes verify-spec.json"
```

## Task 74.6: spec-agent LLM-refinement sub-skill contract

**Files:** Create `.codex/skills/spec-agent/SKILL.md`

- [ ] **Step 1: write** the sub-skill contract (mirror `.codex/skills/variable-agent/SKILL.md`): the deterministic core does keyword gap-detection + interactive ask; this skill describes how an offline LLM sub-agent (a) refines raw-answered values (e.g., extract the bare URL from a sentence for `site-url`), (b) proposes new/refined questions written to **override only** (base immutable, operator-confirmed), (c) never enters the deterministic pipeline. Input: merged questions + raw request + per-run answers. Output: refined answers + proposed override questions (operator-gated).

- [ ] **Step 2: validate-skill still passes** — `npm run validate-skill > /dev/null 2>&1; echo $?` → 0.

- [ ] **Step 3: commit**
```bash
git add .codex/skills/spec-agent/SKILL.md
git commit -m "phase 74: spec-agent LLM-refinement sub-skill contract (override-only evolution)"
```

## Task 74.7: Phase 74 plan doc

**Files:** Create `tasks/phases/phase-74-verify-spec-questionnaire.md`

- [ ] **Step 1: write** following the existing phase-doc format (사용자 quote: "사이트명, 로그인 유무, 파일위치, 노트 내용 ... 물어보는 과정이 잇어야함" + "데이터셋도 관리하면서 ... override 로"), 산출물 table with commits, test counts, Out of scope (LLM refinement runtime, search/teardown later).

- [ ] **Step 2: commit**
```bash
git add tasks/phases/phase-74-verify-spec-questionnaire.md
git commit -m "phase 74 plan doc — verifiable-spec questionnaire (base⊕override + gap detection + bf spec)"
```

---

## Self-Review

- **Spec §① coverage:** base dataset (74.1) ✓, base⊕override merge immutable (74.2) ✓, gap detection skip-answered/ask-missing (74.3) ✓, per-run verify-spec.json (74.4) ✓, `bf spec` flow (74.5) ✓, LLM-refinement override-only evolution (74.6 contract) ✓.
- **Placeholder scan:** complete code in 74.1-74.5; 74.6/74.7 are doc tasks (contract + phase doc), legitimately prose. One inline decision flagged for the implementer in 74.5 Step 1 (raw-answered value semantic: store raw string; LLM extracts later) — explicit, not a placeholder.
- **Type consistency:** `SpecQuestion` fields (id/prompt/category/requiredWhen/detectInRawRequest) consistent across 74.1/74.2/74.3. `loadMergedQuestions`/`detectGaps`/`writeVerifySpec`/`readVerifySpec`/`runSpecCommand`/`specCommand` names consistent across tasks. VerifySpec `{schemaVersion:1, answers:{}}` shape consistent (74.4/74.5).
- **LLM-free invariant:** deterministic core (74.1-74.5) has no LLM; refinement is sub-skill (74.6) outside the pipeline — honors roadmap "Inline LLM in pipeline: NO".
- **Governance:** phase doc 74 → delta 74-71=3 (< 5) → no constraint review this phase. Eval audit far off.

## Execution Handoff

Execute via subagent-driven-development, Task 74.1 → 74.7. Phase 75 (auth) detailed after 74 lands.
