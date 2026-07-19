#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

README="$REPO_ROOT/ops/live/README.md"
ENV_TEMPLATE="$REPO_ROOT/ops/live/env/cosmos-app.env.template"
UNIT="$REPO_ROOT/ops/live/systemd/cosmos-app.service"

note "FIX-031: DATA_DIR authority precondition is documented for deployment"
assert_contains "$(cat "$README")" "DATA_DIR authority deployment precondition"
assert_contains "$(cat "$README")" "DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases"
assert_contains "$(cat "$README")" "schema v2 names and records"
assert_contains "$(cat "$README")" "fails closed instead of running beside it"

note "FIX-031: env template constrains DATA_DIR and cache overrides"
assert_contains "$(cat "$ENV_TEMPLATE")" "must be ASCII"
assert_contains "$(cat "$ENV_TEMPLATE")" "ICON_CACHE, LIQ_CACHE, and PROFILE_CACHE overrides must resolve"
assert_contains "$(cat "$ENV_TEMPLATE")" "rejected before logical-root or DATA_DIR creation"

note "CS-06: inert notification ingest token is removed from the template"
assert_eq "$(grep -c 'NOTIFICATION_AWS_INGEST_TOKEN' "$ENV_TEMPLATE" || true)" "0"

note "FIX-031: unit pins the logical lease root in ExecStart, not Environment="
assert_contains "$(cat "$UNIT")" "ExecStart=/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases /usr/bin/node server/dist/index.js"
assert_eq "$(grep -c '^Environment=.*DATA_DIR_LOGICAL_LEASE_ROOT' "$UNIT" || true)" "0"
assert_contains "$(cat "$UNIT")" "RuntimeDirectory=cosmos-app"
assert_contains "$(cat "$UNIT")" "RuntimeDirectoryMode=0700"
assert_contains "$(cat "$UNIT")" "ReadWritePaths=/var/lib/cosmos /run/cosmos-app"

finish
