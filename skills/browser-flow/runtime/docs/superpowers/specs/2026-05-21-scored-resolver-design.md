# Scored Multi-Signal Resolver — Design (Similo-grounded + 빵틀 weight tuning)

**Status:** approved (brainstorm 2026-05-21).
**Date:** 2026-05-21
**Origin:** real-site validation (gap2) found the deterministic-replay bottleneck is the **resolver**, not flow choice. The layered resolver uses *ordered first-match rungs* ("find-first"); when the top rung resolves an ambiguous/wrong element it cascades to a generic-selector fallback that grabs the first match. Three real sites (Naver/YouTube/Wikipedia) each held early; the deepest cause = resolver robustness.
**Reference:** Similo / VON-Similo (arXiv 2208.00677, 2505.16424) — weighted multi-signal similarity, score-best, threshold fail-safe.

## 사용자 원문 quote (paraphrase 금지 — 설계 제약의 출처)

> "스코어링을 처음에 잡을때 잘잡는 역할은 llm model 이고, 추후 오토메이션 레벨 코드 에서는 model이 scoring 을 하는게 아니다. scoring 이 된 sibiling + 여러 정보들만 기계적으로 판단하는것이다." (모델=setup, 재현=기계적, 런타임 LLM-free)

> "초기에 판단하는 역할을 맡은 agent 가 판단 기준 데이터셋을 지니고 잇어야하는것도 고려" (패턴셋 자산)

> "찾기에 집착한 나머지 scoring 을 안보고 무조건 select first one 을 했다 … 직책이 매니저인 김씨가 있는데 그 사람 옆에는 노트북이 아니라 타자기가 있다" (find-first→score-best, 이웃 증거)

> "0.1, 0.2 … 같은것들만 가지고 하다가 나중에 0.7을 누락 시켯다면 그 스코어에 대한 확신이 떨어지게 됨. top-k vs top-p 비슷한 원리" (신뢰도 = 고가중 mass + 마진, 누락 신호 경계)

## 1. Goal

`resolveLocator`의 *ordered first-match 룽*을 **Similo식 coverage-aware 가중 유사도 scorer(score-best)** 로 교체 — 라이브 후보를 여러 신호의 가중 유사도로 채점, *고가중 mass + 차점 마진*으로 신뢰도 판정, 저신뢰면 *엉뚱한 걸 클릭하지 말고 fail-safe(drift-hold)*. 가중치는 Similo 고정값이 아니라 **빵틀(모델+패턴셋, *모호한 요소만*)로 element별 자동 튜닝**. 런타임은 LLM-free(기계적 채점), 모델은 setup 시점에만.

## 2. Decisions locked (brainstorm 2026-05-21)

1. **하이브리드 모델 invoke**: 결정론 scorer가 명확한 다수(80%)를 기계적 처리; *모호/저신뢰 요소만* setup에서 모델 sub-agent가 disambiguation 기준 생성 + 패턴셋 갱신. 재현은 전부 결정론(LLM 0). 빵틀 80/20을 resolution에.
2. **신호 확장 필수**: 기존 + `href`, `neighborTexts`(주변 가시 텍스트), `cleanId`(동적 id 감지), `type`, `alt`. 각 신호 *안정성 등급* 메타. (누락된 "0.7" = Neighbor-Texts/Href — 동명 disambig 결정 신호.)
3. **coverage/confidence-aware 스코어**: 단순 max 금지. 신뢰도 = f(최고점, 차점 마진, *기여한 고가중 mass*). 저신뢰(마진 작음 / 저가중으로만 결정 / 절대 floor 미달) → fail-safe + (setup) 모델 에스컬레이트. (top-p 원리.)
4. **agent-blind**: 새 신호(neighborTexts/alt/label/href) 전부 기존 redaction/sanitize 경계 통과. 패턴셋/disambiguation은 신호타입·가중만, 값 0.
5. **synthetic-first**: 동명 twin fixture로 결정론 검증(맞는 것 선택 / 약하면 fail-safe / synthetic disambiguation 적용). 실사이트=수동 후속.

## 3. Architecture — components

