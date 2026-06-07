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
    for (const option of [...command.requiredOptions, ...command.optionalOptions]) {
      const matches = option.match(/--[A-Za-z0-9-]+/g);
      if (matches) {
        for (const match of matches) {
          options.add(match);
        }
      }
    }
  }
  return [...options].sort();
}

function renderBashCompletion() {
  const commands = commandNames().join(" ");
  const options = optionNames().join(" ");
  return [
    "# browser-flow bash completion",
    "_browser_flow() {",
    "  local cur",
    "  COMPREPLY=()",
    "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  local commands=\"" + commands + "\"",
    "  local options=\"" + options + "\"",
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    "    COMPREPLY=( $(compgen -W \"${commands}\" -- \"$cur\") )",
    "    return 0",
    "  fi",
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
  return lines.join("\n");
}
