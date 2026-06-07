import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getRepoRoot } from "../../scripts/lib/config.mjs";

/**
 * @param {string} relativePath
 * @returns {string}
 */
function readFile(relativePath) {
  return readFileSync(resolve(getRepoRoot(), relativePath), "utf8");
}

function readComposerSkill() {
  return readFile("agents/orchestrator/playbooks/composer-agent.md");
}

test("composer-agent contract is compose-only judgment with explicit prohibitions", () => {
  const skill = readComposerSkill();

  assert.match(skill, /compose sub-agent/i);
  assert.match(skill, /forbid|must not|do not/i);
  assert.match(skill, /browser execution|execute the browser|browser actions/i);
  assert.match(skill, /safety decisions|safety policy|security policy/i);
  assert.match(skill, /direct workflow mutation|edit workflow\.json|mutate the workflow/i);
  assert.match(skill, /requesting full orchestrator history|full orchestrator history|full workflow history/i);
});

test("composer-agent returns only a structured decision artifact", () => {
  const skill = readComposerSkill();

  assert.match(skill, /structured decision artifact/i);
  assert.match(skill, /schemaVersion/i);
  assert.match(skill, /requestIntent/i);
  assert.match(skill, /targetState/i);
  assert.match(skill, /mustKeep/i);
  assert.match(skill, /maySkip/i);
  assert.match(skill, /requiresData/i);
  assert.match(skill, /candidateHints/i);
  assert.match(skill, /preferredSegments/i);
  assert.match(skill, /stopAfterSegment/i);
  assert.match(skill, /notes/i);
  assert.match(skill, /"preferredSegments":\s*\[\s*0\s*,\s*1\s*\]/i);
  assert.match(skill, /"stopAfterSegment":\s*1/i);
  assert.match(skill, /preferredSegments[\s\S]*(numeric segment indexes|number\[\])/i);
  assert.match(skill, /stopAfterSegment[\s\S]*(optional numeric segment index|number)/i);
  assert.doesNotMatch(skill, /segment id/i);
  assert.doesNotMatch(skill, /"<segment id>"/i);
  assert.doesNotMatch(skill, /"status":/i);
  assert.doesNotMatch(skill, /"kind":\s*"segment-reuse"/i);
  assert.doesNotMatch(skill, /shortNotes/i);
  assert.doesNotMatch(skill, /run bf |bf prepare|bf analyze|click|type|navigate/i);
});

test("browser-flow prompt documents the v1 compose boundary", () => {
  const prompt = readFile("surfaces/browser-flow/public/entry.md");

  assert.match(prompt, /bf compose/i);
  assert.match(prompt, /--run-id/i);
  assert.match(prompt, /interactive live learning/i);
  assert.match(prompt, /multi-run compose/i);
  assert.match(prompt, /deferred/i);
  assert.match(prompt, /primary run/i);
});

test("browser-flow README documents compose v1 as primary-run-only", () => {
  const readme = readFile("README.md");

  assert.match(readme, /bf compose/i);
  assert.match(readme, /primary run/i);
  assert.match(readme, /multi-run/i);
  assert.match(readme, /deferred/i);
  assert.match(readme, /reuse-first/i);
  assert.match(readme, /interactive live learning/i);
});
