# Human-in-Loop Verify — Design Spec

**Date:** 2026-05-20
**Status:** Approved (brainstorming), pending implementation plan
**Author:** browser-flow session (orchestrator + operator co-design)

## Goal

Make real-site capture **verifiable** — safely and reproducibly — by placing
**human-in-loop bookends** around the existing deterministic 4-phase pipeline.
The CDP-direct migration (Phase 64-72) proved *capture* works on a real
authenticated site (NotebookLM, verified 2026-05-20: 13-step capture, order +
values confirmed by operator). `verify`-replay remains blocked by two real
limits this design resolves:

- **(a) precondition unreachable** — verify uses a fresh ephemeral profile, so
  an authenticated site (login required) shows a different page than the
  captured session; captured selectors don't exist.
- **(b) destructive replay** — replaying captured actions against a live
  authenticated account mutates real data (upload, submit, delete).

## Background / why this shape

- A capture is always a *subset* of a longer flow. If the real flow is `a→z`
  and we captured `v→z`, the preconditions established in `a→u` (login,
  prior state) are not in the capture. verify must reconstruct those
  preconditions or it produces a false proof.
- The operator's earlier "record anything, interpret it" instruction was a
  deliberate blind test of LLM comprehension. Result: the LLM reconstructed
  the action sequence accurately (order + values). **LLM comprehension of
  captured actions is now trusted** — the design does not re-litigate it.
- Therefore the uncertainty is not "can the model understand the capture" but
  "can verify reach the precondition state and clean up after itself without
  damaging real data." Human-in-loop at both ends closes that.

## Architecture — bookends

```
[FRONT human-in-loop]            [existing 4-phase]               [BACK human-in-loop]
verifiable-spec 설문      →   prepare→done→analyze→generate   →   verify
(ask only the gaps)            (+ preconditions / teardown /        (1st run human-controlled,
                                safety meta into workflow.json)      repeat runs automated, self-cleaning)
```

Six components:

1. verifiable-spec questionnaire (front)
2. auth model (precondition reachability)
3. teardown strategy
4. safety classification + consent
5. self-cleaning verify execution
6. data-model extensions

---

## ① verifiable-spec questionnaire (front bookend)

LLM interprets each capture against a **managed standard dataset** of
questions — interpretation is per-case (LLM), but it references and evolves a
canonical question set. Three layers:

1. **base question dataset** — committed, versioned, canonical. Path:
   `knowledge/verify-spec/questions.base.json`. Each question:
   ```json
   {
     "id": "login-required",
     "prompt": "이 사이트는 로그인이 필요한가요? (y/n, 필요하면 로그인 방식)",
     "category": "credential",
     "requiredWhen": "startUrl is external (non-localhost)",
     "detectInRawRequest": "raw request mentions login / 로그인 / account / 계정"
   }
   ```
   Categories: `site`, `credential`, `file`, `input`, `teardown`, `sandbox`,
   `safety`. Seed questions: `site-url`, `login-required`, `file-location`,
   `input-values`, `teardown-strategy` (record|search), `sandbox-available`,
   `irreversible-ops-consent`.

2. **user override** — per-user divergence, **never mutates base**. Path:
   `verify-spec/override.json` (gitignored) with optional env override
   `BROWSER_FLOW_VERIFY_SPEC_PATH` (parallels registry/pages override
   pattern). Read-time merge = `base ⊕ override` (override adds/replaces by
   question `id`).

3. **per-run output** — `verify-spec.json` under the run dir: the answered,
   parameterized spec for this capture.

**Flow (spec-agent, runs before/at prepare):**
1. read `base ⊕ override`
2. parse the operator's raw natural-language request against the question set
3. per question: if raw request already answers it → **skip**; else → **ask
   the operator** (one at a time)
4. collect answers → write `verify-spec.json`
5. if the model proposes a new/refined question → write to **override only**
   (base immutable), after operator confirmation

**Principle:** interpretation is LLM per-run; the dataset is the shared
reference; dataset evolution is override-only. Same "override, never pollute
the committed base" discipline applied to the registry/pages this session.

**Builds on:** Phase 61 variable-agent (`scripts/lib/variable-proposer.mjs`,
`variable-agent-interaction.mjs`) and the `make-verifiable` skill. The
questionnaire is the variable-agent generalized from "extract input variables"
to "gather the full verifiable precondition+teardown+safety spec."

---

## ② auth model — precondition reachability

Chosen mechanism: **B (login as a parameterized step) bootstrapped by human,
session reused via keychain.** Rationale: options requiring a pre-logged-in
sandbox profile (persistent-profile reuse / storage-state extraction) assume a
sandbox account most users lack. Replaying login from real credentials works
for any user — but the agent must never see the credential.

