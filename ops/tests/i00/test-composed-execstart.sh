#!/usr/bin/env bash
# The provider binding is intentionally separate from the preserved execution
# and environment overlays. It must never reset or replace either contract.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

note "provider-only drop-in does not own ExecStart or EnvironmentFile"
BASE="$REPO_ROOT/ops/live/systemd/cosmos-app.service"
PROVIDER_DROPIN="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-i00.conf.template"
RUNTIME_DROPIN="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-runtime.conf.template"
assert_file "$BASE"
assert_file "$PROVIDER_DROPIN"
assert_file "$RUNTIME_DROPIN"

if grep -E '^(ExecStart|EnvironmentFile)=' "$PROVIDER_DROPIN" >/dev/null; then
  fail_test "provider-only drop-in changes execution or environment ownership"
fi
pass_assertion

# The packaged recovery source for the preserved runtime overlay remains the
# sole overlay that replaces the base command; the provider overlay is inert.
EFFECTIVE="$(printf '%s\n%s\n%s\n' \
  "$(grep '^ExecStart=' "$BASE")" \
  "$(grep '^ExecStart=' "$RUNTIME_DROPIN")" \
  "$(grep '^ExecStart=' "$PROVIDER_DROPIN")" \
  | awk '/^ExecStart=$/{last=""; next} /^ExecStart=/{last=$0} END{print last}')"

assert_contains "$EFFECTIVE" 'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases'
assert_contains "$EFFECTIVE" '/usr/local/lib/cosmos-ops/i00/bin/app-entrypoint.mjs'
assert_contains "$EFFECTIVE" '/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT='
assert_contains "$(grep '^EnvironmentFile=' "$RUNTIME_DROPIN")" \
  '/etc/cosmos/cosmos-i00.env'

# The value must be non-empty and absolute: an empty assignment throws
# DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID instead of satisfying the gate.
case "$EFFECTIVE" in
  *'DATA_DIR_LOGICAL_LEASE_ROOT= '*) fail_test "lease root is assigned empty in the composed ExecStart" ;;
esac
pass_assertion

# The base unit itself is byte-sealed L15 content and must still carry its own
# ExecStart pin unchanged — if this fails, a fix strayed into ops/live/.
assert_contains "$(grep '^ExecStart=' "$BASE")" '/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases /usr/bin/node server/dist/index.js'

finish
