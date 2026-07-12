#!/usr/bin/env bash
# ops/tests/test-latency-bench.sh — the L-B harness is safe-by-default and
# measures correctly against loopback when explicitly double-authorized.
. "$(dirname "$0")/helpers.sh"

BENCH="$BIN/latency-bench.mjs"
TEMPLATE="$OPS_LIVE/bench/targets.json.template"

note "1. plan mode: valid JSON, no network, all 7 chain stages named"
PLAN="$SANDBOX/plan.json"
assert_rc 0 node "$BENCH" --plan --targets "$TEMPLATE" --out "$PLAN"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(r.mode)' "$PLAN")" plan "plan mode"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(r.chainStages.length)' "$PLAN")" 7 "chain stages"
assert_grep 'acknowledgement_to_private_stream_confirmation' "$PLAN" "last L-B stage present"
assert_grep 'REPLACE_ME_' "$PLAN" "template placeholders flow through untouched"

note "2. run mode refuses without --confirm-network AND OPS_ALLOW_NETWORK=1"
assert_rc 2 node "$BENCH" --run --targets "$TEMPLATE"
assert_rc 2 node "$BENCH" --run --confirm-network --targets "$TEMPLATE"
assert_rc 2 env OPS_ALLOW_NETWORK=1 node "$BENCH" --run --targets "$TEMPLATE"

note "3. non-http(s) schemes and malformed targets refused"
echo '{"targets":[{"label":"x","url":"ftp://127.0.0.1/x"}]}' > "$SANDBOX/bad.json"
assert_rc 2 node "$BENCH" --plan --targets "$SANDBOX/bad.json"
echo '{"targets":[]}' > "$SANDBOX/empty.json"
assert_rc 2 node "$BENCH" --plan --targets "$SANDBOX/empty.json"

note "4. authorized loopback run: sampled phase distributions in the report"
APP_PORT="$(pick_port)"
start_fake_app "$APP_PORT" >/dev/null
cat > "$SANDBOX/local.json" <<EOF
{
  "samplesPerTarget": 3,
  "targets": [ { "label": "loopback", "url": "http://127.0.0.1:$APP_PORT/health/live" } ]
}
EOF
REPORT="$SANDBOX/report.json"
assert_rc 0 env OPS_ALLOW_NETWORK=1 node "$BENCH" --run --confirm-network \
  --targets "$SANDBOX/local.json" --out "$REPORT"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(r.results[0].failures)' "$REPORT")" 0 "no failures"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(typeof r.results[0].phasesMs.total.p50)' "$REPORT")" number "p50 measured"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(r.results[0].phasesMs.total.n)' "$REPORT")" 3 "all samples"

note "5. dead target: failures counted, harness exits 1 when nothing succeeded"
DEAD_PORT="$(pick_port)"
cat > "$SANDBOX/dead.json" <<EOF
{ "samplesPerTarget": 2, "timeoutMs": 1500,
  "targets": [ { "label": "dead", "url": "http://127.0.0.1:$DEAD_PORT/" } ] }
EOF
assert_rc 1 env OPS_ALLOW_NETWORK=1 node "$BENCH" --run --confirm-network \
  --targets "$SANDBOX/dead.json" --out "$SANDBOX/dead-report.json"
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log(r.results[0].failures)' "$SANDBOX/dead-report.json")" 2 "failures counted"

finish
