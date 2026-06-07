import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../../scripts/cdp/watchdogs/action.mjs";

// typeIntoBackendNodeId must handle a NON-FOCUSABLE host inside a
// contentEditable composer (e.g. Google Keep's note body: <p role=presentation>
// inside a contenteditable div). DOM.focus rejects the <p>; the watchdog must
// click it to focus the editing host, then insert. This is exactly the path that
// unblocked the real-Keep step3 body fill.
test("typeIntoBackendNodeId: non-focusable <p> in a contentEditable falls back to click-focus then inserts", async () => {
  const html = "<!doctype html><html><body style=\"margin:40px\">" +
    "<div id=\"ce\" contenteditable=\"true\" style=\"min-height:60px;border:1px solid #ccc;padding:10px;width:320px\">" +
    "<p role=\"presentation\" style=\"margin:0;min-height:22px\"><br></p></div></body></html>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "act-ce-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const { client, sessionManager } = session;
    const sid = sessionManager.getSessionId(target.targetId);
    const doc = /** @type {any} */ (await client.send("DOM.getDocument", { depth: -1, pierce: true }, sid));
    const found = /** @type {any} */ (await client.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "p[role=\"presentation\"]"
    }, sid));
    const desc = /** @type {any} */ (await client.send("DOM.describeNode", { nodeId: found.nodeId }, sid));
    const pBackendNodeId = desc.node.backendNodeId;

    // The <p> is not focusable — this would throw "Element is not focusable"
    // without the click-focus fallback.
    await action.typeIntoBackendNodeId(target.targetId, pBackendNodeId, "안녕 메모");

    const r = /** @type {any} */ (await client.send("Runtime.evaluate", {
      expression: "document.getElementById('ce').innerText",
      returnByValue: true
    }, sid));
    assert.match(String(r.result.value || ""), /안녕 메모/, "text must be inserted into the contentEditable editing host");
  } finally {
    await action.dispose();
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
