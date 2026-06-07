// ⚠️ HISTORICAL — PRE-CDP SNAPSHOT (2026-05-19). This exhibit predates the
// CDP-direct migration and uses Playwright on purpose; it is NOT the current
// generator output and is NOT executable as committed. For the current
// runner shape see scripts/generate/generate-runner.mjs (emits a CDP-direct
// runner — no playwright import) or any artifacts/runs/<id>/generated/runner.mjs.
// Frozen reference snapshot — pipeline-generated runner for the synthetic
// fixture. Produced by running `tests/e2e/full-loop.test.mjs` with the
// "synthetic fixture" test on 2026-05-19, then copying the
// `generated/runner.mjs` from the resulting run directory
// (`artifacts/runs/full-synth-1779124975469/generated/runner.mjs`).
//
// NOT executable as committed:
//   - Header above the shebang breaks the executable invariant by design.
//   - Relative imports (`../../../../scripts/...`) are anchored to the
//     original artifact location, not to `docs/baseline/`.
//   - `reportPath` on the line below is a hard-coded absolute path on the
//     generator host; reproducing the pipeline locally will produce a
//     different absolute path. That hard-coding is the pipeline's
//     intended behavior, not an issue with this snapshot.
//
// Used as the Path B reference in `docs/baseline-comparison.md`. Do NOT
// edit — comparison integrity depends on this being verbatim pipeline
// output.

#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startFixtureServer } from "../../../../scripts/fixtures/site-server.mjs";
import { sanitizeEvidenceText, sanitizeUrl } from "../../../../scripts/security/redact.mjs";

const workflow = {
  "schemaVersion": 1,
  "id": "full-synth-1779124975469",
  "fixture": "synthetic",
  "startUrl": "/synthetic",
  "finalUrl": "/synthetic/result?name=Codex",
  "steps": [
    {
      "action": "goto",
      "url": "/synthetic"
    },
    {
      "action": "fill",
      "selector": "[data-bf=\"name-input\"]",
      "fieldName": "displayName",
      "value": "Codex",
      "secret": false
    },
    {
      "action": "click",
      "selector": "[data-bf=\"launch\"]",
      "text": "Run Demo",
      "href": "",
      "submitterSelector": "",
      "submitterText": "",
      "submitterHref": "",
      "formIdentitySelector": "",
      "formId": "",
      "formName": "",
      "formAction": "",
      "formMethod": "",
      "expectUrl": "/synthetic/result?name=Codex"
    }
  ],
  "verification": {
    "expectedFinalUrl": "/synthetic/result?name=Codex",
    "expectedNetwork": {
      "url": "/api/complete?mode=synthetic",
      "method": "POST",
      "status": 200
    },
    "expectedEvidence": {
      "selector": "[data-bf-evidence=\"result\"]",
      "textIncludes": "Workflow Complete"
    }
  },
  "security": {
    "localOnly": true,
    "sanitizedArtifactsOnly": true,
    "screenshotsPersisted": false
  }
};

function normalizeObservedUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  const url = new URL(rawUrl);
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret") {
    return `${url.pathname}${url.search}`;
  }
  return rawUrl;
}

function resolveWorkflowUrl(baseUrl, targetUrl) {
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret") {
    return new URL(targetUrl, baseUrl).toString();
  }
  return targetUrl;
}

