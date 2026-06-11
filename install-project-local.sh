#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [--tool codex|claude] /path/to/target-project\n' "${0##*/}" >&2
}

tool="codex"
target_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tool)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 64
      fi
      tool=$1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 64
      ;;
    *)
      if [ -n "$target_dir" ]; then
        usage
        exit 64
      fi
      target_dir=$1
      ;;
  esac
  shift
done

if [ -z "$target_dir" ]; then
  usage
  exit 64
fi

target_dir=${target_dir%/}

case "$tool" in
  codex|claude) ;;
  *)
    printf 'Unknown tool: %s\n' "$tool" >&2
    exit 64
    ;;
esac

if [ ! -d "$target_dir" ]; then
  printf 'Target directory does not exist: %s\n' "$target_dir" >&2
  exit 66
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
renderer_script="$script_dir/scripts/install/render-claude-command.mjs"

if [ -f "$script_dir/skills/browser-flow/SKILL.md" ]; then
  source_skill_dir="$script_dir/skills/browser-flow"
else
  printf 'Cannot find browser-flow skill next to installer: %s\n' "$script_dir" >&2
  exit 70
fi

if [ ! -f "$renderer_script" ]; then
  printf 'Cannot find browser-flow renderer next to installer: %s\n' "$renderer_script" >&2
  exit 70
fi

copy_dir() {
  source_dir=$1
  dest_dir=$2
  rm -rf "$dest_dir"
  mkdir -p "$(dirname -- "$dest_dir")"
  cp -R "$source_dir" "$dest_dir"
  rm -rf "$dest_dir/runtime/node_modules"
  find "$dest_dir" -name ".DS_Store" -delete
}

render_claude_command() {
  dest_file=$1
  mkdir -p "$(dirname -- "$dest_file")"
  node "$renderer_script" "$source_skill_dir" "$dest_file" ".claude/browser-flow"
}

prune_empty_dir() {
  dir=$1
  while [ "$dir" != "$target_dir" ]; do
    if [ -d "$dir" ] && rmdir "$dir" 2>/dev/null; then
      dir=$(dirname -- "$dir")
      continue
    fi
    break
  done
}

remove_stale_public_entries() {
  shopt -s nullglob
  for skill_dir in "$source_skill_dir"/skills/*; do
    if [ -d "$skill_dir" ]; then
      name=${skill_dir##*/}
      rm -rf "$target_dir/.codex/skills/$name"
      rm -f "$target_dir/.claude/commands/$name.md"
    fi
  done
  shopt -u nullglob
}

remove_browser_flow_installs() {
  rm -rf "$target_dir/.codex/skills/browser-flow"
  rm -rf "$target_dir/.claude/browser-flow"
  rm -f "$target_dir/.claude/commands/browser-flow.md"
  rm -rf "$target_dir/.browser-flow"
  rm -rf "$target_dir/.agents/skills/browser-flow"

  prune_empty_dir "$target_dir/.codex/skills"
  prune_empty_dir "$target_dir/.codex"
  prune_empty_dir "$target_dir/.claude/commands"
  prune_empty_dir "$target_dir/.claude/browser-flow"
  prune_empty_dir "$target_dir/.claude"
  prune_empty_dir "$target_dir/.agents/skills"
}

remove_stale_public_entries
remove_browser_flow_installs

case "$tool" in
  codex)
    install_dir="$target_dir/.codex/skills/browser-flow"
    copy_dir "$source_skill_dir" "$install_dir"
    printf 'Installed browser-flow for codex to %s\n' "$install_dir"
    ;;
  claude)
    private_dir="$target_dir/.claude/browser-flow"
    command_dir="$target_dir/.claude/commands/browser-flow.md"
    copy_dir "$source_skill_dir" "$private_dir"
    render_claude_command "$command_dir"
    printf 'Installed browser-flow for claude to %s\n' "$private_dir"
    ;;
esac
