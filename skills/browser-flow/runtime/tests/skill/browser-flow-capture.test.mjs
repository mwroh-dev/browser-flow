import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assembleBrowserFlowPackage } from "../../scripts/publish/render-browser-flow-surfaces.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

const packageStage = mkdtempSync(resolve(tmpdir(), "browser-flow-capture-package-"));
const packageRoot = resolve(packageStage, "skills", "browser-flow");
assembleBrowserFlowPackage(getRepoRoot(), packageRoot);
process.on("exit", () => rmSync(packageStage, { recursive: true, force: true }));

/**
 * @param {string} relativePath
 * @returns {string}
 */
function packageFile(relativePath) {
  return resolve(packageRoot, relativePath);
}

test("browser-flow skill bundle exists and validates", () => {
  const result = spawnSync(process.execPath, [
    "scripts/publish/validate-skill-package.mjs"
  ], {
    cwd: getRepoRoot(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /validated/);
});

test("browser-flow public contract distinguishes project-local install from real-site capture", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");

  assert.doesNotMatch(prompt, /Capture targets must be local-only/);
  assert.match(prompt, /project-local/i);
  assert.match(prompt, /real-site/i);
  assert.match(prompt, /--unmasked/);
});

test("browser-flow real-site registry wording matches the implemented promotion gate", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");

  assert.match(prompt, /public-read/i);
  assert.match(prompt, /sensitive security findings[\s\S]*require explicit operator promotion/i);
  assert.doesNotMatch(prompt, /future explicit promotion path/i);
  assert.doesNotMatch(prompt, /security gates prove[\s\S]*safe to promote/i);
});

test("browser-flow manual capture defaults to visible Chrome", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");

  assert.match(prompt, /manual capture opens a visible Chrome/i);
  assert.match(
    prompt,
    /prepare --run-id <id> --fixture <fixture> \[--start-url <url>\] \[--unmasked\] \[--snapshot-dom\]/i
  );
  assert.doesNotMatch(
    prompt,
    /prepare --run-id <id> --fixture <fixture> --headless/i
  );
  assert.doesNotMatch(prompt, /verify --run-id <id> --headless/i);
  assert.match(
    prompt,
    /manual real-site external[\s\S]*(visual\/canvas|stateful-surface)[\s\S]*omit `--headless`/i
  );
  assert.match(
    prompt,
    /local fixtures[\s\S]*synthetic\/e2e tests[\s\S]*known headless-stable[\s\S]*pass `--headless`/i
  );
  assert.match(
    prompt,
    /headless verify fails[\s\S]*headed verify[\s\S]*environment parity/i
  );
});

test("browser-flow manual capture pauses for the user instead of letting the model drive the browser", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const captureAgent = readFileSync(resolve(getRepoRoot(), "agents/capture/AGENT.md"), "utf8");
  const captureDriver = readFileSync(
    packageFile("skills/capture-driver/SKILL.md"),
    "utf8"
  );

  for (const text of [prompt, captureAgent, captureDriver]) {
    assert.match(text, /awaiting_capture/i);
    assert.match(text, /user (must |can )?(perform the demo|operate the visible Chrome)/i);
    assert.match(text, /Do not use\s+(computer-use|browser automation|CDP control|agent-operated browsing)/i);
    assert.match(text, /unless the user explicitly asks for\s+automation-driven capture/i);
  }
});

test("browser-flow routes dynamic data intent to Extract without collapsing ordinal actions", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");

  assert.match(prompt, /Intent classification: action replay vs DATA extraction vs both/i);
  assert.match(prompt, /top N|current|latest|list/i);
  assert.match(prompt, /route[\s\S]*Extract/i);
  assert.match(prompt, /stop on the listing or data page/i);
  assert.match(prompt, /ordinal list action/i);
  assert.match(prompt, /not only fixed-title/i);
});

test("browser-flow data mode stops on data page and routes current values to Extract", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /DATA mode/i);
  assert.match(prompt, /current\/top\/latest\/list\/table\/value data/i);
  assert.match(prompt, /Extract owns the current values/i);
  assert.match(prompt, /Do not encode captured titles, prices, or top-row text as fixed replay evidence/i);
  assert.match(orchestrator, /DATA mode is mandatory/i);
  assert.match(orchestrator, /schema proposal/i);
});

