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
 * Minimal session shape required by watchdogs and action helpers.
 * Both BrowserSession (spawned) and ConnectedBrowserSession (connect-only) satisfy this.
 *
 * @typedef {Object} CdpSession
 * @property {import("./client.mjs").CdpClient} client
 * @property {import("./session-manager.mjs").SessionManager} sessionManager
 * @property {() => Promise<void>} dispose
 */

/**
 * @typedef {Object} ConnectedBrowserSession
 * @property {import("./client.mjs").CdpClient} client
 * @property {import("./session-manager.mjs").SessionManager} sessionManager
 * @property {() => Promise<void>} dispose
 */

/**
 * Build Chrome launch args. Always binds the DevTools endpoint to loopback
 * (127.0.0.1) and strips any caller attempt to rebind the address — the CDP
 * remote-debugging port must never be reachable off-host.
 * @param {BrowserSessionOptions} options
 * @returns {string[]}
 */
export function buildChromeArgs(options) {
  const raw = options.extraArgs ?? [];
  const extra = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (/^--remote-debugging-address(=|$)/.test(raw[i])) {
      // also skip a space-separated value (e.g. ["--remote-debugging-address","0.0.0.0"])
      if (!raw[i].includes("=") && i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
        i += 1;
      }
      continue;
    }
    extra.push(raw[i]);
  }
  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-features=ChromeSigninPromo,SigninIntercept,ProfilePickerOnStartup",
    ...extra,
    "about:blank"
  ];
  if (options.headless) args.unshift("--headless=new");
  return args;
}

/**
 * @param {BrowserSessionOptions} options
 * @returns {Promise<BrowserSession>}
 */
export async function createBrowserSession(options) {
  const chromePath = options.chromePath ?? resolveChromeBinary();
  const args = buildChromeArgs(options);

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

/**
 * Connect to an already-running Chrome instance without spawning a new one.
 * The caller is responsible for managing the Chrome process lifecycle.
 *
 * @param {number} debugPort
 * @returns {Promise<ConnectedBrowserSession>}
 */
export async function connectToExistingChrome(debugPort) {
  const client = await connectCdpClient({ port: debugPort });
  const sessionManager = await createSessionManager(client);

  return {
    client,
    sessionManager,
    async dispose() {
      await sessionManager.dispose();
      await client.close();
      // Do NOT kill the Chrome process — it was not spawned here.
    }
  };
}
