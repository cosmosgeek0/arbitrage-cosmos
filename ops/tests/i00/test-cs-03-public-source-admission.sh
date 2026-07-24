#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/../helpers.sh"

I00_ROOT="$TESTS_DIR/../i00"
I00_TEMPLATE="$TESTS_DIR/../templates/i00/env/cosmos-i00.env.template"
APP_TEMPLATE="$OPS_LIVE/env/cosmos-app.env.template"

note "canonical activation templates admit public-source startup and never opt into offline mode"
assert_grep '^I00_PUBLIC_SOURCE_STARTUP_EGRESS=1$' "$I00_TEMPLATE" \
  "I00 activation template admits canonical public sources"
assert_grep '^I00_PUBLIC_SOURCE_STARTUP_EGRESS=1$' "$APP_TEMPLATE" \
  "application template admits canonical public sources"
assert_not_grep '^I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES=' "$I00_TEMPLATE" \
  "I00 activation template excludes deterministic offline mode"
assert_not_grep '^I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES=' "$APP_TEMPLATE" \
  "application template excludes deterministic offline mode"

note "activation config requires exact live admission and rejects offline conflicts"
cat > "$SANDBOX/runtime.env" <<'ENV'
HOST=127.0.0.1
PORT=8080
DATA_DIR=/var/lib/cosmos/data
EVIDENCE_DIR=/var/lib/cosmos/evidence
MODEL_DIR=/var/lib/cosmos/models
BACKUP_DIR=/var/backups/cosmos
CONTROL_ROOM_OPERATOR_EMAIL=operator@private.invalid
CF_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com
CF_ACCESS_AUD=audience_12345678
I00_TESTED_SHA=0123456789abcdef0123456789abcdef01234567
I00_CONFIG_REVISION=config-1
I00_MODEL_REVISION=UNAVAILABLE
I00_PUBLIC_SOURCE_STARTUP_EGRESS=1
ENV
assert_rc 0 node "$I00_ROOT/bin/validate-config.mjs" --env "$SANDBOX/runtime.env"
grep -v '^I00_PUBLIC_SOURCE_STARTUP_EGRESS=' "$SANDBOX/runtime.env" > "$SANDBOX/missing.env"
assert_rc 1 node "$I00_ROOT/bin/validate-config.mjs" --env "$SANDBOX/missing.env"
sed 's/I00_PUBLIC_SOURCE_STARTUP_EGRESS=1/I00_PUBLIC_SOURCE_STARTUP_EGRESS=0/' \
  "$SANDBOX/runtime.env" > "$SANDBOX/invalid.env"
assert_rc 1 node "$I00_ROOT/bin/validate-config.mjs" --env "$SANDBOX/invalid.env"
cp "$SANDBOX/runtime.env" "$SANDBOX/conflict.env"
printf 'I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES=1\n' >> "$SANDBOX/conflict.env"
assert_rc 1 node "$I00_ROOT/bin/validate-config.mjs" --env "$SANDBOX/conflict.env"

note "isolated deploy probe receives exact admission and no offline override"
export COSMOS_ROOT="$SANDBOX/opt"
export RELEASES_DIR="$COSMOS_ROOT/releases"
export CURRENT_LINK="$COSMOS_ROOT/current"
export PREVIOUS_LINK="$COSMOS_ROOT/previous"
export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export APP_UNIT=df32-fixture-app.service
APP_PORT="$(pick_port)"
export PROBE_PORT="$(pick_port)"
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
export READINESS_GATE_PATHS="/health/live /health/ready"
export POST_SWITCH_GATE_PATHS="/health/live /health/ready"
export GATE_TIMEOUT_SEC=4
export LOCK_TIMEOUT_SEC=2
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
: > "$MOCK_SYSTEMCTL_LOG"
export EXPOSURE_CMD="printf NONE"
export PROBE_CAPTURE="$SANDBOX/probe-env.txt"
export PROBE_CMD='printf "%s|%s\n" "${I00_PUBLIC_SOURCE_STARTUP_EGRESS-}" "${I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES-unset}" > "'"$PROBE_CAPTURE"'"; BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node '"$FIXTURES"'/fake-app.mjs'

start_fake_app "$APP_PORT" "$CURRENT_LINK/runtime-behavior.env" >/dev/null
bash "$FIXTURES/make-release.sh" "$SANDBOX/release-a" rel-cs03-a 1 false
assert_rc 0 bash "$BIN/deploy.sh" --release "$SANDBOX/release-a"
assert_eq "$(cat "$PROBE_CAPTURE")" '1|unset' "probe admission environment"

note "deploy refuses inherited deterministic-offline mode before probing"
bash "$FIXTURES/make-release.sh" "$SANDBOX/release-b" rel-cs03-b 1 false
rm -f "$PROBE_CAPTURE"
assert_rc 1 env I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES=1 \
  bash "$BIN/deploy.sh" --release "$SANDBOX/release-b"
assert_no_file "$PROBE_CAPTURE"

finish
