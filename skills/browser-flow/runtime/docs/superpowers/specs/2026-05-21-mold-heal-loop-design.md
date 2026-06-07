# 빵틀 Heal Loop — Model-Intervention Half: Design

**Status:** approved (sub-design of the north-star; deterministic half = Phases 82–84 done).
**Date:** 2026-05-21
**Parent spec:** `docs/superpowers/specs/2026-05-21-mold-self-healing-automation-design.md`

## 사용자 원문 quote (paraphrase 금지 — 설계 제약의 출처)

> "llm api 로 호출하면 안됨. 나는 api key 가 없고 claude -p, codex spawn 이런걸 쓸 생각이 없음. 혹시나 중간에 llm 을 호출한다고하면 해당 에이전트 시스템 내부의 서브 에이전트를 호출해서 해야함."

> "b 로 하게 되면 없는걸 가지고 끊임없이 디깅하다가 무한루프에 빠질수잇으니까" (런타임 인라인 모델 = 무한루프 위험)

> "cleanup + 전체 재실행" (heal 후 재개 = 부분 resume 아님)

## 1. Goal

빵틀 north-star의 *모델 개입 절반*: 자동화가 drift로 hold됐을 때(Phase 82), 모델이 page-node 구조를 보고 깨진 segment를 **heal**(재mapping)하거나 **partial-incomplete**로 판정. 결정론 절반(82-84) 위에 얹는다. 80% 결정론 유지, 20%(drift)만 모델.

## 2. Heal seam — A: 외부(at-pit) 내부 sub-agent, bounded

- **런타임은 LLM-free 유지.** runner는 drift 시 **heal-request 아티팩트** `{heldSegment 의도, mold diff(old vs live), live page-node 스냅샷}`를 떨구고 halt(기존 held 리포트 확장).
- **모델 invoke = 이 에이전트 시스템 *내부 sub-agent***(Task/Agent dispatch — variable-agent/capture-driver/spec-agent와 동일). **외부 LLM API / `claude -p` / `codex spawn` 금지(API key 없음).**
- **bounded 결정**: heal-agent는 `healedLocators` *또는* `{status: partial-incomplete}` 둘 중 하나만 반환. 런타임 retry 루프 없음 → "없는 걸 끊임없이 디깅" 무한루프 회피.

## 3. Mold capture + diff (deterministic — heal-request 입력)

- capture 시 각 page-node가 **affordance skeleton** 저장: 초기 렌더의 interactive affordance 집합 `{role, accessible-name, structuralKey}`. visibility/class/text 무시(동적 변화 관대).
- drift 시 **old-skeleton vs live diff** 계산: appeared / disappeared / changed. 이게 sub-agent가 "제목 필드가 옮겨졌다/이름 바뀜"을 추론하는 *구조화된 입력*.
- 이중화(parent spec §4)의 secondary mold가 여기서 유일하게 사용됨(상시 대조 아님, 실패 시 진단 diff).

## 4. heal-agent (sub-agent skill — 모델 부분)

- `.codex/skills/heal-agent/SKILL.md` (variable-agent 패턴). 입력: heal-request(의도 + diff + live). 출력 JSON: held segment 타깃의 healed `locator`(Phase 81 locator 형식) **또는** `{status: "partial-incomplete", reason}`.
- 코드는 LLM 호출 안 함 — 에이전트 시스템이 skill을 dispatch, skill이 추론, 코드가 결과를 적용. (Phase 61b variable-agent와 동일 분업.)
- "기능 소멸"(partial-incomplete) 판정은 sub-agent의 bounded 출력 — 이동/개명(heal) vs 진짜 제거(gone) 구분은 sub-agent 책임.

## 5. Orchestration — resume = cleanup + 전체 재실행

```
bf verify → drift-hold (held 리포트 + heal-request 아티팩트)
  → bf cleanup (Phase 84: 부분 런의 dangling 제거 = 깨끗한 상태)
  → orchestrator가 heal-agent sub-agent dispatch
  → healedLocators를 workflow에 apply (self-heal 캐시 — 다음엔 결정론)
  → 전체 재실행 (self-cleaning이 재생성 안전하게 만듦, 중복 없음)
  → partial-incomplete면: 그 segment 표시 + Phase 83 dependency cascade로 영향 범위 산정;
    데이터 독립 downstream은 그대로 재실행.
```
부분 resume(journal로 held부터)은 *채택 안 함* — "중간 페이지 진입에 생성 필요" 케이스를 cleanup+전체재실행이 self-cleaning으로 안전하게 해결(부분 resume의 mutation/navigation 구분 복잡성 회피).

## 6. Phase decomposition (이 절반은 한 phase에 안 들어감)

- **Phase 85 — structural mold capture + old-vs-live diff** (결정론, LLM 0): affordance-skeleton을 page-node graph에 capture + `mold-diff` lib + drift-hold 시 heal-request 아티팩트 emit. 단독 testable, heal의 입력을 셋업.
- **Phase 86 — heal-agent skill + heal-apply + (cleanup→heal→re-run) orchestration** (모델 개입). heal-agent SKILL.md + healed locator를 workflow에 쓰는 apply 코드 + 오케스트레이션(스킬/문서). synthetic mode로 heal-agent 테스트.
- (후속) breadth-search로 mold 풍부화 + visual을 heal 컨텍스트로.

## 7. Builds on

page-node graph(36) · atomic-fp(60) · variable-agent 패턴(61b) · segments(61b) · dependency-graph(83) · safety-hold(76) · drift-hold+journal(82) · dangling cleanup(84) · **layered resolver/locator(81)** = healedLocators 형식 + replay rung.

## 8. Out of scope / known limits

- 런타임 인라인 모델(무한루프 위험) 금지. 외부 LLM API/CLI-spawn 금지.
- heal는 *재실행* 비용 동반(live 연속 아님) — 자동화/verify에선 수용.
- affordance skeleton이 동형 요소(Keep title/body)를 완전 구분 못 할 수 있음 → heal-agent가 diff+live로 disambiguate(visual은 후속 컨텍스트).
- heal-agent "gone" 오판(이동을 제거로) 가능 — partial-incomplete는 보수적, 사용자/재캡처로 교정.

## 9. Open questions (writing-plans/구현에서 결정)

1. heal-request 아티팩트 위치/포맷(run artifact) + agent-blind(자격증명 미포함) 준수.
2. affordance skeleton "초기 렌더" 캡처 시점(daemon settle window) — Phase 85에서 결정.
3. heal-apply가 workflow의 어느 필드를 갱신하나(step.locator 교체 + mold 갱신).
4. orchestration이 스킬 문서(heal-agent SKILL.md)인가 별도 command(`bf heal`)인가 — Phase 86에서 결정.
