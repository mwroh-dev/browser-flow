import { EXIT_CODE_DEFINITIONS } from "./cli-errors.mjs";

export const SUPPORT_SCOPE = {
  target: "macos",
  description: "Supported target: macOS happy path. Windows/Linux behavior is best-effort defensive compatibility, not a release support guarantee."
};

export const RISK_TAXONOMY = ["read", "write", "high-risk-write", "interactive"];
export const LAYER_TAXONOMY = ["setup", "pipeline", "reuse", "review", "promotion", "recovery", "raw-browser"];

const RISK_VALUES = new Set(RISK_TAXONOMY);
const LAYER_VALUES = new Set(LAYER_TAXONOMY);

export const COMMAND_GROUPS = [
  { id: "setup", title: "Setup / diagnostics" },
  { id: "capture", title: "Capture" },
  { id: "pipeline", title: "Analyze / generate / verify" },
  { id: "reuse", title: "Reuse / run" },
  { id: "extract", title: "Extract" },
  { id: "review", title: "Review checkpoints" },
  { id: "promote", title: "Promote" },
  { id: "compose", title: "Compose" },
  { id: "cleanup", title: "Cleanup / heal" }
];

/**
 * @typedef {{
 *   name: string,
 *   value?: string,
 *   required: boolean,
 *   type: "string" | "boolean" | "enum",
 *   values: string[],
 *   description: string
 * }} CommandOption
 *
 * @typedef {{
 *   name: string,
 *   group: string,
 *   risk: "read" | "write" | "high-risk-write" | "interactive",
 *   layer: "setup" | "pipeline" | "reuse" | "review" | "promotion" | "recovery" | "raw-browser",
 *   classification: "public" | "advanced" | "internal",
 *   description: string,
 *   usage: string,
 *   options: CommandOption[],
 *   examples: string[],
 *   sideEffects: string[],
 *   artifacts: string[],
 *   related: string[],
 *   output: "json" | "text" | "interactive",
 *   defaults: Record<string, unknown>,
 *   readArtifacts: string[],
 *   writtenArtifacts: string[],
 *   registryMutation: "none" | "conditional-upsert" | "required-upsert",
 *   safetyImplications: string[],
 *   mutating: boolean
 * }} CommandMetadata
 */

