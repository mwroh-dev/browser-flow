// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMANDS,
  buildCapabilities,
  buildCommandSchema,
  buildSchema,
  renderCommandHelp
} from "../../scripts/lib/cli-metadata.mjs";
import { EXIT_CODE_DEFINITIONS } from "../../scripts/lib/cli-errors.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

test("every metadata command is discoverable through help, schema, and capabilities", () => {
  const capabilities = buildCapabilities();
  const schema = buildSchema();
  const capabilityNames = new Set(capabilities.commands.map((entry) => entry.name));
  const schemaNames = new Set(schema.commands.map((entry) => entry.name));

  for (const command of COMMANDS) {
    assert.equal(capabilityNames.has(command.name), true, `${command.name} missing from capabilities`);
    assert.equal(schemaNames.has(command.name), true, `${command.name} missing from schema`);
    assert.ok(buildCommandSchema(command.name), `${command.name} missing command schema`);
    assert.match(renderCommandHelp(command.name) || "", new RegExp(`browser-flow ${command.name}`));
  }
});

test("CLI contract docs include all stable exit-code names", () => {
  const doc = readFileSync(resolve(getRepoRoot(), "docs", "cli-contract.md"), "utf8");

  for (const exitCode of EXIT_CODE_DEFINITIONS) {
    assert.match(doc, new RegExp(`\\| ${exitCode.status} \\| ${exitCode.code} \\|`));
  }
});

test("docs mention every public command group in the machine-readable schema", () => {
  const doc = readFileSync(resolve(getRepoRoot(), "docs", "cli.md"), "utf8");
  const groups = new Set(buildSchema().commands.map((entry) => entry.group));

  for (const group of ["setup", "capture", "pipeline", "reuse", "extract", "promote", "compose", "cleanup"]) {
    assert.equal(groups.has(group), true, `${group} missing from schema groups`);
  }
  for (const phrase of [
    "First Capture",
    "Analyze, Generate, Verify",
    "Reuse",
    "Extract Data",
    "Promote External Workflow",
    "Cleanup And Recovery"
  ]) {
    assert.match(doc, new RegExp(phrase));
  }
});
