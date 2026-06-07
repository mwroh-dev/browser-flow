# Browser Flow Roadmap — North Star

Scope: forward-looking guidance. This file is the **strategic anchor** that
phase plans (`tasks/phases/`) and per-pattern docs (`docs/patterns-applied.md`)
reference. Living document — updated as understanding sharpens.

Authority boundary: when this disagrees with `docs/architecture.md` or
`AGENTS.md`, those win for **current-state** authority (what is). This file
owns **future-state direction** (what is planned, in what order, why).

Last reviewed: 2026-05-19 (after Phase 33 + lesson "user vision's recurring
nouns point at a data model").

---

## North Star — the data model

The long-term vision is a **page-node graph** where:

- **Page-node** = dedup unit. A semantic page within a site (URL-pattern
  identified, e.g., `/notebook/:id`). Holds: selectors, ancestor chains,
  time-series DOM snapshots, last-captured timestamp, neighbor edges.
- **Flow** = traversal over the page-node graph. One user-meaningful
  workflow = ordered sequence of page-node hops with per-page actions.
- **Edge** = transition between page-nodes (navigation boundary).
- **Knowledge** = the graph itself. Grows when a new flow reuses an
  existing page-node or adds a new one. Same page-node updated over time
  yields snapshot version-chain.

Cost characteristic: storage is **linear in unique page-nodes**, not in
flows. A site of 50 page-nodes serves an unbounded number of flows that
traverse subsets of those nodes. This is the dedup boundary that the
"100 flow × 200KB" naive calculation missed (2026-05-19 lesson).

## Why this model

Three forces converge:

1. **The "a-b-c-d → a-b-c-d′ 꼬임" problem** — adding a new step to an
   existing automation should not destabilize the prior steps. In a flat
   step sequence (current architecture) this requires re-deriving the
   whole flow. In a page-node graph, the new step lives on a page-node
   (existing or new) and the prior nodes are untouched.
2. **Staleness detection** — a real site's UI evolves. Without
   per-page-node snapshot history there is no ground truth for "was here,
   now gone / moved." With time-series snapshots and content-hash diffs,
   the system can self-detect "this page changed on date X, the selectors
   captured before that date may need update."
3. **Cross-flow primitive reuse** — flows like "login → search" and
   "login → checkout" share the login page-node. The graph model makes
   the shared sub-path explicit; selector updates on the login page
   automatically propagate to every flow that traverses it.

These are not three features. They are three consequences of one model
choice. The current flow-registry architecture (Phase 0-33) captures
flows as flat sequences; it cannot express the shared structure that
makes the three properties cheap.

## Atomic fp — 사용자 정의 본체 (2026-05-19 대화에서 받음)

원문 quote (사용자 framing, paraphrase 금지):

> "유저가 5개 중에 4개만 해라 라고 한다고 치면 너의 선택은 1개 빠졌는데? 가 아니라, 4개만 하는걸 새로 플로우를 만드는거다. 그런데 그 플로우를 못만든다? 그러면 유저에게 말해야겟지. 그게 atomic fp 라고 생각한것이다."

> "이제 첫번째 시행했을때부터 무조건 물어보게 하라." (변수 에이전트 활성화 시점)

> "이건 자연어 레벨로 사용자는 말할거고, 변환을 하는건 llm 모델의 역할이라고 생각한다." (자연어 → 시스템 명령)

핵심 framing:

- **atomic fp = 각 step이 독립 unit이라서 임의 조합/제거가 가능하고, 못 조합되면 시스템이 그걸 감지해서 사용자에게 알린다.**
- 결과적으로 (i) atomic path template + (ii) 원본 보존 + 코드 레벨 복사 + (iii) page/modal 단위 조합 + (iv) 변수 placeholder 추출 + 재바인딩 네 가지가 한 묶음.

Atomic Design 매핑 (사용자 anchor, layer 정의의 mental model):

- **atom** = 마우스/키보드 이벤트 (현재 raw-events.jsonl)
- **middle** (molecule + organism 통합 — 사용자 "모호하면 합쳐라" 결정에 따라 1단계에서 코드 구조로 분리하지 않음) = 컴포넌트/도메인 단위 묶음
- **template** = page (현재 page-node)

Phase 60에서 닫은 것 vs 사용자 정의 본체:

- Phase 60 = "1회 캡처 안에서 selector가 N개 매치할 때 정답 1개 선택" — 좁은 framing.
- 사용자 정의 본체 = 조합 가능성 보장 + 깨질 때 인지. Phase 60은 그 본체의 부품 한 조각.
- 본체는 Phase 61 (변수 에이전트 + inputs[] 슬롯 + segment 분할) + Phase 62 (자연어 조합기 + 의존성 검출 + 알림) 두 phase로 풀린다.

이 framing이 reframe되면 Phase 61/62 plan 갱신 필요.

## Decisions confirmed (do not relitigate without strong evidence)

- **Inline LLM in pipeline: NO.** The four-phase deterministic pipeline
  (capture → analyze → generate → verify) stays LLM-free. Validator
  promotion ladder lesson (2026-05-19) is load-bearing.
- **Offline LLM in a separate skill: YES.** Intent narration + cross-run
  audit is a future skill that consumes accumulated artifacts. Does not
  block the pipeline.
- **Raw DOM storage: YES, but opt-in + sanitize-layer mandatory.**
  Snapshot mode is a flag, not default. PII / form-value redaction is
  enforced before persistence. Unmasked mode exists for debug and is
  registry-blocked.
- **Capture mode enum: YES.** Three documented modes — `safe` (default,
  full redaction), `lenient` (only secret-pattern redaction), `unmasked`
  (debug, no registry).
- **pageKey derivation: URL pattern auto + manual override.** Query
  params and ID-shaped path segments are normalized into placeholders.
  Operator can override per-fixture. Content-fingerprint hashing is
  deferred (cost-vs-precision trade-off not yet warranted).
- ~~**CDP access layer: Playwright stays.**~~ **SUPERSEDED 2026-05-20** by
  Phase 64-72 CDP-direct full-extreme migration. 사용자 발화 "그럼 cdp direct
  로 바꾸자 / Full extreme — runner.mjs까지 / 싹다 바꾸자" 에 따라 access layer
  를 raw Chrome DevTools Protocol로 전환. `chrome-remote-interface` (CRI) +
  `devtools-protocol` (types) 위에 thin `scripts/cdp/` 레이어 (client +
  chrome-binary + session-manager + browser-session + 7 watchdogs +
  locator-resolver) 구축. observer-daemon, generate-runner template,
  verify-run subprocess delegation 모두 CDP-direct. `playwright` runtime
  dependency → devDependency (chromium 바이너리 fallback 용도만). 이전 세션
  reframe (snapshot 저장으로 raw-CDP 요구 해석) 은 5번째 redefine 미스로
  기록 (tasks/lessons.md 196-200). 사용자 원본 의도 (raw-CDP) 가 복원됨.

## Current state (post-Phase 34)

Confirmed working (full suite green via `npm run check`, governance gates clear):

- 1-flow codification: capture → analyze → generate → verify, end-to-end
- 5 fixtures (`synthetic`, `docs`, `stateful`, `submit`, `secret`) all
  passing full-loop e2e
- Meta-CDP self-test via `tests/helpers/demo-driver.mjs`
- Truthful replay: 11-row guarantee matrix verified (Phase 33)
- False-positive guard: verifier integrity tested
- Governance: dual-audit gates (constraint review every 5 phases, eval
  audit every 10) firing on schedule
- Phase trace ordering: `trace.jsonl` with strict serial assertion
- **(Phase 34, 2026-05-19) Per-event structural context**: every
  click/input/submit emit carries an ancestor chain (5-level top-down,
  class deliberately excluded) and sibling fingerprint
  (`totalMatchingSelector` + `totalMatchingRole`). Synthetic fixture
  confirms data-bf selector uniqueness (count = 1). Data emission only;
  consumption is Phase 36 (page-as-node).
- **(Phase 35, 2026-05-19) Optional DOM snapshot mode (safe)**:
  `--snapshot-dom` flag on `prepare` opts in to per-navigation snapshot
  capture. Observer-daemon listens for `framenavigated`, waits
  domcontentloaded, calls `page.content()`, sanitizes (strip
  script/style bodies, redact input value attributes), gzip-syncs,
  writes to `artifacts/runs/<id>/snapshots/<index>-<slug>.html.gz`.
  Default OFF — zero cost when not enabled. Mode enum deferred;
  safe-mode policy hard-coded. textContent redaction is a known gap
  carried to Phase 37 for real-site readiness.
- **(Phase 36, 2026-05-19) Page-as-node data model**: `derivePageKey`
  heuristic v1 normalizes URL pathnames (UUID / long-numeric /
  long-opaque → `:id`, fixture-prefixed). Analyze layer
  (`compile.mjs`) tags every workflow step with `pageKey` and
  populates `knowledge/pages/<pageKey>/` with three files:
  `selectors.json` (per-selector ancestors + siblings from
  Phase 34, captureCount accumulating across captures),
  `neighbors.json` (outgoing edges with transitionCount),
  `meta.json` (firstSeen / lastSeen / captureCount / fixtures[]).
  `BROWSER_FLOW_PAGES_PATH` env var follows the registry-override
  pattern for test isolation. Cross-flow primitive reuse is now a
  graph operation against the page-node store.
- **(Phase 37, 2026-05-19) Constraint Set Review (governance gate)**:
  Third consecutive constraint review (Phase 27 / 32 / 37). Audit
  window phases 32 → 37 surfaced no new constitutional candidates:
  Phase 35's "snapshots must be sanitized" is conditional (opt-in
  mode) so stays as Hook layer; Phase 36's `BROWSER_FLOW_PAGES_PATH`
  override is engineering hygiene, not policy. Invariant budget
  stays at 2 of 4. `last_constraint_review_phase: 32 → 37`. Next
  constraint review trigger: Phase 42. First phase under the
  2026-05-19 "autonomous progression + entry self-analysis"
  discipline.
