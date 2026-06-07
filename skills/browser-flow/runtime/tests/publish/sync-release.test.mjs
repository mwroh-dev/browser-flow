import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function initRepo(/** @type {string} */ path) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "user.email", "test@example.com"]);
  git(path, ["config", "user.name", "Test User"]);
}

function releaseNote() {
  return {
    workItemId: "release-sync-history",
    title: "Release sync history",
    status: "resolved",
    userRequest: "Ship only the public browser-flow surface to the release repo.",
    whyItMattered: "The source repo contains private development history and local artifacts.",
    modelConclusion: "The release repo needs an explicit work-item note and closure-checked bundle.",
    changesMade: "Added allowlist sync, HISTORY update, README latest metadata, and audit hooks.",
    expectedResolution: "Release commits can be tied back to source work without exposing source-only files.",
    validation: "Unit test fixture",
    publicationNotes: "No run artifacts or personal paths are published."
  };
}

function writeReleaseTemplates(/** @type {string} */ bundleRoot) {
  writeFileSync(resolve(bundleRoot, "README.md"), [
    "# Browser Flow",
    "",
    "<!-- browser-flow-latest:start -->",
    "No release sync yet.",
    "<!-- browser-flow-latest:end -->",
    ""
  ].join("\n"));
  writeFileSync(resolve(bundleRoot, "HISTORY.md"), [
    "# Browser Flow History",
    "",
    "<!-- browser-flow-history:start -->",
    "No work-item releases yet.",
    "<!-- browser-flow-history:end -->",
    ""
  ].join("\n"));
}