/** @type {CommandMetadata[]} */
export const COMMANDS = [
  command({
    name: "help",
    group: "setup",
    risk: "read",
    layer: "setup",
    classification: "public",
    description: "Print top-level, topic, or command help.",
    usage: "browser-flow help [workflows|examples|safety|artifacts|exit-codes|<command>]",
    examples: ["browser-flow help", "browser-flow help safety", "browser-flow verify --help"],
    sideEffects: ["Read-only; writes help text to stdout."],
    artifacts: ["None."],
    related: ["schema", "capabilities"],
    output: "text",
    mutating: false,
    safetyImplications: ["Help is static and does not inspect browser state or artifacts."]
  }),
  command({
    name: "schema",
    group: "setup",
    risk: "read",
    layer: "setup",
    classification: "public",
    description: "Print the machine-readable browser-flow CLI schema.",
    usage: "browser-flow schema [command <name>]",
    examples: ["browser-flow schema", "browser-flow schema command verify"],
    sideEffects: ["Read-only; writes JSON schema to stdout."],
    artifacts: ["None."],
    related: ["capabilities", "completion"],
    output: "json",
    mutating: false,
    safetyImplications: ["Schema is static and intended for agent planning."]
  }),
  command({
    name: "capabilities",
    group: "setup",
    risk: "read",
    layer: "setup",
    classification: "public",
    description: "Print compact agent-readable CLI capabilities.",
    usage: "browser-flow capabilities",
    examples: ["browser-flow capabilities"],
    sideEffects: ["Read-only; writes JSON capabilities to stdout."],
    artifacts: ["None."],
    related: ["schema", "help"],
    output: "json",
    mutating: false,
    safetyImplications: ["Capabilities are static and intended for agent planning."]
  }),
  command({
    name: "doctor",
    group: "setup",
    risk: "write",
    layer: "setup",
    classification: "public",
    description: "Report page-node staleness and local runtime preflight readiness.",
    usage: "browser-flow doctor [--page-key <pageKey>] [--chrome-path <path>]",
    options: [
      { name: "--chrome-path", value: "path", required: false, type: "string", values: [], description: "--chrome-path <path>" },
      { name: "--json", required: false, type: "boolean", values: [], description: "--json" },
      { name: "--page-key", value: "pageKey", required: false, type: "string", values: [], description: "--page-key <pageKey>" },
    ],
    examples: ["browser-flow doctor", "browser-flow doctor --page-key synthetic/synthetic/result"],
    sideEffects: ["Creates bootstrap directories if missing while checking local runtime readiness."],
    artifacts: ["Reads knowledge/pages/<pageKey>/meta.json, snapshots/*.html.gz, registry metadata, and runtime dependency paths."],
    related: ["prepare", "analyze", "help artifacts"],
    defaults: { pageKey: "all page nodes", chromePath: "BROWSER_FLOW_CHROME_PATH or platform default" },
    readArtifacts: ["knowledge/pages/<pageKey>/meta.json", "knowledge/pages/<pageKey>/snapshots/*.html.gz", "knowledge/registry/workflows.json", "node_modules/*", "scripts/security/*"],
    writtenArtifacts: ["bootstrap directories when missing"],
    mutating: true,
    safetyImplications: ["Bootstrap directory creation does not verify or promote workflows."]
  }),
  command({
    name: "serve-browser",
    group: "setup",
    risk: "interactive",
    layer: "raw-browser",
    classification: "advanced",
    description: "Launch a visible Chrome profile for human login and later attach verification.",
    usage: "browser-flow serve-browser [--run-id <id>] [--port <port>] [--url <site>]",
    options: [
      { name: "--port", value: "port", required: false, type: "string", values: [], description: "--port <port>" },
      { name: "--run-id", value: "id", required: false, type: "string", values: [], description: "--run-id <id>" },
      { name: "--url", value: "site", required: false, type: "string", values: [], description: "--url <site>" },
    ],
    examples: [
      "browser-flow serve-browser --run-id demo --port 9223",
      "browser-flow serve-browser --url https://example.com --port 9223"
    ],
    sideEffects: ["Starts a visible Chrome and blocks until interrupted; stores auth only in the live/profile browser."],
    artifacts: ["Reads workflow.json when --url is omitted; uses profiles/attach/<runId>/."],
    related: ["verify", "help safety"],
    output: "interactive",
    defaults: { port: 9222, profile: "profiles/attach/<runId-or-default>" },
    readArtifacts: ["artifacts/runs/<id>/workflow.json when --url is omitted"],
    writtenArtifacts: ["profiles/attach/<runId-or-default>/"],
    safetyImplications: ["Authentication remains in the live browser/profile and is not persisted to workflow artifacts."]
  }),
  command({
    name: "completion",
    group: "setup",
    risk: "read",
    layer: "setup",
    classification: "public",
    description: "Print static shell completion for browser-flow commands and common flags.",
    usage: "browser-flow completion <bash|zsh|fish>",
    options: [
      { name: "shell", value: "shell", required: true, type: "enum", values: ["bash", "zsh", "fish"], description: "Completion shell positional argument." }
    ],
    examples: [
      "browser-flow completion bash > /usr/local/etc/bash_completion.d/browser-flow",
      "browser-flow completion zsh > ~/.zfunc/_browser-flow",
      "browser-flow completion fish > ~/.config/fish/completions/browser-flow.fish"
    ],
    sideEffects: ["Read-only; writes completion script to stdout."],
    artifacts: ["None."],
    related: ["help", "schema"],
    output: "text",
    mutating: false,
    safetyImplications: ["Completion is static and does not inspect browser state or artifacts."]
  }),
  command({
    name: "prepare",
    group: "capture",
    risk: "write",
    layer: "pipeline",
    classification: "public",
    description: "Create a capture session with an isolated Chrome debug profile.",
    usage: "browser-flow prepare [--run-id <id>] [--fixture <fixture>] [--start-url <url>] [--unmasked] [--snapshot-dom] [--profile-name <name>] [--headless]",
    options: [
      { name: "--capture-mode", required: false, type: "enum", values: ["normal","strict"], description: "--capture-mode normal|strict" },
      { name: "--chrome-path", value: "path", required: false, type: "string", values: [], description: "--chrome-path <path>" },
      { name: "--debug-port", value: "port", required: false, type: "string", values: [], description: "--debug-port <port>" },
      { name: "--fixture", value: "fixture", required: false, type: "string", values: [], description: "--fixture <fixture>" },
      { name: "--headless", required: false, type: "boolean", values: [], description: "--headless" },
      { name: "--profile-name", value: "name", required: false, type: "string", values: [], description: "--profile-name <name>" },
      { name: "--run-id", value: "id", required: false, type: "string", values: [], description: "--run-id <id>" },
      { name: "--snapshot-dom", required: false, type: "boolean", values: [], description: "--snapshot-dom" },
      { name: "--start-url", value: "url", required: false, type: "string", values: [], description: "--start-url <url>" },
      { name: "--unmasked", required: false, type: "boolean", values: [], description: "--unmasked" },
    ],
    examples: [
      "browser-flow prepare --run-id demo --fixture synthetic",
      "browser-flow prepare --run-id site-demo --unmasked --start-url https://example.com"
    ],
    sideEffects: ["Creates run directories, manifest/control files, and a capture Chrome profile; starts the observer daemon."],
    artifacts: ["Writes artifacts/runs/<id>/manifest.json, control.json, daemon logs, raw capture files during capture."],
    related: ["done", "help workflows", "help safety"],
    defaults: { fixture: "manual", debugPort: 0, captureMode: "normal", headless: false, snapshotDom: false, unmasked: false },
    writtenArtifacts: ["artifacts/runs/<id>/manifest.json", "artifacts/runs/<id>/control.json", "artifacts/runs/<id>/daemon.log", "profiles or temp capture profile"],
    safetyImplications: ["External start URLs require --unmasked; raw cookies, tokens, and passwords must not be persisted."]
  }),
  command({
    name: "done",
    group: "capture",
    risk: "write",
    layer: "pipeline",
    classification: "public",
    description: "End capture and persist sanitized artifacts from the observer daemon.",
    usage: "browser-flow done --run-id <id> [--capture-screenshot final]",
    options: [
      { name: "--capture-screenshot", required: false, type: "enum", values: ["final"], description: "--capture-screenshot final" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow done --run-id demo", "browser-flow done --run-id demo --capture-screenshot final"],
    sideEffects: ["Signals the observer daemon, writes sanitized artifacts, and creates review/task previews."],
    artifacts: ["Writes sanitized events, network summary, page evidence, security report, and review/task files under artifacts/runs/<id>/."],
    related: ["prepare", "analyze", "review-noise", "review-locator-intent"],
    readArtifacts: ["artifacts/runs/<id>/control.json", "observer daemon capture state"],
    writtenArtifacts: ["artifacts/runs/<id>/events/sanitized-events.json", "artifacts/runs/<id>/reports/security.json", "analysis review previews", "tasks/variable-extraction.json"],
    safetyImplications: ["Persists sanitized artifacts only; capture screenshot is opt-in with --capture-screenshot final."]
  }),
  command({
    name: "replay",
    group: "capture",
    risk: "write",
    layer: "pipeline",
    classification: "advanced",
    description: "Re-run sanitize and security scan on a captured raw event log without opening a browser.",
    usage: "browser-flow replay --run-id <id>",
    options: [
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow replay --run-id demo"],
    sideEffects: ["Rewrites sanitized capture artifacts and updates control status to replayed when control.json exists."],
    artifacts: ["Reads raw-events.jsonl, raw-page-evidence.json, and manifest.json; writes sanitized artifacts and security.json."],
    related: ["done", "analyze", "help safety"],
    readArtifacts: ["artifacts/runs/<id>/events/raw-events.jsonl", "artifacts/runs/<id>/raw-page-evidence.json", "artifacts/runs/<id>/manifest.json"],
    writtenArtifacts: ["sanitized capture artifacts", "artifacts/runs/<id>/reports/security.json", "artifacts/runs/<id>/control.json when present"],
    safetyImplications: ["Uses the same sanitizer/security path as live capture persistence."]
  }),
  command({
    name: "analyze",
    group: "pipeline",
    risk: "write",
    layer: "pipeline",
    classification: "public",
    description: "Compile sanitized capture artifacts into workflow, path, recipe, and analysis outputs.",
    usage: "browser-flow analyze --run-id <id>",
    options: [
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow analyze --run-id demo"],
    sideEffects: ["Writes analysis artifacts and may activate variable-extraction task state for new paths."],
    artifacts: ["Reads sanitized capture artifacts; writes workflow.json, path.yaml, recipe.yaml, page-node knowledge, and task files."],
    related: ["done", "generate", "vars", "review-route-intent"],
    readArtifacts: ["sanitized capture artifacts", "review result artifacts when present", "knowledge/pages snapshot baseline"],
    writtenArtifacts: ["artifacts/runs/<id>/workflow.json", "analysis/path.yaml", "analysis/recipe.yaml", "knowledge/pages/<pageKey>/", "tasks/variable-extraction.json"],
    safetyImplications: ["Keeps analyzer output artifact-compatible with verification and security gates."]
  }),
  command({
    name: "generate",
    group: "pipeline",
    risk: "write",
    layer: "pipeline",
    classification: "public",
    description: "Generate a runnable CDP-direct runner from workflow.json.",
    usage: "browser-flow generate --run-id <id>",
    options: [
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow generate --run-id demo"],
    sideEffects: ["Writes generated runner files and may upsert registry metadata through existing gates."],
    artifacts: ["Reads workflow.json; writes generated/runner.mjs and generated support artifacts."],
    related: ["analyze", "verify", "help artifacts"],
    readArtifacts: ["artifacts/runs/<id>/workflow.json"],
    writtenArtifacts: ["artifacts/runs/<id>/generated/runner.mjs", "knowledge/registry/workflows.json when registry gate allows"],
    registryMutation: "conditional-upsert",
    safetyImplications: ["Registry writes remain gated and do not prove replay success by themselves."]
  }),
  command({
    name: "verify",
    group: "pipeline",
    risk: "write",
    layer: "pipeline",
    classification: "public",
    description: "Replay the generated workflow and enforce truthfulness gates [--summary] [--screenshots off|final|steps|both].",
    usage: "browser-flow verify --run-id <id> [--headless] [--summary] [--screenshots off|final|steps|both] [--first|--repeat] [--attach <port>]",
    options: [
      { name: "--attach", value: "port", required: false, type: "string", values: [], description: "--attach <port>" },
      { name: "--first", required: false, type: "boolean", values: [], description: "--first" },
      { name: "--headless", required: false, type: "boolean", values: [], description: "--headless" },
      { name: "--repeat", required: false, type: "boolean", values: [], description: "--repeat" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
      { name: "--screenshots", required: false, type: "enum", values: ["off","final","steps","both"], description: "--screenshots off|final|steps|both" },
      { name: "--summary", required: false, type: "boolean", values: [], description: "--summary" },
    ],
    examples: [
      "browser-flow verify --run-id demo --headless",
      "browser-flow verify --run-id demo --summary",
      "browser-flow verify --run-id demo --attach 9223"
    ],
    sideEffects: ["Runs the generated runner, writes verification/security reports, may update workflow screenshot mode, and may update registry when gates allow."],
    artifacts: ["Reads workflow.json and generated/runner.mjs; writes reports/verification.json, reports/security.json, journals, and optional screenshots."],
    related: ["generate", "promote", "heal", "score", "cleanup", "help safety"],
    defaults: { headless: false, summary: false, screenshots: "workflow setting", authMode: "repeat unless --first or --attach is set" },
    readArtifacts: ["artifacts/runs/<id>/workflow.json", "artifacts/runs/<id>/generated/runner.mjs"],
    writtenArtifacts: ["artifacts/runs/<id>/reports/verification.json", "artifacts/runs/<id>/reports/security.json", "state-journal.jsonl", "optional screenshots", "knowledge/registry/workflows.json when gates allow"],
    registryMutation: "conditional-upsert",
    safetyImplications: ["Do not declare success unless verification.json and security.json are both green."]
  }),
  command({
    name: "vars",
    group: "reuse",
    risk: "write",
    layer: "reuse",
    classification: "advanced",
    description: "Inspect, confirm, resume, or interactively resolve variable-extraction task state.",
    usage: "browser-flow vars --run-id <id> [--confirm | --interactive | --resume]",
    options: [
      { name: "--confirm", required: false, type: "boolean", values: [], description: "--confirm" },
      { name: "--interactive", required: false, type: "boolean", values: [], description: "--interactive" },
      { name: "--resume", required: false, type: "boolean", values: [], description: "--resume" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow vars --run-id demo", "browser-flow vars --run-id demo --confirm"],
    sideEffects: ["Read-only by default; confirm/interactive/resume update task state and may update workflow input bindings."],
    artifacts: ["Reads and writes artifacts/runs/<id>/tasks/* and workflow.json."],
    related: ["analyze", "run", "spec"],
    readArtifacts: ["artifacts/runs/<id>/tasks/*", "artifacts/runs/<id>/workflow.json when interactive"],
    writtenArtifacts: ["artifacts/runs/<id>/tasks/*", "artifacts/runs/<id>/workflow.json when interactive decisions apply"],
    safetyImplications: ["Variable values are bound through workflow inputs, not by storing secrets in source artifacts."]
  }),
  command({
    name: "run",
    group: "reuse",
    risk: "write",
    layer: "reuse",
    classification: "public",
    description: "Bind workflow inputs and emit a new derived run with its own generated runner.",
    usage: "browser-flow run --run-id <id> [--bind input.name=value ...] [--dry-run]",
    options: [
      { name: "--bind", required: false, type: "string", values: [], description: "--bind input.name=value" },
      { name: "--dry-run", required: false, type: "boolean", values: [], description: "--dry-run" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow run --run-id demo --bind input.query=weather", "browser-flow run --run-id demo --bind input.query=weather --dry-run"],
    sideEffects: ["Creates a bind-derived run directory, writes bound workflow/manifest, and generates a new runner unless --dry-run is set."],
    artifacts: ["Reads source workflow.json and manifest.json; writes artifacts/runs/<id>-bind-<hash>/."],
    related: ["vars", "generate", "verify"],
    readArtifacts: ["artifacts/runs/<id>/workflow.json", "artifacts/runs/<id>/manifest.json"],
    writtenArtifacts: ["artifacts/runs/<id>-bind-<hash>/manifest.json", "artifacts/runs/<id>-bind-<hash>/workflow.json", "generated/runner.mjs"],
    safetyImplications: ["Bindings must satisfy declared workflow inputs; missing placeholders fail before runner generation."]
  }),
  command({
    name: "spec",
    group: "reuse",
    risk: "write",
    layer: "reuse",
    classification: "advanced",
    description: "Gather verifiable-spec answers for missing workflow verification context.",
    usage: "browser-flow spec --run-id <id> [--request <text>]",
    options: [
      { name: "--request", value: "text", required: false, type: "string", values: [], description: "--request <text>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow spec --run-id demo --request \"requires login\""],
    sideEffects: ["May prompt on stdin and writes verify-spec answers for the run."],
    artifacts: ["Reads knowledge/verify-spec/questions.base.json and optional override; writes artifacts/runs/<id>/verify-spec.json."],
    related: ["analyze", "verify", "vars"],
    defaults: { request: "" },
    readArtifacts: ["knowledge/verify-spec/questions.base.json", "knowledge/verify-spec/questions.override.json when present"],
    writtenArtifacts: ["artifacts/runs/<id>/verify-spec.json"],
    safetyImplications: ["Spec answers shape verification expectations; they do not bypass replay or security gates."]
  }),
  command({
    name: "extract",
    group: "extract",
    risk: "write",
    layer: "reuse",
    classification: "public",
    description: "Emit/apply scrape setup or reuse a durable extractor config for page data.",
    usage: "browser-flow extract --run-id <id> --step <n> [--schema <path> | --apply <scrape-result.json> | --reuse [--paged]] [--data-mode extract|mixed]",
    options: [
      { name: "--apply", value: "scrape-result.json", required: false, type: "string", values: [], description: "--apply <scrape-result.json>" },
      { name: "--data-mode", required: false, type: "enum", values: ["extract","mixed"], description: "--data-mode extract|mixed" },
      { name: "--paged", required: false, type: "boolean", values: [], description: "--paged" },
      { name: "--reuse", required: false, type: "boolean", values: [], description: "--reuse" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
      { name: "--schema", value: "path", required: false, type: "string", values: [], description: "--schema <path>" },
      { name: "--step", value: "n", required: false, type: "string", values: [], description: "--step <n> with emit/reuse; --schema <path> for setup emit or --apply/--reuse mode" },
    ],
    examples: [
      "browser-flow extract --run-id demo --step 2 --schema schema.json",
      "browser-flow extract --run-id demo --step 2 --apply scrape-result.json",
      "browser-flow extract --run-id demo --step 2 --reuse --paged"
    ],
    sideEffects: ["Writes extraction request/result artifacts, workflow extraction references, durable scraping knowledge, and registry data metadata when eligible."],
    artifacts: ["Reads workflow.json and DOM snapshots; writes scrape-request.json, extractor config, extract-result.json, data-result.json, and knowledge/scraping/<pageKey>/."],
    related: ["extract-heal", "promote", "help artifacts"],
    defaults: { dataMode: "extract", paged: false, reuse: false },
    readArtifacts: ["artifacts/runs/<id>/workflow.json", "DOM snapshots", "schema file or scrape-result file depending on mode"],
    writtenArtifacts: ["scrape-request.json", "workflow.json extraction reference", "extractor config", "extract-result.json", "data-result.json", "knowledge/scraping/<pageKey>/", "knowledge/registry/workflows.json when eligible"],
    registryMutation: "conditional-upsert",
    safetyImplications: ["Extraction is page-data focused and remains bound to verified replay/security metadata for promotion."]
  }),
  command({
    name: "extract-heal",
    group: "extract",
    risk: "write",
    layer: "reuse",
    classification: "advanced",
    description: "Emit or apply a repaired extractor config after extraction drift.",
    usage: "browser-flow extract-heal --run-id <id> [--apply <extract-heal-result.json>]",
    options: [
      { name: "--apply", value: "extract-heal-result.json", required: false, type: "string", values: [], description: "--apply <extract-heal-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow extract-heal --run-id demo", "browser-flow extract-heal --run-id demo --apply extract-heal-result.json"],
    sideEffects: ["Read-only without --apply; --apply can force-update durable scraping knowledge and write extraction results."],
    artifacts: ["Reads extract-heal-request.json; may write knowledge/scraping/<pageKey>/ and extract-result.json."],
    related: ["extract", "help safety"],
    readArtifacts: ["artifacts/runs/<id>/extract-heal-request.json", "extract-heal result file when --apply is used"],
    writtenArtifacts: ["knowledge/scraping/<pageKey>/", "extract-result.json when healed"],
    safetyImplications: ["Only repairs extractor config; unrepairable drift should be surfaced rather than bypassed."]
  }),
  command({
    name: "review-noise",
    group: "review",
    risk: "write",
    layer: "review",
    classification: "advanced",
    description: "Brief/apply ambiguous capture-noise review.",
    usage: "browser-flow review-noise --run-id <id> [--apply <capture-noise-result.json>]",
    options: [
      { name: "--apply", value: "capture-noise-result.json", required: false, type: "string", values: [], description: "--apply <capture-noise-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow review-noise --run-id demo", "browser-flow review-noise --run-id demo --apply capture-noise-result.json"],
    sideEffects: ["Read-only briefing without --apply; --apply writes capture-noise decisions."],
    artifacts: ["Reads capture-noise preview and sanitized events; writes capture-noise-result.json."],
    related: ["done", "analyze", "verify"],
    readArtifacts: ["capture-noise preview", "sanitized events", "capture-noise result when present"],
    writtenArtifacts: ["capture-noise-result.json when --apply is used"],
    safetyImplications: ["Ambiguous capture noise requires explicit keep/exclude review before analyzer replay reduction."]
  }),
  command({
    name: "review-locator-intent",
    group: "review",
    risk: "write",
    layer: "review",
    classification: "advanced",
    description: "Brief/apply same-name semantic locator intent review.",
    usage: "browser-flow review-locator-intent --run-id <id> [--apply <locator-intent-result.json>]",
    options: [
      { name: "--apply", value: "locator-intent-result.json", required: false, type: "string", values: [], description: "--apply <locator-intent-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: [
      "browser-flow review-locator-intent --run-id demo",
      "browser-flow review-locator-intent --run-id demo --apply locator-intent-result.json"
    ],
    sideEffects: ["Read-only briefing without --apply; --apply writes locator intent decisions."],
    artifacts: ["Reads locator-intent preview; writes locator-intent-result.json."],
    related: ["done", "analyze", "verify"],
    readArtifacts: ["locator-intent preview", "locator-intent result when present"],
    writtenArtifacts: ["locator-intent-result.json when --apply is used"],
    safetyImplications: ["Repeated same-name locators require semantic confirmation or recapture."]
  }),
  command({
    name: "review-route-intent",
    group: "review",
    risk: "write",
    layer: "review",
    classification: "advanced",
    description: "Brief/apply state/intent route review.",
    usage: "browser-flow review-route-intent --run-id <id> [--apply <route-intent-result.json>]",
    options: [
      { name: "--apply", value: "route-intent-result.json", required: false, type: "string", values: [], description: "--apply <route-intent-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow review-route-intent --run-id demo", "browser-flow review-route-intent --run-id demo --apply route-intent-result.json"],
    sideEffects: ["Read-only briefing without --apply; --apply writes route intent decisions."],
    artifacts: ["Reads route-intent preview; writes route-intent-result.json."],
    related: ["analyze", "generate", "verify"],
    readArtifacts: ["route-intent preview", "route-intent result when present"],
    writtenArtifacts: ["route-intent-result.json when --apply is used"],
    safetyImplications: ["State-route reduction requires review and cannot silently replace DOM replay."]
  }),
  command({
    name: "promote",
    group: "promote",
    risk: "high-risk-write",
    layer: "promotion",
    classification: "public",
    description: "Save a replay-verified external workflow after explicit approval.",
    usage: "browser-flow promote --run-id <id> --scope external --origins <csv> --auth-mode <mode> --profile-mode <mode> --privacy-level <level> --screenshots off|allowed --data-mode route|extract|mixed [--dry-run]",
    options: [
      { name: "--auth-mode", required: true, type: "enum", values: ["none","login-required","keychain-session","attach","persistent-profile"], description: "--auth-mode none|login-required|keychain-session|attach|persistent-profile" },
      { name: "--data-mode", required: true, type: "enum", values: ["route","extract","mixed"], description: "--data-mode route|extract|mixed" },
      { name: "--dry-run", required: false, type: "boolean", values: [], description: "--dry-run" },
      { name: "--origins", value: "csv", required: true, type: "string", values: [], description: "--origins <csv>" },
      { name: "--privacy-level", required: true, type: "enum", values: ["minimal","profile","full"], description: "--privacy-level minimal|profile|full" },
      { name: "--profile-mode", required: true, type: "enum", values: ["ephemeral","named-profile","attached-browser"], description: "--profile-mode ephemeral|named-profile|attached-browser" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
      { name: "--scope", required: true, type: "enum", values: ["external"], description: "--scope external" },
      { name: "--screenshots", required: true, type: "enum", values: ["off","allowed"], description: "--screenshots off|allowed" },
    ],
    examples: [
      "browser-flow promote --run-id demo --scope external --origins https://example.com --auth-mode none --profile-mode ephemeral --privacy-level minimal --screenshots off --data-mode route"
    ],
    sideEffects: ["Mutates the workflow registry only after replay and security artifacts are green and origins cover persisted URLs; --dry-run validates and previews without writing."],
    artifacts: ["Reads workflow.json, verification.json, security.json, and optional data-result.json; writes knowledge/registry/workflows.json."],
    related: ["verify", "extract", "help safety"],
    readArtifacts: ["artifacts/runs/<id>/workflow.json", "reports/verification.json", "reports/security.json", "data-result.json when data-mode is extract or mixed"],
    writtenArtifacts: ["knowledge/registry/workflows.json"],
    registryMutation: "required-upsert",
    safetyImplications: ["External promotion requires passed replay, security ok:true, explicit origins, and policy metadata."]
  }),
  command({
    name: "compose",
    group: "compose",
    risk: "write",
    layer: "reuse",
    classification: "public",
    description: "Compose a primary workflow request into episodic compose artifacts.",
    usage: "browser-flow compose --run-id <id> --request <task> [--dry-run]",
    options: [
      { name: "--dry-run", required: false, type: "boolean", values: [], description: "--dry-run" },
      { name: "--request", value: "task", required: true, type: "string", values: [], description: "--request <task>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow compose --run-id demo --request \"repeat this without the last item\"", "browser-flow compose --run-id demo --request \"repeat this without the last item\" --dry-run"],
    sideEffects: ["Creates a derived run, writes compose request/plan/summary artifacts, generates and verifies the derived workflow unless --dry-run is set."],
    artifacts: ["Reads source workflow.json; writes artifacts/runs/<derivedId>/compose/*, workflow.json, runner.mjs, verification reports."],
    related: ["run", "verify", "help workflows"],
    readArtifacts: ["artifacts/runs/<id>/workflow.json"],
    writtenArtifacts: ["artifacts/runs/<derivedId>/compose/*", "artifacts/runs/<derivedId>/workflow.json", "generated/runner.mjs", "reports/verification.json", "reports/security.json"],
    safetyImplications: ["Compose is primary-run-only and still requires generated runner verification."]
  }),
  command({
    name: "teardown",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Link a teardown into the main workflow from a recorded cleanup or selector search.",
    usage: "browser-flow teardown --run-id <id> (--record <cleanupRunId> | --search [--intent <text>] [--page <pageKey>])",
    options: [
      { name: "--intent", value: "text", required: false, type: "string", values: [], description: "--intent <text>" },
      { name: "--page", value: "pageKey", required: false, type: "string", values: [], description: "--page <pageKey>" },
      { name: "--record", value: "cleanupRunId", required: false, type: "string", values: [], description: "--record <cleanupRunId> or --search" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
      { name: "--search", required: false, type: "boolean", values: [], description: "--record <cleanupRunId> or --search" },
    ],
    examples: [
      "browser-flow teardown --run-id demo --record demo-cleanup",
      "browser-flow teardown --run-id demo --search --intent delete --page synthetic/synthetic/result"
    ],
    sideEffects: ["Updates workflow.json teardown metadata."],
    artifacts: ["Reads workflow.json and optionally knowledge/pages/<pageKey>/selectors.json; writes workflow.json."],
    related: ["cleanup", "verify", "compose"],
    readArtifacts: ["artifacts/runs/<id>/workflow.json", "cleanup run workflow.json or knowledge/pages/<pageKey>/selectors.json"],
    writtenArtifacts: ["artifacts/runs/<id>/workflow.json"],
    safetyImplications: ["Teardown metadata controls cleanup behavior and should be verified with the workflow."]
  }),
  command({
    name: "cleanup",
    group: "cleanup",
    risk: "high-risk-write",
    layer: "recovery",
    classification: "advanced",
    description: "Delete dangling artifacts from a held or aborted run through its teardown recipe.",
    usage: "browser-flow cleanup --run-id <id> [--dry-run]",
    options: [
      { name: "--dry-run", required: false, type: "boolean", values: [], description: "--dry-run" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow cleanup --run-id demo", "browser-flow cleanup --run-id demo --dry-run"],
    sideEffects: ["Runs the generated runner in cleanup-only mode when dangling artifacts exist unless --dry-run is set."],
    artifacts: ["Reads state-journal.jsonl and generated/runner.mjs; may update verification cleanup fields."],
    related: ["teardown", "verify", "heal", "score"],
    readArtifacts: ["state-journal.jsonl", "generated/runner.mjs"],
    writtenArtifacts: ["verification cleanup fields when runner reports cleanup"],
    safetyImplications: ["Cleanup executes only the workflow teardown path for journal-recorded dangling artifacts."]
  }),
  command({
    name: "heal",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Apply a heal-result to a held run, clean up, and perform one bounded re-run.",
    usage: "browser-flow heal --run-id <id> [--apply <heal-result.json>] [--headless|--no-headless]",
    options: [
      { name: "--apply", value: "heal-result.json", required: false, type: "string", values: [], description: "--apply <heal-result.json>" },
      { name: "--headless", required: false, type: "boolean", values: [], description: "--headless (default: true; use --no-headless for headed mode)" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow heal --run-id demo", "browser-flow heal --run-id demo --apply heal-result.json --headless", "browser-flow heal --run-id demo --apply heal-result.json --no-headless"],
    sideEffects: ["Read-only without --apply; --apply updates workflow locators, regenerates, cleans up, and verifies once."],
    artifacts: ["Reads heal-request.json and workflow.json; may write workflow.json, runner.mjs, verification/security reports."],
    related: ["verify", "cleanup", "score"],
    defaults: { headless: true },
    readArtifacts: ["heal-request.json", "workflow.json", "heal-result file when --apply is used"],
    writtenArtifacts: ["workflow.json", "generated/runner.mjs", "reports/verification.json", "reports/security.json"],
    safetyImplications: ["Healing is bounded to one re-run and does not loop around verification holds."]
  }),
  command({
    name: "score",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Apply scoring-agent weight overrides after an ambiguous locator drift hold.",
    usage: "browser-flow score --run-id <id> [--apply <scoring-result.json>] [--headless|--no-headless]",
    options: [
      { name: "--apply", value: "scoring-result.json", required: false, type: "string", values: [], description: "--apply <scoring-result.json>" },
      { name: "--headless", required: false, type: "boolean", values: [], description: "--headless (default: true; use --no-headless for headed mode)" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow score --run-id demo", "browser-flow score --run-id demo --apply scoring-result.json", "browser-flow score --run-id demo --apply scoring-result.json --no-headless"],
    sideEffects: ["Read-only without --apply; --apply updates workflow locator weights, learned scoring knowledge, regenerates, cleans up, and verifies once."],
    artifacts: ["Reads scoring-request.json; may write workflow.json, knowledge/analyzer/semantic/scoring-patterns.json, runner.mjs, reports."],
    related: ["verify", "heal", "scope"],
    defaults: { headless: true },
    readArtifacts: ["scoring-request.json", "workflow.json", "scoring-result file when --apply is used"],
    writtenArtifacts: ["workflow.json", "knowledge/analyzer/semantic/scoring-patterns.json", "generated/runner.mjs", "reports/verification.json", "reports/security.json"],
    safetyImplications: ["Scoring changes are bounded and must pass the subsequent verification/security gates."]
  }),
  command({
    name: "scope",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Emit/apply scope-agent identity regions for signal-poor locators before verification.",
    usage: "browser-flow scope --run-id <id> [--apply <scope-result.json>]",
    options: [
      { name: "--apply", value: "scope-result.json", required: false, type: "string", values: [], description: "--apply <scope-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow scope --run-id demo", "browser-flow scope --run-id demo --apply scope-result.json"],
    sideEffects: ["Writes scope request without --apply; --apply updates workflow locators and regenerates when applied."],
    artifacts: ["Reads workflow.json; writes scope-request.json or workflow.json plus runner.mjs."],
    related: ["analyze", "generate", "verify"],
    readArtifacts: ["workflow.json", "scope-result file when --apply is used"],
    writtenArtifacts: ["scope-request.json", "workflow.json when applied", "generated/runner.mjs when applied"],
    safetyImplications: ["Scope improves locator identity before verification; it does not skip replay."]
  }),
  command({
    name: "reveal",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Emit/apply stateful-affordance reveal semantics for ambiguous reveal controls.",
    usage: "browser-flow reveal --run-id <id> [--apply <reveal-result.json>]",
    options: [
      { name: "--apply", value: "reveal-result.json", required: false, type: "string", values: [], description: "--apply <reveal-result.json>" },
      { name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" },
    ],
    examples: ["browser-flow reveal --run-id demo", "browser-flow reveal --run-id demo --apply reveal-result.json"],
    sideEffects: ["Writes reveal request without --apply; --apply updates workflow action semantics and regenerates when applied."],
    artifacts: ["Reads workflow.json; writes reveal-request.json or workflow.json plus runner.mjs."],
    related: ["analyze", "generate", "verify"],
    readArtifacts: ["workflow.json", "reveal-result file when --apply is used"],
    writtenArtifacts: ["reveal-request.json", "workflow.json when applied", "generated/runner.mjs when applied"],
    safetyImplications: ["Reveal semantics require transition evidence and remain subject to generated replay."]
  }),
  command({
    name: "explore",
    group: "cleanup",
    risk: "write",
    layer: "recovery",
    classification: "advanced",
    description: "Discover a fixture page's navigable graph with read-only bounded BFS.",
    usage: "browser-flow explore --fixture <fixture> [--depth <n>] [--headless]",
    options: [
      { name: "--depth", value: "n", required: false, type: "string", values: [], description: "--depth <n>" },
      { name: "--fixture", value: "fixture", required: true, type: "string", values: [], description: "--fixture <fixture>" },
      { name: "--headless", required: false, type: "boolean", values: [], description: "--headless" },
    ],
    examples: ["browser-flow explore --fixture explore --depth 2"],
    sideEffects: ["Starts a fixture server and temporary Chrome; writes explored edges to page-node knowledge."],
    artifacts: ["Writes knowledge/pages/<pageKey>/explored-edges.json."],
    related: ["doctor", "analyze", "help safety"],
    defaults: { depth: 2, headless: true },
    writtenArtifacts: ["knowledge/pages/<pageKey>/explored-edges.json"],
    safetyImplications: ["Fixture exploration is bounded by depth and budget; it is not a general site crawler."]
  })
];

export const COMMANDS_BY_NAME = new Map(COMMANDS.map((entry) => [entry.name, entry]));

export const CLI_SCHEMA_VERSION = 1;

export const HELP_TOPICS = {
  workflows: `browser-flow help workflows

Happy path:
  browser-flow prepare --run-id demo --fixture synthetic
  browser-flow done --run-id demo
  browser-flow analyze --run-id demo
  browser-flow generate --run-id demo
  browser-flow verify --run-id demo --headless

Reuse:
  browser-flow run --run-id demo --bind input.query=weather
  browser-flow verify --run-id demo-bind-<hash> --headless

Data flow:
  Capture with --snapshot-dom, stop on the data page, verify the workflow, then use extract for the data step.

Recovery:
  Review checkpoint commands resolve analyzer holds. heal, score, scope, reveal, and cleanup handle bounded recovery without changing the phase order.`,
  examples: `browser-flow help examples

First capture:
  browser-flow prepare --run-id demo --fixture synthetic
  browser-flow done --run-id demo
  browser-flow analyze --run-id demo
  browser-flow generate --run-id demo
  browser-flow verify --run-id demo --headless

Reuse:
  browser-flow run --run-id demo --bind input.query=seoul

Extract:
  browser-flow extract --run-id demo --step 2 --schema targetSchema.json
  browser-flow extract --run-id demo --step 2 --apply scrape-result.json
  browser-flow extract --run-id demo --step 2 --reuse

Promote:
  browser-flow promote --run-id demo --scope external --origins https://example.com --auth-mode none --profile-mode ephemeral --privacy-level minimal --screenshots off --data-mode route`,
  safety: `browser-flow help safety

Success requires evidence:
  A workflow is not successful or promotable unless verification.json and security.json are both green.

Secrets:
  Do not persist raw cookies, passwords, tokens, auth headers, CSRF values, or session values. Auth stays in the live browser, OS keychain, or named profile modes.

Real sites:
  Use --unmasked with explicit --start-url for real-site diagnostic capture. If a site blocks or errors, stop instead of adding bypass behavior.

Promotion:
  External promotion requires passed replay, security ok:true, explicit origins, and approval metadata.`,
  artifacts: `browser-flow help artifacts

Per-run artifacts:
  artifacts/runs/<id>/analysis/path.yaml
  artifacts/runs/<id>/analysis/recipe.yaml
  artifacts/runs/<id>/generated/runner.mjs
  artifacts/runs/<id>/reports/verification.json
  artifacts/runs/<id>/reports/security.json

Knowledge:
  knowledge/registry/workflows.json stores verified workflow catalog entries.
  knowledge/pages/<pageKey>/ stores page structure.
  knowledge/scraping/<pageKey>/ stores durable extractor config and golden data.

Rule:
  artifacts/ is episodic and regenerated. knowledge/ is durable and committed.`,
  "exit-codes": `browser-flow help exit-codes

Stable exit codes:
${formatExitCodeRows()}

Human errors:
  browser-flow error: <code>
  What failed: <message>
  Recoverable: yes|no
  Suggested next commands:

JSON errors:
  Commands invoked with --json emit {"ok":false,"error":{...}} on stdout and keep stderr empty.`
};

/**
 * @param {Omit<CommandMetadata, "options" | "examples" | "sideEffects" | "artifacts" | "related" | "output" | "defaults" | "readArtifacts" | "writtenArtifacts" | "registryMutation" | "safetyImplications" | "mutating"> & Partial<Pick<CommandMetadata, "options" | "examples" | "sideEffects" | "artifacts" | "related" | "output" | "defaults" | "readArtifacts" | "writtenArtifacts" | "registryMutation" | "safetyImplications" | "mutating">>} input
 * @returns {CommandMetadata}
 */
function command(input) {
  const metadata = {
    options: [],
    examples: [],
    sideEffects: ["None."],
    artifacts: ["None."],
    related: [],
    output: "json",
    defaults: {},
    readArtifacts: [],
    writtenArtifacts: [],
    registryMutation: "none",
    safetyImplications: [],
    ...input,
    mutating: input.mutating ?? input.risk !== "read"
  };
  if (!RISK_VALUES.has(metadata.risk)) throw new Error(`Unknown CLI risk for ${metadata.name}: ${metadata.risk}`);
  if (!LAYER_VALUES.has(metadata.layer)) throw new Error(`Unknown CLI layer for ${metadata.name}: ${metadata.layer}`);
  return metadata;
}

/**
 * @param {string} repoRoot
 */
export function renderTopLevelHelp(repoRoot) {
  const lines = [
    "browser-flow",
    "",
    "Project-local browser workflow compiler for local fixtures and explicitly approved real websites.",
    SUPPORT_SCOPE.description,
    "",
    "Usage:",
    "  browser-flow <command> [options]",
    "  browser-flow help <workflows|examples|safety|artifacts|exit-codes>",
    ""
  ];
  for (const group of COMMAND_GROUPS) {
    const entries = COMMANDS.filter((entry) => entry.group === group.id);
    if (entries.length === 0) continue;
    lines.push(`${group.title}:`);
    for (const entry of entries) {
      lines.push(`  ${entry.name.padEnd(22)} ${entry.description}`);
    }
    lines.push("");
  }
  lines.push(
    "Topic help:",
    "  browser-flow help workflows",
    "  browser-flow help examples",
    "  browser-flow help safety",
    "  browser-flow help artifacts",
    "  browser-flow help exit-codes",
    "",
    "Advanced commands are shown for agent and recovery workflows, but the first-time path is prepare -> done -> analyze -> generate -> verify.",
    "",
    "Repo root:",
    `  ${repoRoot}`
  );
  return lines.join("\n");
}

/**
 * @param {string} name
 */
export function renderCommandHelp(name) {
  const entry = COMMANDS_BY_NAME.get(name);
  if (!entry) return null;
  const requiredOptionRows = entry.options.filter((option) => option.required);
  const optionalOptionRows = entry.options.filter((option) => !option.required);
  return [
    `browser-flow ${entry.name}`,
    "",
    `Description: ${entry.description}`,
    `Classification: ${entry.classification}`,
    `Risk: ${entry.risk}`,
    `Layer: ${entry.layer}`,
    `Output: ${entry.output}`,
    "",
    "Usage:",
    `  ${entry.usage}`,
    "",
    "Required options:",
    formatOptions(requiredOptionRows),
    "",
    "Optional options:",
    formatOptions(optionalOptionRows),
    "",
    "Common examples:",
    formatList(entry.examples),
    "",
    "Side effects:",
    formatList(entry.sideEffects),
    "",
    "Artifacts:",
    formatList(entry.artifacts),
    "",
    "Related commands:",
    formatList(entry.related)
  ].join("\n");
}

/**
 * @param {string} topic
 */
export function renderTopicHelp(topic) {
  return Object.prototype.hasOwnProperty.call(HELP_TOPICS, topic)
    ? HELP_TOPICS[/** @type {keyof typeof HELP_TOPICS} */ (topic)]
    : null;
}

export function buildCapabilities() {
  return {
    ok: true,
    agentContract: true,
    schemaVersion: CLI_SCHEMA_VERSION,
    product: "browser-flow",
    supportScope: SUPPORT_SCOPE,
    description: "Project-local browser workflow compiler CLI.",
    exitCodes: EXIT_CODE_DEFINITIONS,
    commands: COMMANDS.map((entry) => ({
      name: entry.name,
      group: entry.group,
      risk: entry.risk,
      layer: entry.layer,
      classification: entry.classification,
      description: entry.description,
      options: entry.options,
      outputMode: entry.output,
      mutating: entry.mutating,
      registryMutation: entry.registryMutation,
      safetyImplications: entry.safetyImplications,
      relatedCommands: entry.related
    }))
  };
}

export function buildSchema() {
  return {
    ok: true,
    agentContract: true,
    schemaVersion: CLI_SCHEMA_VERSION,
    product: "browser-flow",
    supportScope: SUPPORT_SCOPE,
    exitCodes: EXIT_CODE_DEFINITIONS,
    topics: Object.keys(HELP_TOPICS),
    commands: COMMANDS.map(commandSchema)
  };
}

/**
 * @param {string} name
 */
export function buildCommandSchema(name) {
  const entry = COMMANDS_BY_NAME.get(name);
  if (!entry) return null;
  return {
    ok: true,
    agentContract: true,
    schemaVersion: CLI_SCHEMA_VERSION,
    product: "browser-flow",
    supportScope: SUPPORT_SCOPE,
    command: commandSchema(entry)
  };
}

/**
 * @param {CommandMetadata} entry
 */
function commandSchema(entry) {
  return {
    name: entry.name,
    description: entry.description,
    group: entry.group,
    risk: entry.risk,
    layer: entry.layer,
    classification: entry.classification,
    usage: entry.usage,
    options: entry.options,
    defaults: entry.defaults,
    outputMode: entry.output,
    sideEffects: entry.sideEffects,
    mutating: entry.mutating,
    readArtifacts: entry.readArtifacts,
    writtenArtifacts: entry.writtenArtifacts,
    registryMutation: entry.registryMutation,
    safetyImplications: entry.safetyImplications,
    relatedCommands: entry.related
  };
}

/**
 * @param {string[]} items
 */
function formatList(items) {
  if (items.length === 0) return "  None.";
  return items.map((item) => `  - ${item}`).join("\n");
}

/**
 * @param {CommandOption[]} options
 */
function formatOptions(options) {
  if (options.length === 0) return "  None.";
  return options.map((option) => {
    const value = option.value ? ` <${option.value}>` : "";
    const values = option.values.length > 0 ? ` (${option.values.join("|")})` : "";
    return `  - ${option.name}${value}${values}: ${option.description}`;
  }).join("\n");
}

function formatExitCodeRows() {
  return EXIT_CODE_DEFINITIONS
    .map((entry) => `  ${String(entry.status).padEnd(2)}  ${entry.code.padEnd(30)} ${entry.description}`)
    .join("\n");
}