- **(Phase 38, 2026-05-19) DOM snapshot lift**: closes Phase 35's
  snapshot-lift carry-over. Observer-daemon writes a
  `snapshots-manifest.json` sidecar at done time listing
  `{ index, url, timestamp, filename }` per captured snapshot.
  Compile reads the manifest, derives pageKey via the existing
  `derivePageKey`, and copies each file to
  `knowledge/pages/<pageKey>/snapshots/<timestampMs>.html.gz`
  (committed cross-run time-series). Artifacts retains the per-run
  copy as audit trail (copy, not move). No-op when snapshot mode
  was off — manifest absent, lift skipped. The page-node store
  now has its third time-series file alongside selectors.json /
  neighbors.json / meta.json, unblocking Phase 39+ staleness
  detection.
- **(Phase 39, 2026-05-19) Staleness detection (`bf doctor`)**:
  first user-facing consumer of the page-node graph. Recursive walk
  of `knowledge/pages/`, computes SHA-256 of gunzipped first and
  latest snapshot per page-node, reports one of four status values
  (`no-snapshots` / `single-capture` / `stable` / `changed`).
  `bf doctor --page-key <key>` filters to a single node.
  Read-only — surfaces signal but does not trigger re-capture
  (operator decides). The "있었는데 없어졌다 / 옮겨갔다" judgment
  the operator named as the original raw-CDP motive is now a
  concrete command surface. Validated on bundled fixtures only —
  real-site partial test (NotebookLM) awaits the prep phases.
