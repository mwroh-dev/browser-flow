# P3 (Phase 92) — Scoring-Agent + Pattern-Set + Per-Element WeightOverride

> Scored-resolver 3단계. P1(신호 캡처, Phase 90) + P2(결정론 coverage-aware scorer, Phase 91) 위에 **element 유형별 가중 튜닝**을 얹는다. 빵틀 80/20을 resolution에: 결정론 패턴이 다수(80%)를 모델 없이 처리, 모델(내부 sub-agent)은 신규 모호 요소(20%)의 *판단 기준만* 생성. 런타임은 LLM-free.

상위 spec: `docs/superpowers/specs/2026-05-21-scored-resolver-design.md` (P1–P4 holistic) — 본 문서는 그 §(c)/P3를 P4 실사이트 발견으로 구체화·수정한다.

## 사용자 원문 quote (paraphrase 금지)

> "scoring을 처음에 잡을때 잘잡는 역할은 llm model 이고, 추후 오토메이션 레벨 코드 에서는 model이 scoring 을 하는게 아니다 … scoring 이 된 sibiling + 여러 정보들만 기계적으로 판단"

> "초기에 판단하는 역할을 맡은 agent 가 판단 기준 데이터셋을 지니고 잇어야하는것도 고려" (패턴셋 자산)

> "직책이 매니저인 김씨가 있는데 그 사람 옆에는 노트북이 아니라 타자기가 있다" (이웃 증거 기반 disambiguation)

## 동기 — P4 실사이트 검증이 드러낸 것

P4(위키백과 "토론" 탭 재현)에서 변수를 한 번에 하나씩 격리한 결과:

1. **href 유사도(Levenshtein)** 가 `/wiki/%XX…` 공통 접두사를 0.54로 과점수 → path-aware로 수정(별도 커밋, P4 fix-A). 변별력↑이나 완주 실패.
2. **진짜 블로커 = 후보 recall**: 200-cap이 document-order 앞 200개만 수집 → 대한민국(인터랙티브 3629개)에서 토론 탭(idx 405)이 *후보에 없었음*. cap 200→5000(safety bound)로 수정. 토론 탭이 **rank 1/3629, score 0.644, href 1.00, relXPath 1.00, margin 0.24** = 명백한 1위가 됨.
3. **유일 잔여 블로커 = mass 게이트** (`mass 0.31 < 0.55`): `decideConfidence`의 mass는 *하드코딩 STABLE 집합*(name/structuralKey/neighborTexts/cleanId)만 센다. 결정 신호(href·relXPath)는 non-stable tier라 mass에 안 들어가고, stable인 structuralKey는 Vector 스킨 탭 DOM에서 brittle(0.00). → **weightOverride가 mass에 도달하지 못함**. 이것이 P3가 풀어야 할 핵심.

## 목적

element 유형별로 "어떤 신호가 결정·안정적인가"를 판단해 **weightOverride**를 부여하고, 그 override가 **점수와 신뢰도(mass)를 동시에** 구동하게 한다. 판단 기준은 **patterns.json**(결정론 자산)에 영속화하고, 신규 유형은 **scoring-agent**(내부 sub-agent)가 기준을 생성해 패턴셋을 키운다.

## 아키텍처 — 빵틀 80/20

```
analyze 시점 (per captured click/fill step.locator):
  1. 결정론 패턴 매칭 (모델 X, 라이브 페이지 X, 순수 함수)
     element 유형 ← step.locator 자기 신호(role / structuralKey / hasHref / type)
     첫 매칭 패턴 → step.locator.disambiguation.weightOverrides 기록
  2. 매칭 없음 + 모호 의심(신규 유형, 20%) → scoring-agent dispatch (내부 sub-agent)
     → disambiguation 산출 → step.locator 기록 + (일반화 가능시) patterns.json append

런타임(replay): LLM 0. resolveLocator가 weightOverrides 머지 (locator-resolver.mjs:143-154, 이미 구현).
```

원칙(상위 spec 계승): 하이브리드 모델 invoke / 런타임 결정론 / agent-blind(패턴·disambiguation은 신호타입·가중만, 실값 0) / synthetic-first(twin fixture로 CI 검증, 실사이트=수동 후속).

## 컴포넌트

### (1) mass 게이트 통합 — `scripts/lib/resolver-score.mjs`

mass 멤버십을 *하드코딩 STABLE 집합* → **유효 weight ≥ `STABLE_TIER`(1.5)** 로 재정의.

```js
export const STABLE_TIER = 1.5;
// decideConfidence 내부:
//   현재: for (k of perSignal) if (STABLE.has(k)) { mNum += weights[k]*sim; mDen += weights[k]; }
//   변경: for (k of perSignal) if ((weights[k] ?? 0) >= STABLE_TIER) { mNum += weights[k]*sim; mDen += weights[k]; }
```

