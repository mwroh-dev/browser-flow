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
async function startWeatherMapServer() {
  const server = http.createServer((request, response) => {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(request.url ?? "/", baseUrl);
    if (url.pathname === "/weather-map") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <section class="map-surface visual-layer">
          <button type="button" class="map_depth_button type_rdr" onclick="location.href='${baseUrl}/weather-map/visual'">레이더</button>
        </section>
        <section class="map-surface point-overlay">
          <button type="button" class="point_overlay_button" onclick="location.href='${baseUrl}/weather-map/overlay'">레이더</button>
        </section>
      </body></html>`);
      return;
    }
    if (url.pathname === "/weather-map/visual") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><h1 data-bf-evidence="visual">Visual radar</h1></body></html>`);
      return;
    }
    if (url.pathname === "/weather-map/overlay") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><h1 data-bf-evidence="overlay">Overlay radar</h1></body></html>`);
      return;
    }
    if (url.pathname === "/generic-surface") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <main id="surface">
          <button id="metric" type="button" data-bf="metric" data-testid="metric" aria-selected="false" class="metric_button"
            onclick="this.setAttribute('aria-selected','true'); this.classList.add('is-selected'); fetch('/api/data?metric=revenue&range=1d').then(() => { const p = document.createElement('p'); p.textContent = 'Revenue chart'; p.setAttribute('data-bf-evidence', 'chart'); document.getElementById('surface').appendChild(p); });">Revenue</button>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/generic-surface-selected-only") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <main id="surface">
          <button id="metric" type="button" data-bf="metric" data-testid="metric" aria-selected="false" class="metric_button"
            onclick="this.setAttribute('aria-selected','true'); this.classList.add('is-selected');">Revenue</button>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/collapsed-option") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <main id="surface">
          <button id="carrier" type="button" class="metric_carrier">Metric</button>
          <button id="metric" type="button" data-bf="metric" class="metric_option"
            onclick="document.getElementById('carrier').textContent = 'Metric Revenue'; this.remove(); fetch('/api/data?metric=revenue&range=1d').then(() => { const p = document.createElement('p'); p.textContent = 'Revenue chart'; document.getElementById('surface').appendChild(p); });">Revenue</button>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/collapsed-option-wrong-carrier") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <main id="surface">
          <button id="carrier" type="button" class="metric_carrier">Metric</button>
          <button id="metric" type="button" data-bf="metric" class="metric_option"
            onclick="document.getElementById('carrier').textContent = 'Metric Cost'; this.remove(); fetch('/api/data?metric=revenue&range=1d').then(() => { const p = document.createElement('p'); p.textContent = 'Revenue chart'; document.getElementById('surface').appendChild(p); });">Revenue</button>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/provider-primer-hidden-option") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head>
        <style>
          .layer_option.hidden-template {
            width: 0;
            height: 0;
            min-width: 0;
            padding: 0;
            border: 0;
            overflow: hidden;
          }
        </style>
      </head><body>
        <main id="surface">
          <button id="carrier" type="button" class="layer_button sat"
            onclick="const option = document.getElementById('rain'); option.classList.remove('hidden-template'); option.style.width = '84px'; option.style.height = '32px';">Layer Satellite</button>
          <button id="rain" type="button" class="layer_option rain hidden-template"
            onclick="this.setAttribute('aria-selected','true'); fetch('/api/data?metric=rain&range=1d').then(() => { const p = document.createElement('p'); p.textContent = 'Rain chart'; document.getElementById('surface').appendChild(p); });">Rain</button>
        </main>
      </body></html>`);
      return;
    }
    if (url.pathname === "/api/data") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, metric: url.searchParams.get("metric") }));
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