- **(Phase 40, 2026-05-19) Named persistent capture profiles**:
  `bf prepare --profile-name <name>` reuses `<profilesRoot>/<name>/`
  across captures instead of mkdtemp'ing a fresh dir each time.
  Operator can log in once per service (NotebookLM, GitHub, Notion,
  …) and reuse the login state for subsequent path captures.
  Chrome's existing `SingletonLock` semantic powers fast-fail
  detection of concurrent same-profile captures; different profile
  names can run concurrently (different dirs + different debug
  ports + different run-ids). Strict name regex
  `^[a-z0-9][a-z0-9-]{0,59}$` keeps names filesystem- and
  shell-safe. `profiles/` gitignored — cookies + login state must
  not leak. `bf profiles list / remove` deferred to Phase 44+;
  GUI wrapper for non-dev UX deferred to Phase 45+.
- **(Phase 41, 2026-05-19) `--unmasked` debug mode**: external URL
  capture unlocked at the URL boundary (`assertLocalUrl` /
  `assertLocalWorkflow` gated), persistence boundary preserved
  (registry upsert refuses entries with
  `workflow.security.localOnly === false`, with stderr log).
  Constitutional invariant #1 ("captures must be local-only")
  reinterpreted as a persistence-boundary invariant: the
  verified-flow catalog stays local-only; capture pipeline can be
  bypassed for debug. `--unmasked` flips
  `workflow.security.localOnly` from true (default) to false; the
  guard propagates through compile → generate / verify → registry.
  No three-mode enum yet — single boolean is the minimum surface
  for the only current consumer (`unmasked`).
- **(Phase 42, 2026-05-19) Dual audit (constraint review + eval
  audit)**: governance gates both fire at the `lcm(5,10)=10`
  coincidence boundary; constraint review formally adopts Phase
  41's persistence-boundary reinterpretation of invariant #1
  (text unchanged; reading documented in audit record). Eval audit
  walked phases 32-42 (+32 tests, 76 → 108): zero assertion
  drift, zero silent removal. Budget stays 2 of 4 — fourth
  consecutive zero-new-invariant review. Counters bumped to 42 +
  42; next dual coincidence Phase 52.
