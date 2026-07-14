#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "exact accepted donor object and trees"
OUT="$(node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT")"
assert_contains "$OUT" 'ACCEPTED_DONOR_VERIFIED'
assert_contains "$OUT" "$DONOR_SHA"
assert_eq "$(git -C "$REPO_ROOT" rev-parse "$DONOR_SHA:ops/live")" 584163858a0333cb1ccb9eff756e91a851b1cb71
assert_eq "$(git -C "$REPO_ROOT" rev-parse "$DONOR_SHA:ops/tests")" f3348a74ef22d9ca2faee431ea8cc5df63f552af

note "fan-in proof accepts additive integration paths but rejects donor-byte drift"
INTEGRATED="$(node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT" --integrated)"
assert_contains "$INTEGRATED" 'INTEGRATED_ACCEPTED_DONOR_VERIFIED'
assert_contains "$INTEGRATED" '"integratedDonorTestFiles":17'
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/integrated-repo"
mkdir -p "$TEST_TMP/integrated-repo/ops/tests/i00" "$TEST_TMP/integrated-repo/server"
printf 'accepted fan-in additive proof\n' > "$TEST_TMP/integrated-repo/ops/tests/i00/additive-proof.txt"
printf 'accepted fan-in shared wiring\n' > "$TEST_TMP/integrated-repo/server/additive-proof.txt"
assert_success node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated
printf '\n# forbidden donor drift\n' >> "$TEST_TMP/integrated-repo/ops/live/bin/deploy.sh"
assert_failure_contains 'integrated ops/live working bytes are dirty or untracked' node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated

note "donor suite from read-only Git archive"
materialize_donor "$TEST_TMP/donor"
DONOR_LOG="$TEST_TMP/donor.log"
bash "$TEST_TMP/donor/ops/tests/run-all.sh" >"$DONOR_LOG" 2>&1
assert_contains "$(tail -4 "$DONOR_LOG")" 'ops/tests summary: 11 passed, 0 failed'
COUNT="$(sed -n 's/^OK (\([0-9][0-9]*\) assertions)$/\1/p' "$DONOR_LOG" | awk '{sum += $1} END {print sum + 0}')"
assert_eq "$COUNT" 347
assert_eq "$(grep -c '^OK ([0-9][0-9]* assertions)$' "$DONOR_LOG")" 11
finish
