import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getPaths, getRepoRoot } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { readRegistry, upsertRegistryEntry } from "../../scripts/registry/workflow-registry.mjs";

/**
 * @param {string[]} args
 */
function spawnWriter(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/helpers/registry-writer.mjs", ...args], {
      cwd: getRepoRoot(),
      stdio: "ignore"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`registry writer exited with ${code}`));
    });
    child.on("error", reject);
  });
}

test("registry lock preserves concurrent updates", async () => {
  const idA = `registry-a-${Date.now()}`;
  const idB = `registry-b-${Date.now()}`;

  await Promise.all([
    spawnWriter([idA, "generated", "10"]),
    spawnWriter([idB, "failed", "0"])
  ]);

  const registry = /** @type {Array<{ id: string, status: string }>} */ (readJson(getPaths().registryPath));

  assert.equal(registry.some((entry) => entry.id === idA && entry.status === "generated"), true);
  assert.equal(registry.some((entry) => entry.id === idB && entry.status === "failed"), true);
});

test("registry duplicate ids are updated in place and remain readable", () => {
  const id = `registry-lookup-${Date.now()}`;

  upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "generated"
  });
  upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "failed"
  });

  const entry = readRegistry().find((item) => item.id === id);

  assert.equal(entry?.status, "failed");
});