### (a) Signal capture 확장 (capture/observe, sanitized)
locator 지문 확장. 기존(role, name, structuralKey, elementKey, relXPath, box, viewport, ancestors, siblings-counts) + 추가:
- **`href`**: 요소 href 속성, 인코딩 정규화(decode 후 비교). 등급: same-origin path=stable, query/signed=unstable.
- **`neighborTexts`**: 근접 가시 텍스트(DOM 형제 + 부모 섹션; v1은 DOM 근접, 시각적 사각형은 후속). *sanitize 필수*.
- **`cleanId`**: id 속성 + *동적 id 감지*(mw*/auto-gen 패턴 → unstable 표시; 동적클래스 필터와 동형).
- **`type`**, **`alt`**.
- 각 신호 `{value, stability: "stable"|"unstable"}`.

### (b) Deterministic scorer (cdp, 재현, LLM 0)
`resolveLocator` 교체. held step에 대해:
1. 라이브 후보 수집(인터랙티브 요소; cap, 예: 200).
2. 후보별 *신호별 유사도* 계산: 동등(tag/name/id/type), Levenshtein(class/href/text/neighbor), 수치/유클리드(location/area/shape, viewport 정규화), 단어집합(neighborTexts). in-page 계산(locator-capture 재사용).
3. score = Σ(유사도 × weight). weight = 패턴셋/disambiguation override > Similo 시드(stable 1.5×/unstable 0.5×).
4. **신뢰도**: winner=argmax. confidence = combine(winnerScore≥absFloor?, margin=winner−runnerUp, highWeightMass=기여한 stable 신호 가중합 비율). HIGH→backendNodeId 반환. LOW→ throw/signal `ambiguous`(→ drift-hold). (임계 숫자는 P2 synthetic 캘리브레이션.)

### (c) Hybrid model (setup, 모호 요소만) — scoring-agent sub-agent
capture/analyze 시 각 캡처 요소를 *자기 페이지* 대상으로 (b) 신뢰도 체크 → 저신뢰만 dispatch. 입력: 요소 지문 + 이웃 + 패턴셋. 출력: step.locator에 `disambiguation:{decisiveSignals, weightOverrides, note}` + (일반화 가능시) 패턴셋 규칙 추가. 모델은 *기준만* 정함(런타임 LLM-free). heal-agent 패턴(내부 sub-agent, 외부 LLM/API 금지).

### (d) Pattern-set 자산
`.codex/skills/scoring-agent/patterns.json`(로컬, agent-blind). 큐레이션 시드(form-input: name/label/placeholder/neighbor 우세; nav-tab/link: role/href/text; …) + 모델 append. 형식 `[{match: 요소타입/맥락 술어, signalWeights:{...}, note}]`. 값 미포함.

### (e) Security / agent-blind
새 신호 캡처는 sanitize 경계 통과(neighborText가 최고 위험 — 값/PII 가능). 보안 스캔(scanArtifacts)되는 아티팩트에 값이 안 들어가게(Phase 85.4 교훈).

## 4. Data flow

```
capture/analyze:
  요소 지문 캡처(확장 신호, sanitized)
  각 요소 → 결정론 scorer 신뢰도 자가체크(자기 페이지)
    HIGH → 그대로
    LOW(모호) → scoring-agent dispatch(모델, 패턴셋 참조)
              → step.locator.disambiguation(weightOverrides) 기록 + 패턴셋 갱신
verify(재현, LLM 0):
  held step → 라이브 후보 수집
  후보별 Σ(신호유사도 × weight[disambiguation>패턴셋>Similo시드])
  confidence(고가중 mass + 마진 + absFloor):
    HIGH → click(backendNodeId)
    LOW  → fail-safe: drift-hold (오클릭 0)
```

## 5. Components / 파일 (예상)

