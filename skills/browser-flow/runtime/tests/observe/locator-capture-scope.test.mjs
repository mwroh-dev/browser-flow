import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { locatorCaptureSource } from "../../scripts/observe/locator-capture.mjs";

// __bfNeighborTexts(el, scopeRule) — the model-defined scope rule extends
// the harvest to ancestor-sibling (uncle) text. Reference: Google Keep take-a-note,
// where the "메모 작성…" placeholder is the clicked <p>'s parent-sibling (uncle),
// outside the legacy base scope (direct siblings + parent text).
test("__bfNeighborTexts pulls the uncle placeholder only when scopeRule reaches it", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "loc-scope-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);

    const expr = locatorCaptureSource + "\n" + `(function(){
      document.body.innerHTML =
        '<div class="wrap">' +
          '<div role="combobox" tabindex="0">' +
            '<p role="presentation"><br></p>' +
          '</div>' +
          '<div class="ph">메모 작성…</div>' +   /* uncle = parent's sibling */
        '</div>';
      var p = document.querySelector('p[role="presentation"]');
      return {
        base: __bfNeighborTexts(p),
        scoped: __bfNeighborTexts(p, { ancestorUp: 1, includeAncestorSiblingText: true })
      };
    })()`;
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const { base, scoped } = r.result.value;

    // Legacy base scope (direct siblings + parent text) misses the uncle.
    assert.ok(!base.includes("메모 작성…"), `base scope must NOT reach the uncle (got ${JSON.stringify(base)})`);
    // Model-defined scope (climb 1 ancestor, include its siblings) reaches it.
    assert.ok(scoped.includes("메모 작성…"), `scoped harvest must reach the uncle (got ${JSON.stringify(scoped)})`);
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
