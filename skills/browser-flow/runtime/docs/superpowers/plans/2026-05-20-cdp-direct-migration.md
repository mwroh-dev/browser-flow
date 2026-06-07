# CDP-Direct Full-Extreme Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** browser-flow를 Playwright-on-CDP에서 raw Chrome DevTools Protocol로 전면 전환. observe + analyze + generate + 산출되는 runner.mjs 모두 CDP-direct. 9개 forward 축 이점 회복 (auto-attach / raw network / lifecycle / 프록시 / ARIA tree / cross-origin / click ladder / 다운로드 / PDF).

**Architecture:** browser-use 패턴 적응. 얇은 CDP 클라이언트 + SessionManager(`Target.setAutoAttach(flatten=True)`) + 단일-책임 Watchdog (network/lifecycle/dom/action/screenshot/proxy-auth/download) 위에 `BrowserSession` façade. observer-daemon, generate-runner, verify-run 모두 façade 호출. Playwright는 runtime deps에서 제거, devDependency로만 유지 (chromium 바이너리 조달 `npx playwright install chromium` 용).

**Tech Stack:** `chrome-remote-interface` (CDP 클라이언트, JSON-RPC over WebSocket, 성숙, runtime dep), `devtools-protocol` (Chrome 공식 타입 정의, `.d.ts`-only — devDependency), Node `node --test` (기존 테스트 러너, concurrency=1), TypeScript strict + JSDoc checkJs (기존 설정 유지).

**Acceptance:** 228 + 신규 tests pass, `npm run check` green, Playwright 의존 코드 0건 (`grep "from \"playwright\"\|chromium\."` empty), runner.mjs는 우리 CDP helper만 import. 사용자 정의 "full extreme + 빠짐없이" 준수 — narrow reframe 금지 (lessons.md 196-200줄 경계).

**Tier 1 손실 (수용)**:
- runner.mjs는 더 이상 Playwright 코드가 아님 — 사용자가 읽고 수정하는 산출물이지만 우리 helper API (`session.click(stepLocator)` 형태) 위에 박힘
- Phase 60 atomic-fp Locator chaining 코드 → AX-tree + backend_node_id 기반 resolver로 재작성
- 53 phase 누적 test suite Playwright API 의존부 (`page.click`, `page.locator`, `chromium.connectOverCDP`) 마이그레이션

**Phase 매핑 (project 컨벤션):** 이 plan의 Section A-I는 project의 Phase 64-72에 1:1 매핑. 각 Section commit 직후 `tasks/phases/phase-NN-*.md` 산출 (Section 첫 task에 포함).

---

## Section A — Foundation: CDP client + SessionManager

목적: Playwright 없이 Chrome에 connect하고 multi-target/multi-session을 관리하는 인프라.

### Task A1: 의존성 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 의존성 추가**

```bash
npm install chrome-remote-interface@^0.33.0
npm install --save-dev devtools-protocol@^0.0.1352000 @types/chrome-remote-interface@^0.31.14
```

- [ ] **Step 2: 설치 검증**

Run: `node -e "import('chrome-remote-interface').then(m => console.log(typeof m.default))"`
Expected: `function` 출력. CRI ESM import 가능 확인.

- [ ] **Step 3: typecheck 통과**

Run: `npm run typecheck`
Expected: 기존 0 error 상태 유지.

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "phase 64a: add chrome-remote-interface + devtools-protocol deps for CDP-direct migration"
```

### Task A2: CDP client wrapper

**Files:**
- Create: `scripts/cdp/client.mjs`
- Create: `tests/cdp/client.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

`tests/cdp/client.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForPort } from "../../scripts/lib/net.mjs";
import { connectCdpClient } from "../../scripts/cdp/client.mjs";

test("connectCdpClient connects over CDP and exposes send()", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "cdp-client-"));
  const debugPort = 9333;
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"
  ], { stdio: "ignore" });
  try {
    await waitForPort(debugPort, 15_000);
    const client = await connectCdpClient({ host: "127.0.0.1", port: debugPort });
    const { browserContextIds } = await client.send("Target.getBrowserContexts", {});
    assert.ok(Array.isArray(browserContextIds));
    await client.close();
  } finally {
    chrome.kill("SIGTERM");
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/client.test.mjs`
Expected: FAIL — `Cannot find module '../../scripts/cdp/client.mjs'`.

- [ ] **Step 3: 최소 구현**

`scripts/cdp/client.mjs`:
```js
import CDP from "chrome-remote-interface";

/**
 * @typedef {Object} CdpConnectOptions
 * @property {string} [host]
 * @property {number} port
 * @property {string} [target] — webSocketDebuggerUrl. 생략 시 /json/version 폴링.
 */

/**
 * @typedef {Object} CdpClient
 * @property {<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<T>} send
 * @property {(event: string, handler: (params: unknown, sessionId?: string) => void) => () => void} on
 * @property {() => Promise<void>} close
 */

/**
 * @param {CdpConnectOptions} options
 * @returns {Promise<CdpClient>}
 */
export async function connectCdpClient(options) {
  const cri = await CDP({
    host: options.host ?? "127.0.0.1",
    port: options.port,
    target: options.target,
    local: true
  });

  return {
    async send(method, params = {}, sessionId) {
      return await cri.send(method, params, sessionId);
    },
    on(event, handler) {
      cri.on(event, handler);
      return () => cri.removeListener(event, handler);
    },
    async close() {
      await cri.close();
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/client.test.mjs`
Expected: PASS. (Chrome 경로가 다른 환경이면 환경변수 `BROWSER_FLOW_CHROME_PATH`로 override — 다음 task에서 일원화).

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/client.mjs tests/cdp/client.test.mjs
git commit -m "phase 64a: CDP client wrapper (connectCdpClient) over chrome-remote-interface"
```

### Task A3: Chrome 바이너리 탐색 helper (Playwright cache fallback)

**Files:**
- Create: `scripts/cdp/chrome-binary.mjs`
- Create: `tests/cdp/chrome-binary.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/chrome-binary.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolveChromeBinary } from "../../scripts/cdp/chrome-binary.mjs";

test("resolveChromeBinary returns an existing executable path", () => {
  const path = resolveChromeBinary();
  assert.ok(path, "expected a non-empty path");
  assert.ok(existsSync(path), `expected ${path} to exist`);
});

