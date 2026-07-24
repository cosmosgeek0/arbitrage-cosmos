#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

DEPLOY="$REPO_ROOT/ops/live/bin/deploy.sh"
COMMON="$REPO_ROOT/ops/live/bin/common.sh"
DONOR_TEST="$REPO_ROOT/ops/tests/test-deploy.sh"
DEPLOY_SOURCE="$(cat "$DEPLOY")"

note "FIRST-HOST-001: refusal guard is inside the lock lifetime and before host sanity"
TRAP_LINE="$(grep -nFx 'trap cleanup EXIT' "$DEPLOY" | cut -d: -f1)"
GUARD_LINE="$(grep -nF 'if [ "${I00_REQUIRE_FIRST_HOST_NO_CURRENT+x}" = x ]; then' "$DEPLOY" | cut -d: -f1)"
SANITY_LINE="$(grep -nFx 'assert_link_sane "$CURRENT_EFFECT_LINK"' "$DEPLOY" | head -1 | cut -d: -f1)"
assert_eq "$(( TRAP_LINE < GUARD_LINE ))" 1 "guard follows cleanup trap"
assert_eq "$(( GUARD_LINE < SANITY_LINE ))" 1 "guard precedes donor host sanity"

note "FIRST-HOST-001: named links resolve through exact descriptor-bound write authority"
assert_eq "$(grep -cF 'CURRENT_EFFECT_LINK="$(authorized_write_effect_path \' "$DEPLOY")" "1"
assert_eq "$(grep -cF '  currentLinkParent "$CURRENT_LINK")"' "$DEPLOY")" "1"
assert_eq "$(grep -cF 'PREVIOUS_EFFECT_LINK="$(authorized_write_effect_path \' "$DEPLOY")" "1"
assert_eq "$(grep -cF '  previousLinkParent "$PREVIOUS_LINK")"' "$DEPLOY")" "1"
assert_contains "$(cat "$COMMON")" 'effect path is outside its authorized write-root capability'

note "FIRST-HOST-001: marker is absent-or-exact-1 and both effect links use -e or -L"
assert_contains "$DEPLOY_SOURCE" 'if [ "${I00_REQUIRE_FIRST_HOST_NO_CURRENT+x}" = x ]; then'
assert_contains "$DEPLOY_SOURCE" '[ "$I00_REQUIRE_FIRST_HOST_NO_CURRENT" = 1 ] \'
assert_contains "$DEPLOY_SOURCE" 'I00_REQUIRE_FIRST_HOST_NO_CURRENT must be absent or exactly 1'
assert_contains "$DEPLOY_SOURCE" 'if [ -e "$CURRENT_EFFECT_LINK" ] || [ -L "$CURRENT_EFFECT_LINK" ]; then'
assert_contains "$DEPLOY_SOURCE" 'if [ -e "$PREVIOUS_EFFECT_LINK" ] || [ -L "$PREVIOUS_EFFECT_LINK" ]; then'
assert_eq "$(grep -cF 'if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then' "$DEPLOY" || true)" "0"
assert_eq "$(grep -cF 'if [ -e "$PREVIOUS_LINK" ] || [ -L "$PREVIOUS_LINK" ]; then' "$DEPLOY" || true)" "0"

note "FIRST-HOST-001: donor regression carries the closed refusal and race matrix"
assert_contains "$(cat "$DONOR_TEST")" 'first-host marker refuses every occupied current/previous path before mutation'
assert_contains "$(cat "$DONOR_TEST")" 'for first_host_link in current previous; do'
assert_contains "$(cat "$DONOR_TEST")" 'for first_host_kind in valid-symlink dangling-symlink regular-file directory; do'
assert_contains "$(cat "$DONOR_TEST")" 'any set marker other than exact 1 refuses before mutation'
assert_contains "$(cat "$DONOR_TEST")" 'run_wrong_first_host_marker_case empty ""'
assert_contains "$(cat "$DONOR_TEST")" 'run_wrong_first_host_marker_case leading-zero 01'
assert_contains "$(cat "$DONOR_TEST")" 'deterministic TOCTOU: path created while donor waits for lock is refused'
assert_contains "$(cat "$DONOR_TEST")" 'clean first-host post-switch failure freezes without inventing rollback'

finish
