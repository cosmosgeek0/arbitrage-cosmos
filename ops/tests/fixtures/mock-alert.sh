#!/usr/bin/env bash
# ops/tests/fixtures/mock-alert.sh — records alerts: SEVERITY CODE MESSAGE.
set -u
printf '%s %s %s\n' "${1:-}" "${2:-}" "${3:-}" >> "${MOCK_ALERT_LOG:?mock-alert needs MOCK_ALERT_LOG}"
exit 0