function genericStatefulSurfaceWorkflow(runId, startUrl, apiUrl) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl,
    finalUrl: startUrl,
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "[data-bf=\"metric\"]",
        text: "Revenue",
        atomicFp: { strategy: "role", role: "button", name: "Revenue" },
        locator: {
          role: "button",
          name: "Revenue",
          cleanId: "metric",
          structuralKey: "main|button|type=button|metric_button|Revenue"
        },
        providerPostconditions: [
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Revenue",
              structuralKey: "main|button|type=button|metric_button|Revenue",
              states: ["aria-selected", "aria-pressed", "checked", "aria-current", "selected", "class:is-selected", "class:active", "class:on"]
            },
            surface: {
              changed: true,
              targets: [
                { role: "", name: "Revenue chart", structuralKey: "main|p|||Revenue chart" }
              ]
            },
            resources: {
              mode: "family-one-of",
              candidates: [
                {
                  method: "GET",
                  status: 200,
                  host: new URL(apiUrl).host,
                  pathPrefix: "/api/data",
                  query: [{ key: "metric", value: "revenue" }]
                }
              ]
            },
            providerContext: {
              pattern: "rendered-data-surface",
              stateCarrier: "mixed",
              replayStrategy: "state-proof-click",
              confidence: "high"
            }
          }
        ]
      }
    ],
    verification: {
      expectedFinalUrl: startUrl,
      expectedNetwork: null,
      expectedEvidence: null,
      transitionTimeoutMs: 10000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

function collapsedOptionSurfaceWorkflow(runId, startUrl, apiUrl, overrides = {}) {
  const stepProvider = overrides.stepProviderContext || {
    pattern: "rendered-data-surface",
    stateCarrier: "mixed",
    replayStrategy: "state-proof-click",
    surfaceKey: "manual/127.0.0.1/collapsed-option#surface",
    controlGroup: "metric-picker",
    confidence: "high"
  };
  const proofProvider = overrides.proofProviderContext || stepProvider;
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl,
    finalUrl: startUrl,
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "[data-bf=\"metric\"]",
        text: "Revenue",
        atomicFp: { strategy: "role", role: "button", name: "Revenue" },
        locator: {
          role: "button",
          name: "Revenue",
          cleanId: "metric",
          structuralKey: "body>main|button|type=button|metric_option|Revenue",
          identityKey: "body>main|button|type=button|metric_option|option",
          identityShape: "body>main|button|type=button|metric_option|",
          controlKind: "option",
          textParts: ["Revenue"]
        },
        providerContext: stepProvider,
        providerPostconditions: [
          {
            kind: "stateful-surface-proof",
            control: {
              role: "button",
              name: "Revenue",
              structuralKey: "body>main|button|type=button|metric_option|Revenue",
              identityKey: "body>main|button|type=button|metric_option|option",
              identityShape: "body>main|button|type=button|metric_option|",
              controlKind: "option",
              textParts: ["Revenue"],
              states: ["aria-selected", "aria-pressed", "checked", "aria-current", "selected", "class:is-selected", "class:active", "class:on"]
            },
            surface: {
              changed: true,
              targets: overrides.surfaceTargets || [
                { role: "button", name: "Metric Revenue", structuralKey: "body>main|button|type=button|metric_carrier|Metric Revenue", controlKind: "carrier" },
                { role: "", name: "Revenue chart", structuralKey: "body>main|p|||Revenue chart" }
              ]
            },
            resources: {
              mode: "family-one-of",
              candidates: [
                {
                  method: "GET",
                  status: 200,
                  host: new URL(apiUrl).host,
                  pathPrefix: "/api/data",
                  query: [{ key: "metric", value: "revenue" }]
                }
              ]
            },
            providerContext: proofProvider
          }
        ]
      }
    ],
    verification: {
      expectedFinalUrl: startUrl,
      expectedNetwork: null,
      expectedEvidence: null,
      transitionTimeoutMs: 10000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

function providerPrimerHiddenOptionWorkflow(runId, startUrl, apiUrl) {
  const providerContext = {
    pattern: "layered-control-surface",
    stateCarrier: "canvas-tile",
    replayStrategy: "state-proof-click",
    surfaceKey: "manual/127.0.0.1/provider-primer-hidden-option#surface",
    controlGroup: "visual-layer",
    confidence: "high"
  };
  const rainLocator = {
    role: "button",
    name: "Rain",
    structuralKey: "body>main|button|type=button|layer_option.rain|Rain",
    identityKey: "body>main|button|type=button|layer_option|option",
    identityShape: "body>main|button|type=button|layer_option.rain|",
    controlKind: "option",
    textParts: ["Rain"]
  };
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl,
    finalUrl: startUrl,
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "button",
        text: "Layer Satellite",
        pageKey: "manual/127.0.0.1/provider-primer-hidden-option",
        locator: {
          role: "button",
          name: "Layer Satellite",
          structuralKey: "body>main|button|type=button|layer_button.sat|Layer Satellite",
          identityKey: "body>main|button|type=button|layer_button|carrier",
          identityShape: "body>main|button|type=button|layer_button|",
          controlKind: "carrier",
          textParts: ["Layer", "Satellite"]
        },
        providerContext,
        providerPrimerEvidence: [
          {
            kind: "provider-proxy-primer",
            candidateId: "cn1",
            evidenceRole: "provider-proxy-before-trusted-action",
            text: "Satellite",
            eventIndexes: [1, 2],
            providerContext
          }
        ],
        providerPostconditions: [
          {
            kind: "reveals-next-action",
            target: rainLocator,
            nextStepIndex: 2,
            nextActionSeq: 3,
            providerContext
          }
        ]
      },
      {
        action: "click",
        selector: "button",
        text: "Rain",
        pageKey: "manual/127.0.0.1/provider-primer-hidden-option",
        locator: rainLocator,
        providerContext,
        providerPostconditions: [
          {
            kind: "stateful-surface-proof",
            control: {
              ...rainLocator,
              states: ["aria-selected", "aria-pressed", "checked", "aria-current", "selected", "class:is-selected", "class:active", "class:on"]
            },
            surface: {
              changed: true,
              targets: [
                { role: "", name: "Rain chart", structuralKey: "body>main|p|||Rain chart" }
              ]
            },
            resources: {
              mode: "family-one-of",
              candidates: [
                {
                  method: "GET",
                  status: 200,
                  host: new URL(apiUrl).host,
                  pathPrefix: "/api/data",
                  query: [{ key: "metric", value: "rain" }]
                }
              ]
            },
            providerContext
          }
        ]
      }
    ],
    verification: {
      expectedFinalUrl: startUrl,
      expectedNetwork: null,
      expectedEvidence: null,
      transitionTimeoutMs: 10000
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  };
}

