#!/usr/bin/env bash
# ops/tests/fixtures/mock-systemctl.sh — records systemctl invocations.
#
# Env contract:
#   MOCK_SYSTEMCTL_LOG   (required) file receiving one line per invocation
#   MOCK_ACTIVE_UNITS    (optional) file listing units considered "active"
#   MOCK_RESTART_HOOK    (optional) command run as: hook <verb> <unit>
set -u
log="${MOCK_SYSTEMCTL_LOG:?mock-systemctl needs MOCK_SYSTEMCTL_LOG}"
printf '%s\n' "$*" >> "$log"
verb="${1:-}"
unit="${2:-}"
case "$verb" in
  is-active)
    if [ -n "${MOCK_ACTIVE_UNITS:-}" ] && [ -f "$MOCK_ACTIVE_UNITS" ] \
        && grep -qx "$unit" "$MOCK_ACTIVE_UNITS"; then
      echo active
      exit 0
    fi
    echo inactive
    exit 3
    ;;
  restart|start|stop)
    if [ -n "${MOCK_RESTART_HOOK:-}" ]; then
      "$MOCK_RESTART_HOOK" "$verb" "$unit"
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