function readJson(/** @type {string} */ path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function commitSource(/** @type {string} */ source, /** @type {string} */ name, /** @type {string} */ body) {
  writeFileSync(resolve(source, name), body);
  git(source, ["add", name]);
  git(source, ["commit", "-q", "-m", `source ${name}`]);
  return git(source, ["rev-parse", "HEAD"]);
}

function buildBundle(/** @type {string} */ bundleRoot, /** @type {string} */ body = "built\n") {
  writeReleaseTemplates(bundleRoot);
  writeFileSync(resolve(bundleRoot, ".bundle-stamp.json"), JSON.stringify({ fileCount: 3 }) + "\n");
  writeFileSync(resolve(bundleRoot, "bundle.txt"), body);
}

test("syncRelease requires a release note, updates HISTORY/README, and commits with the source sha", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);
  const sourceSha = git(source, ["rev-parse", "--short", "HEAD"]);

  writeFileSync(resolve(release, "old.txt"), "old\n");
  mkdirSync(resolve(release, "stale/nested"), { recursive: true });
  writeFileSync(resolve(release, "stale/nested/old.txt"), "old\n");
  git(release, ["add", "old.txt"]);
  git(release, ["add", "stale/nested/old.txt"]);
  git(release, ["commit", "-q", "-m", "initial release"]);

  const result = syncRelease({
    sourceRoot: source,
    releaseRoot: release,
    build: (bundleRoot) => {
      writeReleaseTemplates(bundleRoot);
      writeFileSync(resolve(bundleRoot, ".bundle-stamp.json"), JSON.stringify({ fileCount: 3 }) + "\n");
      writeFileSync(resolve(bundleRoot, "bundle.txt"), "built\n");
    },
    releaseNote: releaseNote(),
    now: "2026-06-02T00:00:00.000Z",
    audit: () => {}
  });

  assert.equal(result.status, "committed");
  assert.equal(result.sourceSha, sourceSha);
  assert.match(git(release, ["log", "-1", "--pretty=%s"]), new RegExp(`sync from ${sourceSha}`));
  assert.match(git(release, ["show", "HEAD:HISTORY.md"]), /## Work Item: release-sync-history - Release sync history/);
  assert.match(git(release, ["show", "HEAD:HISTORY.md"]), /### User Request/);
  assert.match(git(release, ["show", "HEAD:README.md"]), /Source SHA: `[^`]+`/);
  assert.match(git(release, ["show", "HEAD:README.md"]), /`release-sync-history`: Release sync history \(resolved\)/);
  assert.equal(existsSync(resolve(release, "old.txt")), false, "stale files are removed one file at a time");
  assert.equal(existsSync(resolve(release, "stale")), false, "stale empty directories are pruned");
  assert.equal(readFileSync(resolve(release, "bundle.txt"), "utf8"), "built\n");
  assert.equal(git(release, ["status", "--short"]), "");
});

test("syncRelease bootstrap-amend writes release metadata and amends the single pre-public commit without a release note", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-bootstrap-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  const sourceSha = commitSource(source, "source.txt", "hello\n");

  writeFileSync(resolve(release, ".release-state.json"), JSON.stringify({
    published: false,
    projectionVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n");
  writeFileSync(resolve(release, "old.txt"), "old\n");
  git(release, ["add", "."]);
  git(release, ["commit", "-q", "-m", "initial release"]);
  const initialCommitCount = Number(git(release, ["rev-list", "--count", "HEAD"]));

  const result = syncRelease({
    sourceRoot: source,
    releaseRoot: release,
    env: { BROWSER_FLOW_RELEASE_MODE: "bootstrap-amend" },
    build: (bundleRoot) => buildBundle(bundleRoot),
    now: "2026-06-02T00:00:00.000Z",
    audit: () => {}
  });

  assert.equal(result.status, "amended");
  assert.equal(git(release, ["rev-list", "--count", "HEAD"]), String(initialCommitCount));
  assert.equal(existsSync(resolve(release, "old.txt")), false);
  assert.equal(readFileSync(resolve(release, "bundle.txt"), "utf8"), "built\n");
  assert.match(readFileSync(resolve(release, "README.md"), "utf8"), new RegExp(`Source SHA: \`${sourceSha.slice(0, 7)}\``));
  assert.match(readFileSync(resolve(release, "README.md"), "utf8"), /Updated work items:\n- none/);
  assert.match(git(release, ["log", "-1", "--pretty=%B"]), /Source-Range: initial/);

  const state = readJson(resolve(release, ".release-state.json"));
  assert.equal(state.published, false);
  assert.equal(state.projectionVersion, 1);
  assert.equal(state.createdAt, "2026-06-01T00:00:00.000Z");
  assert.equal(state.updatedAt, "2026-06-02T00:00:00.000Z");

  const sourceMeta = readJson(resolve(release, ".release-source.json"));
  assert.equal(sourceMeta.previousSourceHead, null);
  assert.equal(sourceMeta.sourceHead, sourceSha);
  assert.equal(sourceMeta.sourceRange, null);
  assert.equal(sourceMeta.sourceBranch, "main");
  assert.equal(sourceMeta.bundleFileCount, 3);
});

