import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

async function startLayeredProviderServer() {
  const server = http.createServer((request, response) => {
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const url = new URL(request.url ?? "/", baseUrl);
    if (url.pathname === "/layered-map") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <main>
          <button id="video" data-bf="video-layer" type="button" class="map_item_button type_sat"
            onclick="document.getElementById('depth').hidden=false">영상 위성</button>
          <div id="depth" hidden>
            <button id="maple" data-bf="maple-layer" type="button" class="map_depth_button type_maple"
              onclick="
                document.getElementById('video').textContent='영상 강수예측';
                fetch('/api/maple?photoType=maple').then(() => {
                  document.querySelector('[data-bf-evidence=map-state]').textContent='maple';
                });
              ">강수예측</button>
          </div>
          <output data-bf-evidence="map-state">sat</output>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/api/maple") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, photoType: "maple" }));
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
    baseUrl: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined)));
    }
  };
}

test("verify replays layered provider parent opener before child control", { timeout: 120000 }, async () => {
  const runId = `verify-step-ledger-provider-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startLayeredProviderServer();
  try {
    const startUrl = `${server.baseUrl}/layered-map`;
    const networkUrl = `${server.baseUrl}/api/maple?photoType=maple`;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: startUrl,
      steps: [
        { action: "goto", url: startUrl, pageKey: "manual/127.0.0.1/layered-map" },
        {
          action: "click",
        selector: "#video",
          text: "영상 위성",
          pageKey: "manual/127.0.0.1/layered-map",
          locator: {
          role: "button",
          name: "영상 위성",
          cleanId: "video",
          structuralKey: "main>button|button|type=button|map_item_button.type_sat|영상 위성"
        },
        atomicFp: { strategy: "role", role: "button", name: "영상 위성" },
          postconditions: [
            {
              kind: "reveals-next-action",
              target: {
                role: "button",
                name: "강수예측",
                structuralKey: "main>div>button|button|type=button|map_depth_button.type_maple|강수예측"
              },
              nextStepIndex: 2,
              nextActionSeq: 1002
            }
          ],
          providerContext: {
            pattern: "layered-control-surface",
            stateCarrier: "mixed",
            replayStrategy: "state-proof-click",
            surfaceKey: "manual/127.0.0.1/layered-map#map",
            controlGroup: "visual-layer",
            confidence: "high"
          }
        },
        {
          action: "click",
        selector: "#maple",
          text: "강수예측",
          pageKey: "manual/127.0.0.1/layered-map",
          locator: {
          role: "button",
          name: "강수예측",
          cleanId: "maple",
          structuralKey: "main>div>button|button|type=button|map_depth_button.type_maple|강수예측"
        },
        atomicFp: { strategy: "role", role: "button", name: "강수예측" },
          preconditions: [
            {
              kind: "previous-step-postcondition",
              previousStepIndex: 1,
              previousActionSeq: 1001,
              target: {
                role: "button",
                name: "강수예측",
                structuralKey: "main>div>button|button|type=button|map_depth_button.type_maple|강수예측"
              }
            }
          ]
        }
      ],
      verification: {
        expectedFinalUrl: startUrl,
        expectedNetwork: { url: networkUrl, method: "GET", status: 200 },
        expectedEvidence: { selector: "[data-bf-evidence=\"map-state\"]", textIncludes: "maple" },
        proofs: [
          { kind: "final-url", expectedUrl: startUrl, required: true },
          { kind: "network", url: networkUrl, method: "GET", status: 200, required: true },
          { kind: "dom-evidence", selector: "[data-bf-evidence=\"map-state\"]", textIncludes: "maple", required: true },
          {
            kind: "provider-transaction",
            stepIndex: 1,
            postconditions: [
              {
                kind: "reveals-next-action",
                target: { role: "button", name: "강수예측" },
                nextStepIndex: 2
              }
            ],
            providerContext: {
              pattern: "layered-control-surface",
              stateCarrier: "mixed",
              replayStrategy: "state-proof-click",
              surfaceKey: "manual/127.0.0.1/layered-map#map",
              controlGroup: "visual-layer",
              confidence: "high"
            },
            required: true
          }
        ],
        transitionTimeoutMs: 10000
      },
      security: {
        localOnly: true,
        installScope: "project-local",
        targetScope: "local",
        sanitizedArtifactsOnly: true,
        screenshotMode: "off",
        screenshotsPersisted: false
      },
      segments: [{ range: [0, 2], name: "layered provider", startPageKey: "manual/127.0.0.1/layered-map", endPageKey: "manual/127.0.0.1/layered-map" }],
      compounds: [],
      workflowGraph: { edges: [] },
      safety: {
        irreversibleStepIndexes: [],
        consentRequired: false,
        sandbox: { available: false, location: null }
      },
      tabCount: 1,
      revealCandidates: [],
      scopeCandidates: []
    });

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.replayOutcome, "passed", JSON.stringify(result.report, null, 2));
    const proofChecks = Array.isArray(result.report.proofChecks) ? result.report.proofChecks : [];
    assert.equal(
      proofChecks.some((proof) => proof.kind === "provider-transaction" && proof.passed === true),
      true
    );
  } finally {
    await server.close();
  }
});
