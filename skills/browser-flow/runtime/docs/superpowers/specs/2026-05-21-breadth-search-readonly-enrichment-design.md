# breadth-search (2b) — Read-only Affordance Enrichment: Design

**Status:** approved (brainstorm 2026-05-21). Sub-project of roadmap "근본 못한 것 #2".
**Date:** 2026-05-21
**Related:** `docs/roadmap.md` ("Why this model" force #1), `docs/superpowers/specs/2026-05-21-mold-heal-loop-design.md` (§3 mold, §later "breadth-search로 mold 풍부화").

## 사용자 원문 quote (paraphrase 금지 — 설계 동기의 출처)

> "breath search 와 atomic fp 수준으로 쪼개는걸 못했고, 그 전단계에서 done 을 못했다가 근본적인 것이엇는데?" (사용자 정의 "근본 못한 것 #2")

> roadmap force #1: "**a-b-c-d → a-b-c-d′ 꼬임 problem** — adding a new step to an existing automation should not destabilize the prior steps. In a flat step sequence this requires re-deriving the whole flow. In a page-node graph, the new step lives on a page-node (existing or new) and the prior nodes are untouched."

## 1. Goal

캡처된 각 page-node가 *건드린 step locator만*이 아니라 **그 페이지의 full affordance skeleton**(interactive 요소 `{role, name, structuralKey}` 전체)을 보유하게 한다. 그래서 (i) heal이 런타임에 그 풀 mold를 읽어 drift diff가 훨씬 풍부해지고, (ii) page-node가 자기 affordance를 전부 알게 되어 flat sequence가 아니라 *graph node breadth*를 가진다(꼬임 force #1의 read-only 절반).

**Read-only**: affordance를 *열거*만 한다. 클릭/네비게이션 없음 → 실사이트 변이 0. (능동 탐색은 후속.)

## 2. Decisions locked (brainstorm 2026-05-21, 3-question)

1. **동작 범위 = read-only 풍부화.** 미탐색 affordance를 *열거*만; 클릭/네비게이션으로 새 페이지를 발견하는 active 탐색은 **채택 안 함**(후속 phase). 이유: 무변이 → 실사이트 안전, Phase 85 heal과 즉시 맞물림, 규모 작음.
2. **트리거 = 캡처 시점 자동.** 새 command 없음. 녹화 중 데몬이 이미 각 page-node 위에 있으니 그때 skeleton을 무료로 열거 → analyze가 persist. 재네비게이션 없음(auth/state 재현 문제 회피). → *방문한* page-node만 풍부화(그 path의 모든 분기점).
3. **소비 범위 = mold + heal 재배선.** full skeleton → `mold.json`(touched-only → full) + heal을 *런타임에 그 mold.json을 읽도록* 재배선(Phase 85에서 보류한 "런타임 mold read 승격"). candidate edges / staleness snapshot / active 탐색은 보류.

## 3. Architecture — 4 pieces

### (a) Daemon skeleton snapshot (capture-time, read-only)
관찰 데몬은 이미 main-frame navigation을 추적하고 page-node마다 snapshot을 뜬다(`observer-daemon.mjs` — navigation hook + `knowledge/pages/<pageKey>/snapshots/`). 그 hook에 얹어, 페이지 settle 후 `locatorCaptureSource`를 주입하고 `__bfAffordanceSkeleton()`(Phase 85)을 호출 → page-node당 `{ pageKey, skeleton: [{role, name, structuralKey}] }` 1건을 캡처. **순수 열거 — 클릭/네비게이션 0.** 캡처 중 1회 settle 기준(초기 렌더 이후).

### (b) compile persistence
`compile`이 page-node마다 `mold.json`을 *캡처된 full skeleton*에서 작성(Phase 85의 touched-only 도출을 대체). skeleton이 없으면(구 캡처/누락) touched step-locators로 fallback. shape 불변: `{ schemaVersion, pageKey, skeleton }`. dedupe by structuralKey.

### (c) heal runtime mold read (payoff — Phase 85 보류 해소)
runner의 drift-hold 분기가 `pagePaths(heldPageKey).moldPath`를 **런타임에 read**(pages 트리 = runRoot 밖 → `scanArtifacts`(runRoot)가 스캔 안 함 → 85.4-fix를 물게 한 secret-keyword 임베드 오탐 회피). `storedSkeleton = mold.skeleton`(full); mold 없으면 held-segment step-locators fallback(현행 유지). → heal-request diff가 *페이지 전체* stored vs live 비교로 풍부.

### (d) agent-blind + scan-safe (검증 의무)
`mold.json` + `heal-request.json`은 role/name/structuralKey만(값/세션 없음). 풍부해진 skeleton이 보안 스캔 오탐을 재유발하지 않음을 *명시 검증*: structuralKey의 `name=password` 류는 라벨/구조이지 secret *값*이 아니며 SECRET_ASSIGNMENT_PATTERN에 안 걸림, 24자+ 영숫자 토큰 없음. e2e가 `securityOk === true` 유지 확인.

## 4. Data flow

```
녹화: 데몬이 page-node 진입(navigation)마다
  settle → inject locatorCaptureSource → __bfAffordanceSkeleton()
  → {pageKey, skeleton[]} 캡처 (read-only)
bf analyze/compile:
  page-node마다 mold.json = full skeleton (없으면 touched fallback)
bf verify → drift-hold:
  runner가 pagePaths(heldPageKey).moldPath 런타임 read
  storedSkeleton = full mold (없으면 step-locator fallback)
  diffSkeletons(storedSkeleton, liveSkeleton) → heal-request (풍부)
```

## 5. Components / 파일 (예상)

- `scripts/observe/observer-daemon.mjs` — navigation hook에 skeleton 캡처 추가(read-only).
- skeleton 전달 경로 — 데몬 산출물(events 또는 page-node sidecar)로 skeleton을 compile까지 운반(정확한 채널은 plan에서).
- `scripts/analyze/compile.mjs` — `writePageNode` mold.json을 캡처 skeleton 우선으로(없으면 touched fallback).
- `scripts/generate/generate-runner.mjs` — drift-hold 분기에서 `pagePaths(heldPageKey).moldPath` 런타임 read(+ `pagePaths` import). storedSkeleton 도출을 mold-우선/step-fallback으로.
- Tests: compile(full mold + fallback) unit, runner(런타임 mold read) unit/source-assert, e2e(real Chrome: non-touched affordance가 mold/heal-request에 등장 + securityOk 유지).

## 6. Testing strategy

- **compile unit**: 캡처 skeleton 입력 → mold.json이 touched 안 된 affordance까지 포함. skeleton 없으면 step-locator fallback.
- **runner unit/source**: 생성 runner가 런타임에 mold.json을 read하고 storedSkeleton을 mold에서 취함(없으면 fallback). source-string + 합성 입력.
- **e2e (real Chrome)**: 여러 affordance가 있는 fixture page를 캡처 → `mold.json`이 *건드리지 않은* affordance를 포함(full enumeration 증명) → phantom drift-hold → heal-request diff가 non-touched affordance를 참조(풍부 diff 증명) → `securityOk === true`(scan-safe). hard timeout + Singleton 정리. 단일 파일은 `--import=./tests/_setup.mjs`.

## 7. Builds on

page-node graph(36, `pagePaths`/`neighbors`/snapshots) · 데몬 navigation hook + per-node snapshot(36) · `__bfAffordanceSkeleton`(85.1) · `mold.json`(85.3) · `diffSkeletons`(85.2) · heal-request(85.4) · heal 루프/`bf heal`(86). Phase 85에서 "런타임 mold read 승격"으로 보류했던 것을 이 작업이 해소.

## 8. Out of scope → 후속

- **active 탐색**: 미탐색 affordance를 *클릭/네비게이션*해 NEW page-node/edge 발견(BFS). 변이 → safety-hold(76)/self-cleaning(78)/dangling-cleanup(84) 총동원 필요. 별도 spec.
- **candidate edges**: navigational affordance를 `neighbors.json`에 destination-unknown edge로 기록. active 탐색의 초석이나 현재 소비자 없음(YAGNI).
- **staleness snapshot history**(roadmap force #2): skeleton 시계열 diff로 "X날 이후 변경" 감지.
- **visual heal context**: 동형 요소(Keep 제목/본문) 구분용 스크린샷.

## 9. Open questions (writing-plans/구현에서 결정)

1. 데몬 skeleton을 compile까지 운반하는 채널: 기존 events 스트림에 `page-skeleton` 레코드 추가 vs page-node sidecar(`skeleton.json`) 직접 기록. (artifacts→knowledge promotion 경로와 정합.)
2. settle 시점: navigation 후 어느 시점에 skeleton 1회 캡처(domcontentloaded vs 짧은 settle window). 동적 hydration 관대성.
3. 같은 page-node를 여러 번 방문 시 skeleton 병합/최신우선 정책.
4. heal runtime read: runner가 `pagePaths`로 pages-root를 어떻게 해석(env `BROWSER_FLOW_PAGES_PATH` 전파) — verify spawn 환경과 정합.
