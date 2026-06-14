import { ensureBootstrapDirs, getRepoRoot } from "./config.mjs";
import { parseCommandLine } from "./args.mjs";
import { invalidUsage, missingRequiredOption } from "./cli-errors.mjs";
import { renderCompletion } from "./completion.mjs";
import {
  buildCapabilities,
  buildCommandSchema,
  buildSchema,
  COMMANDS_BY_NAME,
  renderCommandHelp,
  renderTopLevelHelp,
  renderTopicHelp
} from "./cli-metadata.mjs";

const COMMAND_LOADERS = {
  prepare: async () => (await import("../commands/prepare.mjs")).prepareCommand,
  done: async () => (await import("../commands/done.mjs")).doneCommand,
  replay: async () => (await import("../commands/replay.mjs")).replayCommand,
  analyze: async () => (await import("../commands/analyze.mjs")).analyzeCommand,
  generate: async () => (await import("../commands/generate.mjs")).generateCommand,
  verify: async () => (await import("../commands/verify.mjs")).verifyCommand,
  status: async () => (await import("../commands/status.mjs")).statusCommand,
  doctor: async () => (await import("../commands/doctor.mjs")).doctorCommand,
  vars: async () => (await import("../commands/vars.mjs")).varsCommand,
  run: async () => (await import("../commands/run.mjs")).runCommand,
  spec: async () => (await import("../commands/spec.mjs")).specCommand,
  teardown: async () => (await import("../commands/teardown.mjs")).teardownCommand,
  cleanup: async () => (await import("../commands/cleanup.mjs")).cleanupCommand,
  heal: async () => (await import("../commands/heal.mjs")).healCommand,
  score: async () => (await import("../commands/score.mjs")).scoreCommand,
  scope: async () => (await import("../commands/scope.mjs")).scopeCommand,
  reveal: async () => (await import("../commands/reveal.mjs")).revealCommand,
  "review-noise": async () => (await import("../commands/review-noise.mjs")).reviewNoiseCommand,
  "review-locator-intent": async () => (await import("../commands/review-locator-intent.mjs")).reviewLocatorIntentCommand,
  "review-route-intent": async () => (await import("../commands/review-route-intent.mjs")).reviewRouteIntentCommand,
  extract: async () => (await import("../commands/extract.mjs")).extractCommand,
  "extract-heal": async () => (await import("../commands/extract-heal.mjs")).extractHealCommand,
  explore: async () => (await import("../commands/explore.mjs")).exploreCommand,
  "serve-browser": async () => (await import("../commands/serve-browser.mjs")).serveBrowserCommand,
  promote: async () => (await import("../commands/promote.mjs")).promoteCommand,
  compose: async () => (await import("../commands/compose.mjs")).composeCommand
};

/**
 * @typedef {{
 *   name: string,
 *   metadata: import("./cli-metadata.mjs").CommandMetadata,
 *   outputMode: "json" | "text" | "interactive",
 *   beforeRun?: () => void,
 *   run: (options: Record<string, string | boolean>, argv: string[]) => Promise<unknown> | unknown,
 *   format?: (result: unknown, options: Record<string, string | boolean>) => string | undefined
 * }} CliRegistryEntry
 */

/** @type {Map<string, CliRegistryEntry>} */
export const COMMAND_REGISTRY = new Map();

