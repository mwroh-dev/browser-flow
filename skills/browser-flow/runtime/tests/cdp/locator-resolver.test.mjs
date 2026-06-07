import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { resolveAtomicFpLocator } from "../../scripts/cdp/locator-resolver.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";

// Shared fixture server for all tests in this file.
const fixture = await startFixtureServer();

test("resolveAtomicFpLocator — role strategy resolves button via AX tree", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "lr-role-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });

    // "Run Demo" button is a role=button with name="Run Demo"
    const result = await resolveAtomicFpLocator(session, target.targetId, {
      selector: "[data-bf='launch']",
      atomicFp: { strategy: "role", role: "button", name: "Run Demo" }
    });

    assert.equal(result.strategyUsed, "role", `expected strategyUsed="role", got "${result.strategyUsed}"`);
    assert.ok(typeof result.backendNodeId === "number" && result.backendNodeId > 0,
      `expected positive backendNodeId, got ${result.backendNodeId}`);
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("resolveAtomicFpLocator — ancestor-scope strategy resolves child within scoped form", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "lr-scope-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/submit`, { waitUntil: "load" });

    // form[aria-label="submit-form"] contains [data-bf="submit-button"]
    const result = await resolveAtomicFpLocator(session, target.targetId, {
      selector: "[data-bf='submit-button']",
      atomicFp: { strategy: "ancestor-scope", scopeSelector: "form[aria-label='submit-form']" }
    });

    assert.equal(result.strategyUsed, "ancestor-scope",
      `expected strategyUsed="ancestor-scope", got "${result.strategyUsed}"`);
    assert.ok(typeof result.backendNodeId === "number" && result.backendNodeId > 0,
      `expected positive backendNodeId, got ${result.backendNodeId}`);
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("resolveAtomicFpLocator — fallback selector resolves element when no atomicFp hint", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "lr-fallback-"));
  const debugPort = await getFreePort();
  const session = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    await lc.navigateAndWait(target.targetId, `${fixture.baseUrl}/synthetic`, { waitUntil: "load" });

    // No atomicFp hint — pure selector fallback
    const result = await resolveAtomicFpLocator(session, target.targetId, {
      selector: "[data-bf='launch']"
    });

    assert.equal(result.strategyUsed, "selector-fallback",
      `expected strategyUsed="selector-fallback", got "${result.strategyUsed}"`);
    assert.ok(typeof result.backendNodeId === "number" && result.backendNodeId > 0,
      `expected positive backendNodeId, got ${result.backendNodeId}`);
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

// Cleanup shared fixture after all tests complete (awaited via node:test after hook).
after(async () => { await fixture.close(); });
