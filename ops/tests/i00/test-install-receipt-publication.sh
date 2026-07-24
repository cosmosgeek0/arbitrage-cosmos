#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"
TEST_TMP="$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$TEST_TMP")"

PUBLISHER="$I00_ROOT/bin/publish-install-receipt.mjs"
TREE_PUBLISHER="$I00_ROOT/bin/publish-install-tree.mjs"
REAL_NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
SIMULATION_ROOT="$("$REAL_NODE" "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-install-receipt-$$")"
SHA=0123456789abcdef0123456789abcdef01234567
DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
VALIDATION_JSON="{\"testedSha\":\"$SHA\",\"releaseId\":\"i00-$SHA\"}"
L15_JSON='{"immutableDonorCommit":"commit-fixture","immutableDonorLiveTree":"tree-fixture","immutableDonorContractSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","amendmentContractSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","effectiveLiveTree":"effective-fixture","effectiveRootDigestSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","findingIds":["DF-32"]}'

bind_command() {
  local command_path
  command_path="$(command -v "$1")"
  command_path="$("$REAL_NODE" -e \
    'process.stdout.write(require("fs").realpathSync(process.argv[1]))' \
    "$command_path")"
  "$REAL_NODE" "$I00_ROOT/bin/inspect-executable.mjs" --path "$command_path"
}

MKDIR_BINDING="$(bind_command mkdir)"
MV_BINDING="$(bind_command mv)"
RM_BINDING="$(bind_command rm)"

tree_helper() {
  "$REAL_NODE" "$TREE_PUBLISHER" \
    --destination "$1" \
    --mkdir-binding "$MKDIR_BINDING" \
    --mv-binding "$MV_BINDING" \
    --rm-binding "$RM_BINDING" \
    --simulation \
    --simulation-root "$SIMULATION_ROOT" \
    "${@:2}"
}

create_staging() {
  local label="$1" parent="$SIMULATION_ROOT/$1-parent" claim_json
  mkdir "$parent"
  chmod 700 "$parent"
  claim_json="$(tree_helper "$parent/i00" \
    --operation claim --staging-name "i00.partial.$label")"
  "$REAL_NODE" -e \
    'process.stdout.write(JSON.parse(process.argv[1]).staging)' \
    "$claim_json"
}

run_publisher() {
  node "$PUBLISHER" \
    --root "$1" \
    --simulation \
    --simulation-root "$SIMULATION_ROOT" \
    --validation-json "$VALIDATION_JSON" \
    --l15-json "$L15_JSON" \
    --i00-enforcement-tree-digest-sha256 "$DIGEST"
}

note "DEPLOY-PORTABILITY-008: install receipt is exact-created with private durable bytes"
POSITIVE_ROOT="$(create_staging positive)"
PUBLISH_OUT="$(run_publisher "$POSITIVE_ROOT")"
assert_contains "$PUBLISH_OUT" INSTALL_RECEIPT_PUBLISHED_CREATE_ONLY
assert_file "$POSITIVE_ROOT/install-receipt.json"
RECEIPT_MODE="$(stat -c '%a' "$POSITIVE_ROOT/install-receipt.json" 2>/dev/null \
  || stat -f '%Lp' "$POSITIVE_ROOT/install-receipt.json")"
assert_eq "$RECEIPT_MODE" 600
RECEIPT_OWNER="$(stat -c '%u' "$POSITIVE_ROOT/install-receipt.json" 2>/dev/null \
  || stat -f '%u' "$POSITIVE_ROOT/install-receipt.json")"
assert_eq "$RECEIPT_OWNER" "$(id -u)"
assert_success node - "$POSITIVE_ROOT/install-receipt.json" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const bytes = fs.readFileSync(path);
const document = JSON.parse(bytes);
if (!bytes.equals(Buffer.from(`${JSON.stringify(document, null, 2)}\n`))) process.exit(1);
if (document.schemaVersion !== 2
    || document.serviceMutationPerformed !== false
    || document.effectiveOpsRoot !== 'accepted-ops-live') process.exit(1);
NODE

note "DEPLOY-PORTABILITY-008: preexisting receipt is never replaced or truncated"
BEFORE_SHA="$(shasum -a 256 "$POSITIVE_ROOT/install-receipt.json" | awk '{print $1}')"
set +e
REUSE_OUT="$(run_publisher "$POSITIVE_ROOT" 2>&1)"
REUSE_RC=$?
set -e
[ "$REUSE_RC" -ne 0 ] || fail_test "preexisting install receipt was accepted"
pass_assertion
assert_contains "$REUSE_OUT" 'install receipt target must be absent'
if printf '%s' "$REUSE_OUT" | grep -F INSTALL_RECEIPT_PUBLISHED_CREATE_ONLY >/dev/null; then
  fail_test "failed install receipt reuse emitted a success status"
fi
pass_assertion
assert_eq "$(shasum -a 256 "$POSITIVE_ROOT/install-receipt.json" | awk '{print $1}')" "$BEFORE_SHA"

note "DEPLOY-PORTABILITY-008: preexisting symlink is rejected without target mutation"
SYMLINK_ROOT="$(create_staging symlink)"
OUTSIDE="$TEST_TMP/outside-sentinel"
printf 'sentinel\n' > "$OUTSIDE"
ln -s "$OUTSIDE" "$SYMLINK_ROOT/install-receipt.json"
assert_failure_contains 'install receipt target must be absent' \
  run_publisher "$SYMLINK_ROOT"