- `scripts/observe/locator-capture.mjs` + `scripts/lib/structural-fp.mjs` — 신호 확장(href/neighborTexts/cleanId/type/alt + 동적-id 감지 + 안정성 등급).
- `scripts/lib/signal-similarity.mjs` (신규) — 신호별 유사도 함수(동등/Levenshtein/수치/단어집합), 순수.
- `scripts/lib/resolver-score.mjs` (신규) — `scoreCandidates(target, candidates, weights)` + `decideConfidence(scores)` → {pick, confidence, reason}, 순수.
- `scripts/cdp/locator-resolver.mjs` — `resolveLocator`를 scorer 기반으로(라이브 후보 수집 + in-page 신호계산 + scoreCandidates + confidence → backendNodeId | ambiguous).
- `scripts/lib/redact.mjs` 경계 — 새 텍스트 신호 sanitize.
- `.codex/skills/scoring-agent/SKILL.md` + `patterns.json` — 모델 disambiguation 계약 + 패턴셋.
- `scripts/lib/schemas.mjs` — locator에 신규 신호 필드 + `disambiguation` (additive-optional).
- Tests: signal-similarity unit, resolver-score unit(동명/마진/고가중mass/fail-safe), 동명 fixture e2e, scoring-agent synthetic.

## 6. Testing strategy

- **순수 unit**: signal-similarity(각 함수) + resolver-score(동명 후보 → neighbor/href로 올바른 것 선택; 동점/약신호 → LOW confidence → fail-safe; weightOverride 반영).
- **e2e(real Chrome, fixture)**: 동명 twin fixture(예: "지리" 앵커 vs 기사 / "Item name" vs "Delete item" + 이웃텍스트 차이) → (a) 결정론 scorer가 맞는 것 클릭, (b) 신호 약하면 drift-hold(오클릭 0 — cud-count류 행위검증), (c) synthetic disambiguation(weightOverride 주입)으로 올바른 선택. hard timeout + Singleton 정리.
- **scoring-agent synthetic**: heal-agent 실증처럼, 모호 요소의 신뢰도-저 케이스에 *진짜 sub-agent* dispatch → disambiguation 산출 → 적용 시 결정론 scorer가 맞게(비-CI 실증).
- **실사이트(수동 후속)**: 위키 토론/지리, YouTube — score-best가 find-first보다 멀리 가는지.

## 7. Builds on

layered resolver/locator(81) · locator-capture `__bf*`(81/85/87) · atomic-fp ancestors/siblings(34/68) · 동적클래스 필터(81) → 동적-id 감지 동형 · safety-classify(76) · redaction 경계(agent-blind) · heal-agent 내부 sub-agent 패턴(86) · drift-hold(82, fail-safe 귀결) · Similo/VON-Similo(외부 ref).

## 8. Phasing (다중 phase — 별 plan)

- **P1 — 신호 캡처 확장**: href/neighborTexts/cleanId(동적감지)/type/alt + 안정성 등급 + sanitize + schema. (capture/observe.)
- **P2 — 결정론 coverage-aware scorer**: signal-similarity + resolver-score(고가중 mass+마진+absFloor) + `resolveLocator` 교체(find-first→score-best) + 동명 fixture e2e + 임계 캘리브레이션. (재현 핵심.)
- **P3 — 하이브리드 모델 + 패턴셋**: scoring-agent SKILL.md + patterns.json(시드) + 모호 요소 disambiguation 산출/기록 + synthetic 실증.
- **P4 — 실사이트 검증**: 위키/YouTube로 score-best 완주 측정(gap2 재개).

## 9. Out of scope / 후속

- 시각적 근접(둘러싼 사각형) neighborTexts — v1은 DOM 근접; visual은 후속(좌표 geometry).
- 멀티탭 재현(별도 백로그: 시계열+서수정렬).
- 임계 자동 최적화(Similo는 벤치마크별 최적화 — 우리는 모델/패턴셋이 점진).

## 10. Open questions (writing-plans/구현 결정)

1. 신뢰도 결합식 정확형(absFloor·margin·highWeightMass 가중) — P2 synthetic 캘리브레이션.
2. neighborTexts "근접" 정확 범위(형제 N개 + 부모 1-2단계 텍스트, 길이 cap).
3. 동적-id 감지 휴리스틱(접두/엔트로피/세션간 변동) — 동적클래스 필터 재사용 범위.
4. 라이브 후보 수집 cap + in-page 신호계산 비용(큰 페이지).
5. disambiguation의 step.locator 기록 vs 패턴셋 일반화 경계.
