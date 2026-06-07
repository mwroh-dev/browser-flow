import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installRecorderWatchdog } from "../../../scripts/cdp/watchdogs/recorder.mjs";
import { recorderInitScript } from "../../../scripts/observe/recorder-script.mjs";

// the recorder snapshots a contentEditable host's identity at FOCUS
// (before typing), and attaches it as preTypingLocator on the focusout input
// event. When the host morphs in place during editing (here: role combobox →
// textbox), the post-typing locator reflects the morphed state but
// preTypingLocator preserves the pre-morph identity — the one replay needs.
test("recorder attaches preTypingLocator (pre-morph identity) to the contentEditable input event", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "rec-pretype-"));
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
    const sid = session.sessionManager.getSessionId(target.targetId);
    const html = "<title>MORPH</title><div id=\"host\" role=\"combobox\" contenteditable=\"true\" style=\"min-height:30px\"></div>";
    await session.client.send("Page.navigate", { url: "data:text/html," + encodeURIComponent(html) }, sid);
    // Let the recorder script install its listeners.
    for (let i = 0; i < 30 && !events.some((e) => e.type === "navigate"); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const ev = (/** @type {string} */ expr) => session.client.send("Runtime.evaluate", { expression: expr }, sid);
    // Real capture fires real focus events; headless programmatic focus()/blur()
    // do not, so dispatch focusin/focusout explicitly to exercise the handlers.
    // Focus (pre-morph: role=combobox) → recorder snapshots preTypingLocator.
    await ev("document.getElementById('host').dispatchEvent(new FocusEvent('focusin',{bubbles:true}))");
    await new Promise((r) => setTimeout(r, 50));
    // Morph the host IN PLACE (same node): role combobox → textbox + content.
    await ev("var h=document.getElementById('host'); h.setAttribute('role','textbox'); h.textContent='note body';");
    // focusout → input event emitted with both locators.
    await ev("document.getElementById('host').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))");

    for (let i = 0; i < 40 && !events.some((e) => e.type === "input"); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const input = events.find((e) => e.type === "input");
    assert.ok(input, "an input event must be emitted on focusout");
    assert.ok(input.preTypingLocator, "input event must carry preTypingLocator (focus-time snapshot)");
    assert.equal(input.preTypingLocator.role, "combobox", "preTypingLocator must hold the PRE-morph role");
    assert.equal(input.locator.role, "textbox", "post-typing locator reflects the morphed role");

    await recorder.dispose();
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
