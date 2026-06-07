import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../../scripts/cdp/browser-session.mjs";
import { installNetworkWatchdog } from "../../../scripts/cdp/watchdogs/network.mjs";
import { startFixtureServer } from "../../../scripts/fixtures/site-server.mjs";

test("network watchdog emits contentDisposition on PDF attachment response", async () => {
  const fixture = await startFixtureServer();
  const profileDir = mkdtempSync(join(tmpdir(), "att-det-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  /** @type {object[]} */
  const events = [];
  const watchdog = await installNetworkWatchdog(session, { onEvent: (e) => events.push(e) });
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    // Deny downloads so the attachment is NOT written to the OS default
    // download dir (~/Downloads). This test only inspects the network.response
    // event (headers arrive before the download is denied), so denying keeps the
    // assertions intact while preventing a test.pdf leak. Browser-level command.
    await session.client.send("Browser.setDownloadBehavior", { behavior: "deny" });
    // PDF responses do not fire DOMContentLoaded — use raw CDP navigate and
    // wait a fixed interval for network events to flow through.
    await session.client.send("Page.navigate", { url: `${fixture.baseUrl}/pdf-fixture` }, sid);
    await new Promise((r) => setTimeout(r, 2000));
    const responses = events.filter((e) => /** @type {any} */ (e).type === "network.response");
    assert.ok(responses.length >= 1, "expected at least one network.response event");
    const pdfResponse = responses.find(
      (e) => /** @type {any} */ (e).mimeType?.includes("pdf")
    );
    assert.ok(pdfResponse !== undefined, "expected a response with mimeType containing 'pdf'");
    assert.ok(
      /** @type {any} */ (pdfResponse).contentDisposition?.includes("attachment"),
      "expected contentDisposition to contain 'attachment'"
    );
  } finally {
    await watchdog.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    await fixture.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
