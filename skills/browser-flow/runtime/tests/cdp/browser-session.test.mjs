import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";

test("BrowserSession.launch starts Chrome, connects CDP, exposes sessionManager", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "browser-session-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({
    profileDir,
    debugPort,
    headless: true
  });
  try {
    assert.ok(session.client, "expected client");
    assert.ok(session.sessionManager, "expected sessionManager");
    const targets = session.sessionManager.listPageTargets();
    assert.ok(targets.length >= 1);
  } finally {
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