- **(Phase 43, 2026-05-19) Parser-backed DOM sanitize +
  textContent redaction**: Phase 35's regex implementation
  replaced with a parser-backed DOM walker. Same safe-mode
  outputs for `<script>` / `<style>` / `<input value=…>` plus
  two NEW textContent rules — secret-context proximity (text
  near `name="password"`-style inputs, within 5 ancestor hops)
  and email pattern (`\b[\w.+-]+@[\w-]+\.[\w.-]+\b` substring
  redaction). Closes the Phase 41 follow-up "textContent leak
  in artifacts/ for unmasked captures". Conservative PII
  catalog (email only); phone / SSN / credit-card defer until
  real-site signal motivates them. textContent sentinels use
  bracket form (`[redacted-secret-text]`, `[redacted-email]`)
  because serialization HTML-escapes angle brackets in text
  nodes; attribute sentinel (`<redacted-input-value>`) is
  unchanged (attributes don't escape).
- **(Phase 44, 2026-05-19) Capture-driver sub-agent pattern
  (Haiku)**: introduces `agents/capture/playbooks/capture-driver.md`
  as the procedural contract for a Haiku-tier sub-agent that
  drives the browser-flow CLI pipeline via background shell
  commands and reports structured JSON to the orchestrator.
  The orchestrator (main session) narrates progress to the
  human user in natural language; sub-agent never talks to
  the user directly. Two operating modes documented:
  **synthetic** (auto-completes via the bundled
  `tests/helpers/demo-driver.mjs`) and **real-site**
  (orchestrator → SendMessage round-trip for the
  user-completion signal between `prepare` and `done`).
  Phase 44 validates synthetic mode end-to-end with a Haiku
  sub-agent invocation; Phase 45 will use the real-site
  branch for NotebookLM. No new project tests; the skill is
  the contract surface. No validator extension yet —
  introduces the skill-registry pattern only when a second
  sub-agent skill emerges.
- **(Phase 45, 2026-05-19) NotebookLM real-site capture
  (PARTIAL — defect surfaced)**: first phase to drive a real
  public service through the Phase 40-44 stack. Operator
  signed in to Google + performed one NotebookLM action.
  Sub-agent `nbk-driver` reached `done` via SendMessage
  continuation (using **agent ID** — name-only addressing
  failed cross-turn). `done` correctly **fail-closed** when
  the security scanner found a Google API key under header
  name `x-goog-api-key` (value redacted to placeholder in the
  report; local repro confirmed). Validates the fail-closed
  contract works for real-site captures, AND surfaces the
  sanitize-layer gap: `SENSITIVE_HEADER_NAMES` exact-match
  list does not cover vendor-prefixed variants like
  `x-goog-api-key`. Phase 46 보완 closes this. analyze /
  generate / verify / doctor were correctly skipped per
  skill spec; profile is clean for the Phase 47 retry.
- **(Phase 46, 2026-05-19) Sanitize-layer header-matching
  promotion (보완)**: closes the Phase 45 surfaced defect.
  `isSensitiveHeaderName` promoted from exact-name anchored
  regex (`SECRET_HEADER_PATTERN`) to substring match using
  the existing `SECRET_FIELD_PATTERN` keyword vocabulary
  (`pass(word)?|secret|token|csrf|session|auth|cookie|key`).
  Same promotion-ladder rung-up as the validator
  (phrase-grep → regex → enum → Zod). Catches
  vendor-prefixed variants (`x-goog-api-key`,
  `x-google-auth-token`, `x-aws-api-key`, …) without
  over-redacting benign headers (`content-type`,
  `cache-control`, `accept-*`, `sec-fetch-*`, etc. — 28
  benign cases tested). SKILL.md updated with the Phase 45
  finding that cross-turn SendMessage continuation must use
  the **agent ID**, not the agent name. Phase 47 NotebookLM
  retry now unblocked.
- **(Phase 47, 2026-05-19) NotebookLM retry (PARTIAL —
  two new defects surfaced)**: Phase 46 sanitize fix
  **VERIFIED** — `done` securityOk=true, findings=[] on real
  NotebookLM capture; the Phase 45 `x-goog-api-key` gap is
  closed. Two new defects surfaced: (A) all captured URLs
  in `sanitized-events.json` collapse to `<non-local-url>`
  because `sanitizeUrl` is not `--unmasked`-aware — the
  Phase 41 URL-boundary bypass does not propagate to the
  sanitize layer; cascades into the garbage pageKey
  `manual/127.0.0.1/%3cnon-local-url%3e`. (B) `compile.mjs`
  hard-codes `/api/` substring as the transition-gate
  network-call heuristic; real-site Google URLs don't match,
  analyzer throws "Unable to derive required transition gate".
  Phase 49 보완 closes Defect A; Phase 50 보완 closes
  Defect B. Sub-agent SendMessage cross-turn continuation
  worked again (second validation).
- **(Phase 48, 2026-05-19) Constraint Set Review (governance
  gate)**: gate fired immediately after Phase 47 doc bumped
  currentPhase to 47 → delta = 5. Audit window phases 42-47
  surfaced zero new constitutional candidates. Sixth
  consecutive zero-new-invariant review (Phases 22 / 27 / 32
  / 37 / 42 / 48). Counters: last_constraint_review_phase
  42 → 48; last_eval_audit_phase stays at 42 (delta 6).
  Phase 41's persistence-boundary reinterpretation carries
  forward unchanged.
- **(Phase 49, 2026-05-19) sanitizeUrl `--unmasked`-aware
  (보완 of Phase 47 Defect A)**: threads the Phase 41
  capture-mode flag through the sanitize chain — prepare →
  manifest → observer-daemon + persist → sanitizeEvent →
  sanitizeUrl. When unmasked, sanitizeUrl preserves external
  URLs (credential + secret-named-query-param redaction
  still applies). Real-site captures now produce meaningful
  pageKeys (`manual/<host>/<path>` instead of
  `manual/127.0.0.1/%3cnon-local-url%3e`). Capture-driver
  SKILL.md gains formal sections for the operator-named
  protocols from this turn: orchestrator reflect-back &
  confirm (bidirectional, once at end of capture) and
  phase-boundary streaming notifications (unidirectional,
  per phase). Constitutional invariant #1 still enforced at
  the persistence boundary.
- **(Phase 50, 2026-05-19) Analyzer transition-gate heuristic
  relaxation (보완 of Phase 47 Defect B)**: `/api/` substring
  HARD filter promoted to preference ordering (api+nonGet →
  api+any → nonGet → any 200 in boundary). Third instance of
  the substring-promotion ladder pattern (after Phase 43 DOM
  sanitize and Phase 46 header redaction). Synthetic
  fixture's POST `/api/complete` regression-safe (still
  selected by the top preference). Real-site Google URLs
  (`/v1internal/...`, `/_/notebooklm/...`) now match through
  the nonGet fallback. Phase 51 retry will validate
  end-to-end.
