import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

import { releasePathFor, resolveShippingFiles } from "../../scripts/lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

test("release allowlist names only installer inputs, renderer sources, and public docs", () => {
  /** @type {{ include: string[], exclude?: string[] }} */
  const allowlist = JSON.parse(readFileSync(manifest, "utf8"));
  assert.ok(allowlist.include.includes("install-project-local.sh"));
  assert.ok(allowlist.include.includes("surfaces/release/README.md"));
  assert.ok(allowlist.include.includes("surfaces/release/HISTORY.md"));
  assert.ok(allowlist.include.includes("scripts/publish/render-browser-flow-surfaces.mjs"));
  assert.ok(allowlist.include.includes("scripts/publish/render-browser-flow-surfaces-cli.mjs"));
  assert.ok(allowlist.include.includes("surfaces/browser-flow/public/entry.md"));
  assert.ok(allowlist.include.includes("surfaces/browser-flow/adapters/claude/browser-flow.md.tmpl"));
  assert.ok(!allowlist.include.includes(".codex/skills/browser-flow"));
  assert.ok(!allowlist.include.includes(".claude/commands/browser-flow.md"));
  assert.ok(!allowlist.include.includes("CLAUDE.md"));
});

test("resolves manifest into concrete source files", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  assert.ok(files.includes("surfaces/release/README.md"));
  assert.ok(files.includes("surfaces/release/HISTORY.md"));
  assert.ok(files.includes("INSTALL.md"));
  assert.ok(files.includes("install-project-local.sh"));
  assert.ok(files.includes("scripts/publish/render-browser-flow-surfaces.mjs"));
  assert.ok(files.includes("scripts/publish/render-browser-flow-surfaces-cli.mjs"));
  assert.ok(files.includes("surfaces/browser-flow/public/entry.md"));
  assert.ok(files.includes("surfaces/browser-flow/adapters/claude/browser-flow.md.tmpl"));
});

test("maps release-only source templates to release-root documents", () => {
  assert.equal(releasePathFor("surfaces/release/README.md"), "README.md");
  assert.equal(releasePathFor("surfaces/release/HISTORY.md"), "HISTORY.md");
  assert.equal(releasePathFor("INSTALL.md"), "INSTALL.md");
});

test("shipping source list excludes dev-only dirs and committed adapter outputs", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  assert.ok(!files.some((f) => f.startsWith("tasks/")));
  assert.ok(!files.some((f) => f.startsWith("docs/superpowers/")));
  assert.ok(!files.includes("docs/roadmap.md"));
  assert.ok(!files.includes(".codex/skills/browser-flow/SKILL.md"));
  assert.ok(!files.includes(".claude/commands/browser-flow.md"));
  assert.ok(!files.includes("CLAUDE.md"));
});

test("shipping source excludes runtime/dev/secret dirs and files", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  const forbidden = [".git/", "node_modules/", "artifacts/", "profiles/", "coverage/", "_temp/"];
  for (const prefix of forbidden) {
    assert.ok(!files.some((f) => f === prefix.slice(0, -1) || f.startsWith(prefix)));
  }
  assert.ok(!files.some((f) => f === ".pii-identities" || f.endsWith("/.pii-identities")));
  assert.ok(!files.some((f) => f.endsWith(".DS_Store")));
});

test("release build emits a package-centric surface with no committed generated adapters", () => {
  const releaseDir = mkdtempSync(resolve(dirname(manifest), "release-shipping-"));
  try {
    execFileSync("node", ["scripts/publish/build-bundle.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, BROWSER_FLOW_RELEASE_DIR: releaseDir },
      stdio: "pipe"
    });

    for (const required of [
      "README.md",
      "HISTORY.md",
      "INSTALL.md",
      "install-project-local.sh",
      "scripts/publish/render-browser-flow-surfaces.mjs",
      "scripts/publish/render-browser-flow-surfaces-cli.mjs",
      "surfaces/browser-flow/public/entry.md",
      "surfaces/browser-flow/adapters/claude/browser-flow.md.tmpl",
      "skills/browser-flow/SKILL.md",
      "skills/browser-flow/prompt.md",
      "skills/browser-flow/scripts/validate-skill.mjs",
      "skills/browser-flow/runtime/scripts/cli.mjs",
      "skills/browser-flow/runtime/package.json",
      "skills/browser-flow/runtime/package-lock.json",
      "skills/browser-flow/runtime/tsconfig.json",
      "skills/browser-flow/agents/orchestrator/AGENT.md",
      "skills/browser-flow/skills/capture-driver/SKILL.md"
    ]) {
      assert.ok(existsSync(resolve(releaseDir, required)), `must ship ${required}`);
    }

    assert.ok(!existsSync(resolve(releaseDir, ".codex")));
    assert.ok(!existsSync(resolve(releaseDir, ".claude")));
    assert.ok(!existsSync(resolve(releaseDir, "CLAUDE.md")));
    assert.ok(!existsSync(resolve(releaseDir, ".browser-flow")));

    const runtimePackage = JSON.parse(
      readFileSync(resolve(releaseDir, "skills/browser-flow/runtime/package.json"), "utf8")
    );
    assert.deepEqual(runtimePackage.scripts, {
      "validate-skill": "node ../scripts/validate-skill.mjs"
    });
  } finally {
    rmSync(releaseDir, { recursive: true, force: true });
  }
});
