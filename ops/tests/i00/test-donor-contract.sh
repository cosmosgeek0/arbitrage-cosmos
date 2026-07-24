#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

REAL_NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
MALICIOUS_GIT_BIN="$TEST_TMP/malicious-git-bin"
GIT_INVOCATION_MARKER="$TEST_TMP/ambient-git-invoked"
mkdir "$MALICIOUS_GIT_BIN"
printf '%s\n' '#!/bin/sh' \
  'printf "ambient Git invoked\n" > "${GIT_INVOCATION_MARKER:?}"' \
  'exit 97' > "$MALICIOUS_GIT_BIN/git"
chmod 700 "$MALICIOUS_GIT_BIN/git"

note "contract-only verification remains Git-free"
CONTRACT_ONLY="$(env PATH="$MALICIOUS_GIT_BIN" GIT_INVOCATION_MARKER="$GIT_INVOCATION_MARKER" \
  "$REAL_NODE" "$I00_ROOT/bin/verify-donor.mjs" --contract-only)"
assert_contains "$CONTRACT_ONLY" 'ACCEPTED_DONOR_CONTRACT_VERIFIED'
assert_not_file "$GIT_INVOCATION_MARKER"

note "donor verifier rejects raw relative, dot, and symlink repo and contract operands"
ln -s "$REPO_ROOT" "$TEST_TMP/repo-alias"
assert_failure_contains '--repo must be one exact raw canonical absolute directory path' \
  node "$I00_ROOT/bin/verify-donor.mjs" --repo relative/repo
assert_failure_contains '--repo must be one exact raw canonical absolute directory path' \
  node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT/."
assert_failure_contains '--repo must be one exact physical canonical non-symlink directory' \
  node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/repo-alias"

ln -s "$I00_ROOT/donor-contract.json" "$TEST_TMP/donor-contract-alias.json"
assert_failure_contains '--contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --contract relative/donor-contract.json --contract-only
assert_failure_contains '--contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --contract "$I00_ROOT/./donor-contract.json" --contract-only
assert_failure_contains '--contract must be one exact physical canonical non-symlink file' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --contract "$TEST_TMP/donor-contract-alias.json" --contract-only

ln -s "$I00_ROOT/l15-amendment-contract.json" "$TEST_TMP/amendment-contract-alias.json"
assert_failure_contains \
  '--amendment-contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --amendment-contract relative/l15-amendment-contract.json --contract-only
assert_failure_contains \
  '--amendment-contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --amendment-contract "$I00_ROOT/./l15-amendment-contract.json" --contract-only
assert_failure_contains \
  '--amendment-contract must be one exact physical canonical non-symlink file' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --amendment-contract "$TEST_TMP/amendment-contract-alias.json" --contract-only

note "exact accepted donor object and trees use one rechecked fixed-path Git executable"
OUT="$(env PATH="$MALICIOUS_GIT_BIN" GIT_INVOCATION_MARKER="$GIT_INVOCATION_MARKER" \
  "$REAL_NODE" "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT")"
assert_contains "$OUT" 'ACCEPTED_DONOR_VERIFIED'
assert_contains "$OUT" "$DONOR_SHA"
assert_contains "$OUT" '"gitExecutable":{"path":'
assert_not_file "$GIT_INVOCATION_MARKER"
DONOR_VERIFIER_SOURCE="$(<"$I00_ROOT/bin/verify-donor.mjs")"
assert_contains "$DONOR_VERIFIER_SOURCE" 'requireSameGitExecutable'
assert_contains "$DONOR_VERIFIER_SOURCE" 'env: GIT_ENV'
if grep -F "execFileSync('git'" "$I00_ROOT/bin/verify-donor.mjs" >/dev/null; then
  fail_test "donor verifier retains ambient Git execution"
fi
pass_assertion
assert_eq "$(git -C "$REPO_ROOT" rev-parse "$DONOR_SHA:ops/live")" 584163858a0333cb1ccb9eff756e91a851b1cb71
assert_eq "$(git -C "$REPO_ROOT" rev-parse "$DONOR_SHA:ops/tests")" f3348a74ef22d9ca2faee431ea8cc5df63f552af