**Mechanism:**
- **First verify**: human types credentials directly into the Chrome login
  form (agent intervention = 0; 2FA / captcha handled by the human in the
  browser). The resulting **authenticated session** (cookies / storage-state)
  is captured and **encrypted into the OS keychain**.
- **Repeat verify**: the generated runner reads the saved session from the
  keychain at runtime and **injects it into a fresh profile** before replaying
  `v→z`. The agent (LLM context, artifacts) never sees the session value.
- **On session expiry**: injection fails / lands on a login page → fall back
  to the first-verify human-bootstrap path (re-prompt human).

**Critical distinction:** the keychain stores the **authenticated session**,
NOT the password. The password is typed by the human at bootstrap and is never
persisted anywhere. This both (a) avoids re-login on every repeat (so 2FA
sites work after one human bootstrap) and (b) keeps the credential entirely
out of the system.

**Agent-blind guarantee:** session value lives only in (1) the live Chrome
profile during bootstrap and (2) the OS keychain. It is never written to
`artifacts/`, never enters an LLM/agent context, and is referenced elsewhere
only by a `secretRef`-style handle.

**Builds on:** existing secret redaction (`scripts/security/` redacts
password fields to `secretRef` already) and `generate-runner.mjs:194` which
already accepts an optional `replayProfileDir` — the injection hook partially
exists.

---

## ③ teardown strategy — user-selectable

How verify learns to undo data it creates. Operator-selectable per capture
(the tool offers the choice; users differ):

- **Strategy `record`** — the operator records a cleanup demo (same capture
  mechanism we already have) → stored as an **inverse segment**. verify runs
  the forward replay, then the recorded teardown. Explicit and exact; one
  extra capture.
- **Strategy `search`** — the operator declares cleanup intent in natural
  language; the system "looks it up" by searching the captured **DOM /
  network / page-node graph** for the teardown path (LLM-assisted). One
  capture; the generated teardown is human-verified on the first verify.
- **Strategy `BFS` (north-star, not first deliverable)** — auto-discover the
  inverse (delete) path by breadth-first traversal of the page-node graph.
  `search` is the reduced form of this; `BFS` is what `search` grows into as
  the graph matures. Implemented opportunistically — when the graph lacks a
  delete path, `BFS` is unavailable and the system falls back to `record` /
  `search`.

**Relationship:** `search` ⊂ `BFS` (search is the manual-seed version of the
graph traversal). The choice between `record` and `search` is offered to the
operator as a first-class option, mirroring the auth/variable choices.

**Builds on:** Phase 36 page-node graph (`knowledge/pages/`), Phase 63 (planned)
`dependency-graph`/`segments`, and the unstarted breadth-search (todo 2b) —
this design is where breadth-search connects to verify.

---

## ④ safety classification + consent

Not every action has a clean inverse. Irreversible / high-consequence
operations are **excluded from verify** and require explicit operator notice +
consent.

- **Excluded categories** (financial / security / business): payment, email
  send, external share, and similar irreversible side-effecting actions.
- **Detection**: at analyze-time the system classifies captured actions; a
  step flagged irreversible is marked `safety.irreversible = true` and is
  **not replayed in verify**. Classification is LLM-assisted (the operator
  already trusts LLM comprehension) and surfaced to the operator for
  confirmation — never silently decided.
- **Consent**: before any verify that would touch a non-excluded but
  side-effecting action, the operator is shown exactly what will execute and
  must consent. Excluded actions are reported as "verify에서 제외됨 (비가역)".
- **Honesty**: this is the acknowledged limit of full e2e verification — the
  same reason responsible engineers don't test irreversible ops against prod.
  The design makes the limit explicit and consent-gated rather than hiding it.

---

## ⑤ self-cleaning verify execution

verify must not leave residue in real data.

- **Sandbox first** — the questionnaire recommends the operator set up a
  sandbox / playground arena (a folder, a throwaway file, a test space). When
  available, verify operates there; destructive replay is harmless.
- **Dummy + teardown fallback** — when no sandbox exists (e.g., NotebookLM has
  no test-space concept), verify creates **test-dummy** data, runs the flow,
  then tears it down (per strategy ③). Dummy naming is **human-readable
  prefix + agent-searchable hash**, e.g. `__bf_test__<shorthash>` — readable
  for a human scanning the account, uniquely findable for idempotent teardown
  retries (orphan recovery if a prior teardown failed mid-way).
- **Execution model**:
  - **First verify**: human-controlled, run once. Human bootstraps auth (②),
    confirms the action interpretation (reflect-back), consents to
    side-effects (④), watches teardown.
  - **Repeat verify**: automated. Keychain session injection (②) + chosen
    teardown (③). Full replay including teardown ("create → run → delete") so
    no residue accumulates.