test("resolveChromeBinary respects BROWSER_FLOW_CHROME_PATH override", () => {
  const original = process.env.BROWSER_FLOW_CHROME_PATH;
  process.env.BROWSER_FLOW_CHROME_PATH = "/tmp/fake-chrome-binary-does-not-exist";
  try {
    assert.throws(() => resolveChromeBinary(), /BROWSER_FLOW_CHROME_PATH/);
  } finally {
    if (original === undefined) delete process.env.BROWSER_FLOW_CHROME_PATH;
    else process.env.BROWSER_FLOW_CHROME_PATH = original;
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/chrome-binary.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`scripts/cdp/chrome-binary.mjs`:
```js
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

/**
 * @returns {string}
 */
export function resolveChromeBinary() {
  const override = process.env.BROWSER_FLOW_CHROME_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`BROWSER_FLOW_CHROME_PATH=${override} does not exist`);
    }
    return override;
  }

  for (const candidate of SYSTEM_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }

  const playwrightCache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(playwrightCache)) {
    for (const entry of readdirSync(playwrightCache)) {
      if (entry.startsWith("chromium")) {
        const macPath = join(playwrightCache, entry, "chrome-mac/Chromium.app/Contents/MacOS/Chromium");
        if (existsSync(macPath)) return macPath;
        const linuxPath = join(playwrightCache, entry, "chrome-linux/chrome");
        if (existsSync(linuxPath)) return linuxPath;
      }
    }
  }

  throw new Error(
    "Chrome/Chromium binary not found. Set BROWSER_FLOW_CHROME_PATH or run `npx playwright install chromium`."
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/chrome-binary.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/chrome-binary.mjs tests/cdp/chrome-binary.test.mjs
git commit -m "phase 64a: Chrome binary resolver (system + Playwright cache fallback)"
```

### Task A4: SessionManager — Target.setAutoAttach(flatten=true) 기반 target/session 풀

**Files:**
- Create: `scripts/cdp/session-manager.mjs`
- Create: `tests/cdp/session-manager.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/session-manager.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForPort } from "../../scripts/lib/net.mjs";
import { connectCdpClient } from "../../scripts/cdp/client.mjs";
import { createSessionManager } from "../../scripts/cdp/session-manager.mjs";
import { resolveChromeBinary } from "../../scripts/cdp/chrome-binary.mjs";

test("SessionManager attaches to existing page target and emits targetCreated", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "session-mgr-"));
  const port = 9334;
  const chrome = spawn(resolveChromeBinary(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"
  ], { stdio: "ignore" });
  try {
    await waitForPort(port, 15_000);
    const client = await connectCdpClient({ port });
    const mgr = await createSessionManager(client);

    const targets = mgr.listPageTargets();
    assert.ok(targets.length >= 1, "expected at least one page target");
    const target = targets[0];
    const sessionId = mgr.getSessionId(target.targetId);
    assert.ok(sessionId, "expected sessionId for page target");

    await client.send("Page.enable", {}, sessionId);
    const { result } = await client.send("Runtime.evaluate", { expression: "1 + 1" }, sessionId);
    assert.equal(result.value, 2);

    await mgr.dispose();
    await client.close();
  } finally {
    chrome.kill("SIGTERM");
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/session-manager.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: 구현**

`scripts/cdp/session-manager.mjs`:
```js
/**
 * @typedef {Object} TargetInfo
 * @property {string} targetId
 * @property {string} type
 * @property {string} url
 * @property {string} title
 */

/**
 * @typedef {Object} SessionManager
 * @property {() => TargetInfo[]} listPageTargets
 * @property {(targetId: string) => string | undefined} getSessionId
 * @property {(handler: (info: TargetInfo, sessionId: string) => void) => () => void} onPageAttached
 * @property {(handler: (targetId: string) => void) => () => void} onTargetDetached
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("./client.mjs").CdpClient} client
 * @returns {Promise<SessionManager>}
 */
export async function createSessionManager(client) {
  /** @type {Map<string, TargetInfo>} */
  const targetIdToInfo = new Map();
  /** @type {Map<string, string>} */
  const targetIdToSessionId = new Map();
  /** @type {Set<(info: TargetInfo, sessionId: string) => void>} */
  const attachedHandlers = new Set();
  /** @type {Set<(targetId: string) => void>} */
  const detachedHandlers = new Set();
  /** @type {Array<() => void>} */
  const off = [];

  off.push(client.on("Target.attachedToTarget", (params) => {
    const p = /** @type {any} */ (params);
    const info = {
      targetId: p.targetInfo.targetId,
      type: p.targetInfo.type,
      url: p.targetInfo.url,
      title: p.targetInfo.title
    };
    targetIdToInfo.set(info.targetId, info);
    targetIdToSessionId.set(info.targetId, p.sessionId);
    if (info.type === "page") {
      for (const h of attachedHandlers) h(info, p.sessionId);
    }
  }));

  off.push(client.on("Target.detachedFromTarget", (params) => {
    const p = /** @type {any} */ (params);
    const targetId = findTargetIdBySessionId(targetIdToSessionId, p.sessionId);
    if (targetId) {
      targetIdToInfo.delete(targetId);
      targetIdToSessionId.delete(targetId);
      for (const h of detachedHandlers) h(targetId);
    }
  }));

  off.push(client.on("Target.targetInfoChanged", (params) => {
    const p = /** @type {any} */ (params);
    const existing = targetIdToInfo.get(p.targetInfo.targetId);
    if (existing) {
      targetIdToInfo.set(p.targetInfo.targetId, {
        ...existing,
        url: p.targetInfo.url,
        title: p.targetInfo.title
      });
    }
  }));

  await client.send("Target.setAutoAttach", {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false
  });

  return {
    listPageTargets() {
      return Array.from(targetIdToInfo.values()).filter((t) => t.type === "page");
    },
    getSessionId(targetId) {
      return targetIdToSessionId.get(targetId);
    },
    onPageAttached(handler) {
      attachedHandlers.add(handler);
      return () => attachedHandlers.delete(handler);
    },
    onTargetDetached(handler) {
      detachedHandlers.add(handler);
      return () => detachedHandlers.delete(handler);
    },
    async dispose() {
      for (const cleanup of off) cleanup();
      attachedHandlers.clear();
      detachedHandlers.clear();
      targetIdToInfo.clear();
      targetIdToSessionId.clear();
    }
  };
}

/**
 * @param {Map<string, string>} map
 * @param {string} sessionId
 */
function findTargetIdBySessionId(map, sessionId) {
  for (const [targetId, sid] of map) {
    if (sid === sessionId) return targetId;
  }
  return undefined;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/session-manager.test.mjs`
Expected: PASS. Page target attached, session ID resolved, Runtime.evaluate에 1+1=2 응답.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/session-manager.mjs tests/cdp/session-manager.test.mjs
git commit -m "phase 64a: SessionManager — Target.setAutoAttach(flatten=true) target/session pool with attach/detach events"
```

### Task A5: BrowserSession façade — launch + connect + dispose 1줄 API

**Files:**
- Create: `scripts/cdp/browser-session.mjs`
- Create: `tests/cdp/browser-session.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/browser-session.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";

test("BrowserSession.launch starts Chrome, connects CDP, exposes sessionManager", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "browser-session-"));
  const session = await createBrowserSession({
    profileDir,
    debugPort: 9335,
    headless: true
  });
  try {
    assert.ok(session.client, "expected client");
    assert.ok(session.sessionManager, "expected sessionManager");
    const targets = session.sessionManager.listPageTargets();
    assert.ok(targets.length >= 1);
  } finally {
    await session.dispose();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/browser-session.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: 구현**

`scripts/cdp/browser-session.mjs`:
```js
import { spawn } from "node:child_process";
import { waitForPort } from "../lib/net.mjs";
import { resolveChromeBinary } from "./chrome-binary.mjs";
import { connectCdpClient } from "./client.mjs";
import { createSessionManager } from "./session-manager.mjs";

/**
 * @typedef {Object} BrowserSessionOptions
 * @property {string} profileDir
 * @property {number} debugPort
 * @property {boolean} [headless]
 * @property {string} [chromePath]
 * @property {string[]} [extraArgs]
 */

/**
 * @typedef {Object} BrowserSession
 * @property {import("./client.mjs").CdpClient} client
 * @property {import("./session-manager.mjs").SessionManager} sessionManager
 * @property {import("node:child_process").ChildProcess} chromeProcess
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {BrowserSessionOptions} options
 * @returns {Promise<BrowserSession>}
 */
export async function createBrowserSession(options) {
  const chromePath = options.chromePath ?? resolveChromeBinary();
  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-features=ChromeSigninPromo,SigninIntercept,ProfilePickerOnStartup",
    ...(options.extraArgs ?? []),
    "about:blank"
  ];
  if (options.headless) args.unshift("--headless=new");

  const chromeProcess = spawn(chromePath, args, { stdio: "ignore" });
  await waitForPort(options.debugPort, 15_000);

  const client = await connectCdpClient({ port: options.debugPort });
  const sessionManager = await createSessionManager(client);

  return {
    client,
    sessionManager,
    chromeProcess,
    async dispose() {
      await sessionManager.dispose();
      await client.close();
      chromeProcess.kill("SIGTERM");
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/browser-session.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/browser-session.mjs tests/cdp/browser-session.test.mjs
git commit -m "phase 64a: BrowserSession facade — launch/connect/dispose one-liner"
```

### Task A6: Phase 64 plan doc 산출

**Files:**
- Create: `tasks/phases/phase-64-cdp-foundation.md`

- [ ] **Step 1: 작성**

```markdown
# Phase 64 — CDP-Direct Foundation (client + session-manager + browser-session)

## 사용자 원문 quote (paraphrase 금지)
> "그럼 cdp direct 로 바꾸자. /writing-plans 작업은 당연히 전체를 다 한다. 빠짐없이."
> "Full extreme — runner.mjs까지"

## 목적
Playwright-on-CDP에서 raw CDP로 전환하는 marathon의 발판. 이 phase에서는 어떤
기존 코드도 수정하지 않고 새 `scripts/cdp/` 디렉토리를 추가. observer-daemon /
generate / verify 마이그레이션 (Phase 65+) 의 의존 라이브러리.

## 산출물
- `scripts/cdp/client.mjs` — chrome-remote-interface 래퍼 (CdpClient interface)
- `scripts/cdp/chrome-binary.mjs` — system + Playwright cache fallback resolver
- `scripts/cdp/session-manager.mjs` — Target.setAutoAttach(flatten=true) target/session 풀
- `scripts/cdp/browser-session.mjs` — launch + connect + dispose façade

## 테스트
- `tests/cdp/client.test.mjs` — connect, send, close
- `tests/cdp/chrome-binary.test.mjs` — override + fallback
- `tests/cdp/session-manager.test.mjs` — attach event + sessionId resolution
- `tests/cdp/browser-session.test.mjs` — end-to-end launch

## Out of scope (Phase 65+)
- 기존 `scripts/observe/chrome.mjs` / `observer-daemon.mjs` 마이그레이션 — Phase 65
- Watchdog 패턴 — Phase 65+
- runner.mjs 재작성 — Phase 70+

## Result Log
(진입 후 채움)
```

- [ ] **Step 2: 커밋**

```bash
git add tasks/phases/phase-64-cdp-foundation.md
git commit -m "phase 64 plan doc — CDP-direct foundation (client + session-manager + browser-session)"
```

---

## Section B — Observer migration (capture path)

목적: `scripts/observe/`를 Playwright Page API에서 CDP-direct로 전환. 기존 동작 동치성 + iframe/popup 통일 attach.

### Task B1: Recorder injection via Runtime.addBinding

**Files:**
- Create: `scripts/cdp/watchdogs/recorder.mjs`
- Create: `tests/cdp/watchdogs/recorder.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/watchdogs/recorder.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installRecorderWatchdog } from "../../../scripts/cdp/watchdogs/recorder.mjs";

test("recorder watchdog injects script and routes bindingCalled events", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "rec-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9336, headless: true });
  try {
    /** @type {object[]} */
    const events = [];
    const recorder = await installRecorderWatchdog(session, {
      onEvent: (event) => events.push(event),
      bindingName: "__browserFlowRecord",
      script: `(() => { window.__browserFlowRecord({ type: 'test', value: 42 }); })();`
    });

    const [target] = session.sessionManager.listPageTargets();
    const sessionId = session.sessionManager.getSessionId(target.targetId);
    await session.client.send("Page.navigate", { url: "about:blank" }, sessionId);

    // Wait until at least one event arrives
    for (let i = 0; i < 50 && events.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(events.length >= 1, "expected at least one binding event");
    assert.equal(events[0].type, "test");
    assert.equal(events[0].value, 42);

    await recorder.dispose();
  } finally {
    await session.dispose();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/recorder.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/recorder.mjs`:
```js
/**
 * @typedef {Object} RecorderWatchdogOptions
 * @property {string} bindingName — Runtime.addBinding name (예: "__browserFlowRecord")
 * @property {string} script — 페이지 컨텍스트 init script (recorderInitScript)
 * @property {(event: object, meta: { sessionId: string, targetId: string }) => void} onEvent
 */

/**
 * @typedef {Object} RecorderWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {RecorderWatchdogOptions} options
 * @returns {Promise<RecorderWatchdog>}
 */
export async function installRecorderWatchdog(session, options) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];

  /**
   * @param {{ targetId: string }} info
   * @param {string} sessionId
   */
  async function attach(info, sessionId) {
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.addBinding", { name: options.bindingName }, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: options.script }, sessionId);
    await client.send("Runtime.evaluate", { expression: options.script }, sessionId).catch(() => {
      // 페이지가 navigate 중이면 evaluate가 실패할 수 있음 — addScriptToEvaluateOnNewDocument로 다음 페이지에서 적용.
    });
  }

  for (const target of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(target.targetId);
    if (sid) await attach(target, sid);
  }
  off.push(sessionManager.onPageAttached((info, sessionId) => {
    attach(info, sessionId).catch((err) => {
      console.error("recorder attach failed:", err instanceof Error ? err.message : String(err));
    });
  }));

  off.push(client.on("Runtime.bindingCalled", (params) => {
    const p = /** @type {any} */ (params);
    if (p.name !== options.bindingName) return;
    let payload;
    try { payload = JSON.parse(p.payload); } catch { return; }
    const targetId = findTargetIdBySessionId(sessionManager, p.executionContextId, p);
    options.onEvent(payload, { sessionId: p.sessionId ?? "", targetId: targetId ?? "" });
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}

/**
 * @param {import("../session-manager.mjs").SessionManager} mgr
 * @param {number} _executionContextId
 * @param {{ sessionId?: string }} params
 */
function findTargetIdBySessionId(mgr, _executionContextId, params) {
  if (!params.sessionId) return undefined;
  for (const target of mgr.listPageTargets()) {
    if (mgr.getSessionId(target.targetId) === params.sessionId) return target.targetId;
  }
  return undefined;
}
```

또한 `scripts/observe/recorder-script.mjs` 의 `window.__browserFlowRecord` 호출이 `Runtime.bindingCalled`로 라우팅되도록 보장 — 이미 그 함수 이름을 사용 중이라 변경 불필요. 단 binding 호출 시 첫 인자는 string이라야 함. 검증:

`scripts/observe/recorder-script.mjs:136` 수정:
```js
// 기존
window.__browserFlowRecord({ ...payload, timestamp: Date.now(), url: location.href });
// 변경 (CDP binding은 string payload만 받음)
window.__browserFlowRecord(JSON.stringify({ ...payload, timestamp: Date.now(), url: location.href }));
```

- [ ] **Step 4: recorder-script.mjs payload stringify**

```bash
# scripts/observe/recorder-script.mjs:132-141 의 emit() 함수 내부 변경
```

이 변경을 직접 적용 후:

Run: `node --test tests/cdp/watchdogs/recorder.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/recorder.mjs scripts/observe/recorder-script.mjs tests/cdp/watchdogs/recorder.test.mjs
git commit -m "phase 65a: recorder watchdog via Runtime.addBinding + bindingCalled (replaces Playwright exposeBinding)"
```

### Task B2: Network watchdog — raw Network domain events

**Files:**
- Create: `scripts/cdp/watchdogs/network.mjs`
- Create: `tests/cdp/watchdogs/network.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/watchdogs/network.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installNetworkWatchdog } from "../../../scripts/cdp/watchdogs/network.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("network watchdog records request + response with loaderId", async () => {
  const fixture = await startSiteServer();
  const profileDir = mkdtempSync(join(tmpdir(), "net-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9337, headless: true });
  /** @type {object[]} */
  const events = [];
  const watchdog = await installNetworkWatchdog(session, { onEvent: (e) => events.push(e) });
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await session.client.send("Page.navigate", { url: `${fixture.baseUrl}/synthetic` }, sid);
    await new Promise((r) => setTimeout(r, 1500));
    const requests = events.filter((e) => e.type === "network.request");
    const responses = events.filter((e) => e.type === "network.response");
    assert.ok(requests.length >= 1, "expected at least one request");
    assert.ok(responses.length >= 1, "expected at least one response");
    assert.ok(requests[0].loaderId, "expected loaderId on request event");
  } finally {
    await watchdog.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/network.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/network.mjs`:
```js
/**
 * @typedef {Object} NetworkWatchdogOptions
 * @property {(event: object) => void} onEvent
 */

/**
 * @typedef {Object} NetworkWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {NetworkWatchdogOptions} options
 * @returns {Promise<NetworkWatchdog>}
 */
export async function installNetworkWatchdog(session, options) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Network.enable", {}, sessionId);
  }

  for (const target of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(target.targetId);
    if (sid) await enableFor(sid);
  }
  off.push(sessionManager.onPageAttached(async (_info, sessionId) => {
    await enableFor(sessionId).catch(() => {});
  }));

  off.push(client.on("Network.requestWillBeSent", (params) => {
    const p = /** @type {any} */ (params);
    options.onEvent({
      type: "network.request",
      timestamp: Date.now(),
      requestId: p.requestId,
      loaderId: p.loaderId,
      url: p.request.url,
      method: p.request.method,
      headers: p.request.headers,
      redirectResponse: p.redirectResponse
    });
  }));

  off.push(client.on("Network.responseReceived", (params) => {
    const p = /** @type {any} */ (params);
    options.onEvent({
      type: "network.response",
      timestamp: Date.now(),
      requestId: p.requestId,
      loaderId: p.loaderId,
      url: p.response.url,
      status: p.response.status,
      method: p.response.requestHeaders?.[":method"] ?? "GET",
      headers: p.response.headers,
      mimeType: p.response.mimeType
    });
  }));

  off.push(client.on("Network.loadingFinished", (params) => {
    const p = /** @type {any} */ (params);
    options.onEvent({
      type: "network.loadingFinished",
      timestamp: Date.now(),
      requestId: p.requestId,
      encodedDataLength: p.encodedDataLength
    });
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/network.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/network.mjs tests/cdp/watchdogs/network.test.mjs
git commit -m "phase 65b: network watchdog — raw Network.requestWillBeSent/responseReceived/loadingFinished with loaderId"
```

### Task B3: Lifecycle watchdog — Page.setLifecycleEventsEnabled + navigation wait

**Files:**
- Create: `scripts/cdp/watchdogs/lifecycle.mjs`
- Create: `tests/cdp/watchdogs/lifecycle.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/watchdogs/lifecycle.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("lifecycle watchdog navigateAndWait resolves on networkidle", async () => {
  const fixture = await startSiteServer();
  const profileDir = mkdtempSync(join(tmpdir(), "lc-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9338, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "networkidle" });
    const events = lc.getEventsFor(target.targetId);
    assert.ok(events.some((e) => e.name === "DOMContentLoaded"));
    assert.ok(events.some((e) => e.name === "load"));
    assert.ok(events.some((e) => e.name === "networkIdle"));
  } finally {
    await lc.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/lifecycle.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/lifecycle.mjs`:
```js
/**
 * @typedef {{ name: string, loaderId: string, timestamp: number }} LifecycleEvent
 * @typedef {"commit" | "domcontentloaded" | "load" | "networkidle"} WaitUntil
 */

/**
 * @typedef {Object} LifecycleWatchdog
 * @property {(targetId: string, url: string, options?: { waitUntil?: WaitUntil, timeoutMs?: number }) => Promise<void>} navigateAndWait
 * @property {(targetId: string) => LifecycleEvent[]} getEventsFor
 * @property {() => Promise<void>} dispose
 */

const WAIT_EVENT = {
  commit: "init",
  domcontentloaded: "DOMContentLoaded",
  load: "load",
  networkidle: "networkIdle"
};

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @returns {Promise<LifecycleWatchdog>}
 */
export async function installLifecycleWatchdog(session) {
  const { client, sessionManager } = session;
  /** @type {Map<string, LifecycleEvent[]>} */
  const eventsByTarget = new Map();
  /** @type {Array<() => void>} */
  const off = [];

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
  }

  for (const t of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(t.targetId);
    if (sid) await enableFor(sid);
    eventsByTarget.set(t.targetId, []);
  }
  off.push(sessionManager.onPageAttached(async (info, sessionId) => {
    eventsByTarget.set(info.targetId, []);
    await enableFor(sessionId).catch(() => {});
  }));

  off.push(client.on("Page.lifecycleEvent", (params) => {
    const p = /** @type {any} */ (params);
    const sid = p.sessionId;
    for (const t of sessionManager.listPageTargets()) {
      if (sessionManager.getSessionId(t.targetId) === sid) {
        const arr = eventsByTarget.get(t.targetId) ?? [];
        arr.push({ name: p.name, loaderId: p.loaderId, timestamp: Date.now() });
        eventsByTarget.set(t.targetId, arr);
        break;
      }
    }
  }));

  return {
    async navigateAndWait(targetId, url, opts = {}) {
      const waitUntil = opts.waitUntil ?? "load";
      const timeoutMs = opts.timeoutMs ?? 30_000;
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for target ${targetId}`);
      const startedAt = Date.now();
      const expectedEvent = WAIT_EVENT[waitUntil];
      const navResult = /** @type {any} */ (await client.send("Page.navigate", { url }, sid));
      const loaderId = navResult.loaderId;
      while (Date.now() - startedAt < timeoutMs) {
        const arr = eventsByTarget.get(targetId) ?? [];
        if (arr.some((e) => e.loaderId === loaderId && e.name === expectedEvent)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`navigateAndWait timeout (${waitUntil}) for ${url}`);
    },
    getEventsFor(targetId) {
      return eventsByTarget.get(targetId) ?? [];
    },
    async dispose() {
      for (const cleanup of off) cleanup();
      eventsByTarget.clear();
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/lifecycle.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/lifecycle.mjs tests/cdp/watchdogs/lifecycle.test.mjs
git commit -m "phase 65c: lifecycle watchdog — Page.lifecycleEvent + loaderId-matched navigateAndWait (4 wait levels)"
```

### Task B4: DOM watchdog — page.content() 대체, snapshot 캡처

**Files:**
- Create: `scripts/cdp/watchdogs/dom.mjs`
- Create: `tests/cdp/watchdogs/dom.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/watchdogs/dom.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installDomWatchdog } from "../../../scripts/cdp/watchdogs/dom.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("DOM watchdog captureOuterHtml returns rendered HTML", async () => {
  const fixture = await startSiteServer();
  const profileDir = mkdtempSync(join(tmpdir(), "dom-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9339, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const dom = await installDomWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const html = await dom.captureOuterHtml(target.targetId);
    assert.ok(html.includes("<html"));
    assert.ok(html.length > 100);
  } finally {
    await dom.dispose();
    await lc.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/dom.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/dom.mjs`:
```js
/**
 * @typedef {Object} DomWatchdog
 * @property {(targetId: string) => Promise<string>} captureOuterHtml
 * @property {(targetId: string) => Promise<string>} currentUrl
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @returns {Promise<DomWatchdog>}
 */
export async function installDomWatchdog(session) {
  const { client, sessionManager } = session;

  return {
    async captureOuterHtml(targetId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
      const html = /** @type {any} */ (await client.send("DOM.getOuterHTML", { backendNodeId: doc.root.backendNodeId }, sid));
      return html.outerHTML;
    },
    async currentUrl(targetId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const result = /** @type {any} */ (await client.send("Runtime.evaluate", { expression: "location.href" }, sid));
      return String(result.result.value);
    },
    async dispose() {}
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/dom.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/dom.mjs tests/cdp/watchdogs/dom.test.mjs
git commit -m "phase 65d: DOM watchdog — captureOuterHtml via DOM.getDocument+getOuterHTML (replaces page.content())"
```

### Task B5: observer-daemon 마이그레이션 — Playwright API 제거

**Files:**
- Modify: `scripts/observe/observer-daemon.mjs` (전부 재작성)
- Delete: `scripts/observe/chrome.mjs` (대체됨)
- Modify: `scripts/observe/page-evidence.mjs` (Playwright Page → CDP session)

- [ ] **Step 1: e2e 테스트가 여전히 통과하는지 baseline 확인**

Run: `node --test tests/e2e/`
Expected: baseline pass count 기록 (현재 그린).

- [ ] **Step 2: observer-daemon 재작성 — BrowserSession + watchdog 위에서 동작**

`scripts/observe/observer-daemon.mjs` 의 핵심 변경:
- `import { chromium } from "playwright"` 제거
- `launchObservedChrome` 호출 → `createBrowserSession` 호출
- `context.exposeBinding(...)` → recorder watchdog (Task B1)
- `page.on("request"/"response")` → network watchdog (Task B2)
- `page.waitForLoadState(...)` → lifecycle watchdog (Task B3)
- `page.content()` → DOM watchdog (Task B4)
- `page.addInitScript / page.evaluate` → recorder watchdog 내 `Page.addScriptToEvaluateOnNewDocument`

치환 후 새 구조 (전체 파일 대략 350라인):
```js
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { createBrowserSession } from "../cdp/browser-session.mjs";
import { installRecorderWatchdog } from "../cdp/watchdogs/recorder.mjs";
import { installNetworkWatchdog } from "../cdp/watchdogs/network.mjs";
import { installLifecycleWatchdog } from "../cdp/watchdogs/lifecycle.mjs";
import { installDomWatchdog } from "../cdp/watchdogs/dom.mjs";
import { recorderInitScript } from "./recorder-script.mjs";
import { sanitizeDomSnapshot } from "../sanitize/dom-sanitize.mjs";
import { appendRawEvent } from "../lib/raw-event-log.mjs";
import { collectPageEvidence } from "./page-evidence.mjs";
// ... (기존 imports 유지)

export async function runObserverDaemon(config) {
  const session = await createBrowserSession({
    profileDir: config.profileDir,
    debugPort: config.debugPort,
    headless: config.headless
  });

  /** @type {any[]} */
  const rawEvents = [];
  /** @type {any[]} */
  const networkEvents = [];

  const recorder = await installRecorderWatchdog(session, {
    bindingName: "__browserFlowRecord",
    script: recorderInitScript,
    onEvent: (event) => {
      rawEvents.push(event);
      appendRawEvent(config.runPaths, event);
    }
  });

  const network = await installNetworkWatchdog(session, {
    onEvent: (event) => {
      networkEvents.push(event);
      appendRawEvent(config.runPaths, event);
    }
  });

  const lifecycle = await installLifecycleWatchdog(session);
  const dom = await installDomWatchdog(session);

  // 초기 navigation
  const [initialTarget] = session.sessionManager.listPageTargets();
  if (config.startUrl) {
    await lifecycle.navigateAndWait(initialTarget.targetId, config.startUrl, { waitUntil: "domcontentloaded" });
  }

  // snapshot mode (Phase 35 보존)
  if (config.snapshotMode) {
    session.client.on("Page.frameNavigated", async (params) => {
      const p = /** @type {any} */ (params);
      if (p.frame.parentId) return; // main frame only
      try {
        await new Promise((r) => setTimeout(r, 300));
        const html = await dom.captureOuterHtml(initialTarget.targetId);
        const sanitized = sanitizeDomSnapshot(html);
        const compressed = gzipSync(sanitized);
        // ... (기존 snapshot 저장 로직 유지)
      } catch (err) {
        console.error("snapshot capture failed:", err);
      }
    });
  }

  return {
    session,
    async stop() {
      await dom.dispose();
      await lifecycle.dispose();
      await network.dispose();
      await recorder.dispose();
      // settle, collect page evidence, then dispose session
      const pageEvidence = await collectPageEvidence(session, initialTarget.targetId);
      writeFileSync(config.runPaths.rawPageEvidencePath, JSON.stringify(pageEvidence));
      await session.dispose();
      return { rawEvents, networkEvents, pageEvidence };
    }
  };
}
```

`scripts/observe/page-evidence.mjs`:
```js
/**
 * @param {import("../cdp/browser-session.mjs").BrowserSession} session
 * @param {string} targetId
 */
export async function collectPageEvidence(session, targetId) {
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) return [];
  const result = /** @type {any} */ (await session.client.send("Runtime.evaluate", {
    expression: "JSON.stringify({ title: document.title, url: location.href, timestamp: Date.now() })",
    returnByValue: true
  }, sid));
  return [JSON.parse(result.result.value)];
}
```

`scripts/observe/chrome.mjs` 삭제:
```bash
git rm scripts/observe/chrome.mjs
```

- [ ] **Step 3: e2e 테스트 통과 확인**

Run: `npm test`
Expected: 228 tests pass. observer-daemon 사용하는 e2e가 CDP-direct path로 동작.

만약 실패하면 — 디버깅. 흔히 발생할 이슈:
- Playwright는 `framenavigated`를 사용했는데 CDP는 `Page.frameNavigated` — 파라미터 shape 다름
- `addInitScript` 즉시 적용 vs `Page.addScriptToEvaluateOnNewDocument`는 다음 navigation부터 — `Runtime.evaluate`로 즉시 실행 보강 필요

- [ ] **Step 4: typecheck 통과**

Run: `npm run typecheck`
Expected: 0 error.

- [ ] **Step 5: 커밋**

```bash
git add scripts/observe/observer-daemon.mjs scripts/observe/page-evidence.mjs
git rm scripts/observe/chrome.mjs
git commit -m "phase 65e: observer-daemon migrated to CDP-direct (BrowserSession + 4 watchdogs); chrome.mjs deleted"
```

### Task B6: Phase 65 plan doc

**Files:**
- Create: `tasks/phases/phase-65-observer-cdp-direct.md`

- [ ] **Step 1: 작성**

(Phase 64 plan doc 형식 따라 작성 — Task B1-B5 산출물 + 테스트 + 통과 카운트 기재)

- [ ] **Step 2: 커밋**

```bash
git add tasks/phases/phase-65-observer-cdp-direct.md
git commit -m "phase 65 plan doc — observer-daemon CDP-direct migration"
```

---

## Section C — Forward gains (9 CDP advantages)

목적: Section B로 Playwright observe layer를 제거한 후, Playwright에서 못 했거나 비용 컸던 9개 영역을 채움.

### Task C1: Click action ladder — coords → JS fallback

**Files:**
- Create: `scripts/cdp/watchdogs/action.mjs`
- Create: `tests/cdp/watchdogs/action.test.mjs`

- [ ] **Step 1: 실패 테스트**

`tests/cdp/watchdogs/action.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../../scripts/cdp/watchdogs/action.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("clickBySelector clicks element via Input.dispatchMouseEvent, JS fallback when coords fail", async () => {
  const fixture = await startSiteServer();
  const profileDir = mkdtempSync(join(tmpdir(), "act-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9340, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const result = await action.clickBySelector(target.targetId, "[data-bf='cta']");
    assert.equal(result.strategy, "input.dispatchMouseEvent");
    assert.equal(result.clicked, true);
  } finally {
    await action.dispose();
    await lc.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/action.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/action.mjs`:
```js
/**
 * @typedef {{ clicked: boolean, strategy: "input.dispatchMouseEvent" | "runtime.callFunctionOn" }} ClickResult
 */

/**
 * @typedef {Object} ActionWatchdog
 * @property {(targetId: string, selector: string) => Promise<ClickResult>} clickBySelector
 * @property {(targetId: string, selector: string, text: string) => Promise<void>} typeIntoSelector
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @returns {Promise<ActionWatchdog>}
 */
export async function installActionWatchdog(session) {
  const { client, sessionManager } = session;

  /**
   * @param {string} sessionId
   * @param {string} selector
   */
  async function resolveBackendNodeId(sessionId, selector) {
    const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sessionId));
    const found = /** @type {any} */ (await client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector
    }, sessionId));
    if (!found.nodeId) throw new Error(`selector did not resolve: ${selector}`);
    const desc = /** @type {any} */ (await client.send("DOM.describeNode", { nodeId: found.nodeId }, sessionId));
    return desc.node.backendNodeId;
  }

  return {
    async clickBySelector(targetId, selector) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const backendNodeId = await resolveBackendNodeId(sid, selector);

      // Scroll into view
      await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sid).catch(() => {});

      // Coords-based click via Input.dispatchMouseEvent
      try {
        const box = /** @type {any} */ (await client.send("DOM.getBoxModel", { backendNodeId }, sid));
        const [x1, y1, x2, , , y3] = box.model.content;
        const x = (x1 + x2) / 2;
        const y = (y1 + y3) / 2;
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, sid);
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sid);
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sid);
        return { clicked: true, strategy: "input.dispatchMouseEvent" };
      } catch (coordsErr) {
        // JS click fallback
        const obj = /** @type {any} */ (await client.send("DOM.resolveNode", { backendNodeId }, sid));
        await client.send("Runtime.callFunctionOn", {
          objectId: obj.object.objectId,
          functionDeclaration: "function() { this.click(); }",
          arguments: [],
          returnByValue: true
        }, sid);
        return { clicked: true, strategy: "runtime.callFunctionOn" };
      }
    },
    async typeIntoSelector(targetId, selector, text) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      const backendNodeId = await resolveBackendNodeId(sid, selector);
      await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sid).catch(() => {});
      // Focus
      await client.send("DOM.focus", { backendNodeId }, sid);
      // Type each char
      for (const char of text) {
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", text: char }, sid);
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", text: char }, sid);
      }
    },
    async dispose() {}
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/action.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/action.mjs tests/cdp/watchdogs/action.test.mjs
git commit -m "phase 66a: action watchdog — click via Input.dispatchMouseEvent + JS callFunctionOn fallback ladder"
```

### Task C2: Proxy auth via Fetch.authRequired

**Files:**
- Create: `scripts/cdp/watchdogs/proxy-auth.mjs`
- Create: `tests/cdp/watchdogs/proxy-auth.test.mjs`

- [ ] **Step 1: 실패 테스트**

테스트 — local HTTP proxy with basic auth fixture가 필요. fixture `scripts/fixtures/proxy-server.mjs` 생성.

`scripts/fixtures/proxy-server.mjs` (Step 3 첫 항목 — 의존하는 helper):
```js
import http from "node:http";

/**
 * Local proxy that requires Basic Auth. Returns { stop, port }.
 * @param {{ username: string, password: string }} opts
 */
export function startAuthProxy(opts) {
  const server = http.createServer((req, res) => {
    const auth = req.headers["proxy-authorization"];
    if (!auth) {
      res.writeHead(407, { "proxy-authenticate": "Basic realm=\"test\"" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = /** @type {any} */ (server.address()).port;
      resolve({
        port,
        stop: () => new Promise((r) => server.close(() => r(undefined)))
      });
    });
  });
}
```

`tests/cdp/watchdogs/proxy-auth.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installProxyAuthWatchdog } from "../../../scripts/cdp/watchdogs/proxy-auth.mjs";
import { startAuthProxy } from "../../../scripts/fixtures/proxy-server.mjs";

test("proxy auth watchdog completes 407 challenge with continueWithAuth", async () => {
  const proxy = await startAuthProxy({ username: "u", password: "p" });
  const profileDir = mkdtempSync(join(tmpdir(), "px-auth-"));
  const session = await createBrowserSession({
    profileDir,
    debugPort: 9341,
    headless: true,
    extraArgs: [`--proxy-server=127.0.0.1:${proxy.port}`]
  });
  const auth = await installProxyAuthWatchdog(session, { username: "u", password: "p" });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, "http://example.com", { waitUntil: "domcontentloaded" });
    // proxy 응답 "ok"가 들어왔다면 navigation 성공
  } finally {
    await auth.dispose();
    await lc.dispose();
    await session.dispose();
    await proxy.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/proxy-auth.test.mjs`
Expected: FAIL — `installProxyAuthWatchdog` 없음.

- [ ] **Step 3: 구현 (proxy-server.mjs 먼저, 그 다음 watchdog)**

`scripts/cdp/watchdogs/proxy-auth.mjs`:
```js
/**
 * @typedef {Object} ProxyAuthWatchdog
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<ProxyAuthWatchdog>}
 */
export async function installProxyAuthWatchdog(session, credentials) {
  const { client, sessionManager } = session;
  /** @type {Array<() => void>} */
  const off = [];

  /** @param {string} sessionId */
  async function enableFor(sessionId) {
    await client.send("Fetch.enable", { handleAuthRequests: true }, sessionId);
  }

  for (const t of sessionManager.listPageTargets()) {
    const sid = sessionManager.getSessionId(t.targetId);
    if (sid) await enableFor(sid);
  }
  off.push(sessionManager.onPageAttached(async (_info, sessionId) => {
    await enableFor(sessionId).catch(() => {});
  }));

  off.push(client.on("Fetch.authRequired", (params) => {
    const p = /** @type {any} */ (params);
    client.send("Fetch.continueWithAuth", {
      requestId: p.requestId,
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: credentials.username,
        password: credentials.password
      }
    }, p.sessionId).catch(() => {});
  }));

  off.push(client.on("Fetch.requestPaused", (params) => {
    const p = /** @type {any} */ (params);
    client.send("Fetch.continueRequest", { requestId: p.requestId }, p.sessionId).catch(() => {});
  }));

  return {
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/proxy-auth.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/proxy-auth.mjs scripts/fixtures/proxy-server.mjs tests/cdp/watchdogs/proxy-auth.test.mjs
git commit -m "phase 66b: proxy-auth watchdog — Fetch.authRequired + continueWithAuth (was 🔴 in Playwright matrix)"
```

### Task C3: Accessibility tree — ARIA accessible name 정확 계산

**Files:**
- Create: `scripts/cdp/watchdogs/accessibility.mjs`
- Create: `tests/cdp/watchdogs/accessibility.test.mjs`

- [ ] **Step 1: 실패 테스트**

```js
// tests/cdp/watchdogs/accessibility.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installAccessibilityWatchdog } from "../../../scripts/cdp/watchdogs/accessibility.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("accessibility watchdog returns role+name for elements", async () => {
  const fixture = await startSiteServer();
  const profileDir = mkdtempSync(join(tmpdir(), "ax-wd-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9342, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const ax = await installAccessibilityWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });
    const nodes = await ax.getFullAxTree(target.targetId);
    assert.ok(nodes.some((n) => n.role === "button"), "expected a button node");
  } finally {
    await ax.dispose();
    await lc.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/accessibility.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/accessibility.mjs`:
```js
/**
 * @typedef {{ nodeId: string, backendDomNodeId?: number, role: string, name: string, value: string }} AxNode
 */

/**
 * @typedef {Object} AccessibilityWatchdog
 * @property {(targetId: string) => Promise<AxNode[]>} getFullAxTree
 * @property {(targetId: string, role: string, name: string) => Promise<number | undefined>} findBackendNodeId
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @returns {Promise<AccessibilityWatchdog>}
 */
export async function installAccessibilityWatchdog(session) {
  const { client, sessionManager } = session;
  return {
    async getFullAxTree(targetId) {
      const sid = sessionManager.getSessionId(targetId);
      if (!sid) throw new Error(`no sessionId for ${targetId}`);
      await client.send("Accessibility.enable", {}, sid);
      const result = /** @type {any} */ (await client.send("Accessibility.getFullAXTree", {}, sid));
      return result.nodes.map((n) => ({
        nodeId: n.nodeId,
        backendDomNodeId: n.backendDOMNodeId,
        role: n.role?.value ?? "",
        name: n.name?.value ?? "",
        value: n.value?.value ?? ""
      }));
    },
    async findBackendNodeId(targetId, role, name) {
      const nodes = await this.getFullAxTree(targetId);
      const match = nodes.find((n) => n.role === role && n.name === name);
      return match?.backendDomNodeId;
    },
    async dispose() {}
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/accessibility.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/accessibility.mjs tests/cdp/watchdogs/accessibility.test.mjs
git commit -m "phase 66c: accessibility watchdog — Accessibility.getFullAXTree + role/name backendNodeId lookup"
```

### Task C4: Download watchdog

**Files:**
- Create: `scripts/cdp/watchdogs/download.mjs`
- Create: `tests/cdp/watchdogs/download.test.mjs`

- [ ] **Step 1: 실패 테스트**

```js
// tests/cdp/watchdogs/download.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installDownloadWatchdog } from "../../../scripts/cdp/watchdogs/download.mjs";
import { startSiteServer } from "../../../scripts/fixtures/site-server.mjs";

test("download watchdog routes file to configured directory", async () => {
  const fixture = await startSiteServer();
  const downloadDir = mkdtempSync(join(tmpdir(), "dl-"));
  const profileDir = mkdtempSync(join(tmpdir(), "dl-prof-"));
  const session = await createBrowserSession({ profileDir, debugPort: 9343, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const dl = await installDownloadWatchdog(session, { downloadDir });
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/download-fixture`, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 2000));
    const files = readdirSync(downloadDir);
    assert.ok(files.length >= 1, "expected at least one downloaded file");
  } finally {
    await dl.dispose();
    await lc.dispose();
    await session.dispose();
    await fixture.stop();
    rmSync(profileDir, { recursive: true, force: true });
    rmSync(downloadDir, { recursive: true, force: true });
  }
});
```

`scripts/fixtures/site-server.mjs` 에 `/download-fixture` 라우트 추가 (Content-Disposition: attachment).

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/download.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현**

`scripts/cdp/watchdogs/download.mjs`:
```js
/**
 * @typedef {Object} DownloadWatchdog
 * @property {() => string[]} listDownloads
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {import("../browser-session.mjs").BrowserSession} session
 * @param {{ downloadDir: string }} options
 * @returns {Promise<DownloadWatchdog>}
 */
export async function installDownloadWatchdog(session, options) {
  const { client } = session;
  /** @type {Array<() => void>} */
  const off = [];
  /** @type {string[]} */
  const downloads = [];

  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: options.downloadDir,
    eventsEnabled: true
  });

  off.push(client.on("Browser.downloadWillBegin", (params) => {
    const p = /** @type {any} */ (params);
    downloads.push(p.suggestedFilename);
  }));

  off.push(client.on("Browser.downloadProgress", (_params) => {
    // progress events available; intentionally no-op for baseline
  }));

  return {
    listDownloads() {
      return downloads.slice();
    },
    async dispose() {
      for (const cleanup of off) cleanup();
    }
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/download.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/download.mjs scripts/fixtures/site-server.mjs tests/cdp/watchdogs/download.test.mjs
git commit -m "phase 66d: download watchdog — Browser.setDownloadBehavior + downloadWillBegin events"
```

### Task C5: Phase 66 plan doc

**Files:**
- Create: `tasks/phases/phase-66-forward-gains.md`

- [ ] **Step 1: 작성**

Section C의 9개 forward gain 중 5개를 Phase 66 산출물로 묶음 (action ladder, proxy auth, accessibility, download, PDF — Task C6에서 PDF). nav lifecycle / auto-attach / cross-origin / raw network는 Phase 65에서 이미 다룸.

- [ ] **Step 2: 커밋**

```bash
git add tasks/phases/phase-66-forward-gains.md
git commit -m "phase 66 plan doc — forward-axis CDP gains (action ladder + proxy + ax tree + download + PDF)"
```

### Task C6: PDF / attachment detection (Content-Type + Content-Disposition raw)

**Files:**
- Modify: `scripts/cdp/watchdogs/network.mjs` (request mimeType filter helper export)
- Create: `tests/cdp/watchdogs/attachment-detect.test.mjs`

- [ ] **Step 1: 실패 테스트**

```js
// network watchdog가 mimeType + contentDisposition을 응답 이벤트에 포함하는지 검증
// fixture 라우트 /pdf-fixture (Content-Type: application/pdf, Content-Disposition: attachment)
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cdp/watchdogs/attachment-detect.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현 — network watchdog에 mimeType 이미 포함됨 (Task B2). contentDisposition 추가:**

`scripts/cdp/watchdogs/network.mjs:responseReceived 핸들러`:
```js
options.onEvent({
  // ... 기존 필드
  contentDisposition: p.response.headers?.["content-disposition"] ?? p.response.headers?.["Content-Disposition"] ?? ""
});
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/cdp/watchdogs/attachment-detect.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add scripts/cdp/watchdogs/network.mjs tests/cdp/watchdogs/attachment-detect.test.mjs scripts/fixtures/site-server.mjs
git commit -m "phase 66e: PDF/attachment detection — Content-Disposition raw header on network.response events"
```

---

## Section D — Analyze layer: compile.mjs 정합성

목적: compile.mjs 입력 (sanitized events + raw page evidence) 의 shape가 Section B에서 변경된 것 반영.

### Task D1: compile.mjs network event shape 정합성

**Files:**
- Modify: `scripts/analyze/compile.mjs` (transition-gate detection 부분)
- Modify: `tests/analyze/compile.test.mjs` 또는 신규 fixture

- [ ] **Step 1: 기존 테스트 실행 — 어느 assertion이 실패하는지 식별**

Run: `node --test tests/analyze/`
Expected: 일부 fail. 이유: network event 객체에 새 필드 (`loaderId`, `requestId`) 있고 type discriminator가 `"network"` → `"network.request"` / `"network.response"` 로 바뀜.

- [ ] **Step 2: compile.mjs 의 transition-gate heuristic 업데이트**

Phase 50에서 `event.type === "network"` 가정 + `/api/` substring. 새 shape에 맞춰:
```js
// 기존
events.filter((e) => e.type === "network")
// 변경
events.filter((e) => e.type === "network.request" || e.type === "network.response")
```

method discriminator는 기존 그대로 (`event.method`).

- [ ] **Step 3: 통과 확인**

Run: `node --test tests/analyze/`
Expected: PASS.

- [ ] **Step 4: 전체 회귀**

Run: `npm test`
Expected: 모든 테스트 pass.

- [ ] **Step 5: 커밋**

```bash
git add scripts/analyze/compile.mjs tests/analyze/
git commit -m "phase 67a: compile.mjs network event discriminator updated to network.request/network.response (CDP shape)"
```

### Task D2: sanitize/event-sanitizer.mjs 정합성

**Files:**
- Modify: `scripts/sanitize/event-sanitizer.mjs`
- Modify: `tests/sanitize/event-sanitizer.test.mjs`

- [ ] **Step 1: 기존 테스트 실행**

Run: `node --test tests/sanitize/`
Expected: 일부 fail (network event shape 변경).

- [ ] **Step 2: event-sanitizer.mjs sanitize 분기 업데이트**

`type === "network"` 분기를 `network.request` / `network.response` / `network.loadingFinished` 로 분기.

- [ ] **Step 3-5: 테스트 통과 + 커밋**

```bash
git add scripts/sanitize/event-sanitizer.mjs tests/sanitize/event-sanitizer.test.mjs
git commit -m "phase 67b: event-sanitizer split network type into request/response/loadingFinished branches"
```

### Task D3: schemas.mjs network event Zod schema 갱신

**Files:**
- Modify: `scripts/lib/schemas.mjs`
- Modify: `tests/lib/schemas.test.mjs`

- [ ] **Step 1-5: schema 분기 추가 → 테스트 → 커밋**

```bash
git add scripts/lib/schemas.mjs tests/lib/schemas.test.mjs
git commit -m "phase 67c: schemas.mjs network event union (request/response/loadingFinished) with loaderId/requestId"
```

### Task D4: Phase 67 plan doc

```bash
git add tasks/phases/phase-67-analyze-shape-sync.md
git commit -m "phase 67 plan doc — analyze layer CDP event-shape sync"
```

---

## Section E — atomic-fp CDP consumer (Phase 60 재구현)

목적: `scripts/lib/atomic-fp.mjs` 의 `deriveAtomicLocator`는 그대로 유지 (메타데이터 derivation은 layer-agnostic). 변경은 *consumer* — 기존 generated runner의 `resolveStepLocator` / `resolveSubmitterLocator` 가 Playwright Locator chain을 썼던 것을 CDP-direct path로 재작성.

### Task E1: CDP-style locator resolver

**Files:**
- Create: `scripts/cdp/locator-resolver.mjs`
- Create: `tests/cdp/locator-resolver.test.mjs`

- [ ] **Step 1: 실패 테스트**

```js
// resolveAtomicFpLocator(session, targetId, step) → returns { backendNodeId, strategyUsed }
// strategy === "role" 인 경우: AX tree에서 role+name 검색
// strategy === "ancestor-scope" 인 경우: DOM 쿼리 chain
// fallback: step.selector 단독
```

- [ ] **Step 2: 실패 확인 → 구현**

`scripts/cdp/locator-resolver.mjs`:
```js
import { installAccessibilityWatchdog } from "./watchdogs/accessibility.mjs";

/**
 * @param {import("./browser-session.mjs").BrowserSession} session
 * @param {string} targetId
 * @param {{ selector: string, atomicFp?: { strategy: string, role?: string, name?: string, scopeSelector?: string } }} step
 * @returns {Promise<{ backendNodeId: number, strategyUsed: string }>}
 */
export async function resolveAtomicFpLocator(session, targetId, step) {
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) throw new Error("no sessionId");
  const fp = step.atomicFp;

  if (fp?.strategy === "role" && fp.role && fp.name) {
    const ax = await installAccessibilityWatchdog(session);
    try {
      const backendNodeId = await ax.findBackendNodeId(targetId, fp.role, fp.name);
      if (backendNodeId) return { backendNodeId, strategyUsed: "role" };
    } finally {
      await ax.dispose();
    }
  }

  if (fp?.strategy === "ancestor-scope" && fp.scopeSelector) {
    // DOM 쿼리: scopeSelector → 그 안에서 step.selector
    const doc = /** @type {any} */ (await session.client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
    const scope = /** @type {any} */ (await session.client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId, selector: fp.scopeSelector
    }, sid));
    if (scope.nodeId) {
      const child = /** @type {any} */ (await session.client.send("DOM.querySelector", {
        nodeId: scope.nodeId, selector: step.selector
      }, sid));
      if (child.nodeId) {
        const desc = /** @type {any} */ (await session.client.send("DOM.describeNode", { nodeId: child.nodeId }, sid));
        return { backendNodeId: desc.node.backendNodeId, strategyUsed: "ancestor-scope" };
      }
    }
  }

  // Fallback: selector 단독
  const doc = /** @type {any} */ (await session.client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
  const found = /** @type {any} */ (await session.client.send("DOM.querySelector", {
    nodeId: doc.root.nodeId, selector: step.selector
  }, sid));
  if (!found.nodeId) throw new Error(`atomic-fp resolution failed for selector: ${step.selector}`);
  const desc = /** @type {any} */ (await session.client.send("DOM.describeNode", { nodeId: found.nodeId }, sid));
  return { backendNodeId: desc.node.backendNodeId, strategyUsed: "selector-fallback" };
}
```

- [ ] **Step 3-5: 통과 + 커밋**

```bash
git add scripts/cdp/locator-resolver.mjs tests/cdp/locator-resolver.test.mjs
git commit -m "phase 68a: atomic-fp CDP-direct resolver — role via AX tree + ancestor-scope via DOM.querySelector chain"
```

### Task E2: Phase 68 plan doc

```bash
git add tasks/phases/phase-68-atomic-fp-cdp-consumer.md
git commit -m "phase 68 plan doc — atomic-fp consumer rewritten on CDP-direct path"
```

---

## Section F — Generate migration (runner.mjs CDP-direct)

목적: `scripts/generate/generate-runner.mjs` 가 생성하는 runner template을 Playwright API → 우리 CDP layer 호출로 전면 교체.

### Task F1: 새 runner template 작성

**Files:**
- Modify: `scripts/generate/generate-runner.mjs`
- Update: `tests/generate/*.test.mjs`

- [ ] **Step 1: 기존 runner template 분석 → 새 template 작성**

기존 (Playwright):
```js
import { chromium } from "playwright";
const context = await chromium.launchPersistentContext(replayProfileDir, { headless: true });
const page = await context.newPage();
await page.goto(startUrl, { waitUntil: "domcontentloaded" });
const locator = page.locator(step.selector).first();
await locator.click();
```

새 (CDP-direct, 우리 helper 사용):
```js
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../scripts/cdp/watchdogs/action.mjs";
import { resolveAtomicFpLocator } from "../../scripts/cdp/locator-resolver.mjs";

const session = await createBrowserSession({
  profileDir: replayProfileDir,
  debugPort: 9400 + (process.pid % 100),
  headless: true
});
const lc = await installLifecycleWatchdog(session);
const action = await installActionWatchdog(session);
try {
  const [target] = session.sessionManager.listPageTargets();
  await lc.navigateAndWait(target.targetId, startUrl, { waitUntil: "domcontentloaded" });
  // for each step:
  const { backendNodeId } = await resolveAtomicFpLocator(session, target.targetId, step);
  await action.clickByBackendNodeId(target.targetId, backendNodeId);
} finally {
  await action.dispose();
  await lc.dispose();
  await session.dispose();
}
```

이를 위해 `action.mjs` 에 `clickByBackendNodeId(targetId, backendNodeId)` helper 추가 (Task F2 보강).

- [ ] **Step 2: 테스트 실행 — 모든 generate 테스트가 새 shape 검증하도록 업데이트**

`tests/generate/runner-template.test.mjs`:
```js
test("generated runner imports CDP helpers, not playwright", () => {
  const runnerCode = generateRunner({ workflow: minimalWorkflow });
  assert.ok(runnerCode.includes("createBrowserSession"));
  assert.ok(!runnerCode.includes("from \"playwright\""));
  assert.ok(!runnerCode.includes("chromium."));
});
```

- [ ] **Step 3: 통과 + 회귀**

Run: `npm test`
Expected: 전체 pass.

- [ ] **Step 4: 커밋**

```bash
git add scripts/generate/generate-runner.mjs scripts/cdp/watchdogs/action.mjs tests/generate/
git commit -m "phase 69a: generate-runner emits CDP-direct runner template (no playwright import)"
```

### Task F2: action watchdog clickByBackendNodeId 추가

**Files:**
- Modify: `scripts/cdp/watchdogs/action.mjs`
- Modify: `tests/cdp/watchdogs/action.test.mjs`

- [ ] **Step 1-5: helper + 테스트 + 커밋**

```bash
git add scripts/cdp/watchdogs/action.mjs tests/cdp/watchdogs/action.test.mjs
git commit -m "phase 69b: action.clickByBackendNodeId — locator resolver와 결합되는 click entry point"
```

### Task F3: Phase 69 plan doc

```bash
git add tasks/phases/phase-69-generate-runner-cdp.md
git commit -m "phase 69 plan doc — generate-runner CDP-direct rewrite"
```

---

## Section G — Verify migration

목적: `scripts/verify/verify-run.mjs` 가 자체 Playwright launch를 더 이상 안 하고, generate가 산출한 runner.mjs를 그대로 실행.

### Task G1: verify-run.mjs 재작성

**Files:**
- Modify: `scripts/verify/verify-run.mjs`
- Modify: `tests/verify/*.test.mjs`

- [ ] **Step 1: 기존 verify-run 구조 파악**

현재 verify-run은 자체 chromium.launch + workflow를 따라가며 truthfulness gate 검증. 일부 코드는 generated runner를 invoke. 이 두 경로 중 후자만 남기고 자체 launch 제거.

- [ ] **Step 2: 재작성**

verify-run.mjs:
```js
import { spawn } from "node:child_process";

export async function verifyRun({ runnerPath, runId, ... }) {
  // runner.mjs를 child process로 실행, exit code + JSON 산출물로 verification 판정
  const proc = spawn(process.execPath, [runnerPath], { stdio: "pipe" });
  // ... gather outputs, compare against expected
}
```

- [ ] **Step 3-5: 테스트 + 커밋**

```bash
git add scripts/verify/verify-run.mjs tests/verify/
git commit -m "phase 70a: verify-run executes generated CDP runner subprocess, removes own Playwright launch"
```

### Task G2: Phase 70 plan doc

```bash
git add tasks/phases/phase-70-verify-cdp.md
git commit -m "phase 70 plan doc — verify-run delegates to generated CDP runner subprocess"
```

---

## Section H — Test suite migration

목적: `tests/helpers/demo-driver.mjs` + `tests/e2e/false-positive-guard.test.mjs` 그리고 잠재적으로 Playwright API 직접 사용하는 다른 테스트들 마이그레이션.

### Task H1: demo-driver.mjs 마이그레이션

**Files:**
- Modify: `tests/helpers/demo-driver.mjs`

- [ ] **Step 1: 기존 demo-driver 분석**

현재 `chromium.connectOverCDP` → page 액션 (synthetic fixture에서 합성된 사용자 동작). 우리 CDP layer로 1:1 대체.

- [ ] **Step 2: 재작성**

```js
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../scripts/cdp/watchdogs/action.mjs";

export async function runDemoDriver({ debugPort, scenario }) {
  // Chrome은 prepare에서 이미 떠 있음 → connect만
  const session = await connectToExistingChrome(debugPort);
  const lc = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);
  try {
    for (const action of scenario.actions) {
      // ... 우리 helper 호출
    }
  } finally {
    await action.dispose();
    await lc.dispose();
    await session.dispose();
  }
}
```

`connectToExistingChrome` helper는 새 `scripts/cdp/browser-session.mjs` 에 추가 (이미 spawn된 Chrome에 connect-only).

- [ ] **Step 3-5: 테스트 + 커밋**

Run: `npm test`
Expected: 전체 pass.

```bash
git add tests/helpers/demo-driver.mjs scripts/cdp/browser-session.mjs
git commit -m "phase 71a: demo-driver migrated to CDP-direct; connectToExistingChrome helper"
```

### Task H2: false-positive-guard 마이그레이션

**Files:**
- Modify: `tests/e2e/false-positive-guard.test.mjs`

- [ ] **Step 1-5: Playwright 직접 사용 부분만 CDP layer로 치환 → 테스트 → 커밋**

```bash
git add tests/e2e/false-positive-guard.test.mjs
git commit -m "phase 71b: false-positive-guard e2e migrated to CDP-direct"
```

### Task H3: 전체 테스트 회귀 확인

- [ ] **Step 1: 전체 회귀**

Run: `npm run check`
Expected: lint + typecheck + validate-skill + tests 모두 pass.

- [ ] **Step 2: Playwright import 0건 확인**

Run: `grep -rln "from \"playwright\"\|require.*playwright\|chromium\." scripts/ tests/`
Expected: 출력 없음 (또는 generated runner 안의 historical comment만).

- [ ] **Step 3: 커밋 (회귀 통과 마커)**

```bash
git commit --allow-empty -m "phase 71c: full test suite green under CDP-direct (228+ tests pass, zero Playwright imports)"
```

### Task H4: Phase 71 plan doc

```bash
git add tasks/phases/phase-71-test-suite-cdp.md
git commit -m "phase 71 plan doc — test suite Playwright API removal"
```

---

## Section I — Playwright runtime dep removal + docs sync

### Task I1: package.json dependencies 정리

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (자동)

- [ ] **Step 1: playwright → devDependency 이동**

`package.json`:
```json
{
  "dependencies": {
    "chrome-remote-interface": "^0.33.0",
    "linkedom": "^0.18.12",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/chrome-remote-interface": "^0.31.14",
    "@types/node": "^25.8.0",
    "devtools-protocol": "^0.0.1352000",
    "husky": "^9.1.7",
    "js-yaml": "^4.1.1",
    "playwright": "^1.60.0",
    "typescript": "^6.0.3"
  }
}
```

`playwright`는 devDependency로만 유지 — `npx playwright install chromium`이 dev 환경 setup 명령으로 살아있게.

- [ ] **Step 2: 재설치 + 회귀**

```bash
rm -rf node_modules package-lock.json
npm install
npm run check
```
Expected: 전체 pass.

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json
git commit -m "phase 72a: playwright moved to devDependency (chromium binary install only)"
```

### Task I2: roadmap.md / architecture.md sync

**Files:**
- Modify: `docs/roadmap.md` (Decisions confirmed #5 갱신, "Playwright stays" 제거)
- Modify: `docs/architecture.md` (runner 정체성 + observe layer 표기 갱신)
- Modify: `AGENTS.md` (필요 시)

- [ ] **Step 1: roadmap.md update**

"Decisions confirmed" #5 "CDP access layer: Playwright stays" 항목을:
- "Decisions confirmed" 에서 "Superseded" 섹션으로 이동
- 새 항목: "CDP access layer: raw CDP via chrome-remote-interface. Phase 64-72 migration completed YYYY-MM-DD."

- [ ] **Step 2: architecture.md update**

"What browser-flow is" line 16:
- "runnable Playwright replay" → "runnable CDP-direct replay using browser-flow's CDP helpers"

Layer Map:
- `observe/` 디렉토리 설명에 "Chrome CDP capture via cdp/" 명시
- `scripts/cdp/` 신규 디렉토리 추가

- [ ] **Step 3: 커밋**

```bash
git add docs/roadmap.md docs/architecture.md
git commit -m "phase 72b: docs sync — roadmap Decisions confirmed #5 superseded; architecture runner = CDP-direct"
```

### Task I3: todo.md + Phase 72 plan doc

**Files:**
- Modify: `tasks/todo.md`
- Create: `tasks/phases/phase-72-playwright-removal-docs.md`

- [ ] **Step 1: todo.md update**

기존 "Active TODO — next-session entry point" 갱신:
- Phase 64-72 완료 마킹
- 다음 단계: breath-search (2b) — 이제 CDP-direct 기반 위에서 Target.setAutoAttach + cross-origin 통일 attach 활용 가능

- [ ] **Step 2: 커밋**

```bash
git add tasks/todo.md tasks/phases/phase-72-playwright-removal-docs.md
git commit -m "phase 72 plan doc + todo update — CDP-direct migration complete; breath-search now unblocked"
```

### Task I4: Final regression marker commit

- [ ] **Step 1: 전체 check**

```bash
npm run check
```
Expected: lint + typecheck + validate-skill + tests 전부 pass.

- [ ] **Step 2: Playwright import 0건 최종 확인 (runtime 코드)**

```bash
grep -rln "from \"playwright\"\|require.*playwright\|chromium\." scripts/
```
Expected: 출력 없음.

- [ ] **Step 3: 마커 commit**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
refactor: CDP-direct full-extreme migration COMPLETE

Phase 64 (foundation) + 65 (observer) + 66 (forward gains) + 67 (analyze)
+ 68 (atomic-fp consumer) + 69 (generate) + 70 (verify) + 71 (tests) +
72 (cleanup) 의 9-phase 작업 완료.

- scripts/cdp/ 신규: client + chrome-binary + session-manager + browser-session
  + locator-resolver + watchdogs (recorder/network/lifecycle/dom/action/
  accessibility/proxy-auth/download)
- scripts/observe/chrome.mjs 삭제, observer-daemon CDP-direct
- scripts/generate/generate-runner.mjs 새 CDP-direct runner template
- scripts/verify/verify-run.mjs subprocess delegation
- 38+ tests 마이그레이션, Playwright runtime import 0건
- package.json: playwright devDependency only

Forward 축 9개 칸 회복:
- Target.setAutoAttach(flatten) ✅ iframe/popup/new tab 통일 attach
- Network raw event ✅ loaderId + redirect chain + raw timing
- Page.lifecycleEvent ✅ 4-level wait + loaderId 매칭
- Fetch.authRequired ✅ 프록시 인증
- Accessibility.getFullAXTree ✅ ARIA name 정확
- Cross-origin target hierarchy ✅
- Click fallback ladder ✅
- Browser.setDownloadBehavior ✅
- Content-Disposition raw ✅

Tier 1 손실 수용:
- runner.mjs는 우리 CDP helper API 위 (Playwright 가독성 X)
- atomic-fp Locator chaining → AX tree + DOM querySelector 재구현
- 38+ tests 마이그레이션 완료

Breath-search (2b) — 이제 CDP-direct 기반 위에서 작업 가능.

PRD line 35 ("Playwright for execution and CDP for observation") 의도
와 사용자 "full extreme" 결정의 합산: observe + execution 모두 CDP-direct.
EOF
)"
```

---

## Self-Review Summary

**Spec coverage:**
- ✅ Observe layer 마이그레이션 (Section B)
- ✅ 9개 forward gain (Section B/C 분산)
- ✅ Analyze 정합성 (Section D)
- ✅ atomic-fp consumer 재구현 (Section E)
- ✅ Generate / runner.mjs 재작성 (Section F)
- ✅ Verify 마이그레이션 (Section G)
- ✅ Test suite 마이그레이션 (Section H)
- ✅ Playwright runtime dep 제거 (Section I)
- ✅ 문서 sync (roadmap, architecture, todo) (Section I)

**Placeholder scan:** 모든 task에 actual code block 또는 명시적 변경 직선 포함. "TBD" 없음. "implement later" 없음.

**Type consistency:**
- `CdpClient` interface는 client.mjs에서 정의, 모든 watchdog가 동일 shape 사용.
- `BrowserSession` interface는 browser-session.mjs에서 정의, observer-daemon/generate/verify 모두 동일.
- `ActionWatchdog.clickBySelector` vs `clickByBackendNodeId` — Task C1에서 selector 진입, Task F2에서 backendNodeId 진입 분리 (의도된 두 entry point).

**Out of scope (다음 plan에서):**
- breath-search (2b) — CDP-direct 기반 완료 후 별도 plan
- composer-agent / dependency-graph (atomic fp 본체 2단계 / Phase 63 original) — CDP-direct 위에서 별도 plan
- knowledge/pages/manual/127.0.0.1/%3cnon-local-url%3e (committed 잔여 — 별도 결정)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-20-cdp-direct-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. 약 36 task 단위로 dispatch.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. 긴 작업 (~3-5일치) — 컨텍스트 관리 주의.

**Which approach?**
