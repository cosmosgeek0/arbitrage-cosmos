#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

BASE="$TEST_TMP/deploy.env"
cat > "$BASE" <<'ENV'
COSMOS_ROOT=/opt/cosmos
RELEASES_DIR=/opt/cosmos/releases
CURRENT_LINK=/opt/cosmos/current
PREVIOUS_LINK=/opt/cosmos/previous
DATA_DIR=/var/lib/cosmos/data
OPS_STATE_DIR=/var/lib/cosmos/ops
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
PROBE_ENABLED=1
PROBE_PORT=8091
PROBE_BASE=http://127.0.0.1:8091
READINESS_GATE_PATHS="/health/live /health/ready"
POST_SWITCH_GATE_PATHS="/health/live /health/ready"
FROZEN_MARKER=/var/lib/cosmos/ops/deploy-frozen.json
MONEY_READY_MARKER=/var/lib/cosmos/ops/money-ready
EXPOSURE_CMD=
I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback
ALERT_CMD=/usr/local/lib/cosmos-ops/bin/alert-log.sh
ENV

note "production sanitizer emits one canonical effective health/probe/marker contract"
OUT="$TEST_TMP/sanitized.env"
assert_success node "$I00_ROOT/bin/sanitize-donor-env.mjs" --env "$BASE" --output "$OUT" --profile deploy
assert_contains "$(cat "$OUT")" "HEALTH_BASE='http://127.0.0.1:8080'"
assert_contains "$(cat "$OUT")" "PROBE_ENABLED='1'"
assert_contains "$(cat "$OUT")" "PROBE_BASE='http://127.0.0.1:8091'"
assert_contains "$(cat "$OUT")" "READINESS_GATE_PATHS='/health/live /health/ready'"
assert_contains "$(cat "$OUT")" "POST_SWITCH_GATE_PATHS='/health/live /health/ready'"
assert_contains "$(cat "$OUT")" "FROZEN_MARKER='/var/lib/cosmos/ops/deploy-frozen.json'"
assert_contains "$(cat "$OUT")" "MONEY_READY_MARKER='/var/lib/cosmos/ops/money-ready'"
assert_contains "$(cat "$OUT")" "EXPOSURE_CMD='/usr/bin/node /usr/local/lib/cosmos-ops/i00/bin/exposure-from-app.mjs'"
assert_contains "$(cat "$OUT")" "I00_OPS_READBACK_URL='http://127.0.0.1:8080/api/system-integration/ops/readback'"

MINIMAL="$TEST_TMP/minimal.env"
grep -Ev '^(PROBE_ENABLED|PROBE_BASE|READINESS_GATE_PATHS|POST_SWITCH_GATE_PATHS|FROZEN_MARKER|MONEY_READY_MARKER)=' "$BASE" > "$MINIMAL"
MINIMAL_OUT="$TEST_TMP/minimal-sanitized.env"
assert_success node "$I00_ROOT/bin/sanitize-donor-env.mjs" --env "$MINIMAL" --output "$MINIMAL_OUT" --profile deploy
for exact in \
  "PROBE_ENABLED='1'" \
  "PROBE_BASE='http://127.0.0.1:8091'" \
  "READINESS_GATE_PATHS='/health/live /health/ready'" \
  "POST_SWITCH_GATE_PATHS='/health/live /health/ready'" \
  "FROZEN_MARKER='/var/lib/cosmos/ops/deploy-frozen.json'" \
  "MONEY_READY_MARKER='/var/lib/cosmos/ops/money-ready'"; do
  assert_contains "$(cat "$MINIMAL_OUT")" "$exact"
done

CASE_NUMBER=0
reject_line() {
  local key="$1" replacement="$2" expected="$3"
  CASE_NUMBER=$((CASE_NUMBER + 1))
  local input="$TEST_TMP/rejected-$CASE_NUMBER.env" output="$TEST_TMP/rejected-$CASE_NUMBER.out"
  awk -v key="$key" -v replacement="$replacement" '
    index($0, key "=") == 1 { print replacement; found=1; next }
    { print }
    END { if (!found) exit 2 }
  ' "$BASE" > "$input"
  assert_failure_contains "$expected" node "$I00_ROOT/bin/sanitize-donor-env.mjs" --env "$input" --output "$output" --profile deploy
  assert_not_file "$output"
}

note "hostile bases, gate weakening, disabled probes, and marker aliases are rejected"
reject_line HEALTH_BASE 'HEALTH_BASE=http://localhost:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=http://0.0.0.0:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=https://127.0.0.1:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=http://127.0.0.1:8080/' 'not canonically encoded'
reject_line HEALTH_BASE 'HEALTH_BASE=http://127.0.0.1:8080?gate=weak' 'contains executable or ambiguous shell syntax'
reject_line PROBE_BASE 'PROBE_BASE=http://127.0.0.1:8092' 'must match the numeric-loopback probe port'
reject_line PROBE_BASE 'PROBE_BASE=http://192.0.2.10:8091' 'exact numeric-loopback HTTP origin'
reject_line PROBE_ENABLED 'PROBE_ENABLED=0' 'must keep the pre-switch probe enabled'
reject_line PROBE_PORT 'PROBE_PORT=8080' 'must differ from the production HEALTH_BASE port'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS=/health/live' 'exact liveness and semantic-readiness gates'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS="/health/live /health/trade-ready"' 'exact liveness and semantic-readiness gates'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS="/health/ready /health/live"' 'exact liveness and semantic-readiness gates'
reject_line POST_SWITCH_GATE_PATHS 'POST_SWITCH_GATE_PATHS=/health/live' 'exact liveness and semantic-readiness gates'
reject_line FROZEN_MARKER 'FROZEN_MARKER=/tmp/deploy-frozen.json' 'canonical ops-state directory'
reject_line MONEY_READY_MARKER 'MONEY_READY_MARKER=/tmp/money-ready' 'canonical ops-state directory'
reject_line OPS_STATE_DIR 'OPS_STATE_DIR=/var/lib/cosmos/ops/../other' 'canonical absolute directory'
reject_line EXPOSURE_CMD 'EXPOSURE_CMD=/tmp/print-none' 'installed bounded readback client'
reject_line I00_OPS_READBACK_URL 'I00_OPS_READBACK_URL=http://127.0.0.1:9090/api/system-integration/ops/readback' 'authenticated numeric-loopback app origin'
finish
