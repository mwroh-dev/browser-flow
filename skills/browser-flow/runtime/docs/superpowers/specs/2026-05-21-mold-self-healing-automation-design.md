# 빵틀 (Mold) — Evidence-Driven Self-Healing Automation: North-Star Design

**Status:** proposed (north-star; decomposes into multiple phases)
**Date:** 2026-05-21
**Supersedes direction of:** Phase 82 "visual layer" (folded in as one optional evidence/heal signal, not a standalone deterministic rung)

## 사용자 원문 quote (paraphrase 금지 — 설계의 출처)

> "80%의 비용을 줄이면서 자동화를 할수있는게 목표"

> "빵틀과 같은거라고 생각함. 만약 이 웹 서비스가 디자인이 바뀌었다고 하면 우리가 만든 빵틀을 넣엇을떄 깨진다? 하면 그때는 llm model 추론이 page node 기반으로 벌어지는 단계로 가는거지."

> "f1 레이스를 하다보면 결국 피트인을 하는데 레이스는 달리고 있고, 피트인을 해서 수정하고 다시 진행하는것 과 마찬가지" / "꽃이 피고 비가 와도 수풀이 쌓여도 레이싱은 간다"

> "증거가 잇으면 그대로 존재하면 달린다, 증거가 없으면 그때 판단한다. 그때 이전 빵틀과 비교해서 무엇이 바뀌었다 를 추론"

> "각 오토메이션 단계별로 state 을 문서로 기록하는 과정이 필요 … 나중에 dangling data 을 찾아서 없애야"

> "중간 연결고리만 수정하고 뒷 연결고리는 제대로 작동할수잇기 때문"

## 1. Goal

캡처한 자동화 흐름을 **80%는 결정론(모델 0, 싸게) 재현**하고, 사이트 디자인/구조가 바뀌어 깨지는 **20%만 LLM이 page-node 구조를 보고 heal**하는 hybrid 자동화. 순수 결정론 verify가 아니라 *결정론 fast-path를 가진 robust 자동화*가 목표.

## 2. Core principle — evidence-first, model-on-drift

핵심 전환(설계의 심장): **"변경됐나?"를 *구조 동일성*이 아니라 *결과 증거*로 판정.**
- 증거(의도한 결과)가 나오면 → 구조가 어떻게 바뀌었든 **그냥 달린다**(레이싱 계속). cosmetic/구조 변화 무시.
- 증거가 안 나오면 → 그때만 **pit-in**: 멈추고(hold) 모델이 진단·heal 후 재개.

이로써 "초기 렌더 언제 끝/하이드레이션/어떤 DOM diff가 drift냐"라는 정의 문제를 *우회*한다(결과만 보므로). 임계는 *구조 diff*가 아니라 *증거 충분성*으로 이동한다(§8).

## 3. Paradigm position

| | record→replay 결정론 (우리 기존) | agentic LLM (browser-use/Stagehand/vercel) | **빵틀 hybrid (이 spec)** |
|---|---|---|---|
| run당 비용 | 0 | 매 run LLM | 80% 0 / 20% LLM |
| 변화 강인성 | 약함(깨짐) | 강함 | 강함(drift시 heal) |
| 결정성 | 높음 | 낮음 | 높음(증거 통과 시) |

성숙 도구의 패턴(LLM resolve → 결과 캐시 → 결정론 replay; Stagehand observe→cache)을 우리 자산 위에 구현하되, **트리거를 "증거 실패"로** 둔다.

## 4. Data model — 이중화 (dual storage per page-node)

각 page-node가 **두 가지**를 보관 (page별로 지님):

1. **Evidence schema (primary, 런타임 상시 체크)** — segment의 *의도가 달성됐다는 증거*. 기존 verify 게이트 재사용: `resultEvidence`(selector+text), `transitionChecks`(URL/affordance 출현), `expectedNetwork`, path-mismatch(text/href/fieldName). **per-segment**으로 확장(어느 segment가 drift났는지 특정).
2. **Structural mold (secondary, 실패 시 *진단 diff*용)** — affordance/role skeleton (role=textbox 2개, button "생성", list … — visibility/expand/class/text 무시한 *의미 골격*). 상시 대조 ❌; 증거 실패 시 *이전 mold vs 현재 live*를 비교해 "무엇이 바뀌었나"를 모델에게 제공.

추가 필드:
3. **Segment 의도 + 기준점 (LLM first-read grounding)** — "이 segment는 노트 제목을 입력하고 생성한다 / 제목 필드의 식별 증거 세트는 {label|placeholder|input + 동반 이벤트}". 동형 요소(Keep title/body)는 `low-confidence` 마킹 → 도착 시 모델 우선.
4. **Dependency edges (Phase 63)** — segment 간 데이터 의존(앞 출력 → 뒤 입력). partial degradation의 절개선.

기존 자산 매핑: page-node graph(36) = 보관소, atomic-fp(60) = 요소 anchor 신호, segments(61b) = heal/degradation 단위, inputs/variable-agent(61) = 의미/기준점.

## 5. Execution engine — write-ahead journal + evidence gates + pit-in

실행은 segment 단위로 진행하며, **mutating 동작 전에 write-ahead state journal**을 남긴다:

