# Scope-Agent (식별 영역 정의) + 전역 A/B Coverage 채점 — Design

> 두 조각: **① scope-agent** — 캡처 시점에 LLM sub-agent가 DOM 스냅샷을 보고 *signal-poor 요소*의 **식별 영역(범위)을 정의**(삼촌/조상/aria-labelledby 건너편 등, 트리 거리 무관) → 그 영역의 A·B 신호를 산출. **② 전역 A/B coverage 채점 policy** — 산출된 신호를 *유의미하게 A만 / B만 / A·B 둘 다* 있는 경우에 따라 결정론으로 채점(Similo coverage-aware). 런타임 LLM-free 유지.

**Reference:** Similo (Nass et al., arXiv:2208.00677) / VON-Similo (arXiv:2505.16424) — 가중 다중신호 유사도, score-best, 임계 fail-safe. 본 설계는 그 위에 *"신호를 트리 어디까지 harvest할지"*(Similo 미해결)를 모델이 결정하는 층을 더한다.

**기반 (기존 자산):** Phase 91 scorer(`resolver-score.mjs`) · Phase 92 scoring-agent + `patterns.json`(요소-맥락별 weightOverride) · Phase 81/85/87 `locator-capture.mjs`(`__bfNeighborTexts`/`__bfElementSignals`) · Phase 86 heal-agent(내부 sub-agent 패턴) · Phase 35/43 `--snapshot-dom`(sanitize된 DOM 스냅샷).

**촉발 (실증 근거):** Gap2 Google Keep full-loop 검증(2026-05-22). 재현이 "메모 작성" 진입 클릭에서 drift-hold — 캡처된 locator가 이름 없는 `<p role=presentation>` + 제네릭 structuralKey이고 라이브에 동일한 게 3개, **구별 신호 0**(winner 0.34→0.40, mass 0.00). 원인: `__bfNeighborTexts`의 harvest 범위가 *직접 형제 + 부모 텍스트*로 하드코딩 → "메모 작성…" 플레이스홀더가 *삼촌(부모의 형제)*이라 누락. (lessons 2026-05-22 4건.)

---

## 사용자 정의 (원문 quote, paraphrase 금지)

> "llm model 이 저 범위를 정하게끔 해야한다. 코드레벨은 어느 레벨까지를 되어야하는지를 모르니까. 모델의 개입이 되어야 어느 범위단락으로 묶어야 하는지 dom 을 확인해서 유저가 한부분의 단락들을 형성하게 해야한다"

> "증조할머니의 사촌의 고모까지 포함해야하는 단계이면 어떻게 하려고 그렇게 하드코딩을 한다는거지"

> "당연히 llm model 이 등장하는 sub agent 가 잇어야지"

> (scope vs heal 구분) "하나는 초기에 어느 범위로 잡을거냐 이고 / 하나는 문제가 터졋을때 기존의 범위가 어디로 갓는지, 그범위가 없어진건지, 옮겨진건지 등을 판독하고 재 추론 하는거지. 이 2개는 같이 등장할수가 없음."

> (전역 채점 policy) "a, b는 dom 에 다 있겟지. 그런데, 유의미하게 a 만 있는경우, b 만 있는 경우, a,b 둘다 잇는 경우에 대해서 점수를 어떻게 부여할것인가 … 저 논문에서 이야기한것이 반영되어야하는것." / "찾는것도 된다는것은 … 둘중 택일로 a만 선택하거나 b 만 선택했을때 문제가 생기니 두개다 고려를 해야 찾을수있다"

> (harvest ⊂ scope) "삼촌까지 포함한다 라는 영역에 내포된것 아니엇나" / "단위의 묶음이 잘 커버가 되느냐 … 그거는 해보면 된다"

---

## 핵심 구분 (이전 redefine-miss 재발 방지 — 반드시 준수)