- **기본값 불변**: DEFAULT_WEIGHTS에서 name/structuralKey/neighborTexts/cleanId가 정확히 1.5 → 현 동작과 동일(회귀 0). 기존 `STABLE` Set은 제거(또는 문서용 주석으로 격하).
- weightOverride가 **단일 knob**: 패턴이 href→1.5로 올리면 href가 score 기여 + mass 진입. structuralKey→0.5로 내리면 mass에서 이탈.
- **위키탭 검산**: weightOverrides `{href:1.5, structuralKey:0.5}` 적용 시 mass set = {name 0.63, href 1.0}(둘 다 ≥1.5; structuralKey 0.5 제외) → mass = (1.5×0.63 + 1.5×1.0)/(1.5+1.5) = **0.815 ≥ 0.55 ✓**. score ≈ 0.795 ≥ 0.6 ✓, margin 큼 → **HIGH 완주**.

### (2) 패턴셋 — `.codex/skills/scoring-agent/patterns.json` (agent-blind, 실값 0)

```jsonc
[
  { "id": "nav-tab",
    "match": { "structuralKeyIncludes": "nav>", "hasHref": true },
    "signalWeights": { "href": 1.5, "structuralKey": 0.5 },
    "note": "탭/네비 링크: URL 경로가 결정·안정, DOM-path는 brittle" },
  { "id": "form-input",
    "match": { "roleIn": ["textbox", "combobox", "spinbutton"] },
    "signalWeights": { "name": 1.5, "neighborTexts": 1.5, "cleanId": 1.5 },
    "note": "입력 필드: 라벨/이름/이웃 텍스트 우세" },
  { "id": "content-link",
    "match": { "roleIn": ["link"], "hasHref": true },
    "signalWeights": { "href": 1.5, "neighborTexts": 1.5 },
    "note": "본문 링크: URL + 주변 텍스트로 동명 갈라냄" }
]
```

- `match` = 순수 술어, **locator 자기 필드만** 사용: `roleIn` / `structuralKeyIncludes`(부분문자열) / `hasHref`(boolean) / `typeIn`. 실텍스트·실URL 미포함 → agent-blind.
- 적용 = 결정론: 첫 매칭 패턴의 `signalWeights` → `disambiguation.weightOverrides`. 다중 매칭 시 배열 순서 우선(시드가 앞, 모델 append가 뒤).
- 시드는 큐레이션. 모델이 `generalizable` 출력 시 append.

### (3) 패턴 매처 — `scripts/lib/pattern-match.mjs` (신규, 순수)

```js
matchPattern(locator, patterns) -> { id, weightOverrides } | null   // 첫 매칭
applyPatterns(locator, patterns) -> locator'  // disambiguation.weightOverrides 병합 기록(있으면)
```

순수·결정론·라이브 페이지 불필요. `evalMatch(locator, match)`는 roleIn/structuralKeyIncludes/hasHref/typeIn만 평가.

### (4) analyze 배선 — `scripts/analyze/compile.mjs`

compile이 각 step.locator에 `applyPatterns`를 적용 → 매칭 시 `disambiguation.weightOverrides`가 workflow.json에 박힘(런타임 LLM-free). 이미 disambiguation을 들고 있으면(모델이 이미 채움) 패턴 적용은 *덮지 않음*(모델 > 패턴 > 시드 우선).

### (5) scoring-agent — `.codex/skills/scoring-agent/SKILL.md` (모델 계약, 내부 sub-agent)

- **언제**: analyze 시점, 패턴 미매칭 + 모호 의심 요소만(20%). (Phase 92에서 트리거는 synthetic demo로 실증; 자동 live-confidence-check 트리거는 후속.)
- **금지**: 외부 LLM/API/`claude -p`/codex spawn. heal-agent와 동일하게 *내부 sub-agent* dispatch만.
- **입력(agent-blind)**: 요소 지문(role/structuralKey/relXPath/hasHref/type/neighbor *개수*) + 형제 후보 요약 + patterns.json. 실텍스트/실URL 미전달.
- **출력**:
```jsonc
{ "stepIndex": N,
  "disambiguation": { "weightOverrides": {"href":1.5,"structuralKey":0.5}, "note": "..." },
  "generalizable": { "id":"...", "match":{...}, "signalWeights":{...} }   // optional
}
```
- `disambiguation` → 해당 step.locator에 항상 기록. `generalizable` 있고 patterns.json에 중복 아니면 append(빵틀이 학습 — 다음엔 같은 유형을 결정론이 모델 없이 처리).
- 모델은 **기준(가중)만** 정함. 런타임은 기계 적용.

### (6) 스키마 — `scripts/lib/schemas.mjs`

`disambiguation`을 additive-optional로 확장: `{ weightOverrides?: Record<string,number>, note?: string, decisiveSignals?: string[] }`. patterns.json 엔트리 shape도 정의.

## 데이터 플로우

