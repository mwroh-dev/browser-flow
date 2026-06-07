import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForPort, getFreePort } from "../../scripts/lib/net.mjs";
import { connectCdpClient } from "../../scripts/cdp/client.mjs";

test("connectCdpClient connects over CDP and exposes send()", async () => {
  const chromePath =
    process.env.BROWSER_FLOW_CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profileDir = mkdtempSync(join(tmpdir(), "cdp-client-"));
  const debugPort = await getFreePort();
  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  try {
    await waitForPort(debugPort, 15_000);
    const client = await connectCdpClient({ host: "127.0.0.1", port: debugPort });
    const { browserContextIds } = /** @type {{ browserContextIds: unknown[] }} */ (await client.send("Target.getBrowserContexts", {}));
    assert.ok(Array.isArray(browserContextIds));
    await client.close();
  } finally {
    chrome.kill("SIGTERM");
    await new Promise((resolve) => chrome.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