1. **scope-agent(초기 establish) ≠ heal-agent(드리프트 repair).** 별개 에이전트, 다른 라이프사이클. scope-agent는 *맨 처음* 식별 영역을 **정의**; heal-agent는 잘 쓰던 범위가 *없어졌나/옮겨졌나* **재추론**. "같이 등장하는 택일"이 아니라 순서(생성→수리). proactive/reactive로 묶지 말 것.
2. **harvest ⊂ scope.** "어디서 신호를 긁나(harvest)"는 별도 반쪽이 아니라 **scope 정의의 결과**. LLM이 "이 요소 영역은 삼촌까지"를 정하면 그 영역 안 A·B가 곧 신호. 별개 단계로 쪼개지 말 것.
3. **단위 = 요소-맥락(element-context), 페이지/SaaS 단위 아님.** 정책은 *전역 공유* 규칙(요소 타입/맥락 술어로 일반화) — `patterns.json` 방식. per-page/per-service 정책 금지(과적합 + 재사용 0).
4. **A/B coverage는 신호 *타입*이 아니라 *안정성*으로.** "A만/B만/둘다"를 raw 타입으로 박지 말고, *안정 신호가 corroborate하면 고신뢰 / 휘발성만이면 저신뢰(fail-safe)*로 표현 → 하나의 전역 규칙이 요소마다 적응(예: Keep 해시클래스 structuralKey = 휘발 B → 자동 저가중).
5. **모델은 setup만, 런타임은 결정론.** scope-agent는 analyze(캡처) 시점에 1회 → 결과를 아티팩트에 동결. 찾기·채점·신뢰도 게이트(저신뢰 *거부*)는 전부 결정론 resolver. **LLM이 런타임에 요소를 고르지 않는다**(비결정·fail-safe 붕괴 방지). "두 개 다 고려해야 찾을 수 있다"의 *찾기*는 결정론 resolver가 A·B 둘 다 써서 하는 것.
6. **agent-blind 유지.** scope-agent는 *sanitize된* 스냅샷을 보고 **scope 규칙(구조)**을 출력 — 실제 텍스트 값은 아티팩트/정책에 안 들어감. 값은 런타임에 후보마다 결정론으로 harvest. (variable-agent가 이벤트 보고 규칙만 내는 것과 동형.)

---

## 아키텍처 — setup(모델) → runtime(결정론)

```
[setup: bf analyze]
  compile: locator 결정론 빌드
    → 결정론 게이트: signal-poor 요소 표시 (빈 name + 휘발/제네릭 structuralKey + siblings 모호 + 비의미 role)
    → 표시된 것마다 scope-agent dispatch (Task tool, 내부 sub-agent)
         입력: 요소 지문(role/structuralKey/ancestors/relXPath/box) + sanitize된 DOM 스냅샷
         판정: 스냅샷에서 요소 찾고 "식별 영역"(구조 규칙) + A/B 신호 등급 결정
         출력: policy 항목 (scope 규칙 + A/B 가중) → patterns.json append (일반화) + step.locator.disambiguation
    → 동결 (workflow.json / patterns.json)
  generate: runner

[runtime: bf verify — LLM 0]
  resolver(결정론):
    후보마다 policy의 scope 규칙으로 A·B harvest (per-candidate 재적용)
    score = Σ(신호 유사도 × 가중[disambiguation > patterns > Similo 시드])
    confidence = coverage-aware(안정 corroboration mass + margin + absFloor)
      HIGH → resolve
      LOW  → fail-safe drift-hold (→ 필요시 heal/scoring 루프, 별개)
```

---

## 컴포넌트

### (1) 결정론 트리거 게이트 — `scripts/analyze/compile.mjs`
analyze 중 각 step.locator의 **signal-poor** 여부를 결정론으로 판정해 scope-agent 대상 표시:
- name 비었거나 generic, **그리고** structuralKey가 휘발(동적 클래스/해시 — 기존 동적-클래스/id 감지 재사용) 또는 제네릭,
- **그리고** siblings.totalMatchingSelector > 1 또는 role이 비의미(presentation/generic).
- (Phase 60 atomic-fp novelty / Phase 93 winner-floor 라우팅과 같은 "결정론으로 모호 감지 → 모델 dispatch" 패턴.)

