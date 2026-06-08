#!/usr/bin/env node

import { prepareCommand } from "./commands/prepare.mjs";
import { doneCommand } from "./commands/done.mjs";
import { replayCommand } from "./commands/replay.mjs";
import { analyzeCommand } from "./commands/analyze.mjs";
import { generateCommand } from "./commands/generate.mjs";
import { verifyCommand } from "./commands/verify.mjs";
import { doctorCommand } from "./commands/doctor.mjs";
import { varsCommand } from "./commands/vars.mjs";
import { runCommand } from "./commands/run.mjs";
import { specCommand } from "./commands/spec.mjs";
import { teardownCommand } from "./commands/teardown.mjs";
import { cleanupCommand } from "./commands/cleanup.mjs";
import { healCommand } from "./commands/heal.mjs";
import { scoreCommand } from "./commands/score.mjs";
import { scopeCommand } from "./commands/scope.mjs";
import { revealCommand } from "./commands/reveal.mjs";
import { reviewNoiseCommand } from "./commands/review-noise.mjs";
import { reviewLocatorIntentCommand } from "./commands/review-locator-intent.mjs";
import { reviewRouteIntentCommand } from "./commands/review-route-intent.mjs";
import { extractCommand } from "./commands/extract.mjs";
import { extractHealCommand } from "./commands/extract-heal.mjs";
import { exploreCommand } from "./commands/explore.mjs";
import { serveBrowserCommand } from "./commands/serve-browser.mjs";
import { promoteCommand } from "./commands/promote.mjs";
import { composeCommand } from "./commands/compose.mjs";
import { parseCommandLine } from "./lib/args.mjs";
import { ensureBootstrapDirs, getRepoRoot } from "./lib/config.mjs";

const helpText = `browser-flow

Project-local browser workflow compiler for local fixtures and real websites.

Usage:
  browser-flow <command> [options]

Commands:
  prepare   Create a capture session with an isolated Chrome debug profile
  done      End capture and persist sanitized artifacts
  replay    Re-run sanitize/scan on a captured run from raw-events.jsonl (no browser)
  analyze   Compile sanitized artifacts into path.yaml and recipe.yaml
  generate  Generate a runnable CDP-direct runner and registry entry
  verify    Replay the generated workflow and enforce truthfulness gates [--summary] [--screenshots off|final|steps|both]
  doctor    Report per-page-node staleness from snapshot time-series
  vars      Inspect / resume variable-extraction task state
  run       Bind workflow inputs and emit a new runner under a derived runId
  spec      Gather verifiable-spec answers (gap-only questionnaire, writes verify-spec.json)
  teardown  Link a teardown into the main workflow — --record <cleanupRunId> or --search --intent "<nl>" --page <pageKey>
  cleanup   Delete dangling artifacts from a held/aborted run — --run-id <runId>
  heal      Apply a heal-result to a held run + cleanup + re-run — --run-id <id> [--apply <heal-result.json>]
  reveal    Emit/apply stateful-affordance reveal semantics — --run-id <id> [--apply <reveal-result.json>]
  review-noise  Brief/apply ambiguous capture-noise review — --run-id <id> [--apply <capture-noise-result.json>]
  review-locator-intent  Brief/apply same-name semantic locator intent review — --run-id <id> [--apply <locator-intent-result.json>]
  review-route-intent  Brief/apply state/intent route review — --run-id <id> [--apply <route-intent-result.json>]
  explore   Discover navigable graph from a page (read-only BFS, depth 2) — --fixture <x> [--depth N]
  serve-browser  Launch a visible Chrome (stable profile + debug port) for human login, kept alive for attach — --run-id <id> [--port 9222] [--url <site>]
  extract   Emit/apply a scrape-result, or --reuse a durable config to extract with zero tokens — --run-id <id> --step <n> [--schema <f> | --apply <r> | --reuse [--paged]]
  extract-heal  Re-derive a drifted extractor config — --run-id <id> [--apply <extract-heal-result.json>]
  compose   Compose a primary workflow request into episodic compose artifacts — --run-id <id> --request "<task>"
  promote   Save a replay-verified external workflow after explicit approval — --run-id <id> --scope external --origins <csv> ...
  help      Show this message

Repo root:
  ${getRepoRoot()}
`;

