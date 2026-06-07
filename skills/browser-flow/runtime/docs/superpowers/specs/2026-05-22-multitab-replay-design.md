# Multi-Tab Replay — Open-New-Tab-and-Continue (Phase 94 + 95)

> 백로그 1순위(빈도-우선에서 live-confidence 다음). 현재 시스템은 단일 탭만 — 클릭이 새 탭/창을 열면(target=_blank, window.open, OAuth/SSO 팝업) 그 탭을 못 따라가 검증 불가. v1: **새 탭을 열고 그 탭으로 이어서 step 수행**(+ 필요시 원래 탭 1회 복귀). 탭 정렬 = **ordinal causal**(생성 순서: capture N번째 탭 ↔ replay N번째 탭).

## 사용자 결정 quote (paraphrase 금지)

> "멀티탭으로 해보자" / v1 범위 = "새 탭 열고 이어가기"

> (세션 초반) "tab 을 새로키는것도 잇어서 … cdp direct 는 그것도 커버가 되는건가" — 시계열 (ts,targetId,event) + Target.targetCreated ordinal causal 정렬

## 동기

실사이트 검증은 인증 플로우가 잦고, OAuth/SSO/`target=_blank`가 새 탭/창을 연다. 단일 탭 가정이면 그 지점에서 검증이 *완전히 불가*(하드 블로커). 빈도×심각도로 백로그 1순위.

## 핵심 발견 (탐색)

캡처 인프라가 이미 멀티탭 인지:
- `scripts/cdp/session-manager.mjs`: 브라우저 레벨 `Target.setAutoAttach({autoAttach:true, flatten:true})` + `targetIdToInfo`/`onPageAttached` 추적 → 새 탭 자동 attach.
- `scripts/cdp/watchdogs/recorder.mjs`: 모든 page 타깃에 recorder 주입(기존 + `onPageAttached`로 새 탭) + `onEvent(payload, { sessionId, targetId })` — **이벤트마다 targetId를 이미 제공**.
- **갭**: `scripts/observe/observer-daemon.mjs:120`의 `onEvent(payload)`가 `{targetId}` meta를 *버림* → 이벤트가 탭 태깅 안 됨. 재현 runner는 `firstTarget` 하나만 씀.

## 웹 검증 (방향 확인, 2026-05-22)

CDP 멀티타깃 표준 패턴 대조(Puppeteer/chromedp/PyCDP/공식 devtools-protocol):
- 🟢 **`Target.setAutoAttach({autoAttach, flatten})` + `targetCreated`/`attachedToTarget`** 가 새 탭/팝업 캡처의 표준. session-manager가 이미 사용 → 방향 맞음.
- 🟢 `openerId?: TargetID` / `openerFrameId?` 가 프로젝트 CDP 타입에 존재(protocol.d.ts:20780/20790).
- 개선 반영: openerId를 캡처 시 **opener-ordinal 링크**로 기록(아래 A1). 단 openerId는 per-run targetId라 *cross-run 정렬 키로는 부적합* → replay 정렬 키는 ordinal 유지. openerId는 (a) 캡처 인과 명시, (b) 향후 다중 탭 disambiguation용.
- known-limit 반영: `waitForDebuggerOnStart:false`라 새 탭의 *recorder 주입 직전* 초기 이벤트(즉시 redirect 등)는 놓칠 수 있음. v1은 새 탭의 *로드 후 사용자 액션*을 대상 → 허용. 완전 캡처 필요 시 v2에서 `waitForDebuggerOnStart:true` + `Runtime.runIfWaitingForDebugger`(범위 밖).

## 아키텍처 — 탭 ordinal

targetId는 매 실행마다 다르므로 **생성 순서 ordinal**이 안정 키. 0 = 초기 탭, 1 = 첫 새 탭, …. capture/replay 모두 생성 순서로 같은 ordinal 부여 → URL 매칭 불필요(OAuth 콜백 URL은 nonce로 매번 달라 부적합).

