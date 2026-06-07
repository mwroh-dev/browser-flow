import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getPaths, getRepoRoot } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { sanitizeUrl } from "../../scripts/security/redact.mjs";
import { scanArtifacts } from "../../scripts/security/scan-artifacts.mjs";

test("prepare rejects non-local start URLs", () => {
  const result = spawnSync(process.execPath, [
    "scripts/cli.mjs",
    "prepare",
    "--run-id", `non-local-${Date.now()}`,
    "--start-url", "https://example.com/login"
  ], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local-only/);
});

test("prepare rejects protocol-relative URLs", () => {
  const result = spawnSync(process.execPath, [
    "scripts/cli.mjs",
    "prepare",
    "--run-id", `protocol-relative-${Date.now()}`,
    "--start-url", "//evil.example/path"
  ], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local-only/);
});

test("scanner accepts redacted secret fields without failing the artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-flow-redacted-"));
  const output = join(root, "security.json");
  writeJson(join(root, "artifact.json"), {
    selector: "[data-bf=\"password\"]",
    fieldName: "<redacted-field>",
    secret: true,
    value: "<redacted-secret>"
  });

  const report = scanArtifacts(root, output);

  assert.equal(report.ok, true);
  assert.equal(dirname(getPaths().registryPath).length > 0, true);
});

test("sanitizeUrl strips embedded credentials while redacting secret query params", () => {
  const sanitized = sanitizeUrl("http://user:secret@127.0.0.1:3000/path?token=abcdefghijklmnopqrstuvwxyz");

  assert.equal(sanitized.includes("user:secret@"), false);
  assert.match(sanitized, /token=%3Credacted%3E/);
});

test("sanitizeUrl redacts relative query secrets and collapses protocol-relative external targets", () => {
  assert.equal(sanitizeUrl("/docs/detail?token=abcdefghijklmnopqrstuvwxyz"), "/docs/detail?token=%3Credacted%3E");
  assert.equal(sanitizeUrl("//evil.example/path?token=abcdefghijklmnopqrstuvwxyz"), "<non-local-url>");
});
