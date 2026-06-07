import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

/**
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
async function startCanonicalServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><h1 data-bf-evidence="done">Done</h1></body></html>`);
      return;
    }
    if (url.pathname === "/start") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><a data-bf="open" href="${baseUrl}/">Open weather</a></body></html>`);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)));
    }
  };
}

test("verify tolerates canonical-equivalent href and final-url differences for manual HTTP flows", { timeout: 120000 }, async () => {
  const runId = `verify-url-canon-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startCanonicalServer();
  try {
    const startUrl = `${server.baseUrl}/start`;
    const finalUrl = server.baseUrl;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl,
      steps: [
        { action: "goto" },
        {
          action: "click",
          selector: "[data-bf=\"open\"]",
          text: "Open weather",
          href: finalUrl,
          expectUrl: finalUrl,
          atomicFp: { strategy: "role", role: "link", name: "Open weather" }
        }
      ],
      verification: {
        expectedFinalUrl: finalUrl,
        expectedNetwork: null,
        expectedEvidence: { selector: "[data-bf-evidence=\"done\"]", textIncludes: "Done" },
        transitionTimeoutMs: 10000
      },
      security: {
        localOnly: true,
        sanitizedArtifactsOnly: true,
        screenshotsPersisted: false
      }
    });

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });

    assert.equal(result.report.replayOutcome, "passed", `canonical-equivalent URLs should not hold replay — ${JSON.stringify(result.report)}`);
    assert.equal(result.report.pathComplete, true, `canonical-equivalent URLs should complete the path — ${JSON.stringify(result.report)}`);
  } finally {
    await server.close();
  }
});