test("browser-flow renders dynamic drift holds as not verified instead of user failure", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /dynamic_content_drift/i);
  assert.match(prompt, /action_path/i);
  assert.match(prompt, /not a claim that the user's action was wrong/i);
  assert.doesNotMatch(prompt, /verification_failed/);
  assert.doesNotMatch(orchestrator, /verification_failed/);
  assert.match(orchestrator, /not_verified/);
});

test("browser-flow treats accidental captured suffixes as editable noise before recommending recapture", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /backtracked-trailing-action/);
  assert.match(prompt, /ignored-events\.json/);
  assert.match(prompt, /exclude\/trim/i);
  assert.match(prompt, /raw capture remains the audit trail/i);
  assert.match(prompt, /Recapture is the\s+fallback/i);
  assert.match(orchestrator, /capture noise/i);
  assert.match(orchestrator, /exclude\/trim/i);
});

test("browser-flow stops at capture_noise_review when ambiguous prefix noise needs a user keep/exclude decision", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /capture_noise_review/i);
  assert.match(prompt, /keep|exclude/i);
  assert.match(prompt, /capture-noise-preview\.json/i);
  assert.match(prompt, /capture-noise-result\.json/i);
  assert.match(prompt, /review-noise --run-id <id>/i);
  assert.match(prompt, /briefing/i);
  assert.match(prompt, /journey/i);
  assert.match(prompt, /intent group|intent journey/i);
  assert.match(prompt, /canonical replay/i);
  assert.match(prompt, /risky keep|risk/i);
  assert.match(prompt, /keep.*exclude|exclude.*keep/i);
  assert.match(prompt, /navigation|state-change|state change/i);
  assert.match(prompt, /same-control/i);
  assert.match(prompt, /hidden|zero-box|layered/i);
  assert.match(prompt, /observation-click|observation click|content-area/i);
  assert.match(prompt, /needs_review/i);
  assert.match(orchestrator, /capture_noise_review/i);
  assert.match(orchestrator, /review-noise --run-id <id>/i);
  assert.match(orchestrator, /keep|exclude/i);
  assert.match(orchestrator, /journey/i);
  assert.match(orchestrator, /intent group|intent journey/i);
  assert.match(orchestrator, /canonical replay/i);
  assert.match(orchestrator, /risky keep|risk/i);
  assert.match(orchestrator, /navigation|state-change|state change/i);
  assert.match(orchestrator, /hidden|zero-box|layered/i);
  assert.match(orchestrator, /observation-click|observation click|content-area/i);
});

test("browser-flow stops at locator_intent_review and briefs every same-name semantic candidate", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /locator_intent_review/i);
  assert.match(prompt, /locator-intent-preview\.json/i);
  assert.match(prompt, /locator-intent-result\.json/i);
  assert.match(prompt, /review-locator-intent --run-id <id>/i);
  assert.match(prompt, /briefing/i);
  assert.match(prompt, /action text/i);
  assert.match(prompt, /semantic section|semantic region|section\/card\/heading/i);
  assert.match(prompt, /same-name counts/i);
  assert.match(prompt, /Do not ask[\s\S]*confirm all|compressed question/i);
  assert.match(orchestrator, /locator_intent_review/i);
  assert.match(orchestrator, /review-locator-intent --run-id <id>/i);
  assert.match(orchestrator, /action text/i);
  assert.match(orchestrator, /same-name counts/i);
});

test("browser-flow publishes a shared replay permission policy across prompt and phase agents", () => {
  const repoRoot = getRepoRoot();
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const policy = readFileSync(packageFile("references/replay-permission-policy.md"), "utf8");
  const agentPaths = [
    "agents/orchestrator/AGENT.md",
    "agents/capture/AGENT.md",
    "agents/analyzer/AGENT.md",
    "agents/generator/AGENT.md",
    "agents/verifier/AGENT.md"
  ];
  const levels = ["deny", "strict-replay", "canonicalize", "confirmed-equivalence", "state-proof-replay"];

  assert.match(prompt, /references\/replay-permission-policy\.md/);
  assert.match(policy, /Generic navigation affordances/);
  assert.match(policy, /href \+ neighborTexts[\s\S]*strict-replay/);
  assert.match(policy, /지리/);
  for (const level of levels) {
    assert.match(prompt, new RegExp(level));
    assert.match(policy, new RegExp(level));
  }
  for (const agentPath of agentPaths) {
    const agent = readFileSync(resolve(repoRoot, agentPath), "utf8");
    assert.match(agent, /references\/replay-permission-policy\.md/);
    for (const level of levels) {
      assert.match(agent, new RegExp(level));
    }
  }
});

