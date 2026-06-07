import { COMMANDS } from "./cli-metadata.mjs";

const SUPPORTED_SHELLS = new Set(["bash", "zsh", "fish"]);
const PRIMARY_COMMANDS = ["prepare", "done", "analyze", "generate", "verify"];

/**
 * @param {string | undefined} shell
 */
export function renderCompletion(shell) {
  if (!shell || !SUPPORTED_SHELLS.has(shell)) {
    throw new Error("completion supports bash, zsh, or fish.");
  }
  if (shell === "bash") return renderBashCompletion();
  if (shell === "zsh") return renderZshCompletion();
  return renderFishCompletion();
}

function commandNames() {
  const all = COMMANDS.map((entry) => entry.name);
  const primary = PRIMARY_COMMANDS.filter((name) => all.includes(name));
  const rest = all.filter((name) => !primary.includes(name));
  return [...primary, ...rest];
}

function optionNames() {
  const options = new Set(["--help", "--json"]);
  for (const command of COMMANDS) {
    for (const option of command.options) {
      options.add(option.name);
    }
  }
  return [...options].sort();
}

function optionNamesFor(command) {
  return [...new Set(["--help", "--json", ...command.options.map((option) => option.name)])].sort();
}

function renderBashCompletion() {
  const commands = commandNames().join(" ");
  const options = optionNames().join(" ");
  const commandCases = COMMANDS.map((command) => {
    const commandOptions = optionNamesFor(command).join(" ");
    return `    ${command.name}) options="${commandOptions}" ;;`;
  });
  return [
    "# browser-flow bash completion",
    "_browser_flow() {",
    "  local cur cmd options",
    "  COMPREPLY=()",
    "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  cmd=\"${COMP_WORDS[1]}\"",
    "  local commands=\"" + commands + "\"",
    "  options=\"" + options + "\"",
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    "    COMPREPLY=( $(compgen -W \"${commands}\" -- \"$cur\") )",
    "    return 0",
    "  fi",
    "  case \"$cmd\" in",
    ...commandCases,
    "  esac",
    "  COMPREPLY=( $(compgen -W \"${options}\" -- \"$cur\") )",
    "}",
    "complete -F _browser_flow browser-flow"
  ].join("\n");
}

function renderZshCompletion() {
  const commandEntries = COMMANDS
    .slice()
    .sort((a, b) => commandNames().indexOf(a.name) - commandNames().indexOf(b.name))
    .map((entry) => `    '${entry.name}:${entry.description.replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`);
  const optionEntries = optionNames().map((option) => `    '${option}'`);
  const enumEntries = [];
  for (const command of COMMANDS) {
    for (const option of command.options) {
      if (option.type === "enum" && option.values.length > 0) {
        enumEntries.push(`    '${command.name} ${option.name}:${option.values.join(" ")}'`);
      }
    }
  }
  return [
    "#compdef browser-flow",
    "",
    "_browser_flow() {",
    "  local state",
    "  local -a commands options",
    "  commands=(",
    ...commandEntries,
    "  )",
    "  options=(",
    ...optionEntries,
    "  )",
    "  # enum value hints",
    ...enumEntries,
    "  _arguments \\",
    "    '1:command:->command' \\",
    "    '*::option:->option'",
    "  case $state in",
    "    command) _describe 'command' commands ;;",
    "    option) _values 'option' $options ;;",
    "  esac",
    "}",
    "",
    "_browser_flow \"$@\""
  ].join("\n");
}

function renderFishCompletion() {
  const commands = commandNames().join(" ");
  const lines = [
    "# browser-flow fish completion",
    `complete -c browser-flow -f -a '${commands}'`
  ];
  for (const option of optionNames()) {
    lines.push(`complete -c browser-flow -l ${option.slice(2)}`);
  }
  for (const command of COMMANDS) {
    for (const option of optionNamesFor(command)) {
      lines.push(`complete -c browser-flow -n '__fish_seen_subcommand_from ${command.name}' -l ${option.slice(2)}`);
    }
    for (const option of command.options) {
      if (option.type === "enum" && option.values.length > 0) {
        lines.push(`complete -c browser-flow -n '__fish_seen_subcommand_from ${command.name}; and __fish_seen_argument -l ${option.name.slice(2)}' -a '${option.values.join(" ")}'`);
      }
    }
  }
  return lines.join("\n");
}