test("syncRelease append records the previous-to-current source range and requires a release note", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-range-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  const previousSha = commitSource(source, "one.txt", "one\n");
  const sourceSha = commitSource(source, "two.txt", "two\n");

  writeFileSync(resolve(release, ".release-state.json"), JSON.stringify({
    published: true,
    projectionVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n");
  writeFileSync(resolve(release, ".release-source.json"), JSON.stringify({
    previousSourceHead: null,
    sourceHead: previousSha,
    sourceRange: null,
    sourceBranch: "main",
    builtAt: "2026-06-01T00:00:00.000Z",
    bundleFileCount: 3,
    projectionVersion: 1
  }, null, 2) + "\n");
  writeReleaseTemplates(release);
  writeFileSync(resolve(release, "bundle.txt"), "old\n");
  git(release, ["add", "."]);
  git(release, ["commit", "-q", "-m", "initial public release"]);

  assert.throws(
    () => syncRelease({
      sourceRoot: source,
      releaseRoot: release,
      build: (bundleRoot) => buildBundle(bundleRoot, "new\n"),
      audit: () => {}
    }),
    /no release note was provided/
  );

  const result = syncRelease({
    sourceRoot: source,
    releaseRoot: release,
    build: (bundleRoot) => buildBundle(bundleRoot, "new\n"),
    releaseNote: releaseNote(),
    now: "2026-06-02T00:00:00.000Z",
    audit: () => {}
  });

  assert.equal(result.status, "committed");
  assert.equal(git(release, ["rev-list", "--count", "HEAD"]), "2");
  const body = git(release, ["log", "-1", "--pretty=%B"]);
  assert.match(body, new RegExp(`Source-Previous: ${previousSha}`));
  assert.match(body, new RegExp(`Source-Commit: ${sourceSha}`));
  assert.match(body, new RegExp(`Source-Range: ${previousSha}\\.\\.${sourceSha}`));

  const sourceMeta = readJson(resolve(release, ".release-source.json"));
  assert.equal(sourceMeta.previousSourceHead, previousSha);
  assert.equal(sourceMeta.sourceHead, sourceSha);
  assert.equal(sourceMeta.sourceRange, `${previousSha}..${sourceSha}`);
});

test("syncRelease append returns unchanged without a release note when source is already synced", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-unchanged-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  const sourceSha = commitSource(source, "source.txt", "hello\n");
  buildBundle(release);
  writeFileSync(resolve(release, ".release-state.json"), JSON.stringify({
    published: true,
    projectionVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z"
  }, null, 2) + "\n");
  writeFileSync(resolve(release, ".release-source.json"), JSON.stringify({
    previousSourceHead: null,
    sourceHead: sourceSha,
    sourceRange: null,
    sourceBranch: "main",
    builtAt: "2026-06-02T00:00:00.000Z",
    bundleFileCount: 3,
    projectionVersion: 1
  }, null, 2) + "\n");
  git(release, ["add", "."]);
  git(release, ["commit", "-q", "-m", "initial public release"]);

  const result = syncRelease({
    sourceRoot: source,
    releaseRoot: release,
    build: (bundleRoot) => buildBundle(bundleRoot),
    now: "2026-06-03T00:00:00.000Z",
    audit: () => {}
  });

  assert.equal(result.status, "unchanged");
  assert.equal(git(release, ["status", "--short"]), "");
  assert.equal(readJson(resolve(release, ".release-state.json")).updatedAt, "2026-06-02T00:00:00.000Z");
  assert.equal(readJson(resolve(release, ".release-source.json")).sourceHead, sourceSha);
});

test("syncRelease refuses bootstrap-amend after the release state is published", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-bootstrap-published-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  commitSource(source, "source.txt", "hello\n");
  writeFileSync(resolve(release, ".release-state.json"), JSON.stringify({
    published: true,
    projectionVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n");
  git(release, ["add", "."]);
  git(release, ["commit", "-q", "-m", "published release"]);

  assert.throws(
    () => syncRelease({
      sourceRoot: source,
      releaseRoot: release,
      env: { BROWSER_FLOW_RELEASE_MODE: "bootstrap-amend" },
      build: (bundleRoot) => buildBundle(bundleRoot),
      audit: () => {}
    }),
    /bootstrap-amend is only allowed before public release/
  );
});

test("syncRelease refuses append when the previous released source is not an ancestor", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-nonancestor-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  const previousSha = commitSource(source, "one.txt", "one\n");
  git(source, ["checkout", "-q", "--orphan", "main-rewritten"]);
  writeFileSync(resolve(source, "rewritten.txt"), "rewritten\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-q", "-m", "rewritten source"]);
  git(source, ["branch", "-M", "main"]);

  writeFileSync(resolve(release, ".release-state.json"), JSON.stringify({
    published: true,
    projectionVersion: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n");
  writeFileSync(resolve(release, ".release-source.json"), JSON.stringify({
    previousSourceHead: null,
    sourceHead: previousSha,
    sourceRange: null,
    sourceBranch: "main",
    builtAt: "2026-06-01T00:00:00.000Z",
    bundleFileCount: 3,
    projectionVersion: 1
  }, null, 2) + "\n");
  git(release, ["add", "."]);
  git(release, ["commit", "-q", "-m", "initial public release"]);

  assert.throws(
    () => syncRelease({
      sourceRoot: source,
      releaseRoot: release,
      build: (bundleRoot) => buildBundle(bundleRoot),
      releaseNote: releaseNote(),
      audit: () => {}
    }),
    /previous released source is not an ancestor/
  );
});

test("syncRelease refuses release changes without a work-item release note", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-no-note-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);

  writeFileSync(resolve(release, "old.txt"), "old\n");
  git(release, ["add", "old.txt"]);
  git(release, ["commit", "-q", "-m", "initial release"]);

  assert.throws(
    () => syncRelease({
      sourceRoot: source,
      releaseRoot: release,
      build: (bundleRoot) => {
        writeReleaseTemplates(bundleRoot);
        writeFileSync(resolve(bundleRoot, "bundle.txt"), "built\n");
      },
      audit: () => {}
    }),
    /no release note was provided/
  );
  assert.equal(existsSync(resolve(release, "old.txt")), true, "release repo is unchanged without a release note");
  assert.equal(existsSync(resolve(release, "bundle.txt")), false, "temp bundle output is not applied without a release note");
  assert.equal(git(release, ["status", "--short"]), "");
});

test("syncRelease does not mutate the release repo when temp bundle build fails", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-failed-build-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);

  writeFileSync(resolve(release, "old.txt"), "old\n");
  git(release, ["add", "old.txt"]);
  git(release, ["commit", "-q", "-m", "initial release"]);

  assert.throws(
    () => syncRelease({
      sourceRoot: source,
      releaseRoot: release,
      build: (bundleRoot) => {
        writeReleaseTemplates(bundleRoot);
        writeFileSync(resolve(bundleRoot, "bundle.txt"), "partial\n");
        throw new Error("bundle failed");
      },
      releaseNote: releaseNote(),
      audit: () => {}
    }),
    /bundle failed/
  );
  assert.equal(existsSync(resolve(release, "old.txt")), true);
  assert.equal(existsSync(resolve(release, "bundle.txt")), false);
  assert.equal(git(release, ["status", "--short"]), "");
});

