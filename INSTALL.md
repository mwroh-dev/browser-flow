# Browser Flow project-local install

Use the installer from a `browser-flow-released` checkout:

```bash
./install-project-local.sh /path/to/target-project
./install-project-local.sh --tool claude /path/to/target-project
```

The default install writes the Codex projection to:

```text
/path/to/target-project/.codex/skills/browser-flow
```

The Claude install writes only:

```text
/path/to/target-project/.claude/commands/browser-flow.md
/path/to/target-project/.claude/browser-flow
```

It does not install global skills, does not write root-level runtime
dependencies into the target project, and does not inject or rewrite the host
project's root `CLAUDE.md`. The installed package prepares its own dependencies
inside the installed package's `runtime/` directory on first use.

After installing, restart Codex from the target project so it discovers the
new project-local skill. For Claude installs, restart Claude Code so it
discovers the new project-local command.