**Dangling risk**: like DB dangling rows, a mid-teardown failure can leave
orphan dummies. Mitigation: identifiable dummy naming + idempotent teardown
that re-finds and removes leftovers on the next run.

---

## ⑥ data-model extensions

`workflow.json` (the analyze output) gains three fields:

```json
{
  "steps": [ ... existing, with atomicFp/submitterAtomicFp ... ],
  "segments": [ ... existing ... ],
  "inputs": [ ... existing ... ],
  "preconditions": [
    { "kind": "login", "site": "notebooklm.google.com",
      "authMode": "human-bootstrap+keychain-session",
      "sessionRef": "<keychain handle>" }
  ],
  "teardown": {
    "strategy": "record" | "search" | "bfs",
    "steps": [ ... inverse steps (record) or discovered (search) ... ],
    "dummyNaming": { "prefix": "__bf_test__", "hashLen": 8 }
  },
  "safety": {
    "irreversibleStepIndexes": [ ... ],
    "consentRequired": true | false,
    "sandbox": { "available": true|false, "location": "<path or null>" }
  }
}
```

New committed files:
- `knowledge/verify-spec/questions.base.json` (canonical question set)

New gitignored / user-local:
- `verify-spec/override.json` (per-user question override)
- per-run `verify-spec.json` (answered spec, under run dir — ephemeral)

Keychain: session handles only; no values in repo.

---

## Verify execution model (sequence)

```
verify --run-id X [--first | --repeat]

FIRST (human-controlled, once):
  read verify-spec.json + workflow.preconditions
  → human bootstraps auth in Chrome (2FA by human) → session → keychain
  → reflect-back captured actions to operator (맞나요?)
  → operator consents to side-effecting steps (safety ④)
  → fresh profile + injected session
  → replay forward (skipping irreversible steps)
  → run teardown (③) → confirm no residue
  → record verification.json + security.json

REPEAT (automated):
  inject keychain session into fresh profile (agent-blind)
  → replay forward (skip irreversible)
  → run teardown
  → verification.json (+ on session-expiry: fall back to FIRST)
```

---

## Testing strategy

- **Unit**: question merge (`base ⊕ override`, override never mutates base);
  spec-agent gap detection (raw request answers → skip; missing → ask);
  dummy-name generation (prefix + hash, idempotent re-find); safety
  classifier (irreversible categories flagged); teardown step derivation
  (record inverse round-trip; search over a fixture page-node graph).
- **Integration (synthetic fixtures)**: full bookended loop on a bundled
  fixture with a simulated login segment + a create/teardown pair — verifies
  the create→run→delete cycle leaves the fixture store clean. No real
  credentials; the synthetic "auth" is a fixture form.
- **Keychain**: mock the keychain read/write boundary in tests (no real OS
  keychain in CI); assert the session value never appears in any artifact or
  agent-visible output.
- **Real-site**: manual, operator-driven first-verify on NotebookLM
  (out of automated suite). The synthetic integration is the regression gate.
- **Isolation**: all tests honor the `NODE_TEST_CONTEXT` guard + env overrides
  (registry/pages/verify-spec) added this session — no committed-tree
  pollution.

---

## Existing-asset mapping (don't reinvent)

| Component | Builds on |
|-----------|-----------|
| ① questionnaire | Phase 61 variable-agent + `make-verifiable` skill |
| ② auth | `security/` secretRef redaction + `generate-runner.mjs` `replayProfileDir` hook |
| ③ teardown | Phase 36 page-node graph, Phase 63 dependency-graph/segments, breadth-search (2b) |
| ④ safety | Phase 54 warn-not-block + existing scan layer |
| ⑤ self-cleaning | Phase 40 profiles + this-session `_temp` quarantine discipline |
| ⑥ data model | existing `workflow.json` steps/segments/inputs |

## Out of scope (this spec)

- Full `BFS` auto-teardown discovery (north-star; `record`/`search` ship first,
  `BFS` is opportunistic when the graph supports it).
- Credential vaulting beyond OS keychain (no custom secrets manager).
- CI/unattended verify of irreversible ops (excluded by policy ④).
- Multi-account / team-shared override sync (override is per-user/local).

## Open items for the implementation plan

- Exact OS-keychain API binding (macOS `security` CLI vs a node keytar-style
  dep) — pick one in the plan; must keep the value out of agent context.
- `verify-spec.json` schema (Zod) + where the spec-agent runs (pre-prepare CLI
  step vs a `bf spec` command).
- How `verify --first` vs `--repeat` is surfaced (flag vs auto-detect by
  keychain presence).
- Scope is large (6 components in one spec, per operator decision). The
  implementation plan should sequence: data-model + questionnaire (①⑥) →
  auth (②) → safety (④) → teardown record (③ record) → self-cleaning (⑤) →
  search/BFS (③ search) as later phases.
