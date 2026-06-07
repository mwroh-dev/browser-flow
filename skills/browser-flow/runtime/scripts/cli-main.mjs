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
import {
  classifyCliError,
  formatHumanCliError,
  formatJsonCliError,
  isJsonErrorMode
} from "./lib/cli-errors.mjs";
import { renderCompletion } from "./lib/completion.mjs";
import {
  buildCapabilities,
  buildCommandSchema,
  buildSchema,
  renderCommandHelp,
  renderTopLevelHelp,
  renderTopicHelp
} from "./lib/cli-metadata.mjs";

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const { command, options } = parseCommandLine(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    const topic = typeof argv[3] === "string" && !argv[3].startsWith("--") ? argv[3] : "";
    const help = topic ? renderTopicHelp(topic) : null;
    ensureBootstrapDirs();
    process.stdout.write(`${help ?? renderTopLevelHelp(getRepoRoot())}\n`);
    return;
  }

  if (options.help === true) {
    const scopedHelp = renderCommandHelp(command) ?? renderTopLevelHelp(getRepoRoot());
    ensureBootstrapDirs();
    process.stdout.write(`${scopedHelp}\n`);
    return;
  }

  if (command === "capabilities") {
    ensureBootstrapDirs();
    process.stdout.write(`${JSON.stringify(buildCapabilities(), null, 2)}\n`);
    return;
  }

  if (command === "schema") {
    ensureBootstrapDirs();
    if (argv[3] === "command") {
      const commandName = argv[4];
      const result = typeof commandName === "string" ? buildCommandSchema(commandName) : null;
      if (!result) {
        throw new Error("schema command requires a known command name.");
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(buildSchema(), null, 2)}\n`);
    return;
  }

  if (command === "completion") {
    ensureBootstrapDirs();
    const shell = typeof argv[3] === "string" && !argv[3].startsWith("--") ? argv[3] : undefined;
    process.stdout.write(`${renderCompletion(shell)}\n`);
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

  throw new Error(`Unknown command "${command}".`);
}

try {
  await main(process.argv);
} catch (error) {
  const { command, options } = parseCommandLine(process.argv);
  const failure = classifyCliError(error, { command });
  process.exitCode = failure.exitCode;
  if (isJsonErrorMode(process.argv, options)) {
    process.stdout.write(`${JSON.stringify(formatJsonCliError(failure), null, 2)}\n`);
  } else {
    process.stderr.write(formatHumanCliError(failure));
  }
}
