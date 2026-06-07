# Reactive Scoring Loop — Auto Live-Confidence Trigger (Phase 93)

> Phase 92가 "범위 밖 후속"으로 남긴 자동 live-confidence 트리거. **reactive** 모델: `bf verify`가 *모호(저신뢰) drift-hold*하면 오케스트레이터가 scoring-agent(내부 sub-agent)를 dispatch → weightOverride 산출 → `bf score --apply`로 적용 + bounded 1회 re-run. heal-loop(Phase 86)의 정확한 미러. 런타임 LLM-free 유지.

상위 spec: `docs/superpowers/specs/2026-05-21-scoring-agent-weightoverride-design.md` (P3). 본 문서는 그 P3가 남긴 "자동 live-confidence-check 트리거"를 **reactive(drift-hold 발동)**로 구체화한다.

## 사용자 결정 (brainstorm)

- **reactive > proactive**: 중간 단계 요소의 라이브 채점은 그 페이지의 올바른 상태를 요구한다. proactive 설정 스캔은 각 페이지로 직접 이동/재생해야 함(폼/POST/스테이트풀은 URL 직접이동 재현 불가 = 상태 문제). reactive는 verify가 held step까지 자연 replay하므로 상태 문제 없음 + heal-loop 기계장치 재사용.
- **빈도-우선 우선순위**: live-confidence(요소 단위, 빈번)를 멀티탭(workflow 단위)보다 먼저. "라이브 증거가 순서상 먼저."
- **별도 `bf score` (heal 미러)**: scoring과 heal은 다른 agent 계약·결과 shape → 별도 명령으로 관심사 분리. 오케스트레이터가 driftReason으로 라우팅.

## 핵심 구분: heal vs scoring

| | heal-agent (Phase 86) | scoring-agent (Phase 93) |
|---|---|---|
| drift 원인 | 요소가 *이동/소멸* (locator가 아예 resolve 안 됨) | 요소는 있으나 *모호* (저신뢰 resolution) |
| driftReason | "no element matched" / mold-diff 소멸 | "ambiguous locator: low-confidence resolution (...)" |
| 처방 | locator 재매핑(새 role/name/structuralKey) | weightOverride(어느 신호가 결정적인가) |
| 명령 | `bf heal --apply` | `bf score --apply` |

오케스트레이터 라우팅(결정론): driftReason이 `includes("ambiguous locator")` → scoring, 그 외 → heal.

## 아키텍처 — reactive 루프

```
bf verify → drift-hold
  ├─ driftReason "ambiguous locator: low-confidence" → runner가 scoring-request.json emit
  └─ 그 외(no-match/이동/소멸)                        → runner가 heal-request.json emit (기존)
오케스트레이터(Claude 세션): driftReason 보고 라우팅
  ├─ ambiguous → scoring-agent dispatch (Task tool, 내부 sub-agent)
  └─ moved/gone → heal-agent dispatch (기존)
scoring-agent: scoring-request.json 읽음 → scoring-result.json 씀 (weightOverrides [+ generalizable])
bf score --apply: applyScoringResult → regenerate → cleanup(Phase 84) → bounded 1회 re-run
```

런타임(replay)은 LLM 0 — 모델은 setup(드리프트 복구) 시점에만, 결과는 weightOverride로 workflow에 박힘.

## 컴포넌트

### (1) scoring-request emission — `scripts/generate/generate-runner.mjs`

runner가 drift-hold할 때 driftReason을 분기한다:
- `driftReason.includes("ambiguous locator")` → `scoring-request.json` emit.
- 그 외 → 기존 `heal-request.json` emit (불변).

scoring-request.json (agent-blind, 실 텍스트/URL 값 0):
```jsonc
{
  "stepIndex": <number>,
  "intent": "<held segment 이름 / 이 step의 목적>",
  "heldElement": { "role": "...", "structuralKey": "<shape>", "hasHref": <bool>, "type": "...", "neighborCount": <int> },
  "drift": { "winner": <number>, "margin": <number>, "mass": <number> },
  "patterns": [ /* 현재 patterns.json */ ]
}
```
- `heldElement`는 held step.locator에서 *형태/유무만* 추출(값 제외). `drift`는 driftReason의 winner/margin/mass 파싱(어느 게이트가 막았는지). `patterns`는 loadPatterns().
- 후보 상세(sibling 신호 shape)는 범위 밖(후속) — Phase 92 demo처럼 요소 유형 + drift metrics로 충분.

### (2) `bf score` 명령 — `scripts/commands/score.mjs` (신규), `scripts/cli.mjs` 등록

`bf heal`(scripts/commands/heal.mjs) 미러:
- scoring-request.json 없으면 → 에러("ambiguous drift-hold 아님").
- `--apply` 없으면 → scoring-request 반환(오케스트레이터가 dispatch 입력으로 읽음).
- `--apply <scoring-result>`: parseScoringResult → applyScoringResult(workflow, result) [Phase 92 기존, compile.mjs] → workflow.json 기록(self-tune 캐시) → regenerate → cleanup → **bounded 1회 re-run**(deps.rerun ?? verifyRun).
- generalizable 패턴 있고 patterns.json 중복 아니면 → append.

### (3) scoring-result 적용 — `applyScoringResult` (Phase 92, compile.mjs) 재사용

stepIndex의 step.locator.disambiguation에 weightOverrides(화이트리스트+클램프) 기록. 이미 존재 + 테스트됨. bf score가 호출.

### (4) 스키마 — `scripts/lib/schemas.mjs`

