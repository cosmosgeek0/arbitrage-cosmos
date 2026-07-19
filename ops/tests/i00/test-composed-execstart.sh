#!/usr/bin/env bash
# The gap this test closes: the base unit and the I00 drop-in were each pinned
# individually, but nothing ever asserted the COMPOSED unit systemd actually
# runs. The drop-in's ExecStart= reset silently discarded the /usr/bin/env
# prefix that was the sole carrier of DATA_DIR_LOGICAL_LEASE_ROOT — mandatory
# under NODE_ENV=production (bootstrap/environment.ts throws at module load) —
# so the service as shipped could not boot.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

note "composed base-unit + I00 drop-in ExecStart still boots"
BASE="$REPO_ROOT/ops/live/systemd/cosmos-app.service"
DROPIN="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-i00.conf.template"
assert_file "$BASE"
assert_file "$DROPIN"

# systemd semantics: an empty ExecStart= resets the list; the effective
# command is whatever non-empty ExecStart= lines follow the last reset.
EFFECTIVE="$(printf '%s\n%s\n' "$(grep '^ExecStart=' "$BASE")" "$(grep '^ExecStart=' "$DROPIN")" \
  | awk '/^ExecStart=$/{last=""; next} /^ExecStart=/{last=$0} END{print last}')"

assert_contains "$EFFECTIVE" 'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases'
assert_contains "$EFFECTIVE" 'app-entrypoint.mjs'
assert_contains "$EFFECTIVE" '/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT='

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
