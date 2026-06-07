# Active Exploration — Replay-based Read-only Graph BFS: Design

**Status:** approved (brainstorm 2026-05-21). The *active half* of roadmap "근본 못한 것 #2"; builds on Phase 87 (read-only enrichment).
**Date:** 2026-05-21
**Related:** `docs/roadmap.md` (force #1 꼬임), `docs/superpowers/specs/2026-05-21-breadth-search-readonly-enrichment-design.md`.

## 사용자 원문 quote (paraphrase 금지 — 설계 결정의 출처)

> "결국 해당 페이지에서 연결된 지점이 무엇이냐 레벨수준으로 하면 된다고 생각함. … 뎁스 탐색을 할때는 2뎁스까지 하되 readonly 를 하고"

> "데이터를 오염시키는 create, update, delete 에 대해서는 결국 그 지점을 유저가 요청할때만 충족하면 된다 … 저게 무엇인지는 이미 리스트업이 되어잇지만 … 각 페이지별로 state 을 가지고 잇다가 나중에 c u d 을 할때 채우면 된다"

> "뒤로가기 라던지 그런게 문제가 될수잇으니 제일 좋은건 역시 시작지점에서부터 리플레이를 하면서 하는게 맞다"

## 1. Goal

캡처가 걸은 한 경로를 넘어, page-node graph를 **너비로 확장**한다 — 각 page-node에서 *안전한(navigational/read-only) affordance*를 실제로 클릭해 그 목적지(새 page-node/edge)를 발견. **2뎁스**까지. **CUD(create/update/delete) affordance는 탐색 때 누르지 않고** 목적지 미지 상태로 기록만 하며, *유저가 그 CUD를 실제 요청할 때* lazy하게 채운다(이 phase 범위 밖, 기록만). 포크 복귀는 **시작점부터 replay**. 이게 roadmap 꼬임 force #1의 active 절반(graph edge breadth).

성격: "active"지만 CUD를 빼므로 사실상 **replay 기반 read-only 그래프 확장**. read-only 열거(Phase 87)와 달리 *클릭/네비게이션을 실제로 함*.

## 2. Decisions locked (brainstorm 2026-05-21)

1. **depth = 2.** 각 페이지에서 연결된 지점 2레벨까지.
2. **탐색은 navigational(read-only) affordance만 클릭.** CUD는 page-node state에 "destination 미지" edge로 기록만(Phase 87 skeleton에 이미 리스트업). 목적지 채우기는 유저-요청 CUD 시 lazy(이 phase 밖).
3. **포크 복귀 = seed부터 replay.** 분기 N을 탐색하려면 seed에서 그 노드까지의 *click-prefix*를 다시 replay해 도달 후 N 클릭. (뒤로가기/URL점프의 상태 비재현 회피.)
4. **분류기 보수적.** "확실히 read-only navigation일 때만 클릭, 애매하면 CUD로 취급해 안 누름"(false-safe=사고 / false-CUD=덜 탐색 → 후자가 안전한 실패). safety-hold(76)의 비가역 분류기를 *클릭 전 게이트*로 재사용. dangling-cleanup(84)을 backstop.
5. **synthetic-first.** 분기 구조가 알려진 fixture로 메커니즘(2뎁스 BFS + replay복귀 + 분류 + 종료)을 결정론적 검증("발견 graph == 기대 graph"). 실사이트는 후속.

## 3. Architecture — components

### (a) affordance classifier (pure)
`classifyAffordance({role, name})` → `"navigate" | "cud" | "skip"`.
- `cud`: name이 CUD/비가역 키워드 매치(delete/remove/저장/save/add/추가/send/보내기/pay/결제/구독/apply/적용/submit … safety-hold 키워드 재사용·확장). **보수적: 매치 or 애매 → cud(안 누름).**
- `navigate`: role=link 또는 href 있는 a, 또는 명백 네비 텍스트(open/view/상세/보기/탭/필터 등)로 *확신*될 때만.
- `skip`: 입력/비interactive 등 탐색 대상 아님(textbox, 이미 방문 등).
순수·키워드 기반 → Node 단위 테스트. (safety-hold 분류기와 공유/확장.)

### (b) explorer driver (CDP-direct)
`scripts/explore/explorer.mjs` — BFS 오케스트레이터.
- frontier: `{pageKey, clickPrefix: Affordance[]}` 큐. visited: `Set<pageKey>`. depth 카운트.
- 각 frontier 노드에 대해: **seed 네비 → clickPrefix replay(resolveLocator로 각 affordance 클릭) → 현재 페이지 skeleton 열거(__bfAffordanceSkeleton)**.
- skeleton의 각 affordance를 classify:
  - `navigate` & depth<2: **seed부터 clickPrefix+이 affordance를 replay-click → 도달 URL→pageKey 관찰**. 새 pageKey면 edge 기록 + frontier에 push(clickPrefix 연장). 이미 visited면 edge만(cycle skip).
  - `cud`: edge를 `destination=null, kind:"cud"`로 기록(클릭 안 함).
- 종료: depth≤2, visited 재방문 skip, page-node당 navigate 클릭 cap, 전체 budget(횟수/시간).
- 재사용: createBrowserSession, action(click), lifecycle(navigate), locator-capture(`__bfAffordanceSkeleton`), cdp/locator-resolver(`resolveLocator`로 affordance 클릭), classifier.

### (c) command
`scripts/commands/explore.mjs` — `bf explore --fixture <branchy> --depth 2` (synthetic-first; 실사이트는 후속에 `--run-id`/`--url`). explorer 실행 → 발견 graph를 persist → 요약 리턴.

### (d) graph persistence
발견된 edge를 page-node `neighbors.json`(기존 edge store)에 기록: `{to: <pageKey>, via: {role,name,structuralKey}, kind: "navigate"}` 또는 `{to: null, via, kind: "cud"}`. 새 page-node 디렉토리에 skeleton(mold.json) 기록(Phase 87 형식 재사용). agent-blind(role/name/key만).

### (e) safety
classifier 클릭 전 게이트(CUD 제외) + synthetic-first(변이 위험 0) + dangling-cleanup(84) backstop(navigate가 의외로 부작용 시). 실사이트 전환 시 safety-hold/self-cleaning 총동원(후속).

## 4. Data flow

```
bf explore --fixture explore --depth 2
  frontier = [{pageKey: seed, clickPrefix: []}]
  while frontier and depth<=2:
    node = dequeue; visited.add(node.pageKey)
    navigate(seed); replay(node.clickPrefix)         # 포크 복귀
    skeleton = __bfAffordanceSkeleton()
    for aff in skeleton:
      c = classifyAffordance(aff)
      if c=="navigate" and depth<2:
        navigate(seed); replay(node.clickPrefix); click(aff)   # 분기 클릭
        dest = pageKeyOf(currentUrl)
        record edge node.pageKey --aff--> dest
        if dest not in visited: enqueue {dest, clickPrefix+[aff]}
      elif c=="cud":
        record edge node.pageKey --aff--> (null, "cud")    # 클릭 안 함
  persist edges→neighbors.json, new nodes→skeleton/mold
```

## 5. Components / 파일 (예상)

- `scripts/lib/affordance-classifier.mjs` + test — `classifyAffordance` (safety-hold 키워드 공유).
- `scripts/explore/explorer.mjs` + test — BFS 오케스트레이터(순수 로직은 단위테스트, CDP 부분은 e2e).
- `scripts/commands/explore.mjs` + `cli.mjs` 등록 + test.
- `scripts/fixtures/site-server.mjs` — `explore` fixture: 알려진 2뎁스 graph(허브 → navigate 링크 N개 → 서브페이지) + CUD 버튼 1개(분류기가 skip 확인용).
- `neighbors.json` 기록 — 기존 store에 `via`/`kind` 필드 추가(additive).
- Tests: classifier unit, explorer BFS unit(순수: frontier/visited/depth/cycle), explore command, e2e(real Chrome: explore fixture → 발견 graph == 기대 graph + CUD 미클릭).

## 6. Testing strategy

- **classifier unit**: navigate/cud/skip 분류 — CUD 키워드(저장/삭제/결제…) → cud, 명백 네비(상세/보기/href) → navigate, 애매("적용") → cud(보수적). false-safe 없음 검증.
- **explorer unit**: 순수 BFS 로직(주입된 가짜 navigate/skeleton 함수로) — depth 2 종료, visited cycle skip, clickPrefix 연장, cud는 클릭 호출 0회.
- **e2e (real Chrome)**: `explore` fixture(알려진 graph)를 `bf explore --depth 2` → 발견 edge/node가 *기대 graph와 일치* + CUD 버튼은 edge에 `kind:"cud", to:null`로 기록되고 *클릭 안 됨*(fixture가 클릭 시 카운트/상태변경하는데 안 변함으로 확인) + 2뎁스 초과 미탐색. hard timeout + Singleton 정리. 단일 파일 `--import=./tests/_setup.mjs`.

## 7. Builds on

page-node graph/`neighbors.json`(36) · `__bfAffordanceSkeleton`(85.1/87) · `mold.json`(85/87) · cdp/locator-resolver `resolveLocator`(81) · action/lifecycle watchdog(66) · safety-hold 비가역 분류기(76) · dangling-cleanup(84) · demo-driver CDP 패턴(71).

## 8. Out of scope → 후속

- **실사이트 active 탐색**: synthetic 메커니즘 검증 후. safety-hold/self-cleaning 총동원 + 실사이트 변동성.
- **CUD destination lazy-fill**: 유저가 CUD를 실제 요청할 때(consent + self-cleaning) 목적지 채우기. 이 phase는 *기록(kind:cud, to:null)*만.
- **depth>2**, staleness, visual, cross-flow primitive 재사용(roadmap force #3).

## 9. Open questions (writing-plans/구현에서 결정)

1. classifier 키워드 출처: safety-hold 분류기 함수 직접 재사용 vs 키워드 집합 공유 모듈로 추출(both 소비). 보수 기본값(애매→cud) 위치.
2. clickPrefix replay 시 affordance 재-resolve 실패(동적 페이지) 처리: skip + 기록 vs 탐색 중단. (synthetic은 안정적이라 v1은 skip+log.)
3. `neighbors.json` 스키마 확장(`via`/`kind`) 정확한 형태 + 기존 `outgoing`(Phase 36)과의 병합 규칙.
4. budget 기본값(page-node당 navigate cap, 전체 클릭/시간 상한) — synthetic 기준.
5. explore fixture의 정확한 graph 형태(노드/링크/CUD 버튼 수) — 결정론적 기대 graph 작성.