note "fan-in proof accepts additive integration paths but rejects donor-byte drift"
INTEGRATED="$(node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT" --integrated)"
assert_contains "$INTEGRATED" 'INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED'
assert_contains "$INTEGRATED" '"integratedDonorTestFiles":17'
assert_contains "$INTEGRATED" '"authorizedCorrectionFindingIds":["R3-D-WATCHDOG-007","R3-D-BACKUP-008","CS-03","RB-27","FIX-031-CS-06","DEPLOY-READINESS-001","FIRST-HOST-001","DEPLOY-PORTABILITY-008"]'
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/integrated-repo"
mkdir -p "$TEST_TMP/integrated-repo/ops/tests/i00" "$TEST_TMP/integrated-repo/server"
printf 'accepted fan-in additive proof\n' > "$TEST_TMP/integrated-repo/ops/tests/i00/additive-proof.txt"
printf 'accepted fan-in shared wiring\n' > "$TEST_TMP/integrated-repo/server/additive-proof.txt"
assert_success node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated
printf '\n# forbidden donor drift\n' >> "$TEST_TMP/integrated-repo/ops/live/bin/deploy.sh"
assert_failure_contains 'integrated effective ops/live working bytes or mode differ' node "$I00_ROOT/bin/verify-donor.mjs" --repo "$TEST_TMP/integrated-repo" --integrated

note "integrated verifier rejects hidden index bits, ignored entries, mode drift, and empty directories"
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/assume-unchanged-repo"
git -C "$TEST_TMP/assume-unchanged-repo" update-index \
  --assume-unchanged ops/live/bin/deploy.sh
printf '\n# hidden assume-unchanged drift\n' \
  >> "$TEST_TMP/assume-unchanged-repo/ops/live/bin/deploy.sh"
assert_failure_contains 'working bytes or mode differ from the exact committed binding' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/assume-unchanged-repo" --integrated

git clone -q --shared "$REPO_ROOT" "$TEST_TMP/skip-worktree-repo"
git -C "$TEST_TMP/skip-worktree-repo" update-index \
  --skip-worktree ops/tests/test-secret-scanner.sh
printf '\n# hidden skip-worktree drift\n' \
  >> "$TEST_TMP/skip-worktree-repo/ops/tests/test-secret-scanner.sh"
assert_failure_contains 'working bytes or mode differ from the exact committed binding' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/skip-worktree-repo" --integrated

git clone -q --shared "$REPO_ROOT" "$TEST_TMP/ignored-live-repo"
printf 'ops/live/ignored-extra.txt\n' \
  >> "$TEST_TMP/ignored-live-repo/.git/info/exclude"
printf 'ignored hostile bytes\n' \
  > "$TEST_TMP/ignored-live-repo/ops/live/ignored-extra.txt"
assert_failure_contains 'working bytes are dirty or untracked' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/ignored-live-repo" --integrated

git clone -q --shared "$REPO_ROOT" "$TEST_TMP/empty-live-repo"
mkdir "$TEST_TMP/empty-live-repo/ops/live/ignored-empty"
assert_failure_contains 'working bytes are dirty or untracked' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/empty-live-repo" --integrated

git clone -q --shared "$REPO_ROOT" "$TEST_TMP/filemode-repo"
git -C "$TEST_TMP/filemode-repo" config core.filemode false
chmod -x "$TEST_TMP/filemode-repo/ops/live/bin/deploy.sh"
assert_failure_contains 'working bytes or mode differ from the exact committed binding' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/filemode-repo" --integrated

note "integrated verifier neutralizes fsmonitor, replacement refs, hooks, and external diff"
git clone -q --shared "$REPO_ROOT" "$TEST_TMP/git-config-repo"
FSMONITOR_MARKER="$TEST_TMP/fsmonitor-invoked"
FSMONITOR_HOOK="$TEST_TMP/hostile-fsmonitor"
printf '%s\n' '#!/bin/sh' "printf invoked > '$FSMONITOR_MARKER'" 'exit 97' > "$FSMONITOR_HOOK"
chmod 700 "$FSMONITOR_HOOK"
git -C "$TEST_TMP/git-config-repo" config core.fsmonitor "$FSMONITOR_HOOK"
assert_success node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/git-config-repo" --integrated
assert_not_file "$FSMONITOR_MARKER"
git -C "$TEST_TMP/git-config-repo" config --unset core.fsmonitor

git -C "$TEST_TMP/git-config-repo" replace "$DONOR_SHA" \
  "$(git -C "$TEST_TMP/git-config-repo" rev-parse HEAD)"
assert_success node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/git-config-repo" --integrated
git -C "$TEST_TMP/git-config-repo" replace -d "$DONOR_SHA" >/dev/null

EXTERNAL_DIFF_MARKER="$TEST_TMP/external-diff-invoked"
EXTERNAL_DIFF_HOOK="$TEST_TMP/hostile-external-diff"
printf '%s\n' '#!/bin/sh' "printf invoked > '$EXTERNAL_DIFF_MARKER'" 'exit 0' \
  > "$EXTERNAL_DIFF_HOOK"
chmod 700 "$EXTERNAL_DIFF_HOOK"
git -C "$TEST_TMP/git-config-repo" config diff.external "$EXTERNAL_DIFF_HOOK"
git -C "$TEST_TMP/git-config-repo" config diff.trustExitCode true
printf '\n# donor-test worktree drift\n' \
  >> "$TEST_TMP/git-config-repo/ops/tests/test-secret-scanner.sh"
