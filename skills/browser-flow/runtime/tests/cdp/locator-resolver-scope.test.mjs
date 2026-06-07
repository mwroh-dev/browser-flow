import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { resolveLocator } from "../../scripts/cdp/locator-resolver.mjs";

// end-to-end (synthetic Keep pattern): three identical empty
// <p role=presentation> "take a note" boxes; only block A has the distinctive
// "메모 작성…" placeholder as its parent-sibling (uncle). Proves the chain:
//   signal-poor (no anchor)            → resolver fail-safes (ambiguous)
//   scope-agent enrichment (anchor + scopeRule) → resolver picks the RIGHT p.
const KEEP_PAGE = "data:text/html," + encodeURIComponent(
  "<!doctype html><meta charset=utf-8><body>" +
  '<div class="wrap"><div role="combobox" tabindex="0"><p data-bf-id="A" role="presentation"><br></p></div><div class="ph">메모 작성…</div></div>' +
  '<div class="wrap"><div role="combobox" tabindex="0"><p data-bf-id="B" role="presentation"><br></p></div><div class="ph">다른 입력칸</div></div>' +
  '<div class="wrap"><div role="combobox" tabindex="0"><p data-bf-id="C" role="presentation"><br></p></div><div class="ph">또 다른 영역</div></div>' +
  "</body>"
);

/**
 * Read an attribute off a resolved backendNodeId via DOM.describeNode.
 * @param {any} session @param {any} sid @param {number} backendNodeId @param {string} attr
 */
async function attrOf(session, sid, backendNodeId, attr) {
  const d = /** @type {any} */ (await session.client.send("DOM.describeNode", { backendNodeId }, sid));
  const a = (d.node && d.node.attributes) || [];
  for (let i = 0; i < a.length; i += 2) if (a[i] === attr) return a[i + 1];
  return undefined;
}

/** @param {(session: any, targetId: any) => Promise<any>} fn */
async function withPage(fn) {
  const profileDir = mkdtempSync(join(tmpdir(), "lr-scope-e2e-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, KEEP_PAGE, { waitUntil: "load" });
    return await fn(session, target.targetId);
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
}

test("signal-poor empty <p> (no anchor) → resolver fail-safes (ambiguous)", async () => {
  await withPage(async (session, targetId) => {
    // Captured locator with NO distinguishing signal — the Gap2 Keep state.
    const step = { locator: { role: "presentation", name: "", structuralKey: "div>div>p|role=presentation||", neighborTexts: [] } };
    await assert.rejects(
      () => resolveLocator(session, targetId, step),
      /ambiguous/,
      "3 identical empty presentation paragraphs must drift-hold (no wrong click)"
    );
  });
});

test("scope-agent enrichment (anchor + scopeRule) → resolver picks the RIGHT <p>", async () => {
  await withPage(async (session, targetId) => {
    const sid = session.sessionManager.getSessionId(targetId);
    // What applyScope writes: target neighborText anchor + the candidate harvest rule.
    const step = {
      locator: {
        role: "presentation",
        name: "",
        structuralKey: "div>div>p|role=presentation||",
        neighborTexts: ["메모 작성…"],
        disambiguation: {
          scopeRule: { ancestorUp: 1, includeAncestorSiblingText: true },
          weightOverrides: { structuralKey: 0.5 }
        }
      }
    };
    const result = await resolveLocator(session, targetId, step);
    assert.equal(result.confidence, "high", "anchor must lift confidence to high");
    const id = await attrOf(session, sid, result.backendNodeId, "data-bf-id");
    assert.equal(id, "A", `resolver must pick block A's <p> (the one with the '메모 작성…' uncle), got ${id}`);
  });
});
