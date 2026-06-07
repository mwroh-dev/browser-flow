import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

// Named persistent capture profiles. Each test installs its
// own BROWSER_FLOW_PROFILES_PATH override so committed profiles/ tree
// is not touched and tests do not bleed state.

/**
 * @param {string} path
 */
async function removeTreeWithRetry(path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? /** @type {{ code?: string }} */ (error).code : "";
      if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(String(code)) || attempt === 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

/**
 * @param {(profilesRoot: string) => Promise<void> | void} body
 */
async function withIsolatedProfilesRoot(body) {
  const previous = process.env.BROWSER_FLOW_PROFILES_PATH;
  const isolatedRoot = mkdtempSync(join(tmpdir(), "browser-flow-profile-int-test-"));
  process.env.BROWSER_FLOW_PROFILES_PATH = isolatedRoot;
  try {
    await body(isolatedRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSER_FLOW_PROFILES_PATH;
    } else {
      process.env.BROWSER_FLOW_PROFILES_PATH = previous;
    }
    await removeTreeWithRetry(isolatedRoot);
  }
}

test("--profile-name preserves the profile directory after done", async () => {
  await withIsolatedProfilesRoot(async (profilesRoot) => {
    const profileName = "phase40-persist";
    const profileDir = resolvePath(profilesRoot, profileName);
    const runId = `profile-persist-${Date.now()}`;

    const prepared = runCli([
      "prepare",
      "--run-id", runId,
      "--fixture", "synthetic",
      "--headless",
      "--profile-name", profileName
    ]);
    assert.equal(prepared.status, "ready");
    assert.equal(existsSync(profileDir), true, "profile dir must exist after prepare");

    await driveObservedWorkflow({
      debugPort: prepared.debugPort,
      workflow: "synthetic"
    });
    runCli(["done", "--run-id", runId]);

    // Persistence contract: after done, the profile directory must
    // still exist (no rmSync) and must contain Chrome state
    // (anything more than just SingletonLock — at minimum the
    // Default profile subfolder).
    assert.equal(existsSync(profileDir), true, "profile dir must survive done");
    const contents = readdirSync(profileDir);
    assert.ok(contents.length >= 1, `profile dir must retain Chrome state, got: ${JSON.stringify(contents)}`);
    // Chrome populates "Default" under the user-data-dir on first run.
    assert.ok(
      contents.includes("Default") || contents.some((name) => name !== "SingletonLock"),
      `profile dir must contain Chrome state beyond the lock file, got: ${JSON.stringify(contents)}`
    );
  });
});

test("prepare refuses when profile has an existing SingletonLock", async () => {
  await withIsolatedProfilesRoot((profilesRoot) => {
    const profileName = "phase40-locked";
    const profileDir = resolvePath(profilesRoot, profileName);
    mkdirSync(profileDir, { recursive: true });
    // Simulate either another running browser-flow capture OR a
    // stale lock from a prior crash. Either way, prepare must
    // refuse fast rather than try to spawn Chrome on a locked
    // profile.
    writeFileSync(resolvePath(profileDir, "SingletonLock"), "fake-host-12345");

    let threw = false;
    try {
      runCli([
        "prepare",
        "--run-id", `profile-locked-${Date.now()}`,
        "--fixture", "synthetic",
        "--headless",
        "--profile-name", profileName
      ]);
    } catch (error) {
      threw = true;
      const message = error instanceof Error ? error.message : String(error);
      // runCli throws with the CLI's stderr text; the prepare lock
      // error must surface in that message.
      assert.match(message, /in use or has a stale lock/i, `unexpected lock-refusal message: ${message}`);
      assert.match(message, new RegExp(profileName), `error must name the conflicting profile (${profileName})`);
    }
    assert.equal(threw, true, "prepare must throw when SingletonLock pre-exists in the profile dir");
  });
});

test("--profile-name rejects invalid names (regex enforcement)", () => {
  let threw = false;
  try {
    runCli([
      "prepare",
      "--run-id", `profile-invalid-${Date.now()}`,
      "--fixture", "synthetic",
      "--headless",
      "--profile-name", "InvalidName"
    ]);
  } catch (error) {
    threw = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /Invalid profile name/i);
  }
  assert.equal(threw, true, "prepare must reject uppercase profile names");
});
