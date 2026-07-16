#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

SERVER_ROOT="$TEST_TMP/readback-server"
mkdir -p "$SERVER_ROOT"
printf '{"status":503,"body":{"error":"starting"}}\n' > "$SERVER_ROOT/config.json"
node "$TEST_DIR/fixtures/readback-server.mjs" "$SERVER_ROOT" >"$SERVER_ROOT/stdout" 2>"$SERVER_ROOT/stderr" &
SERVER_PID=$!
cleanup_readback_test() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  cleanup_test_tmp
}
trap cleanup_readback_test EXIT
for _ in $(seq 1 100); do
  [ -f "$SERVER_ROOT/address.json" ] && break
  sleep 0.02
done
assert_file "$SERVER_ROOT/address.json"
PORT="$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(v.port))' "$SERVER_ROOT/address.json")"
READBACK_URL="http://127.0.0.1:$PORT/api/system-integration/ops/readback"
CLIENT="$I00_ROOT/bin/exposure-from-app.mjs"

write_valid() {
  local exposure="${1:-NONE}"
  node - "$SERVER_ROOT/config.json" "$exposure" <<'NODE'
const fs = require('fs');
const [path, exposureState] = process.argv.slice(2);
const second = Math.floor(Date.now() / 1_000) * 1_000;
fs.writeFileSync(path, `${JSON.stringify({
  status: 200,
  body: {
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: new Date(second - 1_000).toISOString().replace('.000Z', 'Z'),
    validUntilUtc: new Date(second + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
    deploymentFrozen: false,
    exposureState,
    ambiguityState: exposureState === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NONE',
    recoveryState: exposureState === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : 'NONE',
    currentSchemaVersion: 1,
    rollbackFloor: 1,
  },
})}\n`);
NODE
}

assert_client() {
  local expected="$1" output rc stderr="$TEST_TMP/client-stderr"
  shift
  : > "$stderr"
  set +e
  output="$(env I00_OPS_READBACK_URL="$READBACK_URL" "$@" "$CLIENT" 2>"$stderr")"
  rc=$?
  set -e
  assert_eq "$rc" 0
  assert_eq "$output" "$expected"
  assert_eq "$(cat "$stderr")" ''
}

note "exact current loopback readback emits only the closed exposure enum"
for state in NONE ACTIVE AMBIGUOUS RECOVERY_REQUIRED UNKNOWN; do
  write_valid "$state"
  assert_client "$state"
done

note "URL, response, schema, freshness, and timeout failures emit only UNKNOWN"
write_valid NONE
assert_eq "$(env I00_OPS_READBACK_URL="http://localhost:$PORT/api/system-integration/ops/readback" "$CLIENT")" UNKNOWN
assert_eq "$(env I00_OPS_READBACK_URL="http://127.0.0.1:$PORT/health/live" "$CLIENT")" UNKNOWN
assert_eq "$(env I00_OPS_READBACK_URL='https://example.invalid/api/system-integration/ops/readback' "$CLIENT")" UNKNOWN
assert_eq "$(env I00_OPS_READBACK_URL="$READBACK_URL" "$CLIENT" --caller-override)" UNKNOWN

node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.status=503;fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.contentType="text/plain";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
printf '{"status":200,"body":"not-json"}\n' > "$SERVER_ROOT/config.json"
assert_client UNKNOWN

write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.extra="forbidden";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.source="CALLER_ASSERTED";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.exposureState="CLEAR";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.currentSchemaVersion=Number.MAX_SAFE_INTEGER+1;fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.rollbackFloor=2;fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN

write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.observedAtUtc="2000-01-01T00:00:00Z";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p),t=Math.floor(Date.now()/1000)*1000;v.body.observedAtUtc=new Date(t+60000).toISOString().replace(".000Z","Z");v.body.validUntilUtc=new Date(t+120000).toISOString().replace(".000Z","Z");fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.body.validUntilUtc="2000-01-01T00:00:01Z";fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p),t=Date.parse(v.body.observedAtUtc);v.body.validUntilUtc=new Date(t+60000).toISOString().replace(".000Z","Z");fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN

node -e 'const fs=require("fs"),p=process.argv[1];fs.writeFileSync(p,JSON.stringify({status:200,body:"x".repeat(9000)}));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN
write_valid NONE
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.delayMs=500;fs.writeFileSync(p,JSON.stringify(v));' "$SERVER_ROOT/config.json"
assert_client UNKNOWN I00_OPS_READBACK_TIMEOUT_MS=50
assert_eq "$(cat "$SERVER_ROOT/stderr")" ''
finish
