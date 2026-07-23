#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

WRAPPER="$I00_ROOT/bin/release-switch.sh"
SOURCE="$(cat "$WRAPPER")"

note "DEPLOY-DEFECTS-007(1): first-host evidence is a distinct pre-authorization step"
assert_contains "$SOURCE" '--prepare-first-host-evidence'
assert_contains "$SOURCE" '--first-host-evidence-dir'
assert_contains "$SOURCE" 'FIRST_HOST_EVIDENCE_PREPARED'
assert_contains "$SOURCE" 'prepare-first-host evidence rejects authorization and receipt inputs'

note "DEPLOY-DEFECTS-007(1): actual first-host switches consume rather than regenerate evidence"
assert_contains "$SOURCE" 'first-host switch requires --first-host-evidence-dir'
assert_contains "$SOURCE" 'prepared first-host evidence bundle changed after preflight'
assert_contains "$SOURCE" 'first-host-evidence-sha256:'

PREPARE_EXIT_LINE="$(grep -nF 'FIRST_HOST_EVIDENCE_PREPARED' "$WRAPPER" | tail -1 | cut -d: -f1)"
AUTH_LINE="$(grep -nF 'AUTH_BASE=(' "$WRAPPER" | head -1 | cut -d: -f1)"
DELEGATE_LINE="$(grep -nF '"$DONOR_ROOT/bin/deploy.sh" --release' "$WRAPPER" | head -1 | cut -d: -f1)"
assert_eq "$(( PREPARE_EXIT_LINE < AUTH_LINE ))" 1
assert_eq "$(( PREPARE_EXIT_LINE < DELEGATE_LINE ))" 1

finish