`ScoringRequestV1` + `ScoringResultV1` (additive). ScoringResult shape는 Phase 92 SKILL.md 출력과 일치: `{ schemaVersion, runId, stepIndex, disambiguation:{weightOverrides, note?}, generalizable?:{id,match,signalWeights} }`.

### (5) 경로 — `scripts/lib/config.mjs`

`scoringRequestPath` / `scoringResultPath` (runRoot 또는 tasksDir 하위). heal과 동일 패턴.

### (6) scoring-agent 계약 갱신 — `.codex/skills/scoring-agent/SKILL.md`

입력을 `scoring-request.json`(reactive: 드리프트 복구 시점)으로 명시. drift metrics(winner/margin/mass)로 "어떤 게이트가 막혔나"를 보고 결정 신호의 weight를 올림(예: mass 부족 + nav 요소 → href를 stable tier로). 출력 계약(weightOverrides + generalizable)은 기존 유지. 외부 LLM/API 금지, 내부 sub-agent only.

## 데이터 플로우

```
verify → 모호 drift-hold → scoring-request.json (heldElement shape + drift metrics + patterns)
오케스트레이터 → scoring-agent(Task) → scoring-result.json (weightOverrides [+ generalizable])
bf score --apply → applyScoringResult → workflow.disambiguation 박힘 → regenerate → cleanup → 1 re-run
재현(LLM-free): resolveLocator가 weightOverrides 머지 → scoreCandidates + decideConfidence(가중 일치) → HIGH → 클릭
generalizable → patterns.json append → 다음엔 결정론이 같은 유형 처리(reactive 발동 감소)
```

## 에러 처리 / 경계

- scoring-request 없는데 bf score → 명확한 에러(heal과 동일).
- re-run이 다시 모호-hold → 새 held 리포트 반환, **자동 재dispatch 없음**(heal과 동일 bounded). 오케스트레이터가 판단.
- driftReason이 ambiguous도 no-match도 아닌 경우(예: transition timeout) → scoring-request도 heal-request도 아님 또는 heal-request 기본 — scoring 라우팅은 ambiguous에만.
- agent-blind: scoring-request/result에 실 텍스트/URL 값 0(heldElement는 shape/presence만). weightOverrides는 화이트리스트+클램프[0,3](applyScoringResult 기존).
- generalizable 패턴은 구조 술어만(roleIn/structuralKeyIncludes/hasHref/typeIn), 값 0 — pattern-match evalMatch 계약 준수.

## 테스트

- **e2e `verify-scoring-loop.test.mjs`** (`verify-heal-loop` 미러, real Chrome fixture): 동명/형제 ambiguous fixture(기본 weights로 mass<0.55 → "ambiguous locator" drift-hold) → (1) scoring-request.json emit + heldElement/drift 필드 확인, (2) *합성* scoring-result(weightOverride; heal-loop의 합성 heal-result처럼 모델 stand-in) 작성, (3) `bf score --apply` → re-run이 ambiguous-hold 없이 완주 + 해당 클릭 실행. hard timeout + Singleton 정리.
- **unit**: scoring-request emission이 ambiguous reason에만(no-match엔 heal-request) — driftReason 분기; bf score --apply 배선(applyScoringResult 호출 + bounded 1 re-run); ScoringRequest/Result 스키마 parse.
- **scoring-agent synthetic 실증(non-CI)**: 기존 `scripts/demos/scoring-agent-demo.mjs`를 reactive(scoring-request.json 소비)로 확장 — 실 내부 sub-agent dispatch → scoring-result → bf score --apply → 완주(gap1 heal demo 방식).

## 거버넌스 — Phase 93

state: `last_constraint_review_phase=91`(다음 96), `last_eval_audit_phase=92`(다음 102). Phase 93 → 두 게이트 모두 delta<기준 → **게이트 무발동**. phase doc(`tasks/phases/phase-93-reactive-scoring-loop.md`)만 작성, 게이트 무발동 명시. validate-skill PASS 유지.

## 파일 요약

| 파일 | 변경 |
|------|------|
| `scripts/generate/generate-runner.mjs` | ambiguous drift-hold 시 scoring-request.json emit (driftReason 분기) |
| `scripts/commands/score.mjs` | 신규 — bf score [--apply] |
| `scripts/cli.mjs` | `score` 명령 등록 |
| `scripts/lib/schemas.mjs` | ScoringRequestV1/ScoringResultV1 + parse 헬퍼 |
| `scripts/lib/config.mjs` | scoringRequestPath/scoringResultPath |
| `.codex/skills/scoring-agent/SKILL.md` | 입력=scoring-request.json (reactive) 명시 |
| `scripts/demos/scoring-agent-demo.mjs` | reactive 소비로 확장 (non-CI) |
| tests | verify-scoring-loop(e2e) + unit(emission/routing/schema) |
| `tasks/phases/phase-93-reactive-scoring-loop.md` | phase doc, 게이트 무발동 |

## 범위 밖 → 후속

- **proactive 설정 스캔**(전수 사전 하드닝) — 상태 문제로 보류.
- scoring-request에 sibling 후보 신호 shape 포함(더 풍부한 모델 입력).
- 멀티탭 replay(백로그, 빈도-우선으로 후순위).
- 자동 재dispatch 루프(현재 bounded 1회 유지).

## 적용 패턴 (patterns-applied)

heal-loop(86, drift-hold→agent→apply→bounded re-run) 미러 · scoring-agent/weightOverride(P3/92) · drift-hold(82, fail-safe) · agent-blind redaction 경계 · 빵틀 80/20(결정론 패턴 + 모델은 잔여 모호분만, generalizable로 학습) · 내부 sub-agent 패턴(86 heal, 61 variable).
