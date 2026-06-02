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

  // Browser-level command — no sessionId argument
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