test("browser-flow documents URL-state proof workflows separately from screenshot artifacts", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const analyzer = readFileSync(resolve(getRepoRoot(), "agents/analyzer/AGENT.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  for (const text of [prompt, analyzer, orchestrator]) {
    assert.match(text, /proofs\[\]|proof-set|proof-set/i);
    assert.match(text, /url-state/i);
    assert.match(text, /expectedNetwork[\s\S]*(not\s+mandatory|no longer\s+mandatory)/i);
    assert.match(text, /URL-only|final-state URL/i);
  }
  assert.match(prompt, /Screenshots remain user artifacts/i);
  assert.match(orchestrator, /Capture-time screenshots\s+remain\s+user artifacts/i);
});

test("browser-flow stops at route_intent_review before replaying reducible DOM paths", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");
  const analyzer = readFileSync(resolve(getRepoRoot(), "agents/analyzer/AGENT.md"), "utf8");

  for (const text of [prompt, orchestrator, analyzer]) {
    assert.match(text, /route_intent_review/i);
    assert.match(text, /route-intent-preview\.json/i);
    assert.match(text, /route-intent-result\.json/i);
    assert.match(text, /review-route-intent --run-id <id>/i);
    assert.match(text, /briefing/i);
    assert.match(text, /omitted DOM steps|omitted steps/i);
    assert.match(text, /target state URL/i);
    assert.match(text, /proofs/i);
  }
  assert.match(prompt, /Do not ask[\s\S]*confirm all|compressed question/i);
  assert.match(orchestrator, /confirm-state-route|keep-dom-route/i);
});

test("browser-flow documents opt-in capture final screenshot artifacts separately from replay proof", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");

  assert.match(prompt, /done --run-id <id> --capture-screenshot final/i);
  assert.match(prompt, /capture-final\.png/i);
  assert.match(prompt, /verified:\s*false/i);
  assert.match(prompt, /replay proof/i);
});

test("browser-flow distinguishes diagnostic replay success from registry promotion failure", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /diagnostic replay succeeded/i);
  assert.match(prompt, /security_not_clean/);
  assert.match(prompt, /not registry-promoted/i);
  assert.match(prompt, /not a replay failure/i);
  assert.match(orchestrator, /diagnostic replay succeeded/i);
  assert.match(orchestrator, /not registry-promoted/i);
});

test("browser-flow treats external services as first-class replay-verified targets", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");

  assert.match(prompt, /project-local by installation\/runtime footprint/i);
  assert.match(prompt, /External cloud services are normal workflow targets/i);
  assert.match(prompt, /public-read policy/i);
  assert.match(prompt, /explicit operator approval/i);
  assert.match(prompt, /origin, auth\/profile, privacy, screenshot, and\s+data-mode metadata/i);
  assert.match(prompt, /public-read[\s\S]*updates the registry entry's data metadata automatically/i);
  assert.match(prompt, /reports\/data-result\.json/i);
  assert.match(orchestrator, /External workflows are replay-verified/i);
  assert.match(orchestrator, /Public-read flows/i);
});

test("browser-flow documents secure convenience modes for broad login requests", () => {
  const prompt = readFileSync(packageFile("prompt.md"), "utf8");
  const orchestrator = readFileSync(resolve(getRepoRoot(), "agents/orchestrator/AGENT.md"), "utf8");
  const readme = readFileSync(resolve(getRepoRoot(), "README.md"), "utf8");
  const architecture = readFileSync(resolve(getRepoRoot(), "docs/architecture.md"), "utf8");

  for (const text of [prompt, orchestrator]) {
    assert.match(text, /do everything|다 해줘/i);
    assert.match(text, /attached-browser/i);
    assert.match(text, /keychain-session/i);
    assert.match(text, /persistent-profile/i);
    assert.match(text, /refuse[\s\S]*raw cookies/i);
  }

  assert.match(readme, /Real-Site, Login, and Privacy Modes/i);
  assert.match(readme, /raw cookies, passwords, tokens, or session values/i);
  assert.match(readme, /attached-browser/i);
  assert.match(readme, /keychain-session/i);
  assert.match(readme, /persistent-profile/i);

  assert.match(architecture, /Real-Site Authentication Modes/i);
  assert.match(architecture, /Save cookies or passwords in files/i);
  assert.match(architecture, /rejected/i);
  assert.match(architecture, /OS keychain/i);
  assert.match(architecture, /named profile directory/i);
});
