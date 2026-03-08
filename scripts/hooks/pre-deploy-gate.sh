#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="/tmp/gastos-workflow-state.json"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

if ! "$SCRIPT_DIR/workflow-state.sh" check "verify" 2>/dev/null; then
  echo "Tests have not passed yet. Run npm run check && npm run test before deploying." >&2
  exit 2
fi

exit 0
