#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

WRAPPER="$I00_ROOT/bin/release-switch.sh"
SOURCE="$(cat "$WRAPPER")"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
RISK_SOURCE="$(cat "$RISK_PRODUCER")"

note "DEPLOY-DEFECTS-007(1): first-host evidence is a distinct pre-authorization step"
assert_contains "$SOURCE" '--prepare-first-host-evidence'
assert_contains "$SOURCE" '--first-host-evidence-dir'
assert_contains "$SOURCE" 'FIRST_HOST_EVIDENCE_PREPARED'
assert_contains "$SOURCE" 'prepare-first-host evidence rejects authorization and receipt inputs'

note "DEPLOY-DEFECTS-007(1): actual first-host switches consume rather than regenerate evidence"
assert_contains "$SOURCE" 'first-host switch requires --first-host-evidence-dir'
assert_contains "$SOURCE" 'prepared first-host evidence bundle changed after preflight'
assert_contains "$RISK_SOURCE" 'function firstHostBinding(directory, expectedSystemctl, simulationRoot) {'
assert_contains "$RISK_SOURCE" '`first-host-evidence-sha256:${firstHost.firstHostEvidenceSha256}`'

note "DEPLOY-DEFECTS-007(1): preview endpoints and receipt evidence stay dynamically bound"
assert_contains "$SOURCE" 'for(const endpoint of value.action.allowedEndpoints)console.log(endpoint);'
assert_contains "$SOURCE" 'AUTH_ENDPOINTS+=(--expected-endpoint "$endpoint")'
assert_contains "$SOURCE" '"${AUTH_BASE[@]}" "${AUTH_ENDPOINTS[@]}")"'
assert_contains "$SOURCE" '--expected-preview-document-sha256 "$ACTION_PREVIEW_SHA256"'

PREPARE_EXIT_LINE="$(grep -nF 'FIRST_HOST_EVIDENCE_PREPARED' "$WRAPPER" | tail -1 | cut -d: -f1)"
AUTH_LINE="$(grep -nF 'AUTH_BASE=(' "$WRAPPER" | head -1 | cut -d: -f1)"
DELEGATE_LINE="$(grep -nF -- '-- "$DONOR_ROOT/bin/deploy.sh"' "$WRAPPER" | head -1 | cut -d: -f1)"
assert_eq "$(( PREPARE_EXIT_LINE < AUTH_LINE ))" 1
assert_eq "$(( PREPARE_EXIT_LINE < DELEGATE_LINE ))" 1

finish
