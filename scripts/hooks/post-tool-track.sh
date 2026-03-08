#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="/tmp/gastos-workflow-state.json"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# Map tool/skill invocations to pipeline step names
case "$TOOL_NAME" in
  *test-driven-development*) "$SCRIPT_DIR/workflow-state.sh" complete "tdd" ;;
  *verification-before-completion*) "$SCRIPT_DIR/workflow-state.sh" complete "verify" ;;
  *requesting-code-review*) "$SCRIPT_DIR/workflow-state.sh" complete "review" ;;
  *simplify*) "$SCRIPT_DIR/workflow-state.sh" complete "simplify" ;;
  *revise-claude-md*) "$SCRIPT_DIR/workflow-state.sh" complete "revise-claude-md" ;;
  *writing-plans*) "$SCRIPT_DIR/workflow-state.sh" complete "plan" ;;
  *using-git-worktrees*) "$SCRIPT_DIR/workflow-state.sh" complete "worktree" ;;
  *brainstorming*) "$SCRIPT_DIR/workflow-state.sh" complete "brainstorm" ;;
esac

exit 0