```
캡처: rawEvent마다 targetId 태깅 → targetId→ordinal(첫 등장 순서) → compile이 step.tabOrdinal 부여
재현: runner가 ordinalToTargetId 맵 유지; step.tabOrdinal != active면 (없으면 새 타깃 대기) 전환
```

## Phase A (캡처 태깅)

### A1. daemon targetId 태깅 — `scripts/observe/observer-daemon.mjs`
`installRecorderWatchdog`의 `onEvent(payload, meta)`에서 `meta.targetId`를 받아:
- `targetId→ordinal` 맵 유지(첫 등장 순서로 0,1,2… 부여; 초기 탭 = 0).
- 각 rawEvent에 `tabOrdinal`(+ 디버그용 `targetId`는 저장 안 함 — ordinal만) 태깅 후 push/append.
- network watchdog 이벤트도 동일 가능하나 v1은 recorder 이벤트(클릭/입력/네비)만 태깅(YAGNI).
- **opener 링크(웹검증 반영)**: 새 ordinal에 처음 진입할 때, session-manager의 targetInfo `openerId`로 opener의 ordinal을 찾아 `openerOrdinal`로 기록(예: 탭1 openerOrdinal=0). v1 정렬엔 ordinal-순서만 쓰지만, 인과를 명시 기록해 둠(다중 탭 disambiguation 후속에 사용). session-manager가 targetInfo에 openerId를 보존해야 함(현재 url/title/type만 저장 → openerId 추가, additive).

### A2. compile tabOrdinal — `scripts/analyze/compile.mjs`
- 각 step에 `tabOrdinal`(rawEvent의 ordinal에서 전파). 기존 단일탭 캡처는 모든 이벤트 ordinal 0 → step.tabOrdinal 0(또는 미설정=0) → 무영향.
- workflow에 `tabCount`(관측된 최대 ordinal+1) 기록(재현 검증/문서용).
- 탭-오픈 인과는 step 순서로 암묵 표현(새 ordinal의 첫 step 직전 step이 트리거 클릭). 별도 이벤트 불필요.

### A3. 스키마 — `scripts/lib/schemas.mjs`
- `Step`에 `tabOrdinal: z.number().int().nonnegative().optional()` (additive).
- workflow에 `tabCount: z.number().int().positive().optional()` (additive).

## Phase B (재현 따라가기)

### B1. runner active-target 전환 — `scripts/generate/generate-runner.mjs`
현재 `const targetId = firstTarget.targetId` 단일 사용 → ordinal 맵 기반:
```
const ordinalToTargetId = { 0: firstTarget.targetId };
let activeOrdinal = 0;
// 각 step 실행 직전:
const want = step.tabOrdinal ?? 0;
if (want !== activeOrdinal) {
  if (ordinalToTargetId[want] === undefined) {
    const newTid = await waitForNewTarget(bs, ordinalToTargetId, transitionTimeoutMs);
    ordinalToTargetId[want] = newTid;
    // 새 탭은 자기 URL로 이미 로드 중 — goto/navigate 금지, settle(domcontentloaded)만 대기
  }
  activeOrdinal = want;
}
const targetId = ordinalToTargetId[activeOrdinal];   // 이후 모든 호출에 사용
```
- 모든 step 액션(goto/fill/click/submit/teardown)이 `targetId`를 이 active 값으로 사용. 기존 함수 시그니처(targetId 인자) 그대로 → 내부 배선만.

### B2. `waitForNewTarget` (runner helper, <24자)
`session.sessionManager.listPageTargets()`에서 `ordinalToTargetId`에 아직 없는 page 타깃을 bounded poll(transitionTimeoutMs). 발견 시 그 targetId 반환 + 새 탭 settle(domcontentloaded 짧은 대기, 기존 navigateAndWait 패턴의 대기만). timeout → throw → drift-hold(fail-safe: 새 탭 안 열림).

### B3. 새 탭 resolve 준비
resolveLocator는 매 호출 시 `locatorCaptureSource`를 Runtime.evaluate로 주입 → 새 탭에서도 `__bfCollectCandidates` 동작. **추가 작업 없음**.