const commandHelpText = {
  prepare: `browser-flow prepare

Usage:
  browser-flow prepare [--run-id <id>] [--fixture <fixture>] [--start-url <url>] [--unmasked] [--snapshot-dom] [--profile-name <name>] [--headless]

Notes:
  - Manual capture defaults to visible Chrome and pauses at awaiting_capture.
  - Use --unmasked with --start-url for explicit real-site diagnostic capture.
  - Reserve --headless for automation-driven capture, not the default human demo.
`,
  done: `browser-flow done

Usage:
  browser-flow done --run-id <id> [--capture-screenshot final]
`,
  analyze: `browser-flow analyze

Usage:
  browser-flow analyze --run-id <id>
`,
  generate: `browser-flow generate

Usage:
  browser-flow generate --run-id <id>
`,
  verify: `browser-flow verify

Usage:
  browser-flow verify --run-id <id> [--headless] [--summary]
`,
  cleanup: `browser-flow cleanup

Usage:
  browser-flow cleanup --run-id <id>
`,
  "review-noise": `browser-flow review-noise

Usage:
  browser-flow review-noise --run-id <id> [--apply <capture-noise-result.json>]
`,
  "review-locator-intent": `browser-flow review-locator-intent

Usage:
  browser-flow review-locator-intent --run-id <id> [--apply <locator-intent-result.json>]
`,
  "review-route-intent": `browser-flow review-route-intent

Usage:
  browser-flow review-route-intent --run-id <id> [--apply <route-intent-result.json>]
`
};

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const { command, options } = parseCommandLine(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    ensureBootstrapDirs();
    process.stdout.write(`${helpText}\n`);
    return;
  }

  if (options.help === true) {
    const scopedHelp = Object.prototype.hasOwnProperty.call(commandHelpText, command)
      ? commandHelpText[/** @type {keyof typeof commandHelpText} */ (command)]
      : helpText;
    ensureBootstrapDirs();
    process.stdout.write(`${scopedHelp}\n`);
    return;
  }

  if (command === "prepare") {
    process.stdout.write(`${JSON.stringify(prepareCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "done") {
    const result = await doneCommand(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "replay") {
    const result = replayCommand(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "analyze") {
    process.stdout.write(`${JSON.stringify(analyzeCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "generate") {
    process.stdout.write(`${JSON.stringify(generateCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "verify") {
    const result = await verifyCommand(options);
    if (options.summary === true) {
      process.stdout.write(`${JSON.stringify({ ok: result.ok, summary: result.summary }, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return;
  }

  if (command === "doctor") {
    ensureBootstrapDirs();
    process.stdout.write(`${JSON.stringify(doctorCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "vars") {
    process.stdout.write(`${JSON.stringify(await varsCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "run") {
    process.stdout.write(`${JSON.stringify(runCommand(options, argv), null, 2)}\n`);
    return;
  }

  if (command === "spec") {
    const result = await specCommand(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "teardown") {
    process.stdout.write(`${JSON.stringify(teardownCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "cleanup") {
    process.stdout.write(`${JSON.stringify(await cleanupCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "heal") {
    process.stdout.write(`${JSON.stringify(await healCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "score") {
    process.stdout.write(`${JSON.stringify(await scoreCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "scope") {
    process.stdout.write(`${JSON.stringify(await scopeCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "reveal") {
    process.stdout.write(`${JSON.stringify(await revealCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "review-noise") {
    process.stdout.write(`${JSON.stringify(await reviewNoiseCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "review-locator-intent") {
    process.stdout.write(`${JSON.stringify(await reviewLocatorIntentCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "review-route-intent") {
    process.stdout.write(`${JSON.stringify(await reviewRouteIntentCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "extract") {
    process.stdout.write(`${JSON.stringify(await extractCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "extract-heal") {
    process.stdout.write(`${JSON.stringify(await extractHealCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "explore") {
    process.stdout.write(`${JSON.stringify(await exploreCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "serve-browser") {
    // Interactive/blocking — manages its own stdout, no JSON result wrapper.
    await serveBrowserCommand(options);
    return;
  }

  if (command === "promote") {
    process.stdout.write(`${JSON.stringify(promoteCommand(options), null, 2)}\n`);
    return;
  }

  if (command === "compose") {
    process.stdout.write(`${JSON.stringify(await composeCommand(options), null, 2)}\n`);
    return;
  }

  throw new Error(
    `Command "${command}" is not implemented yet. Run "browser-flow help" for the planned command surface.`
  );
}

try {
  await main(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
