import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getPaths, getRepoRoot } from "../scripts/lib/config.mjs";
import { withAssembledPackage } from "./helpers/assembled-package.mjs";

test("CLI help exposes the planned command surface", () => {
  const result = spawnSync(process.execPath, ["scripts/cli.mjs", "help"], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /prepare/);
  assert.match(result.stdout, /done/);
  assert.match(result.stdout, /analyze/);
  assert.match(result.stdout, /generate/);
  assert.match(result.stdout, /verify/);
  assert.match(result.stdout, /promote\s+Save a replay-verified external workflow/i);
  assert.match(result.stdout, /review-route-intent\s+Brief\/apply state\/intent route review/i);
  // doctor command surfaces page-node staleness.
  assert.match(result.stdout, /doctor/);
});

test("CLI help mentions verify --summary compact mode", () => {
  const result = spawnSync(process.execPath, ["scripts/cli.mjs", "help"], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify\s+Replay/);
  assert.match(result.stdout, /--summary/);
});

test("bootstrap directories are created from help path", () => {
  const paths = getPaths();
  assert.equal(existsSync(paths.runsRoot), true);
  assert.equal(existsSync(dirname(paths.registryPath)), true);
});

test("command-scoped help does not execute prepare", () => {
  const result = spawnSync(process.execPath, ["scripts/cli.mjs", "prepare", "--help"], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:\s+browser-flow prepare/i);
  assert.doesNotMatch(result.stdout, /"chromePid"/);
  assert.doesNotMatch(result.stdout, /"runId"/);
});

test("assembled package CLI command-scoped help does not execute prepare", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const result = spawnSync(
      process.execPath,
      ["scripts/cli.mjs", "prepare", "--help"],
      {
        cwd: resolve(packageRoot, "runtime"),
        encoding: "utf8"
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /Usage:\s+browser-flow prepare/i);
    assert.doesNotMatch(output, /"chromePid"/);
    assert.doesNotMatch(output, /"runId"/);
  });
});