for (const [name, metadata] of COMMANDS_BY_NAME) {
  if (name === "help") {
    register({
      name,
      metadata,
      outputMode: "text",
      beforeRun: ensureBootstrapDirs,
      run: (_options, argv) => {
        const topic = typeof argv[3] === "string" && !argv[3].startsWith("--") ? argv[3] : "";
        return (topic ? renderTopicHelp(topic) ?? renderCommandHelp(topic) : null) ?? renderTopLevelHelp(getRepoRoot());
      }
    });
    continue;
  }
  if (name === "schema") {
    register({
      name,
      metadata,
      outputMode: "json",
      beforeRun: ensureBootstrapDirs,
      run: (_options, argv) => {
        if (argv[3] === "command") {
          const commandName = argv[4];
          const result = typeof commandName === "string" ? buildCommandSchema(commandName) : null;
          if (!result) throw invalidUsage("schema command requires a known command name.");
          return result;
        }
        return buildSchema();
      }
    });
    continue;
  }
  if (name === "capabilities") {
    register({
      name,
      metadata,
      outputMode: "json",
      beforeRun: ensureBootstrapDirs,
      run: () => buildCapabilities()
    });
    continue;
  }
  if (name === "completion") {
    register({
      name,
      metadata,
      outputMode: "text",
      beforeRun: ensureBootstrapDirs,
      run: (_options, argv) => {
        const shell = typeof argv[3] === "string" && !argv[3].startsWith("--") ? argv[3] : undefined;
        return renderCompletion(shell);
      }
    });
    continue;
  }

  register({
    name,
    metadata,
    outputMode: metadata.output,
    beforeRun: name === "doctor" ? ensureBootstrapDirs : undefined,
    run: async (options, argv) => {
      validateOptions(metadata, options);
      const command = await COMMAND_LOADERS[name]?.();
      if (!command) throw invalidUsage(`Unknown command "${name}".`);
      return name === "run" ? command(options, argv) : command(options);
    },
    format: name === "verify"
      ? (result, options) => options.summary === true ? `${JSON.stringify({ ok: result?.ok, summary: result?.summary }, null, 2)}\n` : undefined
      : undefined
  });
}

/**
 * @param {CliRegistryEntry} entry
 */
function register(entry) {
  COMMAND_REGISTRY.set(entry.name, entry);
}

/**
 * @param {import("./cli-metadata.mjs").CommandMetadata} metadata
 * @param {Record<string, string | boolean>} options
 */
export function validateOptions(metadata, options) {
  for (const option of metadata.options) {
    if (!option.name.startsWith("--")) continue;
    const key = option.name.slice(2);
    const value = options[key];
    if (option.required && value === undefined) {
      throw missingRequiredOption(`${metadata.name} requires ${option.name}${option.value ? ` <${option.value}>` : ""}.`, metadata.name);
    }
    if (value === undefined) continue;
    if (option.type === "boolean" && typeof value !== "boolean") {
      throw invalidUsage(`${metadata.name} option ${option.name} does not accept a value.`, [`browser-flow ${metadata.name} --help`]);
    }
    if ((option.type === "string" || option.type === "enum") && typeof value === "boolean") {
      // true: flag given without a value; false: a --no-<flag> negation,
      // which only boolean options support.
      throw invalidUsage(`${metadata.name} option ${option.name} requires a value.`, [`browser-flow ${metadata.name} --help`]);
    }
    if (option.type === "enum" && typeof value === "string" && !option.values.includes(value)) {
      throw invalidUsage(
        `${metadata.name} option ${option.name} must be one of: ${option.values.join(" | ")}.`,
        [`browser-flow ${metadata.name} --help`]
      );
    }
  }
}

/**
 * @param {string[]} argv
 */
export function resolveRegistryEntry(argv) {
  const { command, options } = parseCommandLine(argv);
  const resolvedCommand = command || "help";
  if (resolvedCommand === "--help" || resolvedCommand === "-h") {
    return { entry: COMMAND_REGISTRY.get("help"), command: "help", options };
  }
  const entry = COMMAND_REGISTRY.get(resolvedCommand);
  if (!entry) throw invalidUsage(`Unknown command "${resolvedCommand}".`);
  if (options.help === true && resolvedCommand !== "help") {
    return {
      entry: {
        name: "help",
        metadata: COMMANDS_BY_NAME.get("help"),
        outputMode: "text",
        beforeRun: ensureBootstrapDirs,
        run: () => renderCommandHelp(resolvedCommand) ?? renderTopLevelHelp(getRepoRoot())
      },
      command: "help",
      options
    };
  }
  return { entry, command: resolvedCommand, options };
}