### (2) scope-agent (모델, setup) — `.codex/skills/scope-agent/SKILL.md` (신규)
heal-agent와 동형 계약(내부 sub-agent, 외부 LLM/API 금지):
- **입력**: signal-poor 요소의 지문 + ancestors + relXPath/box + **sanitize된 페이지 스냅샷 HTML**(이미 `--snapshot-dom`으로 캡처).
- **추론**: 스냅샷에서 요소를 찾아(relXPath/box) **트리 거리와 무관하게** 의미 식별 영역을 판정 — "이 빈 `<p>`는 메모작성 composer; 정체성 신호 = role=combobox 조상 + 삼촌의 '메모 작성…' 앵커텍스트". *유의미한* 앵커 vs 노이즈("닫기"/"OK")의 의미 판단이 여기서 모델 몫.
- **출력**(agent-blind, 값 0 — 구조 규칙만): policy 항목.

### (3) 전역 A/B coverage 채점 — `scripts/lib/resolver-score.mjs` (확장)
- 후보마다 policy의 scope 규칙으로 A(이웃/앵커: neighborTexts/name/aria)·B(구조: structuralKey/relXPath/box) harvest.
- `score = Σ(유사도 × weight)`; weight 우선순위 `disambiguation > patterns.json > Similo 시드`.
- **confidence = coverage-aware (전역 규칙)**: 안정 신호(의미 앵커 A 또는 정적 구조 B)가 corroborate하는 mass + 차점 margin + absFloor. 휘발성만으로 찍히면 LOW → fail-safe. → "A만/B만/둘다"가 *안정성 mass*로 자연 표현됨.

### (4) harvest 재적용 — `scripts/observe/locator-capture.mjs` (`__bfNeighborTexts` 파라미터화)
- 하드코딩(직접형제+부모텍스트) → **policy의 scope 규칙을 인자로** 받아 그 범위에서 텍스트 harvest. setup에서 모델이 정한 규칙을 런타임에 *후보마다 동일 적용*. (구조적으로 재적용 가능한 형태로 표현 — 예: `ancestorUp: N, includeAncestorSiblingText: true`.)

---

## 출력 형태 — policy 항목 (patterns.json 확장)

요소-맥락별, 일반화 키. agent-blind(타입·규칙·가중만, 값 0):
```jsonc
{
  "match": "<요소-맥락 술어>",        // 일반화 키 (예: role=presentation + contenteditable-ancestor)
  "scope": {                          // ① scope-agent 산출 — harvest 범위 (구조 규칙)
    "ancestorUp": 2,                  //   조상 N단계까지
    "includeAncestorSiblingText": true, //   조상의 형제(삼촌) 텍스트 포함
    "anchorRole": "combobox"          //   식별 조상 role
  },
  "signalWeights": {                  // ② 전역 A/B coverage — 신호별 비중
    "neighborTexts": 1.5,             //   A형 앵커 (안정)
    "role": 1.0,
    "structuralKey": 0.5              //   B형 구조 (Keep에선 휘발 → 저가중)
  },
  "note": "Keep take-a-note: 빈 p, 삼촌 플레이스홀더로 식별"
}
```
- `bf <cmd> --apply`가 workflow.json/patterns.json에 동결 (heal/score --apply와 동형).

---

## Reference 예제 — Keep `<p role=presentation>` + "메모 작성…"

DOM(사용자 제공):
```html
<div class="fmcmS-h1U9Be-LS81yb">                     <!-- 조부모 -->
  <div role="combobox" tabindex="0" aria-autocomplete="list">  <!-- 부모 -->
    <p role="presentation"><br></p>                    <!-- 클릭된 el (빈 이름) -->
  </div>
  <div class="fmcmS-LwH6nd">메모 작성…</div>          <!-- 삼촌 = 식별 앵커 -->
</div>
```
흐름:
1. 게이트: 빈 name + 제네릭 structuralKey + siblings 다수 → signal-poor 표시.
2. scope-agent: 스냅샷 읽음 → "영역 = 조부모까지, 앵커 = 삼촌 '메모 작성…' + role=combobox 조상" → policy(`ancestorUp:2, includeAncestorSiblingText:true, anchorRole:combobox`, neighborTexts 1.5 / structuralKey 0.5).
3. runtime: 라이브 빈 `<p>` 3개 중 **'메모 작성…' 삼촌을 가진 것만** A-신호 매치 → coverage 고신뢰 → resolve. (다른 2개는 그 앵커 없음 → 자연 배제.) — "단위 묶음이 잘 커버되나"는 이 재캡처로 실증.