- **(Phase 51, 2026-05-19) NotebookLM retry #3 — PARTIAL**:
  Third real-site attempt with Phase 49 + Phase 50 stack.
  Capture succeeded; sanitize + done failed-closed when
  security scanner hit a high-entropy state token plus an
  `auth=<redacted>` placeholder match. Outcome reframed by the
  operator: three retries plus accumulated fail-closed gates
  produced a system that can't complete a basic capture
  Playwright codegen handles trivially. Lesson 49514f2
  "accumulated fail-closed gates + infrastructure-ahead-of-
  capability" recorded. Architectural pivot: capability-first
  sequence (warn-not-block security under `--unmasked` → toggle
  state → ARIA selectors → retry #4) takes precedence over
  more sanitize-layer hardening.
- **(Phase 52, 2026-05-19) Eval audit (governance gate, 2nd
  execution)**: 10-phase eval audit fired on schedule (delta
  42→52). Window phases 42-52 added 11 tests (Phase 43 +7,
  Phase 46 +4); 0 assertion drift. Coverage gaps surfaced:
  Phase 49/50 deferred validation to Phase 51 retry which
  surfaced the architectural defect instead. Audit endorsed
  the capability-first pivot. Counter bump: `last_eval_audit
  _phase` 42 → 52. Next dual coincidence Phase 62.
- **(Phase 53, 2026-05-19) Constraint Set Review (governance
  gate, 7th execution)**: 5-phase constraint review fired
  immediately after Phase 52 (delta 48→53 reached because
  phase-54 plan doc is staged). Audit window phases 48-53
  reviewed. Zero new constitutional candidates. Key
  insight: distinguishes *invariant text* from *application
  boundary* — Phase 54 will refine the capture-time
  application of invariant #2 (warn-not-block under
  `--unmasked`) while leaving the persistence-time meaning
  unchanged. Seventh consecutive zero-new-invariant review.
  Counter bump: `last_constraint_review_phase` 48 → 53.
  Next trigger: Phase 58.
