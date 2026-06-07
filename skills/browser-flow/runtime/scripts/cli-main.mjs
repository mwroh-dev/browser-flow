#!/usr/bin/env node

import { parseCommandLine } from "./lib/args.mjs";
import {
  classifyCliError,
  formatHumanCliError,
  formatJsonCliError,
  isJsonErrorMode
} from "./lib/cli-errors.mjs";
import { resolveRegistryEntry } from "./lib/cli-registry.mjs";

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const { entry, options } = resolveRegistryEntry(argv);
  if (!entry) {
    throw new Error("CLI registry failed to resolve a command.");
  }
  entry.beforeRun?.();
  const result = await entry.run(options, argv);
  if (entry.outputMode === "interactive") {
    return;
  }
  const formatted = entry.format?.(result, options);
  if (formatted !== undefined) {
    process.stdout.write(formatted);
    return;
  }
  if (entry.outputMode === "text") {
    process.stdout.write(`${String(result)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
