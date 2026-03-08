#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="/tmp/gastos-workflow-state.json"

usage() {
  echo "Usage: workflow-state.sh <command> [args...]"
  echo ""
  echo "Commands:"
  echo "  init <description> <size> <steps-json>  Initialize workflow state"
  echo "  complete <step-name>                     Mark a step as completed"
  echo "  check <step-name>                        Check if a step is completed (exit 0/1)"
  echo "  check-any <step1> [step2] ...            Check if all listed steps are done"
  echo "  status                                   Pretty-print state file"
  echo "  set-deploy-version <version-id>          Set previous deploy version"
  echo "  clear                                    Delete state file"
  exit 1
}

cmd_init() {
  local description="${1:?Missing task description}"
  local size="${2:?Missing size}"
  local steps_json="${3:?Missing steps JSON array}"

  if ! echo "$steps_json" | jq -e 'type == "array"' > /dev/null 2>&1; then
    echo "Error: steps-json must be a JSON array" >&2
    exit 1
  fi

  jq -n \
    --arg task "$description" \
    --arg size "$size" \
    --argjson steps "$steps_json" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      task: $task,
      size: $size,
      required_steps: $steps,
      completed: [],
      previous_deploy_version: null,
      started_at: $ts
    }' > "$STATE_FILE"
}

cmd_complete() {
  local step="${1:?Missing step name}"

  if [[ ! -f "$STATE_FILE" ]]; then
    echo "Error: No state file found. Run 'init' first." >&2
    exit 1
  fi

  jq --arg step "$step" \
    '.completed = (.completed + [$step] | unique)' \
    "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

cmd_check() {
  local step="${1:?Missing step name}"

  # No state file — nothing to enforce
  if [[ ! -f "$STATE_FILE" ]]; then
    exit 0
  fi

  # Step not in required list — nothing to enforce
  local is_required
  is_required=$(jq -r --arg step "$step" \
    'if (.required_steps | index($step)) then "yes" else "no" end' \
    "$STATE_FILE")

  if [[ "$is_required" == "no" ]]; then
    exit 0
  fi

  # Step is required — check if completed
  local is_completed
  is_completed=$(jq -r --arg step "$step" \
    'if (.completed | index($step)) then "yes" else "no" end' \
    "$STATE_FILE")

  if [[ "$is_completed" == "yes" ]]; then
    exit 0
  fi

  echo "Step not completed: $step" >&2
  exit 1
}

cmd_check_any() {
  if [[ $# -eq 0 ]]; then
    echo "Error: check-any requires at least one step name" >&2
    exit 1
  fi

  # No state file — nothing to enforce
  if [[ ! -f "$STATE_FILE" ]]; then
    exit 0
  fi

  local missing=()

  for step in "$@"; do
    local is_required
    is_required=$(jq -r --arg step "$step" \
      'if (.required_steps | index($step)) then "yes" else "no" end' \
      "$STATE_FILE")

    if [[ "$is_required" == "no" ]]; then
      continue
    fi

    local is_completed
    is_completed=$(jq -r --arg step "$step" \
      'if (.completed | index($step)) then "yes" else "no" end' \
      "$STATE_FILE")

    if [[ "$is_completed" == "no" ]]; then
      missing+=("$step")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing required steps: ${missing[*]}" >&2
    exit 1
  fi

  exit 0
}

cmd_status() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No active workflow state."
    exit 0
  fi

  jq '.' "$STATE_FILE"
}

cmd_set_deploy_version() {
  local version="${1:?Missing version ID}"

  if [[ ! -f "$STATE_FILE" ]]; then
    echo "Error: No state file found. Run 'init' first." >&2
    exit 1
  fi

  jq --arg v "$version" \
    '.previous_deploy_version = $v' \
    "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

cmd_clear() {
  rm -f "$STATE_FILE"
}

# --- Command dispatch ---

if [[ $# -eq 0 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  init)               cmd_init "$@" ;;
  complete)           cmd_complete "$@" ;;
  check)              cmd_check "$@" ;;
  check-any)          cmd_check_any "$@" ;;
  status)             cmd_status ;;
  set-deploy-version) cmd_set_deploy_version "$@" ;;
  clear)              cmd_clear ;;
  *)                  usage ;;
esac
