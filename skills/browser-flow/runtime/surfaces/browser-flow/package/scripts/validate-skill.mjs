#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentsRoot = resolve(root, "agents");
const skillsRoot = resolve(root, "skills");
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

const agentNames = ["orchestrator", "capture", "analyzer", "generator", "verifier"];
const requiredAgentFiles = agentNames.flatMap((name) => [
  `agents/${name}/AGENT.md`,
  `agents/${name}/openai.yaml`,
  `agents/${name}/knowledge-pattern.md`
]);
const requiredRuntimeFiles = [
  "scripts/cli.mjs",
  "scripts/cli-main.mjs",
  "scripts/commands/compose.mjs",
  "scripts/commands/review-locator-intent.mjs",
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

// Every agent's AGENT.md must declare a Safety Layers section
// (multi-layered-safety-via-code: Role / Gate / Rule / Hook mapping).
// The Safety Layers section must additionally include explicit
// Role and Gate rows so the four-layer model is structurally complete.
const requiredSafetyLayerRows = ["| Role ", "| Gate "];
for (const name of agentNames) {
  const agentText = readFileSync(resolve(agentsRoot, `${name}/AGENT.md`), "utf8");
  const safetyHeader = "## Safety Layers";
  const safetyIndex = agentText.indexOf(safetyHeader);
  if (safetyIndex === -1) {
    throw new Error(
      `agents/${name}/AGENT.md must declare a '## Safety Layers' section.`
    );
  }
  const safetySection = agentText.slice(safetyIndex);
  for (const row of requiredSafetyLayerRows) {
    if (!safetySection.includes(row)) {
      throw new Error(
        `agents/${name}/AGENT.md Safety Layers section must include a '${row.trim()}' row (multi-layered-safety-via-code).`
      );
    }
  }
}

// Section-order check — every AGENT.md must match the canonical
// outline. The only slot that varies is role-specific (orchestrator:
// Phase Agents + Skill Entry Point; phase agents: Callable Tools).
// Everything from Behavioral Contract onward is identical across all
// five agents.
const orchestratorSections = [
  "Identity",
  "Role",
  "Phase Agents",
  "Skill Entry Point",
  "Behavioral Contract",
  "Safety Layers",
  "Knowledge"
];
const phaseAgentSections = [
  "Identity",
  "Role",
  "Callable Tools",
  "Behavioral Contract",
  "Safety Layers",
  "Knowledge"
];
for (const name of agentNames) {
  const agentText = readFileSync(resolve(agentsRoot, `${name}/AGENT.md`), "utf8");
  const sectionHeaders = (agentText.match(/^## .+$/gm) ?? []).map((line) =>
    line.slice(3).trim()
  );
  const expected = name === "orchestrator" ? orchestratorSections : phaseAgentSections;
  if (sectionHeaders.length !== expected.length) {
    throw new Error(
      `agents/${name}/AGENT.md must have exactly ${expected.length} top-level sections (found ${sectionHeaders.length}: ${JSON.stringify(sectionHeaders)})`
    );
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (sectionHeaders[i] !== expected[i]) {
      throw new Error(
        `agents/${name}/AGENT.md section #${i + 1} must be '## ${expected[i]}' (found '## ${sectionHeaders[i]}')`
      );
    }
  }
}

// knowledge-pattern.md must declare its canonical strategy
// header verbatim (knowledge-update-strategies.md canonical form).
// The agent-type → strategy mapping is fixed; drift means the agent's
// declared strategy and the strategy actually used to write semantic
// entries can diverge silently.
const expectedStrategyHeader = {
  orchestrator: "## Strategy: Strategy B + prediction-error + meta",
  capture: "## Strategy: Strategy B + prediction-error",
  analyzer: "## Strategy: Strategy B (N=3)",
  generator: "## Strategy: Strategy B (N=3)",
  verifier: "## Strategy: Strategy B + prediction-error"
};
for (const name of agentNames) {
  const patternPath = resolve(agentsRoot, `${name}/knowledge-pattern.md`);
  const patternText = readFileSync(patternPath, "utf8");
  const expected = expectedStrategyHeader[name];
  if (!patternText.includes(expected)) {
    throw new Error(
      `agents/${name}/knowledge-pattern.md must declare strategy header '${expected}' verbatim (knowledge-update-strategies.md canonical form)`
    );
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

const captureDriverText = readFileSync(
  resolve(skillsRoot, "capture-driver", "SKILL.md"),
  "utf8"
);
const captureAgentText = readFileSync(
  resolve(agentsRoot, "capture/AGENT.md"),
  "utf8"
);
const orchestratorAgentText = readFileSync(
  resolve(agentsRoot, "orchestrator/AGENT.md"),
  "utf8"
);

// manifest.json references is the available-reference catalog;
// prompt.md is the per-phase binding. Every catalog entry must be
// named somewhere in prompt.md, otherwise the manifest holds a dead
// listing (silent divergence between two authority surfaces —
// purpose-scoped-authority warns against this).
const manifestText = readFileSync(resolve(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
if (!Array.isArray(manifest.references)) {
  throw new Error("manifest.json must declare a 'references' array");
}

const promptText = readFileSync(resolve(root, "prompt.md"), "utf8");
const runtimeCliMainText = readFileSync(resolve(runtimeRoot, "scripts/cli-main.mjs"), "utf8");
const runtimeCliMetadataText = readFileSync(resolve(runtimeRoot, "scripts/lib/cli-metadata.mjs"), "utf8");
const runtimeConfigText = readFileSync(resolve(runtimeRoot, "scripts/lib/config.mjs"), "utf8");
const runtimeSchemaVersionsText = readFileSync(resolve(runtimeRoot, "scripts/lib/schema-versions.mjs"), "utf8");
const runtimeSchemasText = readFileSync(resolve(runtimeRoot, "scripts/lib/schemas.mjs"), "utf8");
if (!promptText.includes("Never declare success before both")) {
  throw new Error("prompt.md must include the verification constitutional invariant.");
}
if (!promptText.includes("project-local")) {
  throw new Error("prompt.md must include the project-local installation invariant.");
}
if (!promptText.includes("--unmasked") || !promptText.includes("real-site")) {
  throw new Error("prompt.md must document explicit real-site capture via --unmasked.");
}
if (!/public-read[\s\S]*auto-promot/i.test(promptText)
  || !/explicit\s+operator approval[\s\S]*origin, auth\/profile, privacy, screenshot, and\s+data-mode metadata/i.test(promptText)) {
  throw new Error("prompt.md must match registry behavior: public-read real-site runs may auto-promote; other external runs require explicit operator approval.");
}
if (/security gates prove[\s\S]*safe to promote/i.test(promptText)) {
  throw new Error("prompt.md must not imply the current security gates can promote unmasked real-site runs.");
}
if (!/manual capture opens a visible Chrome/i.test(promptText)) {
  throw new Error("prompt.md must state that manual capture opens a visible Chrome by default.");
}
if (!/awaiting_capture[\s\S]*hard stop/i.test(promptText)) {
  throw new Error("prompt.md must describe awaiting_capture as a hard stop for manual capture.");
}
if (/prepare --run-id <id> --fixture <fixture> --headless/i.test(promptText)) {
  throw new Error("prompt.md must not show --headless on the manual capture prepare example.");
}
if (/verify --run-id <id> --headless/i.test(promptText)) {
  throw new Error("prompt.md must not make verify headless unconditionally.");
}
if (!/manual real-site external[\s\S]*(visual\/canvas|stateful-surface)[\s\S]*omit `--headless`/i.test(promptText)) {
  throw new Error("prompt.md must tell manual real-site visual/stateful workflows to omit --headless for verify by default.");
}
if (!/local fixtures[\s\S]*synthetic\/e2e tests[\s\S]*known headless-stable[\s\S]*pass `--headless`/i.test(promptText)) {
  throw new Error("prompt.md must keep --headless guidance for fixtures, tests, and known headless-stable automation flows.");
}
if (!/headless verify fails[\s\S]*headed verify[\s\S]*environment parity/i.test(promptText)) {
  throw new Error("prompt.md must classify headed/headless divergence as environment parity, not headless success.");
}
if (!/Do not use\s+(computer-use|browser automation|CDP control|agent-operated browsing)/i.test(promptText)) {
  throw new Error("prompt.md must forbid agent-driven browser control during manual capture.");
}
if (!/unless the user explicitly asks for\s+automation-driven capture/i.test(promptText)) {
  throw new Error("prompt.md must require explicit user opt-in before automation-driven capture replaces a human demo.");
}
if (!/human\/manual[\s\S]*omit `--headless`|omit `--headless`[\s\S]*human\/manual/i.test(captureDriverText)) {
  throw new Error("capture-driver SKILL.md must tell manual capture flows to omit --headless.");
}
if (!/Do not use\s+(computer-use|browser automation|CDP control|agent-operated browsing)/i.test(captureDriverText)) {
  throw new Error("capture-driver SKILL.md must forbid agent-driven browser control during manual capture.");
}
if (!/unless the user explicitly asks for\s+automation-driven capture/i.test(captureDriverText)) {
  throw new Error("capture-driver SKILL.md must require explicit user opt-in before automation-driven capture replaces a human demo.");
}
if (!/human\/manual[\s\S]*omit `--headless`|omit `--headless`[\s\S]*human\/manual/i.test(captureAgentText)) {
  throw new Error("agents/capture/AGENT.md must tell manual capture flows to omit --headless.");
}
if (!/Do not use\s+(computer-use|browser automation|CDP control|agent-operated browsing)/i.test(captureAgentText)) {
  throw new Error("agents/capture/AGENT.md must forbid agent-driven browser control during manual capture.");
}
if (!/unless the user explicitly asks for\s+automation-driven capture/i.test(captureAgentText)) {
  throw new Error("agents/capture/AGENT.md must require explicit user opt-in before automation-driven capture replaces a human demo.");
}

// Every manifest.json reference path must appear in prompt.md.
// A future addition to the manifest that nobody binds in prompt.md
// fails here as a dead-listing audit.
for (const refPath of manifest.references) {
  if (typeof refPath !== "string") {
    throw new Error(
      `manifest.json references entries must be strings (got ${typeof refPath})`
    );
  }
  if (!promptText.includes(refPath)) {
    throw new Error(
      `manifest.json references entry '${refPath}' is not bound anywhere in prompt.md (dead listing)`
    );
  }
}

// 5-agent projected-view linkage.
if (!promptText.includes("Pipeline — Phase Entry Protocol")) {
  throw new Error(
    "prompt.md must declare 'Pipeline — Phase Entry Protocol' so phase entry is structurally locatable."
  );
}
for (const name of agentNames) {
  const agentMdPath = `agents/${name}/AGENT.md`;
  if (!promptText.includes(agentMdPath)) {
    throw new Error(`prompt.md must reference projected view path: ${agentMdPath}`);
  }
  const openaiPath = `agents/${name}/openai.yaml`;
  if (!promptText.includes(openaiPath)) {
    throw new Error(`prompt.md must reference projected view path: ${openaiPath}`);
  }
}

const phaseSpecificReferences = [
  ["### Phase 1 — Capture", "references/security-policy.md"],
  ["### Phase 1 — Capture", "references/replay-permission-policy.md"],
  ["### Phase 2 — Analyze", "references/replay-permission-policy.md"],
  ["### Phase 3 — Generate", "references/artifact-schemas.md"],
  ["### Phase 3 — Generate", "references/replay-permission-policy.md"],
  ["### Phase 4 — Verify", "references/verification-rules.md"],
  ["### Phase 4 — Verify", "references/replay-permission-policy.md"]
];
const nextPhaseRegex = /### Phase \d+ — /g;
for (const [phaseHeader, refPath] of phaseSpecificReferences) {
  const phaseStart = promptText.indexOf(phaseHeader);
  if (phaseStart === -1) {
    throw new Error(`prompt.md must include phase header: ${phaseHeader}`);
  }
  nextPhaseRegex.lastIndex = phaseStart + phaseHeader.length;
  const nextMatch = nextPhaseRegex.exec(promptText);
  const phaseEnd = nextMatch ? nextMatch.index : promptText.length;
  const phaseBlock = promptText.slice(phaseStart, phaseEnd);
  if (!phaseBlock.includes(refPath)) {
    throw new Error(`phase block "${phaseHeader}" must reference ${refPath} inside its block`);
  }
}

if (!promptText.includes("agent identity")) {
  throw new Error(
    "prompt.md must instruct the LLM to self-identify with the phrase 'agent identity' at phase entry."
  );
}

const replayPermissionLevels = [
  "deny",
  "strict-replay",
  "canonicalize",
  "confirmed-equivalence",
  "state-proof-replay"
];
const replayPolicyPath = "references/replay-permission-policy.md";
const replayPolicyText = readFileSync(resolve(root, replayPolicyPath), "utf8");
for (const level of replayPermissionLevels) {
  if (!replayPolicyText.includes(level)) {
    throw new Error(`${replayPolicyPath} must define replay permission level '${level}'.`);
  }
  if (!promptText.includes(level)) {
    throw new Error(`prompt.md must reference replay permission level '${level}'.`);
  }
}
for (const name of agentNames) {
  const agentText = readFileSync(resolve(agentsRoot, `${name}/AGENT.md`), "utf8");
  if (!agentText.includes(replayPolicyPath)) {
    throw new Error(`agents/${name}/AGENT.md must reference ${replayPolicyPath}.`);
  }
  for (const level of replayPermissionLevels) {
    if (!agentText.includes(level)) {
      throw new Error(`agents/${name}/AGENT.md must reference replay permission level '${level}'.`);
    }
  }
}
if (!/Intent classification: action replay vs DATA extraction vs both/i.test(promptText)) {
  throw new Error("prompt.md must begin its checklist with intent classification.");
}
if (
  !/top N|current|latest|headlines|prices|rows|list|collect|read|check values/i.test(promptText)
) {
  throw new Error("prompt.md must route top/current/latest/list-style requests to Extract.");
}
if (!/stop on the listing or data page/i.test(promptText)) {
  throw new Error("prompt.md must tell data-only flows to stop on the listing or data page.");
}
if (!/ordinal list action/i.test(promptText)) {
  throw new Error("prompt.md must preserve ordinal list actions for dynamic item clicks.");
}
if (!/not only fixed-title/i.test(promptText)) {
  throw new Error("prompt.md must not collapse dynamic item clicks into only fixed-title clicks.");
}
if (
  !/current\/top\/latest\/list data[\s\S]*Extract routing/i.test(
    orchestratorAgentText
  )
) {
  throw new Error(
    "agents/orchestrator/AGENT.md must own interpreting current/top/latest/list data and Extract routing."
  );
}
if (!/dynamic_content_drift[\s\S]*action_path/i.test(promptText)) {
  throw new Error("prompt.md must explain dynamic_content_drift with action_path.");
}
if (!/not a claim that the user'?s action was wrong/i.test(promptText.replace(/\s+/g, " "))) {
  throw new Error("prompt.md must describe dynamic drift holds as not-verified rather than user failure.");
}
if (/verification_failed/i.test(promptText) || /verification_failed/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must use structured not_verified_hold wording instead of verification_failed.");
}
if (!/not_verified_hold/i.test(promptText) || !/not_verified_hold/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must define not_verified_hold as the structured replay hold checkpoint.");
}
if (!/capture_noise_review/i.test(promptText) || !/capture_noise_review/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must define capture_noise_review for ambiguous capture-noise review.");
}
if (!/review-noise --run-id <id>/i.test(promptText) || !/review-noise --run-id <id>/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must route capture_noise_review through the review-noise briefing/apply command.");
}
if (!/locator_intent_review/i.test(promptText) || !/locator_intent_review/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must define locator_intent_review for generic same-name semantic locator review.");
}
if (!/review-locator-intent --run-id <id>/i.test(promptText) || !/review-locator-intent --run-id <id>/i.test(orchestratorAgentText)) {
  throw new Error("skill contract must route locator_intent_review through the review-locator-intent briefing/apply command.");
}
if (!/action text[\s\S]*semantic|semantic[\s\S]*action text/i.test(promptText) || !/same-name counts/i.test(promptText)) {
  throw new Error("prompt.md must require full locator_intent_review candidate briefing instead of opaque all-candidate prompts.");
}
const runtimeCliRegistryText = readFileSync(resolve(runtimeRoot, "scripts/lib/cli-registry.mjs"), "utf8");
if (!/"review-noise":\s*async \(\) =>[\s\S]*reviewNoiseCommand/.test(runtimeCliRegistryText)) {
  throw new Error("runtime/scripts/lib/cli-registry.mjs must lazy-load reviewNoiseCommand.");
}
if (!/"review-locator-intent":\s*async \(\) =>[\s\S]*reviewLocatorIntentCommand/.test(runtimeCliRegistryText)) {
  throw new Error("runtime/scripts/lib/cli-registry.mjs must lazy-load reviewLocatorIntentCommand.");
}

const composeHeader = "## Compose — v1 boundary";
const composeIndex = promptText.indexOf(composeHeader);
if (composeIndex === -1) {
  throw new Error("prompt.md must include a compose boundary section.");
}
const composeEnd = promptText.indexOf("## Constitutional Invariants", composeIndex);
const composeSection = promptText.slice(composeIndex, composeEnd === -1 ? promptText.length : composeEnd);
if (!/bf compose --run-id <id> --request "<goal>"/i.test(composeSection)) {
  throw new Error("compose section must document `bf compose --run-id <id> --request \"<goal>\"`.");
}
if (!/one primary run/i.test(composeSection) || !/primary-run-only/i.test(composeSection)) {
  throw new Error("compose section must state that v1 is primary-run-only.");
}
if (!/interactive live learning/i.test(composeSection)) {
  throw new Error("compose section must mention interactive live learning.");
}
if (!/multi-run compose[\s\S]*deferred/i.test(composeSection)) {
  throw new Error("compose section must defer multi-run compose.");
}
if (
  !/code-enforced safety gates/i.test(composeSection) ||
  !/runtime validation and gate\s+code/i.test(composeSection)
) {
  throw new Error("compose section must keep safety enforcement in code and validator wording.");
}
if (!/compose:\s*async \(\) =>[\s\S]*composeCommand/.test(runtimeCliRegistryText)) {
  throw new Error("runtime/scripts/lib/cli-registry.mjs must lazy-load composeCommand.");
}
if (!/name:\s*"compose"[\s\S]*description:\s*"Compose a primary workflow request/i.test(runtimeCliMetadataText)) {
  throw new Error("runtime/scripts/lib/cli-metadata.mjs help metadata must document the compose command.");
}
if (!/COMMAND_REGISTRY/.test(runtimeCliMainText) && !/resolveRegistryEntry/.test(runtimeCliMainText)) {
  throw new Error("runtime/scripts/cli-main.mjs must dispatch through the command registry.");
}
if (!/composeRequestPath/.test(runtimeConfigText) || !/composeSummaryPath/.test(runtimeConfigText)) {
  throw new Error("runtime/scripts/lib/config.mjs must expose compose artifact paths.");
}
if (!/composeDecision:\s*1/.test(runtimeSchemaVersionsText) || !/composeSummary:\s*1/.test(runtimeSchemaVersionsText)) {
  throw new Error("runtime/scripts/lib/schema-versions.mjs must register compose artifact schema versions.");
}
if (!/ComposeDecisionV1/.test(runtimeSchemasText) || !/ComposeSummaryV1/.test(runtimeSchemasText)) {
  throw new Error("runtime/scripts/lib/schemas.mjs must include compose artifact schemas.");
}

process.stdout.write("browser-flow skill validated\n");