test("syncRelease refuses to run from a non-main source branch", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-branch-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);
  git(source, ["checkout", "-q", "-b", "feature"]);

  writeFileSync(resolve(release, "old.txt"), "old\n");
  git(release, ["add", "old.txt"]);
  git(release, ["commit", "-q", "-m", "initial release"]);

  assert.throws(
    () => syncRelease({ sourceRoot: source, releaseRoot: release, build: () => {} }),
    /release sync must run from source main/
  );
});

test("syncRelease refuses to overwrite a dirty release repo", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-dirty-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);
  writeFileSync(resolve(release, "dirty.txt"), "dirty\n");

  assert.throws(
    () => syncRelease({ sourceRoot: source, releaseRoot: release, build: () => {} }),
    /release repo has uncommitted changes/
  );
});

test("syncRelease refuses to build from a dirty source repo", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-sync-release-dirty-source-"));
  const source = resolve(root, "source");
  const release = resolve(root, "release");
  initRepo(source);
  initRepo(release);

  writeFileSync(resolve(source, "source.txt"), "hello\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source change"]);
  writeFileSync(resolve(source, "uncommitted.txt"), "dirty\n");

  assert.throws(
    () => syncRelease({ sourceRoot: source, releaseRoot: release, build: () => {} }),
    /source repo has uncommitted changes/
  );
});

test("syncRelease skips when BROWSER_FLOW_SKIP_RELEASE_HOOK is set", async () => {
  const { syncRelease } = await import("../../scripts/publish/sync-release.mjs");
  const result = syncRelease({
    env: { BROWSER_FLOW_SKIP_RELEASE_HOOK: "1" },
    sourceRoot: "/does/not/matter",
    releaseRoot: "/does/not/matter",
    build: () => {
      throw new Error("build should not run");
    }
  });

  assert.equal(result.status, "skipped");
});