assert_failure_contains 'working bytes or mode differ from the exact committed binding' \
  node "$I00_ROOT/bin/verify-donor.mjs" \
  --repo "$TEST_TMP/git-config-repo" --integrated
assert_not_file "$EXTERNAL_DIFF_MARKER"

assert_contains "$DONOR_VERIFIER_SOURCE" "'core.fsmonitor=false'"
assert_contains "$DONOR_VERIFIER_SOURCE" "'core.hooksPath=/dev/null'"
assert_contains "$DONOR_VERIFIER_SOURCE" 'GIT_NO_REPLACE_OBJECTS'
assert_contains "$DONOR_VERIFIER_SOURCE" "'--no-ext-diff'"
if [ "$(uname -s)" = "Darwin" ]; then
  BOUND_GIT_PATH="$(node -e \
    'process.stdout.write(JSON.parse(process.argv[1]).gitExecutable.path)' "$INTEGRATED")"
  assert_eq "$BOUND_GIT_PATH" "$(xcode-select --print-path)/usr/bin/git"
  [ "$BOUND_GIT_PATH" != "/usr/bin/git" ] \
    || fail_test "Darwin Git dispatcher was accepted as the implementation"
  pass_assertion
  assert_contains "$INTEGRATED" '"darwinDeveloperSelection":{"directory":'
  assert_contains "$DONOR_VERIFIER_SOURCE" \
    'active Darwin developer directory changed around Git use'
fi

note "immutable donor root and corrected effective root remain distinct exact contracts"
materialize_donor "$TEST_TMP/accepted-root"
assert_success node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/accepted-root/ops/live" --accepted-only
assert_failure node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/accepted-root/ops/live"
materialize_effective_l15 "$TEST_TMP/effective-root"
assert_success node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live"
note "donor-root verifier rejects raw relative, dot, and symlink root and contract operands"
ln -s "$TEST_TMP/effective-root/ops/live" "$TEST_TMP/effective-live-alias"
ln -s "$TEST_TMP/effective-root/ops" "$TEST_TMP/effective-ops-parent-alias"
assert_failure_contains '--root must be one exact raw canonical absolute directory path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" --root relative/live
assert_failure_contains '--root must be one exact raw canonical absolute directory path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live/."
assert_failure_contains '--root must be one exact physical canonical non-symlink directory' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" --root "$TEST_TMP/effective-live-alias"
assert_failure_contains '--root must be one exact physical canonical non-symlink directory' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-ops-parent-alias/live"

direct_effective_l15_verify() {
  node --input-type=module - \
    "$I00_ROOT/l15-amendment.mjs" \
    "$I00_ROOT/l15-amendment-contract.json" "$1" <<'EOF'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [modulePath, contractPath, root] = process.argv.slice(2);
const { loadL15AmendmentContract, verifyEffectiveL15Root } = await import(
  pathToFileURL(modulePath).href
);
const expectedSha256 = createHash('sha256').update(readFileSync(contractPath)).digest('hex');
const loadedContract = loadL15AmendmentContract(contractPath, expectedSha256);
verifyEffectiveL15Root({ root, loadedContract });
EOF
}
assert_failure_contains \
  'executed effective L15 root must be one exact raw canonical absolute directory path' \
  direct_effective_l15_verify relative/live
assert_failure_contains \
  'executed effective L15 root must be one exact raw canonical absolute directory path' \
  direct_effective_l15_verify "$TEST_TMP/effective-root/ops/live/."
assert_failure_contains \
  'executed effective L15 root must be one exact physical canonical non-symlink directory' \
  direct_effective_l15_verify "$TEST_TMP/effective-ops-parent-alias/live"

assert_failure_contains '--contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --contract relative/donor-contract.json
assert_failure_contains '--contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --contract "$I00_ROOT/./donor-contract.json"
assert_failure_contains '--contract must be one exact physical canonical non-symlink file' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --contract "$TEST_TMP/donor-contract-alias.json"

assert_failure_contains \
  '--amendment-contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --amendment-contract relative/l15-amendment-contract.json
assert_failure_contains \
  '--amendment-contract must be one exact raw canonical absolute file path' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --amendment-contract "$I00_ROOT/./l15-amendment-contract.json"
assert_failure_contains \
  '--amendment-contract must be one exact physical canonical non-symlink file' \
  node "$I00_ROOT/bin/verify-donor-root.mjs" \
  --root "$TEST_TMP/effective-root/ops/live" \
  --amendment-contract "$TEST_TMP/amendment-contract-alias.json"

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
