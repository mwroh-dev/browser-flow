/**
 * @param {string[]} argv
 * @returns {{ command: string, options: Record<string, string | boolean> }}
 */
export function parseCommandLine(argv) {
  const command = argv[2] ?? "help";
  /** @type {Record<string, string | boolean>} */
  const options = {};

  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options };
}

/**
 * @param {Record<string, string | boolean>} options
 * @param {string} key
 * @param {string | undefined} fallback
 */
export function getStringOption(options, key, fallback) {
  const value = options[key];
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

/**
 * @param {Record<string, string | boolean>} options
 * @param {string} key
 */
export function getBooleanOption(options, key) {
  return options[key] === true;
}