- **(Phase 60, 2026-05-19) atomic-fp consumer (사용자 정의 근본
  못한 것 #2의 atomic-fp 절반)**: 사용자 quote — "breath search
  와 atomic fp 수준으로 쪼개는걸 못했고". Phase 34는 ancestor
  chain + sibling fingerprint를 수집했지만 `compile.mjs`가
  workflow.steps[]에 옮기지 않아 generate-runner는 `.locator
  (step.selector).first()` 한 길만 사용. Phase 57 NotebookLM
  capture가 그 비용을 노출: 5개 ambiguous step
  (totalMatchingSelector 3/73/3/70/71)이 73개 button 중 첫
  번째를 묵묵히 선택. 새 `scripts/lib/atomic-fp.mjs`
  (`deriveAtomicLocator`)가 role-first + ancestor-fallback
  전략을 적용해 step에 `atomicFp` 메타 부착 (User-approved 옵션 B).
  runner template에 `resolveStepLocator` + `resolveSubmitterLocator`
  helper 추가 — `atomicFp.strategy==="role"`이면 `page.getByRole(role,
  {name})`, `==="ancestor-scope"`이면 `page.locator(scopeSelector)
  .locator(step.selector)`. atomicFp 없으면 기존 `.first()` 경로
  보존 (synthetic/docs/stateful/submit/secret fixture 무영향).
  Phase 57 capture에 analyze + generate 재실행 (zero-GUI per
  todo.md): step 4 ("delete 삭제") + step 7 ("채팅 기록 삭제…") +
  step 8 ("삭제") → role, step 3 (button[더보기]) → `artifact-
  library-item` ancestor-scope, step 5 (form) → `delete-dialog`
  scope + submitter role. ID는 의도적으로 skip (Angular Material이
  `mat-menu-panel-279` 같은 numbered ID 발급 — Phase 57에서 확인).
  144 tests (+16: atomic-fp 단위 12 + compile 통합 2 + runner 통합 2).
  breath-search 절반 (todo 2b)은 새 phase plan 필요한 별도 차원.
- **(Phase 59, 2026-05-19) Constraint Set Review (governance
  gate, 8th execution)**: 5-phase constraint review fired
  immediately as currentPhase=60 (delta 7, gate stays at delta
  ≥ 5). Audit window phases 53→59 reviewed (Phase 54 warn-not-
  block, 55 raw-events.jsonl, 56 bf replay, 58 generate
  unmasked-aware, 60 atomic-fp consumer). Zero new constitutional
  candidates. Phase 58 audit insight folded in: "duplicate gates
  that don't carry persistence semantics are boundary leaks, not
  invariant violations" — third refinement of Phase 53's
  invariant-vs-application-boundary distinction. Eighth
  consecutive zero-new-invariant review. Counter bump:
  `last_constraint_review_phase` 53 → 59. Next trigger: Phase 64.
- **(Phase 58, 2026-05-19) Generate가 --unmasked workflow에서
  통과 (G1 진짜 완주)**: Phase 57 NotebookLM capture가
  prepare → done → analyze까지 통과했으나 generate에서
  `assertLocalWorkflow` fail-close. 처음 보고에서 이를
  "intended boundary"로 framing한 것은 53 phase 합리화 패턴의
  재발 — 사용자가 강하게 교정 ("나는 제약을 걸어둔적이 없다.
  부분개선을 의도한적도 없다. 당연히 더 나아가야지"). 진단:
  invariant #1의 진짜 enforcement는 `upsertRegistryEntry`의
  silent skip (Phase 41)이고 generate-runner.mjs:18의
  `assertLocalWorkflow`는 중복 + 사용자 goal 차단. Phase 41이
  verify-run.mjs는 풀었지만 generate-runner.mjs는 빠뜨린 누락.
  5줄 변경 — verify-run.mjs의 unmasked gating 패턴을 byte-for-
  byte 복제. 모든 boundary(URL/sanitize/scan/analyze/verify/
  generate)가 일관된 single-enforcement 패턴 완성, registry-write
  한 곳만 load-bearing. 128 tests (+1 unmasked workflow generate +
  registry skip 검증). Phase 57 capture로 실제 generate 재실행
  검증 예정.
- **(Phase 56, 2026-05-19) `bf replay <runId>` entry point
  (G3: 수집/분석 분리 2/2)**: G2 단독으로는 zero-GUI-retry
  효과 없으므로 같은 사이클 내 G3 마무리. raw page-evidence
  를 sanitize 이전 형태로 `raw-page-evidence.json`에 dump
  하고 (observer-daemon `/done` handler에서 persistSanitized
  Artifacts 호출 이전), `bf replay <runId>` 명령이 raw-events
  .jsonl + raw-page-evidence.json을 input으로 받아
  `persistSanitizedArtifacts`를 재호출 — live done과 100%
  동일 sanitize 경로. live와 replayed 산출물은 결정적 byte-
  for-content 동일 (e2e가 5개 파일 unlink 후 deep-equal로
  강제). 발견: `collectPageEvidence`가 timestamp를 stamp 안
  해서 sanitize 시점 `Date.now()` fallback이 매번 다른 값을
  부여 → raw artifact는 *capture 시점 ground truth*여야 한다는
  invariant 명시화 후 collectPageEvidence에 timestamp stamp 추가.
  127 tests (+2: round-trip 결정성 + missing-input throw).
  validator phrase-grep 5건 추가. G2 + G3 결합으로 사용자
  정의 "수집/분석 분리" 완성 — Phase 57부터 모든 후속 변경은
  capture 1회 후 replay로 zero-GUI 검증.
- **(Phase 55, 2026-05-19) Raw event log persistence (G2:
  수집/분석 분리 1/2)**: 사용자 진단으로 capability-first 시퀀스
  재정의됨 — "수집/분석이 철저하게 나뉘었다면 사용자 1회 테스트로
  충분했어야 한다". 53 phase 동안 함수 레이어 분리는 했지만 raw
  event가 `const rawEvents = []` 메모리 배열에만 존재해 fail-close
  시 영영 손실, 사용자 GUI 3회 호출의 root cause. 본 phase는
  observer-daemon이 모든 recorder/network event를 `artifacts/runs/
  <run-id>/raw-events.jsonl`에 sync append하도록 함. trace.mjs와
  동일한 `appendFileSync` 패턴. 새 helper `scripts/lib/raw-event-
  log.mjs` 가 `appendRawEvent` + `readRawEventLog` export — 후자는
  Phase 56 `bf replay` 입력으로 사용 예정. 125 tests (+5: 단위 4 +
  e2e 1). Goal G2 직접 매핑. Phase 56이 G3 (replay entry point)
  닫으면 zero-GUI-retry 완성.
- **(Phase 54, 2026-05-19) `--unmasked` security gate becomes
  warn-not-block (capability-first 1/4)**: First phase of the
  capability-first sequence prescribed by lesson 49514f2.
  `scanArtifacts` gains `(runRoot, outputPath, { unmasked })`
  signature; under `--unmasked`, findings still populate but
  `ok=true` and a new `warningOnly` field surfaces the
  warned-only state. `persist.mjs` reads `manifest.unmasked`;
  `verify-run.mjs` mirrors via `workflowDoc.security.localOnly
  === false`. Constitutional invariant #1 enforcement stays at
  the persistence boundary (registry-upsert refusal of
  `localOnly=false`, Phase 41). Four-boundary table codifies
  the layer attribution: capture-time gates are advisory,
  persistence-time is load-bearing. 120 tests (+1 three-path
  scanArtifacts test). Phase 53 audit's invariant-vs-
  application-boundary distinction now implemented in code.

## Design principle — DI-style profile identity (2026-05-19 turn)

Operator clarification during Phase 40 follow-up: when a user
wants captures that touch two services concurrently *in the same
workflow* (not two separate captures), the right pattern is to
**create a combined profile** (`--profile-name notebooklm-github`)
that holds both logins, rather than wire two `--profile-name`
values into one capture. Profile name = identity of a dependency
set; multi-dep needs a new identity, not a multi-identity capture.

browser-flow already supports this pattern as a usage convention
— no extra implementation needed. The discipline implication for
future phases: **do not add multi-profile-per-capture
infrastructure**. Composition lives at the profile-identity
layer, not at the capture-invocation layer.

Gaps relative to the north star:

- ~~No staleness detection~~ — **closed in Phase 39** (`bf doctor`).
- Cross-flow knowledge reuse is now *possible* via page-node graph
  but no flows yet exercise shared pages — bundled fixtures are
  independent. Phase 37+ will introduce a flow that reuses a
  previously-seen page-node.
- `manual` fixture (arbitrary external sites) is speculatively
  supported (selectorFor fallback to tagName) — not real-world ready;
  Phase 37 will surface this with real-site captures (NotebookLM, etc.)
- DOM snapshot textContent redaction not implemented (Phase 35 ships
  script/style/value redaction only). Real-site captures will leak
  textContent until a parser-backed sanitize lands — Phase 37 task.
- ~~Snapshot lift from `artifacts/runs/<id>/snapshots/` to
  `knowledge/pages/<key>/snapshots/`~~ — **closed in Phase 38**.
- `countSiblings.totalMatchingRole` cost not yet measured on real-site
  DOMs (current 5 fixtures have < 50 nodes; Phase 37)
- `implicitRoleOf` ARIA role table covers only common landmarks +
  form controls; missing listitem / cell / row / treeitem / tab /
  tabpanel. Phase 37 if real-site captures require them.
- `accessibleNameOf` uses a simplified rule (aria-label || innerText)
  rather than the full ARIA Accessible Name and Description Computation
  algorithm (Phase 37)
- DOM snapshot timing assumes `domcontentloaded` is sufficient. SPA
  post-hydration updates not captured. May need `--snapshot-wait`
  alternatives when Phase 37 hits real-site SPAs.
- Mode enum (safe / lenient / unmasked) declared in roadmap but not
  yet implemented. Safe-mode policy currently hard-coded; enum infra
  is a separate follow-up phase when the first non-safe variant is
  needed.
- `derivePageKey` heuristic v1 produces awkward redundant prefixes
  (`synthetic/synthetic`, `docs/docs/catalog`) when the fixture name
  matches the first pathname segment. Refinement candidate when
  Phase 37 has real-site URL data to test against.
- No manual `pageKey` override mechanism yet. Phase 37+ candidate.
- `accumulateSelector` keeps last-seen ancestors / siblings (overwrite
  semantics). Phase 37+ can refine to "stable vs variant" once N > 1
  captures exist for the same selector.

## Phase plan (dependency order)

Each phase is atomic per `harness-hill-climbing`. Numbers are sequential
commit identifiers, not conceptual priority — conceptual order is the
dependency chain below.

> **Course correction 2026-05-19**: snapshot mode swapped ahead of
> page-as-node (originally Phase 35 was page-as-node, Phase 36 was
> snapshot). Rationale: pageKey derivation heuristics for real-site
> URLs (Notion `/notebook/<id>`, GitHub `/<user>/<repo>/issues/<n>`)
> are best designed against actual DOM + URL data, not in the dark.
> Snapshot mode produces that data first; page-node model then
> consumes it. The reversal is per the operator instruction at the
> 2026-05-19 Phase 36-first decision turn. Original order preserved
> in commit `4adda1f`.

### Phase 34 — Per-event ancestor chain + sibling fingerprint ✅

Foundation. Recorder emits ancestor chain (5 levels up) and sibling
fingerprint per click/input/submit event. Data emission only — compile
does NOT consume yet (that is Phase 36 page-as-node).

Atomic dimension: extend event schema with two structural fields.
Files: `recorder-script.mjs`, `event-sanitizer.mjs`, `schemas.mjs`,
1-2 tests.

Committed: `6bfab8d` (2026-05-19).

### Phase 35 — Optional DOM snapshot mode (safe-mode default)

`--snapshot-dom` flag in `prepare`. On each frame navigation, observer
captures `page.content()`, sanitizes (strip script/style content,
redact textContent matching SECRET_FIELD_PATTERN, redact `value`
attributes on inputs), gzips, persists at
`artifacts/runs/<id>/snapshots/<index>-<url-slug>.html.gz` — flat
per-run for now (Phase 36 will reorganize to per-page-node).

Mode enum introduced as `--mode` flag with `safe` / `lenient` /
`unmasked` values; only `safe` is implemented in this phase.
`lenient` and `unmasked` throw "not yet implemented" — declaration
of expansion shape without shipping un-implemented variants.

Why now (per course correction): snapshot data is the ground truth
needed to design Phase 36's pageKey heuristic against real DOM and
URL patterns rather than in the dark.

### Phase 36 — Page-as-node data model

Introduce `knowledge/pages/<pageKey>/` directory structure. `pageKey`
derived from URL pattern with query-param normalization + manual
override — informed by Phase 35's snapshot URLs. Phase 34's ancestor
data is consumed and stored per page-node (`selectors.json`,
`neighbors.json`). Phase 35's snapshots migrate from flat per-run
to per-page-node time-series. `workflow.json` gains `pageKey` field
per step.

Why now (post-snapshot): pageKey design has real DOM + URL data as
input. Snapshot reorganization is a file move + manifest update,
manageable migration cost.

### Phase 37 — Staleness detection

Page-node gets `last_captured` timestamp and `content_hash`. New
capture triggers diff; mismatch flips `status: stale`. `bf doctor`
command surfaces stale page-nodes and the flows that depend on them.

Why fourth: needs snapshots (Phase 36) for the diff input. Closes the
"있었는데 없어졌다" loop the operator named as the original CDP-level
motivation.

### Phase 38+ — Offline audit skill (intent narration)

Separate skill, not in the CLI pipeline. `bf narrate` captures user
intent before flow; offline LLM cross-checks intent vs captured
events post-run. Begins the agentic-exploration territory ((B) in
the May 19 conversation framing).

Why last: requires the page-node graph (Phase 35) and snapshots
(Phase 36) as inputs. Begins the soft-LLM layer that the
deterministic pipeline carefully avoided.

### Phase 61 — atomic fp 본체 1단계 (분할됨: 61a 인프라 + 61b capability)

Phase 60에서 닫은 1회 캡처 selector disambiguation 위에 사용자 정의
atomic fp 본체 1단계. 사용자 결정으로 broken-state machinery + 작업
단위 state framework 추가되어 scope 이 9-10개 산출물로 커짐 → 53 phase
인프라 과잉 패턴 재발 위험으로 분할 결정.

#### Phase 61a — 작업 단위 state framework + broken-state validator + `bf vars` skeleton (인프라)

각 작업 요청에 timestamp + 식별자 + state(`pending|in-progress|complete|broken|failed`)가 박힌 통일된
framework. 사용자 framing: "lane 이든 phase 이든 결국은 각 과정마다
현재 state 을 보는것이 잇어야한다 … broken 상태로 꺼졋다고 치면 나중에
시작할때 validate 같은게 잇어서 이거 하다가 말았다 와 같은식으로 되어야지".
산출물: `scripts/lib/workflow-status.mjs`, `scripts/lib/broken-state-validator.mjs`,
`scripts/commands/vars.mjs` skeleton, `bf done` 작업 등록 hook. Phase 61a
에서는 variable-extraction 작업 단위만 framework 에 등록 — 기존 단계
(capture / analyze / generate / verify) 통합 migration 은 후속 phase
(additive). 상세: `tasks/phases/phase-61a-state-framework-and-broken-validator.md`.

#### Phase 61b — variable-agent sub-skill + inputs[] binding + segments[] (capability)

Phase 61a framework 위에서 capability 본체. `bf done` 직후 atomic-fp-novelty
판정 (new atomic 또는 new pageKey trigger 시 무조건 활성화 — 사용자 정의
"처음 하는 패스") → variable-agent private playbook (`agents/analyzer/playbooks/variable-agent.md`)
이 LLM 의미 추론 + 사용자 인터랙션으로 inputs[] 슬롯 확정. segments[] 는
page-node 경계로 결정적 자동 분할. `bf run <runId> --bind input.X=...` CLI
가 binding 받아 새 runId (`<originalRunId>-bind-<short-hash>`) 디렉토리에
새 runner 생성/실행 — 원본 보존. 후보 0개도 무조건 사용자 합의. abort
/ 실패 시 Phase 61a framework 통해 broken state 마킹, `bf vars <runId>` 로
재개. 상세: `tasks/phases/phase-61b-variable-agent-and-inputs-binding.md`.

### Phase 62 — Eval Audit (governance gate, 3rd execution)

Gate-forced: `currentPhase=63` (phase-63 plan doc staged) →
`delta = 63 - 52 = 11`. Audit window 52→62 walks 5 capability code
phases (54/55/56/58/60) + 2 prior audits (53/59) + 3 staged plans
(61/63). 25 new tests, 0 assertion drift, 5 deferred coverage gaps
(all routed to Phase 61/63 atomic fp body work). Audit formalizes
the "Phase 60 = narrow framing 부품 / Phase 61+63 = atomic fp 본체"
split that surfaced in this dialogue. Counter bump:
`last_eval_audit_phase` 52 → 62. Next eval audit: Phase 72.
상세: `tasks/phases/phase-62-eval-audit.md`.

### Phase 63 — 자연어 조합기 + 조합 가능성 검출 + 알림 (atomic fp 본체 2단계)

사용자 정의 atomic fp 본체의 마지막 부품. Phase 61의 inputs[] +
segments[] 기반 위에서, 사용자 자연어 요청 (예: "이 path에서 5개 중 4개만",
"이 segment와 저 segment 조합")을 *composer-agent* sub-skill (LLM)이 segment
선택 + binding 변경으로 변환, *결정적 코드*의 dependency-graph로 조합
가능성 검증. 조합 불가 시 (segment 의존성 깨짐) 사용자에게 명시 알림.
`bf compose <runId> --request "..."` CLI. v1은 단일 primary run에서만
조립하는 reuse-first boundary로 두고, gap이 남으면 interactive live
learning으로 채운다. multi-run compose 및 cross-run security context merge
policy 는 후속 backlog 로 둔다. Phase 61과 63이 합쳐서 사용자가 명시한
"atomic path template + 코드 레벨 복사 + 조립" 그림의 본체 완성. 상세:
`tasks/phases/phase-63-composition-agent.md`.

## Open forks (decide when the phase arrives)

- `pageKey` collision resolution (two URL patterns mapping to same
  key) — defer until first collision observed in real captures.
- Snapshot compression strategy beyond gzip (delta encoding for time
  series, structural-diff vs byte-diff) — Phase 36 will pick one
  default, others are Phase 36+ candidates.
- multi-run compose — Phase 63 v1 is primary-run-only; composing across
  multiple source runs stays deferred.
- cross-run security context merge policy — deferred until multi-run
  compose exists and there is a concrete merge model to validate.
- Offline audit: separate Codex skill vs browser-flow sub-skill — Phase
  38 decision.
- Ancestor depth — 5 is the Phase 34 default; revisit if `manual`
  fixture exposes deeper meaningful nesting.

## Anchors (cross-links)

- Current-state architecture: `docs/architecture.md`
- Skill/agent boundary: `AGENTS.md`
- Pattern application map: `docs/patterns-applied.md`
- Phase 33 baseline measurement: `docs/baseline-comparison.md`
- Recurring corrections / patterns: `tasks/lessons.md`
- Per-phase atomic plans: `tasks/phases/`
- Governance schedules: `.governance/state.json`,
  `.codex/skills/browser-flow/scripts/validate-skill.mjs`

## How this file is maintained

- Update **after** a phase commits, not before. Phase plans declare
  intent; the roadmap reflects ratified direction.
- Move items between "confirmed" and "open forks" only with an
  accompanying phase or lesson reference.
- Do NOT delete prior content; mark superseded items with a
  strikethrough or relocate to a "Superseded" appendix. The roadmap
  is forward-looking but the path of decisions matters for context.