test("verify replays same-name weather-map controls through deterministic surface context", { timeout: 120000 }, async () => {
  const runId = `verify-weather-map-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/weather-map`;
    const finalUrl = `${server.baseUrl}/weather-map/visual`;

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
          selector: "button",
          text: "레이더",
          expectUrl: finalUrl,
          locator: {
            role: "button",
            name: "레이더"
          },
          surfaceContext: {
            kind: "weather-map",
            surfaceKey: "manual/127.0.0.1/weather-map#weather-map",
            controlGroup: "visual-layer"
          }
        }
      ],
      verification: {
        expectedFinalUrl: finalUrl,
        expectedNetwork: null,
        expectedEvidence: { selector: "[data-bf-evidence=\"visual\"]", textIncludes: "Visual radar" },
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
    assert.equal(result.report.replayOutcome, "passed", `weather-map surface context should disambiguate same-name controls — ${JSON.stringify(result.report)}`);
  } finally {
    await server.close();
  }
});

test("verify does not skip provider primer when reveal target is hidden zero-box", { timeout: 120000 }, async () => {
  const runId = `verify-provider-primer-hidden-option-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/provider-primer-hidden-option`;
    writeJson(runPaths.workflowJsonPath, providerPrimerHiddenOptionWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=rain&range=1d`));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.replayOutcome, "passed", `hidden zero-box target should not skip provider opener — ${JSON.stringify(result.report)}`);
    assert.deepEqual(result.report.executedSteps, ["goto", "click", "click"]);
    assert.deepEqual(result.report.alreadyPresentSteps || [], []);
  } finally {
    await server.close();
  }
});

test("verify passes generic stateful surface proof with selected control and resource family", { timeout: 120000 }, async () => {
  const runId = `verify-generic-stateful-surface-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/generic-surface`;
    writeJson(runPaths.workflowJsonPath, genericStatefulSurfaceWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=revenue&range=1d`));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.replayOutcome, "passed", `generic stateful surface should pass with selected control plus resource family — ${JSON.stringify(result.report)}`);
  } finally {
    await server.close();
  }
});

test("verify fails closed when stateful surface proof has selected control only", { timeout: 120000 }, async () => {
  const runId = `verify-generic-stateful-surface-negative-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/generic-surface-selected-only`;
    writeJson(runPaths.workflowJsonPath, genericStatefulSurfaceWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=revenue&range=1d`));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.failureReason, "provider-postcondition-failed");
    assert.deepEqual(result.report.providerDiagnostics.missing, [
      "surface-render: unknown",
      "resource-family: missing"
    ]);
    assert.match(result.report.error, /resource-family: missing|surface-render: unknown/);
  } finally {
    await server.close();
  }
});

test("verify accepts collapsed option state projected onto same-surface carrier", { timeout: 120000 }, async () => {
  const runId = `verify-collapsed-option-projection-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/collapsed-option`;
    writeJson(runPaths.workflowJsonPath, collapsedOptionSurfaceWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=revenue&range=1d`));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.replayOutcome, "passed", `collapsed option should pass with same-surface carrier projection — ${JSON.stringify(result.report)}`);
  } finally {
    await server.close();
  }
});

test("verify rejects collapsed option when projected carrier has the wrong value", { timeout: 120000 }, async () => {
  const runId = `verify-collapsed-option-wrong-value-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/collapsed-option-wrong-carrier`;
    writeJson(runPaths.workflowJsonPath, collapsedOptionSurfaceWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=revenue&range=1d`, {
      surfaceTargets: [
        { role: "button", name: "Metric Cost", structuralKey: "body>main|button|type=button|metric_carrier|Metric Cost", controlKind: "carrier" },
        { role: "", name: "Revenue chart", structuralKey: "body>main|p|||Revenue chart" }
      ]
    }));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.failureReason, "provider-postcondition-failed");
    assert.match(result.report.error, /control-state: failed/);
  } finally {
    await server.close();
  }
});

test("verify rejects collapsed option projection across different surface context", { timeout: 120000 }, async () => {
  const runId = `verify-collapsed-option-wrong-context-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startWeatherMapServer();
  try {
    const startUrl = `${server.baseUrl}/collapsed-option`;
    writeJson(runPaths.workflowJsonPath, collapsedOptionSurfaceWorkflow(runId, startUrl, `${server.baseUrl}/api/data?metric=revenue&range=1d`, {
      proofProviderContext: {
        pattern: "rendered-data-surface",
        stateCarrier: "mixed",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/127.0.0.1/other#surface",
        controlGroup: "metric-picker",
        confidence: "high"
      }
    }));

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    assert.equal(result.report.failureReason, "provider-postcondition-failed");
    assert.match(result.report.error, /control-state: failed/);
  } finally {
    await server.close();
  }
});