```
capture → events(신호 포함, P1)
analyze/compile:
  per step.locator:
    applyPatterns(locator, patterns.json)
      ├─ 매칭 → disambiguation.weightOverrides 기록  (80%, 결정론)
      └─ 미매칭+모호 → [Phase92 synthetic: scoring-agent dispatch]
                        → disambiguation 기록 + patterns.json append (20%, 모델 기준만)
  → workflow.json (weightOverrides 박힘)
verify/replay (LLM-free):
  resolveLocator → weights = {...DEFAULT_WEIGHTS, ...loc.disambiguation.weightOverrides}
    → scoreCandidates → decideConfidence(mass = 유효weight≥STABLE_TIER)
    → HIGH: 클릭 / LOW: drift-hold(fail-safe, 오클릭 0)
```

## 에러 처리 / 경계

- 패턴 미매칭 + 모델 미실행(Phase 92 자동 트리거 없음) → DEFAULT_WEIGHTS로 진행(P2 동작). 저신뢰면 fail-safe(drift-hold) — 안전.
- weightOverride가 모든 stable을 제거해 mass denominator=0 → 기존 `mDen===0 ? 0` 경로로 mass=0 → LOW(fail-safe). 안전.
- patterns.json 부재/파싱 실패 → 빈 배열로 취급(패턴 적용 스킵), DEFAULT_WEIGHTS. 크래시 금지.
- scoring-agent 출력의 weightOverrides 키는 알려진 신호명만 허용(화이트리스트), 값은 [0, 3] 클램프. 미지 키/범위초과 무시.
- agent-blind: 패턴·disambiguation·scoring-agent 입출력에 실텍스트/실URL 0. 매처 술어는 타입/구조/유무만.

## 테스트

- **unit `pattern-match.test.mjs`**: roleIn/structuralKeyIncludes/hasHref/typeIn 술어 매칭(맞는 locator만), 첫 매칭 우선, 미매칭→null, applyPatterns가 weightOverrides 병합·기존 disambiguation 미덮음.
- **unit `resolver-score.test.mjs` 보강**: mass 통합 — href를 1.5로 올리면 mass 포함, 0.5로 내리면 제외; DEFAULT_WEIGHTS 회귀(현 4 stable 동일 mass). 위키탭류 수치(override 적용 시 mass≥0.55, 미적용 시 <0.55).
- **e2e(real Chrome, fixture)**: samename + nav-tab류 fixture → 패턴 적용으로 score-best HIGH 완주 / 약신호 → drift-hold(오클릭 0, 행위검증). hard timeout + Singleton 정리.
- **scoring-agent synthetic demo(non-CI)**: 패턴 미매칭 신규 모호 요소 → 진짜 내부 sub-agent dispatch → disambiguation 산출 → 적용 시 결정론 scorer가 올바른 형제 선택 + generalizable면 patterns.json append되어 형제 요소엔 모델 없이 적용됨을 실증(heal-agent gap1 방식).

## 거버넌스 — Phase 92 = eval-audit 게이트

`last_eval_audit_phase=82`, Phase 92 → delta 10 → **eval audit 하드 게이트**. plan에 eval audit task 포함: harness hill-climbing 점검(스킬/패턴셋이 실제 capability를 늘렸나 vs infra 부풀림 — patterns.json/scoring-agent가 실측 완주율을 올리는가). `.governance/state.json` `last_eval_audit_phase` 82→92 bump. (constraint review는 86→91 완료, 다음 96 — Phase 92는 해당 없음.)

## 파일 요약

| 파일 | 변경 |
|------|------|
| `scripts/lib/resolver-score.mjs` | mass 통합(STABLE_TIER), STABLE Set 제거/격하 |
| `scripts/lib/pattern-match.mjs` | 신규 — 순수 패턴 매처/적용 |
| `scripts/analyze/compile.mjs` | applyPatterns를 step.locator에 배선 |
| `.codex/skills/scoring-agent/patterns.json` | 신규 — 시드 패턴(nav-tab/form-input/content-link) |
| `.codex/skills/scoring-agent/SKILL.md` | 신규 — 모델 disambiguation 계약 |
| `scripts/lib/schemas.mjs` | disambiguation/pattern shape additive-optional |
| `tests/lib/pattern-match.test.mjs`, `resolver-score.test.mjs`(보강), e2e fixture, synthetic demo | 테스트 |
| `.governance/state.json` | last_eval_audit_phase 82→92 |
| `tasks/phases/phase-92-scoring-agent.md` | phase doc + eval audit 기록 |

## 범위 밖 (후속)

- 자동 live-confidence-check 트리거(analyze에서 페이지 재오픈해 저신뢰 자동 dispatch) — Phase 92는 synthetic 트리거만.
- 실사이트 위키탭 완주 실측 — 수동 P4-resume(패턴 적용 후).
- 임계 자동 최적화, 시각적 근접 neighborTexts.

## 적용 패턴 (patterns-applied)

빵틀 80/20(82–89) resolution 적용 · heal-agent 내부 sub-agent 패턴(86) · Phase 61 variable-agent analyze-hook 선례 · Similo/VON-Similo 가중(외부 ref) · agent-blind redaction 경계 · drift-hold(82, fail-safe) · harness hill-climbing(eval audit 게이트).
