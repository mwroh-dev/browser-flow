import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installRecorderWatchdog } from "../../../scripts/cdp/watchdogs/recorder.mjs";
import { installActionWatchdog } from "../../../scripts/cdp/watchdogs/action.mjs";
import { recorderInitScript } from "../../../scripts/observe/recorder-script.mjs";

test("recorder watchdog injects script and routes bindingCalled events", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "rec-wd-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  try {
    /** @type {any[]} */
    const events = [];
    const recorder = await installRecorderWatchdog(session, {
      onEvent: (event) => events.push(event),
      bindingName: "__browserFlowRecord",
      // CDP Runtime.addBinding payload must be a string — script must JSON.stringify
      script: `(() => { window.__browserFlowRecord(JSON.stringify({ type: 'test', value: 42 })); })();`
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
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("recorder records navigate from the main frame only (iframe navigations suppressed)", async () => {
  // Real-site finding (Google Keep): the injected recorder script is installed
  // into every frame, so cross-origin telemetry/auth iframes (notes-pa, ogs,
  // feedback proxies) each emit their own navigate event — noise that pollutes
  // start/final URL derivation. The main-frame guard suppresses subframe navs.
  const profileDir = mkdtempSync(join(tmpdir(), "rec-frame-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  try {
    /** @type {any[]} */
    const events = [];
    const recorder = await installRecorderWatchdog(session, {
      onEvent: (event) => events.push(event),
      bindingName: "__browserFlowRecord",
      script: recorderInitScript
    });

    const [target] = session.sessionManager.listPageTargets();
    const sessionId = session.sessionManager.getSessionId(target.targetId);
    // Main document (title MAINPAGE) embedding a nested document (title IFRAMECHILD).
    // The recorder is injected into both frames; only the main-frame navigate must
    // be recorded. We discriminate by document.title carried on the navigate event.
    const child = "data:text/html," + encodeURIComponent("<title>IFRAMECHILD</title>child");
    const main = "data:text/html," + encodeURIComponent(`<title>MAINPAGE</title>main<iframe src="${child}"></iframe>`);
    await session.client.send("Page.navigate", { url: main }, sessionId);

    for (let i = 0; i < 30 && !events.some((e) => e.type === "navigate"); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // give any (suppressed) iframe navigate a chance to arrive too
    await new Promise((r) => setTimeout(r, 500));

    const navs = events.filter((e) => e.type === "navigate");
    assert.ok(navs.some((n) => n.text === "MAINPAGE"), "main-frame navigate must be recorded");
    assert.ok(
      navs.every((n) => n.text !== "IFRAMECHILD"),
      "iframe navigate must be suppressed by the main-frame guard"
    );

    await recorder.dispose();
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("recorder emits actionId-linked interrupted toggle diffs before the final settled reveal", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "rec-toggle-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  try {
    /** @type {any[]} */
    const events = [];
    const recorder = await installRecorderWatchdog(session, {
      onEvent: (event) => events.push(event),
      bindingName: "__browserFlowRecord",
      script: recorderInitScript
    });
    const action = await installActionWatchdog(session);

    const [target] = session.sessionManager.listPageTargets();
    const sessionId = session.sessionManager.getSessionId(target.targetId);
    const page = "data:text/html," + encodeURIComponent(`
      <header>
        <nav>
          <a data-bf="expand" role="button" href="/">Expand menu</a>
          <ul id="links"></ul>
        </nav>
      </header>
      <script>
        const toggle = document.querySelector('[data-bf="expand"]');
        const list = document.getElementById('links');
        let isOpen = false;
        function render() {
          toggle.textContent = isOpen ? 'Collapse menu' : 'Expand menu';
          toggle.setAttribute('href', isOpen ? '#' : '/');
          list.innerHTML = isOpen ? '<li><a data-bf="weather" href="/weather">Weather</a></li>' : '';
        }
        toggle.addEventListener('click', (event) => {
          event.preventDefault();
          isOpen = !isOpen;
          render();
        });
        render();
      </script>
    `);
    await session.client.send("Page.navigate", { url: page }, sessionId);
    for (let i = 0; i < 30 && !events.some((event) => event.type === "navigate"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await action.clickBySelector(target.targetId, '[data-bf="expand"]');
    await action.clickBySelector(target.targetId, '[data-bf="expand"]');
    await action.clickBySelector(target.targetId, '[data-bf="expand"]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < 30 && !events.some((event) => event.type === "click" && event.text === "Weather"); i += 1) {
      try {
        await action.clickBySelector(target.targetId, '[data-bf="weather"]');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    for (let i = 0; i < 30 && events.filter((event) => event.type === "action-diff").length < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const clicks = events.filter((event) => event.type === "click");
    const diffs = events.filter((event) => event.type === "action-diff");
    assert.ok(clicks.length >= 4, `expected >=4 clicks, got ${clicks.length}`);
    assert.ok(clicks.slice(0, 4).every((event) => typeof event.actionId === "string" && event.actionId.length > 0));
    assert.ok(clicks.slice(0, 4).every((event) => Number.isInteger(event.actionSeq) && event.actionSeq > 0));
    assert.ok(clicks.slice(0, 4).every((event) => typeof event.documentId === "string" && event.documentId.length > 0));
    assert.equal(new Set(clicks.slice(0, 4).map((event) => event.actionSeq)).size, 4);
    assert.equal(diffs.slice(0, 3).map((event) => event.settleStatus).join(","), "interrupted,interrupted,settled");
    assert.equal(diffs.slice(0, 3).every((event, index) => event.actionId === clicks[index].actionId), true);
    assert.equal(diffs.slice(0, 3).every((event, index) => event.actionSeq === clicks[index].actionSeq), true);
    assert.equal(diffs.slice(0, 3).every((event, index) => event.documentId === clicks[index].documentId), true);

    await action.dispose();
    await recorder.dispose();
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("recorder classifies content-area clicks as observation and native controls as interactive", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "rec-action-kind-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  try {
    /** @type {any[]} */
    const events = [];
    const recorder = await installRecorderWatchdog(session, {
      onEvent: (event) => events.push(event),
      bindingName: "__browserFlowRecord",
      script: recorderInitScript
    });
    const action = await installActionWatchdog(session);

    const [target] = session.sessionManager.listPageTargets();
    const sessionId = session.sessionManager.getSessionId(target.targetId);
    const page = "data:text/html," + encodeURIComponent(`
      <main data-bf="content" role="main" style="display:block;width:600px;height:320px;padding:24px;border:1px solid #ccc">
        <section>
          <p id="sunset">Sunset PM 19:44</p>
        </section>
        <button id="run" type="button">Run</button>
      </main>
    `);
    await session.client.send("Page.navigate", { url: page }, sessionId);
    for (let i = 0; i < 30 && !events.some((event) => event.type === "navigate"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await action.clickBySelector(target.targetId, "#sunset");
    await action.clickBySelector(target.targetId, "#run");
    for (let i = 0; i < 30 && events.filter((event) => event.type === "click").length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const clicks = events.filter((event) => event.type === "click");
    const observation = clicks.find((event) => event.text.includes("Sunset"));
    const interactive = clicks.find((event) => event.text === "Run");

    assert.ok(observation, "content-area click must be recorded");
    assert.equal(observation.actionKind, "observation");
    assert.equal(observation.role, "main");
    assert.match(observation.observedTextSummary, /Sunset PM 19:44/);
    assert.ok(interactive, "native button click must be recorded");
    assert.equal(interactive.actionKind, "interactive");
    assert.equal(interactive.role, "button");

    await action.dispose();
    await recorder.dispose();
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