function escapeRegex(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function resolveFixtureStartPath() {
  if (workflow.fixture === "synthetic") {
    return "/synthetic";
  }
  if (workflow.fixture === "docs") {
    return "/docs";
  }
  if (workflow.fixture === "stateful") {
    return "/stateful";
  }
  if (workflow.fixture === "submit") {
    return "/submit";
  }
  if (workflow.fixture === "secret") {
    return "/secret";
  }
  return workflow.startUrl;
}

async function waitForExpectedUrl(page, expectedUrl) {
  await page.waitForFunction(
    ({ target, fixture }) => {
      const current = fixture === "synthetic" || fixture === "docs" || fixture === "stateful" || fixture === "submit" || fixture === "secret"
        ? location.pathname + location.search
        : location.href;
      return current === target;
    },
    { target: expectedUrl, fixture: workflow.fixture },
    { timeout: workflow.verification.transitionTimeoutMs ?? 30_000 }
  );
}

function classifyFailure(message) {
  if (message.includes("BROWSER_FLOW_SECRET_0")) {
    return "secret-missing";
  }
  if (message.includes("Fill-path mismatch")) {
    return "fill-path-mismatch";
  }
  if (message.includes("Submit-path mismatch")) {
    return "submit-path-mismatch";
  }
  if (message.includes("Action-path mismatch")) {
    return "action-path-mismatch";
  }
  if (message.includes("Timeout")) {
    return "expected-url-timeout";
  }
  return "replay-error";
}

async function readFormSignature(locator) {
  return await locator.evaluate((node) => {
    const form = /** @type {HTMLFormElement} */ (node);
    let formIdentitySelector = form.tagName.toLowerCase();
    if (form.dataset && form.dataset.bf) {
      formIdentitySelector = '[data-bf="' + form.dataset.bf + '"]';
    } else if (form.dataset && form.dataset.testid) {
      formIdentitySelector = '[data-testid="' + form.dataset.testid + '"]';
    } else if (form.id) {
      formIdentitySelector = '#' + CSS.escape(form.id);
    } else {
      const name = form.getAttribute("name");
      if (name) {
        formIdentitySelector = form.tagName.toLowerCase() + '[name="' + name + '"]';
      } else {
        const aria = form.getAttribute("aria-label");
        if (aria) {
          formIdentitySelector = form.tagName.toLowerCase() + '[aria-label="' + aria + '"]';
        }
      }
    }
    return {
      formIdentitySelector,
      formId: form.id || "",
      formName: form.getAttribute("name") || "",
      formAction: form.getAttribute("action") || "",
      formMethod: String(form.getAttribute("method") || form.method || "GET").toUpperCase()
    };
  });
}

export async function runWorkflow(options = {}) {
  const headless = options.headless ?? true;
  const replayProfileDir = options.replayProfileDir ?? mkdtempSync(join(tmpdir(), "browser-flow-replay-"));
  const reportPath = options.reportPath ?? "/path/to/repo/artifacts/runs/full-synth-1779124975469/reports/verification.json";
  mkdirSync(replayProfileDir, { recursive: true });

  let fixtureServer = null;
  let baseUrl = "";
  if (workflow.fixture === "synthetic" || workflow.fixture === "docs" || workflow.fixture === "stateful" || workflow.fixture === "submit" || workflow.fixture === "secret") {
    fixtureServer = await startFixtureServer();
    baseUrl = fixtureServer.baseUrl;
  }

  const context = await chromium.launchPersistentContext(replayProfileDir, {
    channel: "chrome",
    headless
  });
  const page = context.pages()[0] ?? await context.newPage();
  const networkHits = [];

  page.on("response", (response) => {
    networkHits.push({
      url: normalizeObservedUrl(response.url()),
      status: response.status(),
      method: response.request().method()
    });
  });

  const executedSteps = [];
  const writeReport = (report) => {
    const sanitized = sanitizeReport(report);
    writeFileSync(reportPath, JSON.stringify(sanitized, null, 2) + "\n", "utf8");
    return sanitized;
  };
  try {
    for (const step of workflow.steps) {
      if (step.action === "goto") {
        const startTarget = baseUrl ? resolveWorkflowUrl(baseUrl, resolveFixtureStartPath()) : workflow.startUrl;
        await page.goto(startTarget, { waitUntil: "domcontentloaded" });
      } else if (step.action === "fill") {
        const locator = page.locator(step.selector).first();
        const signature = await locator.evaluate((node) => {
          const element = /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (node);
          return {
            fieldName: element.getAttribute("name") || element.id || element.getAttribute("aria-label") || ""
          };
        });
        if (step.fieldName && step.fieldName !== "<redacted-field>" && signature.fieldName !== step.fieldName) {
          throw new Error(`Fill-path mismatch for ${step.selector}: expected field "${step.fieldName}" but saw "${signature.fieldName}"`);
        }
        if (step.secret && !process.env.BROWSER_FLOW_SECRET_0) {
          throw new Error("Secret replay value BROWSER_FLOW_SECRET_0 is required for this workflow.");
        }
        const value = step.secret ? process.env.BROWSER_FLOW_SECRET_0 ?? "" : step.value ?? "";
        await locator.fill(value);
      } else if (step.action === "click") {
        const locator = page.locator(step.selector).first();
        const signature = await locator.evaluate((node) => {
          const element = /** @type {HTMLElement} */ (node);
          return {
            text: String(
              element.innerText ||
              element.getAttribute("aria-label") ||
              element.getAttribute("value") ||
              ""
            ).replace(/\s+/g, " ").trim(),
            href: element instanceof HTMLAnchorElement ? element.getAttribute("href") || "" : ""
          };
        });
        if (step.text && !signature.text.includes(step.text)) {
          throw new Error(`Action-path mismatch for ${step.selector}: expected text "${step.text}" but saw "${signature.text}"`);
        }
        if (step.href) {
          if (signature.href !== step.href) {
            throw new Error(`Action-path mismatch for ${step.selector}: expected href "${step.href}" but saw "${signature.href}"`);
          }
        }
        await locator.click();
      } else if (step.action === "submit") {
        const formLocator = page.locator(step.selector).first();
        const formSignature = await readFormSignature(formLocator);
        if (step.formIdentitySelector && formSignature.formIdentitySelector !== step.formIdentitySelector) {
          throw new Error(`Submit-path mismatch for ${step.selector}: expected form selector "${step.formIdentitySelector}" but saw "${formSignature.formIdentitySelector}"`);
        }
        if (step.formId && formSignature.formId !== step.formId) {
          throw new Error(`Submit-path mismatch for ${step.selector}: expected form id "${step.formId}" but saw "${formSignature.formId}"`);
        }
        if (step.formName && formSignature.formName !== step.formName) {
          throw new Error(`Submit-path mismatch for ${step.selector}: expected form name "${step.formName}" but saw "${formSignature.formName}"`);
        }
        if (step.formAction && formSignature.formAction !== step.formAction) {
          throw new Error(`Submit-path mismatch for ${step.selector}: expected form action "${step.formAction}" but saw "${formSignature.formAction}"`);
        }
        if (step.formMethod && formSignature.formMethod !== step.formMethod) {
          throw new Error(`Submit-path mismatch for ${step.selector}: expected form method "${step.formMethod}" but saw "${formSignature.formMethod}"`);
        }
        if (step.submitterSelector) {
          const locator = page.locator(step.submitterSelector).first();
          const signature = await locator.evaluate((node) => {
            const element = /** @type {HTMLElement} */ (node);
            return {
              text: String(
                element.innerText ||
                element.getAttribute("aria-label") ||
                element.getAttribute("value") ||
                ""
              ).replace(/\s+/g, " ").trim(),
              href: element instanceof HTMLAnchorElement ? element.getAttribute("href") || "" : ""
            };
          });
          if (step.submitterText && !signature.text.includes(step.submitterText)) {
            throw new Error(`Action-path mismatch for ${step.submitterSelector}: expected text "${step.submitterText}" but saw "${signature.text}"`);
          }
          if (step.submitterHref && signature.href !== step.submitterHref) {
            throw new Error(`Action-path mismatch for ${step.submitterSelector}: expected href "${step.submitterHref}" but saw "${signature.href}"`);
          }
          await locator.click();
        } else {
          await formLocator.evaluate((form) => {
            const candidate = /** @type {HTMLFormElement} */ (form);
            candidate.requestSubmit();
          });
        }
      }

      executedSteps.push(step.action);
      if (step.expectUrl) {
        await waitForExpectedUrl(page, step.expectUrl);
      }
    }

    const transitionChecks = [];
    const finalUrl = normalizeObservedUrl(page.url());
    transitionChecks.push({
      name: "final-url",
      expected: workflow.verification.expectedFinalUrl,
      actual: finalUrl,
      passed: workflow.verification.expectedFinalUrl ? finalUrl === workflow.verification.expectedFinalUrl : true
    });

    if (workflow.verification.expectedNetwork) {
      const networkPass = networkHits.some((entry) =>
        entry.url === workflow.verification.expectedNetwork.url &&
        entry.method === workflow.verification.expectedNetwork.method &&
        entry.status === workflow.verification.expectedNetwork.status
      );
      transitionChecks.push({
        name: "network",
        expected: workflow.verification.expectedNetwork,
        actual: networkHits,
        passed: networkPass
      });
    }

    let resultEvidence = { passed: true, selector: "", actualText: "", expectedText: "" };
    if (workflow.verification.expectedEvidence) {
      const locator = page.locator(workflow.verification.expectedEvidence.selector).first();
      const actualText = ((await locator.textContent({ timeout: 1_000 }).catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
      const expectedText = workflow.verification.expectedEvidence.textIncludes ?? "";
      resultEvidence = {
        selector: workflow.verification.expectedEvidence.selector,
        actualText,
        expectedText,
        passed: actualText.includes(expectedText)
      };
    }

    const report = {
      success: executedSteps.length === workflow.steps.length &&
        transitionChecks.every((check) => check.passed) &&
        resultEvidence.passed,
      pathComplete: executedSteps.length === workflow.steps.length,
      executedSteps,
      stepCount: workflow.steps.length,
      transitionChecks,
      resultEvidence
    };

    return writeReport(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return writeReport({
      success: false,
      pathComplete: false,
      executedSteps,
      stepCount: workflow.steps.length,
      transitionChecks: [],
      resultEvidence: {
        passed: false,
        selector: "",
        actualText: "",
        expectedText: ""
      },
      failureReason: classifyFailure(message),
      error: message
    });
  } finally {
    await context.close();
    if (fixtureServer) {
      await fixtureServer.close();
    }
    rmSync(replayProfileDir, { recursive: true, force: true });
  }
}

function sanitizeReport(report) {
  return {
    ...report,
    transitionChecks: report.transitionChecks.map((check) => {
      if (check.name === "final-url") {
        return {
          ...check,
          expected: typeof check.expected === "string" ? sanitizeUrl(check.expected) : check.expected,
          actual: typeof check.actual === "string" ? sanitizeUrl(check.actual) : check.actual
        };
      }
      if (check.name === "network") {
        return {
          ...check,
          expected: check.expected
            ? { ...check.expected, url: typeof check.expected.url === "string" ? sanitizeUrl(check.expected.url) : check.expected.url }
            : check.expected,
          actual: Array.isArray(check.actual)
            ? check.actual.map((entry) => ({
                ...entry,
                url: typeof entry.url === "string" ? sanitizeUrl(entry.url) : entry.url
              }))
            : check.actual
        };
      }
      return check;
    }),
    resultEvidence: report.resultEvidence
      ? {
          ...report.resultEvidence,
          actualText: sanitizeEvidenceText(report.resultEvidence.actualText),
          expectedText: sanitizeEvidenceText(report.resultEvidence.expectedText)
        }
      : report.resultEvidence,
    error: report.error ? sanitizeEvidenceText(report.error) : report.error
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkflow({
    headless: process.argv.includes("--headless")
  }).then((report) => {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }).catch((error) => {
    process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
    process.exit(1);
  });
}
