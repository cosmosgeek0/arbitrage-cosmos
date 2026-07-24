#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

INSTALLER="$I00_ROOT/bin/install-ops-bundle.sh"
SOURCE="$(<"$INSTALLER")"
AUTHORIZED_SOURCE="$(sed -n \
  '/^run_authorized_install_effect()/,/^if \[ "${1-}" = --authorized-effect \]; then/p' \
  "$INSTALLER")"

note "DEPLOY-PORTABILITY-008: install wrapper uses the exact four-document runner API"
assert_success bash -n "$INSTALLER"
assert_eq "$(grep -c 'validate-authorization\.mjs' "$INSTALLER")" 1
assert_eq "$(grep -c 'run-bound-effect\.mjs' "$INSTALLER")" 1
assert_eq "$(grep -c 'record-authorized-action-outcome\.mjs' "$INSTALLER")" 1
for token in \
  '--authorization "$AUTHORIZATION"' \
  '--deployment-risk "$DEPLOYMENT_RISK"' \
  '--action-preview "$ACTION_PREVIEW"' \
  '--authorization-consumption "$AUTHORIZATION_CONSUMPTION"' \
  '-- "$SCRIPT_DIR/install-ops-bundle.sh"' \
  'authorizationConsumptionPath' \
  'effectStartEvidence' \
  'effectTerminalEvidence'; do
  assert_contains "$SOURCE" "$token"
done
for forbidden in --uid --gid --program --authorization-expires-at-utc \
  --evidence-valid-until-utc --receipt-reserve-sec --preflight \
  effect-start-utc consumptionReceipt; do
  if printf '%s' "$SOURCE" | grep -F -- "$forbidden" >/dev/null; then
    fail_test "installer retains legacy runner or recorder input $forbidden"
  fi
  pass_assertion
done

note "DEPLOY-PORTABILITY-008: one internal effect uses only inherited capabilities"
for token in \
  'I00_EFFECT_EXEC_NODE_FD' \
  'I00_EFFECT_EXEC_BASH_FD' \
  'I00_EFFECT_EXEC_MKDIR_FD' \
  'I00_EFFECT_EXEC_CP_FD' \
  'I00_EFFECT_EXEC_CHMOD_FD' \
  'I00_EFFECT_EXEC_MV_FD' \
  'I00_EFFECT_EXEC_RM_FD' \
  'I00_AUTHORIZED_EFFECT_WRITE_ROOT_DESTINATION_PARENT_FD' \
  'I00_AUTHORIZED_EFFECT_READ_ROOT_RELEASE_SOURCE_FD' \
  'local release_cap=/proc/self/fd/51' \
  'local write_cap=/proc/self/fd/40' \
  '"$release_cap/ops/i00/."' \
  '"$release_cap/ops/live/."' \
  'readRoots.releaseSource' \
  'treeSha256' \
  'trap cleanup_authorized_staging EXIT' \
  '/proc/self/fd/30 -T --'; do
  assert_contains "$AUTHORIZED_SOURCE" "$token"
done
if printf '%s\n' "$AUTHORIZED_SOURCE" \
    | grep -E '^[[:space:]]*(mkdir|cp|chmod|mv|rm|node|bash)([[:space:]]|$)' >/dev/null; then
  fail_test "authorized install effect retains a named executable"
fi
pass_assertion
if printf '%s\n' "$AUTHORIZED_SOURCE" | grep -F '"$RELEASE/ops/' >/dev/null; then
  fail_test "authorized install effect reads release material by caller pathname"
fi
pass_assertion

note "DEPLOY-PORTABILITY-008: direct internal invocation cannot forge runner authority"
assert_failure_contains 'authorized install effect lacks the verified runner parent' \
  "$INSTALLER" --authorized-effect \
  --release "$TEST_TMP/release" \
  --destination "$TEST_TMP/destination"
assert_failure_contains 'authorized install effect requires root' \
  env _I00_RUNNER_PARENT_VERIFIED=1 \
  "$INSTALLER" --authorized-effect \
  --release "$TEST_TMP/release" \
  --destination "$TEST_TMP/destination"
assert_failure_contains 'unknown argument' \
  "$INSTALLER" --df32-unsupported-option

finish
