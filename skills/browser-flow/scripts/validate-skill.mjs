#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = resolve(root, "agents");
const runtimeRoot = resolve(root, "runtime");

const requiredSkillFiles = [
  "SKILL.md",
  "prompt.md",
  "manifest.json",
  "references/security-policy.md",
  "references/artifact-schemas.md",
  "references/verification-rules.md",
  "references/replay-permission-policy.md",
  "references/commit-protocol.md",
  "references/registry-contract.md"
];

const agentNames = ["orchestrator", "capture", "analyzer", "generator", "verifier", "extractor"];
const requiredAgentFiles = agentNames.flatMap((name) => [
  `agents/${name}/AGENT.md`,
  `agents/${name}/openai.yaml`,
  `agents/${name}/knowledge-pattern.md`
]);
const requiredRuntimeFiles = [
  "scripts/cli.mjs",
  "scripts/cli-main.mjs",
  "scripts/commands/compose.mjs",
  "scripts/commands/review-noise.mjs",
  "scripts/commands/review-locator-intent.mjs",
  "scripts/commands/review-route-intent.mjs",
  "scripts/analyze/locator-intent.mjs",
  "scripts/analyze/replay-policy.mjs",
  "scripts/compose/compose-summary.mjs",
  "scripts/compose/workflow-assembler.mjs",
  "scripts/compose/policy-hooks.mjs",
  "scripts/lib/schemas.mjs",
  "scripts/lib/schema-versions.mjs",
  "scripts/lib/cli-metadata.mjs",
  "scripts/lib/cli-registry.mjs",
  "scripts/lib/config.mjs",
  "package.json",
  "package-lock.json"
];

for (const relativePath of requiredSkillFiles) {
  if (!existsSync(resolve(root, relativePath))) {
    throw new Error(`Missing required skill file: ${relativePath}`);
  }
}
for (const relativePath of requiredAgentFiles) {
  if (!existsSync(resolve(root, relativePath))) {
    throw new Error(`Missing required agent file: ${relativePath}`);
  }
}
for (const relativePath of requiredRuntimeFiles) {
  if (!existsSync(resolve(runtimeRoot, relativePath))) {
    throw new Error(`Missing required runtime file: runtime/${relativePath}`);
  }
}

// Keep this validator dependency-free so a freshly installed project-local
// skill can be checked before runtime dependencies are installed.
for (const name of agentNames) {
  const yamlPath = resolve(agentsRoot, `${name}/openai.yaml`);
  const yamlText = readFileSync(yamlPath, "utf8");
  const roleTypeMatch = yamlText.match(/^role_type:\s*["']?([^"'\s#]+)/m);
  if (!roleTypeMatch) {
    throw new Error(`agents/${name}/openai.yaml must declare role_type.`);
  }
  const expectedRoleType = name === "orchestrator" ? "entry" : "phase";
  if (roleTypeMatch[1] !== expectedRoleType) {
    throw new Error(
      `agents/${name}/openai.yaml role_type must be '${expectedRoleType}' (found '${roleTypeMatch[1]}')`
    );
  }
}

const skillText = readFileSync(resolve(root, "SKILL.md"), "utf8");
if (!skillText.includes("surface: repo_skill")) {
  throw new Error("SKILL.md must declare surface: repo_skill.");
}

const manifestText = readFileSync(resolve(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
if (manifest.name !== "browser-flow") {
  throw new Error("manifest.json must declare name: browser-flow.");
}
if (manifest.surface !== "repo_skill") {
  throw new Error("manifest.json must declare surface: repo_skill.");
}
if (manifest.prompt !== "prompt.md") {
  throw new Error("manifest.json must point prompt to prompt.md.");
}
if (!Array.isArray(manifest.references)) {
  throw new Error("manifest.json must declare a 'references' array");
}
for (const refPath of manifest.references) {
  if (typeof refPath !== "string") {
    throw new Error(
      `manifest.json references entries must be strings (got ${typeof refPath})`
    );
  }
  if (!existsSync(resolve(root, refPath))) {
    throw new Error(`manifest.json references missing file: ${refPath}`);
  }
}

const runtimeCliMainText = readFileSync(resolve(runtimeRoot, "scripts/cli-main.mjs"), "utf8");
const runtimeCliRegistryText = readFileSync(resolve(runtimeRoot, "scripts/lib/cli-registry.mjs"), "utf8");
const runtimeCliMetadataText = readFileSync(resolve(runtimeRoot, "scripts/lib/cli-metadata.mjs"), "utf8");
const cliDispatchText = `${runtimeCliMainText}\n${runtimeCliRegistryText}\n${runtimeCliMetadataText}`;

const requiredCommands = [
  "prepare",
  "done",
  "analyze",
  "generate",
  "verify",
  "extract",
  "extract-heal",
  "review-noise",
  "review-locator-intent",
  "review-route-intent",
  "compose"
];
for (const command of requiredCommands) {
  if (!new RegExp(`name:\\s*"${command}"`).test(runtimeCliMetadataText)) {
    throw new Error(`runtime CLI metadata must document command: ${command}`);
  }
}
for (const [command, handler] of [
  ["review-noise", "reviewNoiseCommand"],
  ["review-locator-intent", "reviewLocatorIntentCommand"],
  ["review-route-intent", "reviewRouteIntentCommand"],
  ["compose", "composeCommand"]
]) {
  if (!cliDispatchText.includes(command) || !cliDispatchText.includes(handler)) {
    throw new Error(`runtime CLI must dispatch the ${command} command.`);
  }
}

const runtimeConfigText = readFileSync(resolve(runtimeRoot, "scripts/lib/config.mjs"), "utf8");
const runtimeSchemaVersionsText = readFileSync(resolve(runtimeRoot, "scripts/lib/schema-versions.mjs"), "utf8");
const runtimeSchemasText = readFileSync(resolve(runtimeRoot, "scripts/lib/schemas.mjs"), "utf8");
for (const token of ["composeRequestPath", "composeSummaryPath"]) {
  if (!runtimeConfigText.includes(token)) {
    throw new Error(`runtime/scripts/lib/config.mjs must expose ${token}.`);
  }
}
for (const token of ["composeDecision", "composeSummary"]) {
  if (!new RegExp(`${token}:\\s*1`).test(runtimeSchemaVersionsText)) {
    throw new Error(`runtime/scripts/lib/schema-versions.mjs must register ${token}.`);
  }
}
for (const token of ["ComposeDecisionV1", "ComposeSummaryV1"]) {
  if (!runtimeSchemasText.includes(token)) {
    throw new Error(`runtime/scripts/lib/schemas.mjs must include ${token}.`);
  }
}

process.stdout.write("browser-flow skill validated\n");
