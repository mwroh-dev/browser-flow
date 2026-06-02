import { createBrowserSession } from "../cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../cdp/watchdogs/lifecycle.mjs";
import { getStringOption } from "../lib/args.mjs";
import { getAttachProfileDir, getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { parseWorkflowArtifact } from "../lib/schemas.mjs";

const DEFAULT_PORT = 9222;

/**
 * Launch a VISIBLE Chrome on a stable profile + remote-debugging-port and keep
 * it alive (until Ctrl+C). The human logs into the real site in this window and
 * leaves it open; `bf verify --attach <port>` then connects to it. Auth lives in
 * the user's Chrome only — never captured to keychain/artifacts (agent-blind).
 *
 * @param {Record<string, string | boolean>} options
 */
export async function serveBrowserCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  const portRaw = getStringOption(options, "port", undefined);
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`serve-browser: invalid --port "${portRaw ?? ""}".`);
  }

  // Resolve the login site: --url override, else the workflow's login precondition.
  let siteUrl = getStringOption(options, "url", undefined);
  if (!siteUrl) {
    if (!runId) {
      throw new Error("serve-browser requires --run-id (or --url).");
    }
    const runPaths = getRunPaths(runId);
    const workflowDoc = parseWorkflowArtifact(
      readJson(runPaths.workflowJsonPath),
      runPaths.workflowJsonPath
    );
    const preconditions = /** @type {Array<{kind: string, site: string}> | undefined} */ (
      workflowDoc.preconditions
    );
    const rawSite = preconditions?.find((p) => p.kind === "login")?.site;
    if (rawSite) {
      siteUrl = rawSite.startsWith("http://") || rawSite.startsWith("https://") ? rawSite : "https://" + rawSite;
    }
  }

  const profileDir = getAttachProfileDir(runId ?? "default");
  const bs = await createBrowserSession({ profileDir, debugPort: port, headless: false });

  // Navigate to the login site best-effort (the user can also navigate manually).
  if (siteUrl) {
    const [target] = bs.sessionManager.listPageTargets();
    if (target) {
      try {
        const lifecycle = await installLifecycleWatchdog(bs);
        await lifecycle.navigateAndWait(target.targetId, siteUrl, { waitUntil: "load", timeoutMs: 30_000 });
        await lifecycle.dispose();
      } catch (_navErr) {
        // Non-fatal — browser is open; human can navigate manually.
      }
    }
  }

  process.stdout.write(
    `serve-browser: Chrome가 port ${port} 에서 실행 중입니다.\n` +
      `  profile : ${profileDir}\n` +
      (siteUrl ? `  page    : ${siteUrl}\n` : "") +
      `  이 창에서 로그인한 뒤 창을 그대로 유지하세요.\n` +
      `  다른 터미널: node scripts/cli.mjs verify --run-id ${runId ?? "<id>"} --attach ${port}\n` +
      `  종료: 이 터미널에서 Ctrl+C\n`
  );

  // Block until SIGINT/SIGTERM, keeping the spawned Chrome alive for attach.
  await new Promise((resolve) => {
    const shutdown = async () => {
      process.stdout.write("\nserve-browser: 종료합니다 (Chrome 닫음).\n");
      try {
        await bs.dispose();
      } catch (_e) {
        // ignore dispose errors on shutdown
      }
      resolve(undefined);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
