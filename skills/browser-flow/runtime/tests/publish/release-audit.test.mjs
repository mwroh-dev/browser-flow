import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { auditRelease } from "../../scripts/publish/release-audit.mjs";

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function initRepo() {
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-release-audit-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  return root;
}

test("release audit accepts a clean release tree and history", () => {
  const root = initRepo();
  try {
    writeFileSync(resolve(root, "README.md"), "# Browser Flow\n");
    writeFileSync(resolve(root, "HISTORY.md"), "# History\n");
    git(root, ["add", "README.md", "HISTORY.md"]);
    git(root, ["commit", "-q", "-m", "initial release"]);

    assert.deepEqual(auditRelease(root), { ok: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release audit fails when README latest metadata is stale", () => {
  const root = initRepo();
  try {
    writeFileSync(resolve(root, ".release-source.json"), JSON.stringify({
      sourceHead: "207dbf029ff73244f7916beedf87dde37358d7ce",
      builtAt: "2026-06-04T12:48:07.300Z"
    }, null, 2) + "\n");
    writeFileSync(resolve(root, "README.md"), [
      "# Browser Flow",
      "",
      "<!-- browser-flow-latest:start -->",
      "- Source SHA: `98ee0b0`",
      "- Updated: 2026-06-04T12:37:05.100Z",
      "<!-- browser-flow-latest:end -->",
      ""
    ].join("\n"));
    writeFileSync(resolve(root, "HISTORY.md"), "# History\n");
    git(root, ["add", "README.md", "HISTORY.md", ".release-source.json"]);
    git(root, ["commit", "-q", "-m", "initial release"]);

    const result = auditRelease(root);
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /README latest source SHA mismatch: expected 207dbf0/);
    assert.match(result.findings.join("\n"), /README latest updated timestamp mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release audit fails on current run artifacts, screenshots, and snapshots", () => {
  const root = initRepo();
  try {
    mkdirSync(resolve(root, "artifacts/runs/run/reports/screenshots"), { recursive: true });
    mkdirSync(resolve(root, "artifacts/runs/run/snapshots"), { recursive: true });
    writeFileSync(resolve(root, "artifacts/runs/run/raw-events.jsonl"), "{}\n");
    writeFileSync(resolve(root, "artifacts/runs/run/snapshots/page.html.gz"), "snapshot\n");
    writeFileSync(resolve(root, "artifacts/runs/run/reports/screenshots/capture-final.png"), "png\n");

    const result = auditRelease(root);
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /current forbidden path/);
    assert.match(result.findings.join("\n"), /raw-events\.jsonl|capture-final\.png|\.html\.gz/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release audit fails on personal markers in git history after deletion", () => {
  const root = initRepo();
  try {
    writeFileSync(resolve(root, "README.md"), "# Browser Flow\n");
    writeFileSync(resolve(root, "leak.txt"), "/Users/cielo-iamdt/Downloads/browser-test\n");
    git(root, ["add", "README.md", "leak.txt"]);
    git(root, ["commit", "-q", "-m", "leaky release"]);
    rmSync(resolve(root, "leak.txt"));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "remove leak"]);

    const result = auditRelease(root);
    assert.equal(result.ok, false);
    assert.match(result.findings.join("\n"), /history personal marker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