---

## 불변식 (constitutional 경계 — 위반 금지)
- **런타임 LLM-free**: 모델은 analyze(setup)만. 찾기·채점·게이트는 결정론.
- **fail-safe 우선**: 저신뢰 → drift-hold(오클릭 0). scope/coverage가 풀어도 confidence gate가 최종 거부권 보유.
- **agent-blind**: scope-agent는 sanitize 스냅샷 → 구조 규칙만 출력. 값/쿠키/세션 0. 새 harvest 텍스트는 기존 sanitize 경계 통과(neighborText 최고위험 — Phase 85.4 교훈).
- **80/20**: 결정론 80%, 모델은 signal-poor(모호)에만.

---

## Files
- `scripts/analyze/compile.mjs` — signal-poor 게이트 + policy 적용/동결.
- `.codex/skills/scope-agent/SKILL.md` — 신규 sub-agent 계약(heal-agent 동형).
- `scripts/observe/locator-capture.mjs` — `__bfNeighborTexts` scope-규칙 파라미터화.
- `scripts/lib/resolver-score.mjs` — A/B coverage 채점(안정성 mass) 명시화.
- `.codex/skills/scoring-agent/patterns.json` — `scope` 필드 추가(또는 scope-agent 전용 정책 파일).
- `scripts/commands/` — `--apply` 경로(score/heal 동형) 또는 analyze-hook 통합.

## Tests
- `resolver-score` 단위: A만/B만/A·B 둘다 × 안정/휘발 조합 → confidence 매트릭스 (fail-safe 포함).
- `locator-capture` 단위: scope 규칙(ancestorUp/includeAncestorSiblingText)대로 harvest (삼촌 텍스트 포함 케이스).
- compile 통합: signal-poor 게이트 발화 + policy 적용 → step.locator에 scope/weights 반영.
- scope-agent 합성: 가짜 스냅샷(빈 p + 삼촌 앵커) → 올바른 scope 규칙 산출.
- e2e: Keep 동형 fixture(빈 presentation 3개 중 하나만 삼촌 앵커) capture→analyze(scope-agent)→verify 완주.

## Open forks / 검증 (해보면서 결정)
- **scope 규칙 표현력**: `ancestorUp+siblingText`로 대부분 커버되나, aria-labelledby(화면 반대편 참조) 같은 비-구조적 연결은 별도 규칙 필요할 수 있음 — 실측 후 확장.
- **단위 묶음 커버율**: 사용자 결정 "해보면 된다" — Keep 재캡처 + 2~3개 실사이트로 검증.
- **scope-agent 통합 위치**: 기존 scoring-agent(가중) 확장 vs 별도 scope-agent. 가중과 scope를 한 모델이 같이 내는 게 자연(한 판단)이나, 계약 단순성 위해 분리할 수도 — 구현 시 결정.
- **트리거 정밀도**: signal-poor 게이트 느슨/빡빡 균형 (과다 dispatch vs 누락).

## Anchors
- 상위/이웃 spec: `2026-05-21-scored-resolver-design.md`, `2026-05-21-scoring-agent-weightoverride-design.md`, `2026-05-22-reactive-scoring-loop-design.md`.
- 외부 ref: Similo arXiv:2208.00677 / VON-Similo arXiv:2505.16424 (`docs/research-applied.md §2`).
- 패턴: heal-agent `.codex/skills/heal-agent/SKILL.md`(내부 sub-agent), variable-agent(analyze-hook 모델).
- lessons(2026-05-22): scope=모델 결정 / scope-agent vs heal-agent / neighborTexts shallow harvest = redefine-miss / Keep full-loop 결과.
- roadmap: `docs/roadmap.md`("Why this model" force #1 꼬임 문제 — 리졸버 강건성).
