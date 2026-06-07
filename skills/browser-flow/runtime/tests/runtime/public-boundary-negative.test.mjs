import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { renderClaudeCommand } from "../../scripts/publish/render-browser-flow-surfaces.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";
import { withAssembledPackage } from "../helpers/assembled-package.mjs";

test("package prompt and rendered claude command do not advertise internal playbooks as entry surfaces", async () => {
  const root = getRepoRoot();
  await withAssembledPackage(async ({ packageRoot }) => {
    const commandStage = mkdtempSync(resolve(tmpdir(), "browser-flow-command-"));
    try {
      const commandPath = resolve(commandStage, ".claude/commands/browser-flow.md");
      renderClaudeCommand(root, commandPath, ".claude/browser-flow");

      const codexPrompt = readFileSync(resolve(packageRoot, "prompt.md"), "utf8");
      const claudeCmd = readFileSync(commandPath, "utf8");
      const codexPublicEntry = codexPrompt.split("## Role Identity")[0];
      const claudePublicEntry = claudeCmd.split("## Role Identity")[0];
      const publicSurfaces = [codexPublicEntry, claudePublicEntry];

      assert.match(codexPublicEntry, /Top-level entrypoints may invoke only this flow\./);
      assert.match(codexPublicEntry, /Internal agent-owned playbooks are not public entry surfaces\./);
      assert.match(claudePublicEntry, /Top-level entrypoints may invoke only this flow\./);
      assert.match(claudePublicEntry, /Internal agent-owned playbooks are not public entry surfaces\./);

      for (const forbidden of [
        "scope-agent",
        "scoring-agent",
        "heal-agent",
        "scraping-agent",
        "extract-heal-agent",
        "variable-agent",
        "spec-agent",
        "capture-driver"
      ]) {
        for (const publicSurface of publicSurfaces) {
          assert.doesNotMatch(publicSurface, new RegExp(forbidden));
        }
      }
    } finally {
      rmSync(commandStage, { recursive: true, force: true });
    }
  });
});

test("canonical docs state browser-flow is the only public entry surface", () => {
  const root = getRepoRoot();
  const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
  const architecture = readFileSync(resolve(root, "docs/architecture.md"), "utf8");

  for (const doc of [agents, architecture]) {
    assert.match(doc, /Only `browser-flow` is a public entry surface\./);
    assert.match(doc, /Internal playbooks are agent-owned and are not top-level model entry surfaces\./);
  }
});