assert_eq "$(<"$OUTSIDE")" sentinel
assert_eq "$(readlink "$SYMLINK_ROOT/install-receipt.json")" "$OUTSIDE"

note "DEPLOY-PORTABILITY-008: unsafe or aliased parent is rejected before publication"
UNSAFE_ROOT="$(create_staging unsafe)"
chmod 755 "$UNSAFE_ROOT"
assert_failure_contains 'install receipt parent must be one canonical private directory' \
  run_publisher "$UNSAFE_ROOT"
assert_not_file "$UNSAFE_ROOT/install-receipt.json"
chmod 700 "$UNSAFE_ROOT"
PRIVATE_ROOT="$(create_staging private)"
ALIASED_ROOT="$TEST_TMP/aliased-root"
ln -s "$PRIVATE_ROOT" "$ALIASED_ROOT"
assert_failure_contains 'TEST install-receipt root must remain below the marked simulation root' \
  run_publisher "$ALIASED_ROOT"
assert_not_file "$PRIVATE_ROOT/install-receipt.json"

note "DEPLOY-PORTABILITY-008: mode, marked root, and staging claim close every write root"
SYSTEM_ROOT="$(create_staging system-refusal)"
assert_failure_contains 'SYSTEM install-receipt staging parent must be exact' \
  node "$PUBLISHER" \
    --root "$SYSTEM_ROOT" \
    --validation-json "$VALIDATION_JSON" \
    --l15-json "$L15_JSON" \
    --i00-enforcement-tree-digest-sha256 "$DIGEST"
assert_not_file "$SYSTEM_ROOT/install-receipt.json"
MISSING_ROOT="$(create_staging missing-root)"
assert_failure_contains 'requires explicit --simulation-root' \
  node "$PUBLISHER" \
    --root "$MISSING_ROOT" \
    --simulation \
    --validation-json "$VALIDATION_JSON" \
    --l15-json "$L15_JSON" \
    --i00-enforcement-tree-digest-sha256 "$DIGEST"
assert_not_file "$MISSING_ROOT/install-receipt.json"
OTHER_SIMULATION_ROOT="$("$REAL_NODE" "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-install-receipt-other-$$")"
WRONG_ROOT="$(create_staging wrong-root)"
assert_failure_contains 'must remain below the marked simulation root' \
  node "$PUBLISHER" \
    --root "$WRONG_ROOT" \
    --simulation \
    --simulation-root "$OTHER_SIMULATION_ROOT" \
    --validation-json "$VALIDATION_JSON" \
    --l15-json "$L15_JSON" \
    --i00-enforcement-tree-digest-sha256 "$DIGEST"
assert_not_file "$WRONG_ROOT/install-receipt.json"
UNCLAIMED_ROOT="$SIMULATION_ROOT/unclaimed-root"
mkdir "$UNCLAIMED_ROOT"
chmod 700 "$UNCLAIMED_ROOT"
assert_failure_contains 'install-tree claim' run_publisher "$UNCLAIMED_ROOT"
assert_not_file "$UNCLAIMED_ROOT/install-receipt.json"

note "DEPLOY-PORTABILITY-008: substituted staging identity cannot receive a receipt"
SUBSTITUTED_ROOT="$(create_staging substituted)"
SUBSTITUTED_DISPLACED="$SUBSTITUTED_ROOT.displaced"
mv "$SUBSTITUTED_ROOT" "$SUBSTITUTED_DISPLACED"
mkdir "$SUBSTITUTED_ROOT"
chmod 700 "$SUBSTITUTED_ROOT"
assert_failure_contains 'does not bind this exact install-receipt publication' \
  run_publisher "$SUBSTITUTED_ROOT"
assert_not_file "$SUBSTITUTED_ROOT/install-receipt.json"
rmdir "$SUBSTITUTED_ROOT"
mv "$SUBSTITUTED_DISPLACED" "$SUBSTITUTED_ROOT"

note "DEPLOY-PORTABILITY-008: installer delegates receipt publication to the hardened writer"
INSTALL_SOURCE="$(<"$I00_ROOT/bin/install-ops-bundle.sh")"
PUBLISHER_SOURCE="$(<"$PUBLISHER")"
assert_contains "$INSTALL_SOURCE" 'publish-install-receipt.mjs'
assert_contains "$INSTALL_SOURCE" 'umask 077'
assert_not_file "$TEST_TMP/nonexistent-proof"
for token in O_EXCL O_NOFOLLOW O_DIRECTORY '/proc/self/fd/' \
  fsyncSync readSync 'install receipt named identity' \
  'SYSTEM install-receipt staging parent must be exact' \
  'validateSimulationRoot' 'install-tree claim identity'; do
  assert_contains "$PUBLISHER_SOURCE" "$token"
done
if grep -F 'writeFileSync(resolve(root, "install-receipt.json")' \
    "$I00_ROOT/bin/install-ops-bundle.sh" >/dev/null; then
  fail_test "installer retains truncating pathname receipt publication"
fi
pass_assertion

finish