```
for each segment:
  journal.write({ segment, intent, about_to: <action+inputs>, status: "in-progress" })   # WRITE-AHEAD (mutate 전)
  run segment deterministically (resolveLocator ladder — Phase 81)
  check evidence gate (per-segment)
  if evidence PASS:
     journal.mark(status: "done", created: <artifacts e.g. __bf_test__ name>)
     continue   # 레이싱 계속, 모델 0
  else:  # DRIFT — pit-in
     journal.mark(status: "incomplete")
     HOLD (mutate 더 진행 금지 — safety, Phase 76)
     → heal loop (§6)
```

- **write-ahead가 필수**: 동작 *후* 기록이면 "생성 직후 크래시"한 dangling을 놓침(DB WAL 규율). journal이 dangling cleanup(§7)의 단서.
- **hold = pit-in**: 앞단에서 전 경로를 모델이 미리 순회 ❌ (중간 페이지 진입에 *생성*이 필요 → 실데이터 오염). 도착 시점에만 점검/heal.

## 6. Heal loop — evidence 실패 시

1. journal + segment 의도/기준점 로드.
2. **이전 mold vs 현재 live page-node diff** 계산 → "무엇이 바뀌었나"(secondary mold의 유일한 사용처).
3. 외부 agent(LLM)에 {segment 의도, 기준점 증거세트, mold diff, live 구조/AX/(옵션)스크린샷} 제공 → 판독:
   - ✅ **디자인 변경, 의도 달성 가능** → 새 locator로 heal → segment 재실행 → 증거 재확인 → 재개. healed locator를 mold에 캐시(self-heal). 다음부터 다시 결정론.
   - ❌ **기능 자체 소멸** → 그 segment를 `partial-incomplete`로 마킹. **중간 링크만 끊김; 구조적으로 독립인 뒷 segment는 계속**(단 §7 의존 cascade 확인).
4. (옵션) 스크린샷/visual은 *별도 결정론 rung*이 아니라 *모델에게 주는 한 증거/컨텍스트*로 흡수 — 동형 요소(title/body) disambiguation에 사용.

## 7. Partial degradation + dangling-data cleanup

- **절개선 = dependency edges (Phase 63)**: segment 4의 input이 segment 3의 출력에 의존(chaining/pipe)이면, 3이 깨지면 4도 *데이터 의존*으로 함께 절개(cascade). 구조적 독립이면 뒤는 그대로.
- **Dangling cleanup = journal + teardown + dependency**: journal이 "무엇을 만들었나"(중간 생성물, `__bf_test__` 등) 기록 → abort/partial 시 Phase 78/79 self-cleaning(teardown recipe + findDummies sweep + orphan recovery)을 **journal 기반 멀티스텝으로 확장**해 dangling 제거. 최악 시나리오(10페이지, 중간 생성, 10번째 실패)를 이 원장이 회수 가능케 함.

## 8. Resolved hard decisions

- **(a) 초기-렌더 baseline 정의 문제 → 우회**: 구조 스냅샷 대신 *결과 증거*로 판정하므로 "언제의 DOM이냐"가 불필요.
- **(b) 무엇을 비교하나 → affordance/role skeleton** (mold diff 시에만; visibility/class/text 무시).
- **(c) partial degradation 안전 → dependency-graph 선행 필수**(Phase 63).
- **증거 충분성 튜닝 → 수용 + 실패 주도 반복**: 이미 ~80% 추론된 수준에서 증거 잡고, 실패 시 그 부분만 보강. 사전 완벽 calibrate 시도 안 함. (thin→false pass / rich→false drift 균형은 false-positive-guard 계열의 영구 과제로 인정.)

## 9. Builds on (existing assets)

page-node graph(36) · atomic-fp(60) · inputs/variable-agent(61) · segments(61b) + dependency-graph(63, 계획→이제 prerequisite) · safety irreversible-skip+hold(76) · self-cleaning/teardown/orphan(77-79) · **layered resolver(81, = 결정론 fast-path)** · breadth-search(79 north-star, = mold 구조 구축).

## 10. Phase decomposition (north-star → 점진)

1. **per-segment evidence gates + write-ahead state journal + drift-hold** — 결정론만으로 "drift에서 멈추고 dangling을 추적"(LLM 없이 가치). 
2. **dependency-graph (Phase 63 완성)** — 절개선 + cascade + journal-기반 dangling cleanup.
3. **structural mold(affordance skeleton) capture + 이전/현재 diff** — heal 진단 입력.
4. **LLM 기준점(first-read grounding) + pit-in heal loop** — 외부 agent seam(authoring + drift-시 런타임). partial-incomplete 판정.
5. **breadth-search로 mold 구조 풍부화** + visual을 heal 컨텍스트로 흡수.

각 phase는 단독으로 testable + 가치 산출.

## 11. Out of scope / known limits

- 매 run 전체를 LLM이 재추론하는 full-agentic(paradigm B)는 아님 — 80% 결정론 유지가 비용 목표.
- 증거가 본질적으로 관측 불가한 동작(부수효과 없는 순수 read)은 evidence-thin → false-pass 위험 잔존.
- LLM seam의 비용/지연/비결정성은 20%(drift)에 국한.

## 12. Open questions (spec self-review에서 결정)

1. State journal의 저장 위치/포맷(per-run artifact vs 별도 ledger) + agent-blind(자격증명 미기록) 준수.
2. per-segment evidence를 기존 단일 verification 게이트에서 어떻게 분해하나(segment 경계 = page-node).
3. heal 시 LLM seam 형태(외부 agent 호출 규약) — 런타임 drift에서 어떻게 invoke하나(현재 런타임 LLM 없음).
4. "기능 소멸" 판정의 신뢰도(이동/개명 vs 진짜 제거 구분).
