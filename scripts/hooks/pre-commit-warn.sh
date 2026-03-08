#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="/tmp/gastos-workflow-state.json"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

WARNINGS=""

if ! "$SCRIPT_DIR/workflow-state.sh" check "review" 2>/dev/null; then
  WARNINGS="${WARNINGS}Code review has not been run. "
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "simplify" 2>/dev/null; then
  WARNINGS="${WARNINGS}Simplify pass has not been run. "
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "revise-claude-md" 2>/dev/null; then
  WARNINGS="${WARNINGS}CLAUDE.md has not been revised. "
fi

if [ -n "$WARNINGS" ]; then
  echo "WARNING: ${WARNINGS}Proceeding anyway."
fi

exit 0