### B4. switch-back
ordinal이 이미 맵에 있으면 단순 전환(원래 탭 = ordinal 0 복귀). v1 "필요시 1회 복귀" 자동 충족.

## 데이터 플로우

```
capture: 모든 탭 recorder(기존) → onEvent{targetId} → daemon ordinal 태깅 → rawEvent.tabOrdinal
analyze: compile → step.tabOrdinal + workflow.tabCount
replay: runner ordinalToTargetId 맵; step.tabOrdinal 전환(없으면 waitForNewTarget) → active targetId로 resolve/click/...
```

## 에러 처리 / 경계

- 새 탭 timeout 내 미생성 → drift-hold(기존 fail-safe).
- step.tabOrdinal 미설정(레거시/단일탭) → 0 → 기존 동작 불변.
- 예상 못 한 추가 탭(광고 팝업 등)이 먼저 열림 → ordinal 오정렬 위험. v1: `waitForNewTarget`은 "ordinalToTargetId에 없는 *가장 최근* page 타깃"을 취함 — 다중 동시 새 탭은 범위 밖(후속). 단일 새 탭/step 시퀀스가 v1 가정.
- agent-blind: ordinal은 정수, targetId 미저장, 새 탭 URL은 기존 sanitize 통과.
- 식별자 <24자(생성 runner): `waitForNewTarget`(15), `ordinalToTargetId`(17), `activeOrdinal`(13).

## 테스트 (synthetic-first)

- **fixture** `scripts/fixtures/site-server.mjs`: `/multitab`(= `<a target="_blank" href="/multitab/popup">`) + `/multitab/popup`(클릭 요소 + `data-bf-evidence`). 새 탭 step 후 변형으로 원래 탭 복귀.
- **e2e `verify-multitab.test.mjs`**(real Chrome): hand-written workflow(step.tabOrdinal 0→1) → replay가 (1) 새 탭 감지·전환, (2) 새 탭 클릭/evidence, (3) pathComplete. **fail-safe 변형**: 새 탭 미생성 → drift-hold(오동작 0).
- **unit**: compile tabOrdinal 부여(targetId→ordinal 첫등장; 단일탭=전부 0 회귀); daemon ordinal 태깅; schema parse.
- **캡처 실증**: 새 탭 fixture를 demo-driver로 캡처 → rawEvents에 tabOrdinal 태깅 확인.

## 거버넌스

Phase 94(A) + 95(B). `last_constraint_review_phase=91`(다음 96), `last_eval_audit_phase=92`(다음 102) → **94·95 모두 게이트 무발동**. 각 phase doc 작성, `.governance/state.json` 불변. (다음 feature가 96이면 constraint review 발동 — 그때 처리.)

## 분해 (한 spec, 두 구현 phase)

- **Phase A**: 캡처 태깅(daemon ordinal + compile tabOrdinal + schema + unit + 캡처 실증). 작음 — 인프라 대부분 존재.
- **Phase B**: 재현 따라가기(runner active-target 전환 + waitForNewTarget + fixture + e2e). B가 A 의존 → 순차. 별도 커밋 그룹, 각각 GREEN.

## 범위 밖 → 후속

- 임의 N탭 자유 전환·탭 닫기·탭별 독립 세그먼트(v1 = 열고 이어가기 + 1회 복귀).
- 다중 동시 새 탭/광고 팝업 disambiguation(URL/opener 기반).
- 새 탭 URL 기반 정렬(ordinal로 충분).
- 팝업 차단/권한 다이얼로그.

## 적용 패턴 (patterns-applied)

CDP Target.setAutoAttach(기존 session-manager) · recorder 멀티타깃 attach(기존) · drift-hold(82, fail-safe — 새 탭 미생성) · agent-blind(ordinal 정수, targetId 미저장) · additive-optional 스키마(레거시 단일탭 무영향) · synthetic-first(새 탭 fixture, 실사이트 수동 후속) · 빵틀: 인프라 80% 재사용 + 신규 20%(태깅 + active 전환).
