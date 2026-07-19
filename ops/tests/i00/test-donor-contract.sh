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
assert_contains "$INTEGRATED" 'INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED'
assert_contains "$INTEGRATED" '"integratedDonorTestFiles":17'
assert_contains "$INTEGRATED" '"authorizedCorrectionFindingIds":["R3-D-WATCHDOG-007","R3-D-BACKUP-008","CS-03","RB-27","FIX-031-CS-06","DEPLOY-READINESS-001"]'
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/integrated-repo"
mkdir -p "$TEST_TMP/integrated-repo/ops/tests/i00" "$TEST_TMP/integrated-repo/server"
printf 'accepted fan-in additive proof\n' > "$TEST_TMP/integrated-repo/ops/tests/i00/additive-proof.txt"
printf 'accepted fan-in shared wiring\n' > "$TEST_TMP/integrated-repo/server/additive-proof.txt"
assert_success node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated
printf '\n# forbidden donor drift\n' >> "$TEST_TMP/integrated-repo/ops/live/bin/deploy.sh"
assert_failure_contains 'integrated effective ops/live working bytes are dirty or untracked' node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated

note "immutable donor root and corrected effective root remain distinct exact contracts"
materialize_donor "$TEST_TMP/accepted-root"
assert_success node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/accepted-root/ops/live" --accepted-only
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/accepted-root/ops/live"
materialize_effective_l15 "$TEST_TMP/effective-root"
assert_success node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" --require-immutable
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/immutable-effective-root"
chmod -R a-w "$TEST_TMP/immutable-effective-root"
assert_success node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/immutable-effective-root" --require-immutable

note "full effective inventory rejects noncritical drift, extras, omissions, and unsafe nodes"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/noncritical-drift"
printf '\nunauthorized drift\n' >> "$TEST_TMP/noncritical-drift/README.md"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/noncritical-drift"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/extra-path"
printf 'extra\n' > "$TEST_TMP/extra-path/extra.txt"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/extra-path"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/extra-empty-directory"
mkdir "$TEST_TMP/extra-empty-directory/undeclared-empty"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/extra-empty-directory"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/missing-path"
rm "$TEST_TMP/missing-path/cloudflare/README.md"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/missing-path"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/symlink-path"
rm "$TEST_TMP/symlink-path/cloudflare/README.md"
ln -s ../README.md "$TEST_TMP/symlink-path/cloudflare/README.md"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/symlink-path"
cp -R "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/fifo-path"
rm "$TEST_TMP/fifo-path/cloudflare/README.md"
mkfifo "$TEST_TMP/fifo-path/cloudflare/README.md"
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/fifo-path"

note "amendment manifest and committed undeclared L15 drift fail closed"
cp "$I00_ROOT/l15-amendment-contract.json" "$TEST_TMP/tampered-amendment.json"
printf ' ' >> "$TEST_TMP/tampered-amendment.json"
assert_failure node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT" \
  --amendment-contract "$TEST_TMP/tampered-amendment.json" --integrated
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/undeclared-repo"
printf '\n# undeclared restore drift\n' >> "$TEST_TMP/undeclared-repo/ops/live/bin/restore.sh"
git -C "$TEST_TMP/undeclared-repo" add ops/live/bin/restore.sh
git -C "$TEST_TMP/undeclared-repo" -c user.name=I00 -c user.email=i00@invalid \
  commit -qm 'hostile undeclared drift'
assert_failure node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/undeclared-repo" --integrated

note "donor suite from read-only Git archive"
materialize_donor "$TEST_TMP/donor"
DONOR_LOG="$TEST_TMP/donor.log"
bash "$TEST_TMP/donor/ops/tests/run-all.sh" >"$DONOR_LOG" 2>&1
assert_contains "$(tail -4 "$DONOR_LOG")" 'ops/tests summary: 11 passed, 0 failed'
COUNT="$(sed -n 's/^OK (\([0-9][0-9]*\) assertions)$/\1/p' "$DONOR_LOG" | awk '{sum += $1} END {print sum + 0}')"
assert_eq "$COUNT" 347
assert_eq "$(grep -c '^OK ([0-9][0-9]* assertions)$' "$DONOR_LOG")" 11
finish
