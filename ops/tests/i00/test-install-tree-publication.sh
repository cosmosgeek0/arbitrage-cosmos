#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"
TEST_TMP="$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$TEST_TMP")"

TOOL="$I00_ROOT/bin/publish-install-tree.mjs"
REAL_NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
SIMULATION_ROOT="$("$REAL_NODE" "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-install-tree-$$")"

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

helper() {
  "$REAL_NODE" "$TOOL" \
    --destination "$1" \
    --mkdir-binding "$MKDIR_BINDING" \
    --mv-binding "$MV_BINDING" \
    --rm-binding "$RM_BINDING" \
    --simulation \
    --simulation-root "$SIMULATION_ROOT" \
    "${@:2}"
}

raw_helper() {
  "$REAL_NODE" "$TOOL" \
    --destination "$1" \
    --mkdir-binding "$MKDIR_BINDING" \
    --mv-binding "$MV_BINDING" \
    --rm-binding "$RM_BINDING" \
    "${@:2}"
}

json_field() {
  "$REAL_NODE" -e \
    'process.stdout.write(JSON.parse(process.argv[1])[process.argv[2]])' \
    "$1" "$2"
}

inode_of() {
  stat -c '%i' "$1" 2>/dev/null || stat -f '%i' "$1"
}

mode_of() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

note "DEPLOY-PORTABILITY-008: mutation mode and root are closed before staging creation"
SYSTEM_REFUSAL_PARENT="$SIMULATION_ROOT/system-refusal-parent"
mkdir "$SYSTEM_REFUSAL_PARENT"
chmod 700 "$SYSTEM_REFUSAL_PARENT"
assert_failure_contains 'SYSTEM destination parent must be exact' \
  raw_helper "$SYSTEM_REFUSAL_PARENT/i00" \
  --operation claim --staging-name i00.partial.system-refusal
assert_not_file "$SYSTEM_REFUSAL_PARENT/i00.partial.system-refusal"
MISSING_ROOT_PARENT="$SIMULATION_ROOT/missing-root-parent"
mkdir "$MISSING_ROOT_PARENT"
chmod 700 "$MISSING_ROOT_PARENT"
assert_failure_contains 'TEST publication requires explicit --simulation-root' \
  raw_helper "$MISSING_ROOT_PARENT/i00" --simulation \
  --operation claim --staging-name i00.partial.missing-root
assert_not_file "$MISSING_ROOT_PARENT/i00.partial.missing-root"
UNMARKED_ROOT="$TEST_TMP/unmarked-root"
mkdir "$UNMARKED_ROOT"
chmod 700 "$UNMARKED_ROOT"
assert_failure_contains 'not one canonical marked simulation root' \
  raw_helper "$UNMARKED_ROOT/i00" --simulation \
  --simulation-root "$UNMARKED_ROOT" \
  --operation claim --staging-name i00.partial.unmarked
assert_not_file "$UNMARKED_ROOT/i00.partial.unmarked"
OTHER_SIMULATION_ROOT="$("$REAL_NODE" "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-install-tree-other-$$")"
assert_failure_contains 'must remain below the marked simulation root' \
  raw_helper "$MISSING_ROOT_PARENT/i00" --simulation \
  --simulation-root "$OTHER_SIMULATION_ROOT" \
  --operation claim --staging-name i00.partial.wrong-root
assert_not_file "$MISSING_ROOT_PARENT/i00.partial.wrong-root"

note "DEPLOY-PORTABILITY-008: exact staging claim publishes one durable final tree"
POSITIVE_PARENT="$SIMULATION_ROOT/positive-parent"
POSITIVE_DESTINATION="$POSITIVE_PARENT/i00"
mkdir "$POSITIVE_PARENT"
chmod 700 "$POSITIVE_PARENT"
POSITIVE_CLAIM_JSON="$(helper "$POSITIVE_DESTINATION" \
  --operation claim --staging-name i00.partial.positive)"
assert_contains "$POSITIVE_CLAIM_JSON" INSTALL_TREE_STAGING_CLAIMED
POSITIVE_STAGING="$(json_field "$POSITIVE_CLAIM_JSON" staging)"
POSITIVE_CLAIM="$(json_field "$POSITIVE_CLAIM_JSON" claim)"
assert_eq "$(mode_of "$POSITIVE_STAGING")" 700
printf 'payload\n' > "$POSITIVE_STAGING/payload"
POSITIVE_INODE="$(inode_of "$POSITIVE_STAGING")"
chmod -R a-w "$POSITIVE_STAGING"
chmod go+x "$POSITIVE_STAGING"
assert_contains "$(helper "$POSITIVE_DESTINATION" \
  --operation verify --claim "$POSITIVE_CLAIM")" \
  INSTALL_TREE_STAGING_IDENTITY_VERIFIED
POSITIVE_PUBLISH="$(helper "$POSITIVE_DESTINATION" \
  --operation publish --claim "$POSITIVE_CLAIM")"
assert_contains "$POSITIVE_PUBLISH" INSTALL_TREE_PUBLISHED_DURABLE
assert_contains "$POSITIVE_PUBLISH" '"parentDurability":"FSYNCED"'
assert_file "$POSITIVE_DESTINATION/payload"
assert_eq "$(inode_of "$POSITIVE_DESTINATION")" "$POSITIVE_INODE"
assert_eq "$(mode_of "$POSITIVE_DESTINATION")" 511
assert_not_file "$POSITIVE_STAGING"
assert_not_file "$POSITIVE_CLAIM"

note "DEPLOY-PORTABILITY-008: substituted staging identity is never verified or cleaned"
STAGING_PARENT="$SIMULATION_ROOT/staging-parent"
STAGING_DESTINATION="$STAGING_PARENT/i00"
mkdir "$STAGING_PARENT"
chmod 700 "$STAGING_PARENT"
STAGING_CLAIM_JSON="$(helper "$STAGING_DESTINATION" \
  --operation claim --staging-name i00.partial.substitution)"
STAGING_PATH="$(json_field "$STAGING_CLAIM_JSON" staging)"
STAGING_CLAIM="$(json_field "$STAGING_CLAIM_JSON" claim)"
STAGING_DISPLACED="$STAGING_PATH.displaced"
mv "$STAGING_PATH" "$STAGING_DISPLACED"
mkdir "$STAGING_PATH"
chmod 700 "$STAGING_PATH"
printf 'substitute\n' > "$STAGING_PATH/sentinel"
assert_failure_contains 'named identity differs from its claim' \
  helper "$STAGING_DESTINATION" --operation verify --claim "$STAGING_CLAIM"
assert_failure_contains 'named identity differs from its claim' \
  helper "$STAGING_DESTINATION" --operation cleanup --claim "$STAGING_CLAIM"
assert_file "$STAGING_PATH/sentinel"
assert_file "$STAGING_CLAIM"
rmdir "$STAGING_PATH" 2>/dev/null || {
  rm "$STAGING_PATH/sentinel"
  rmdir "$STAGING_PATH"
}
mv "$STAGING_DISPLACED" "$STAGING_PATH"
assert_contains "$(helper "$STAGING_DESTINATION" \
  --operation cleanup --claim "$STAGING_CLAIM")" \
  INSTALL_TREE_STAGING_CLEANED_EXACT
assert_not_file "$STAGING_PATH"
assert_not_file "$STAGING_CLAIM"

note "DEPLOY-PORTABILITY-008: substituted parent cannot redirect final publication"
PARENT_OUTER="$SIMULATION_ROOT/parent-substitution"
PARENT_PATH="$PARENT_OUTER/held"
PARENT_DISPLACED="$PARENT_OUTER/held.displaced"
PARENT_DESTINATION="$PARENT_PATH/i00"
mkdir -p "$PARENT_PATH"
chmod 700 "$PARENT_OUTER" "$PARENT_PATH"
PARENT_CLAIM_JSON="$(helper "$PARENT_DESTINATION" \
  --operation claim --staging-name i00.partial.parent)"
PARENT_STAGING="$(json_field "$PARENT_CLAIM_JSON" staging)"
PARENT_CLAIM="$(json_field "$PARENT_CLAIM_JSON" claim)"
PARENT_STAGING_INODE="$(inode_of "$PARENT_STAGING")"
mv "$PARENT_PATH" "$PARENT_DISPLACED"
mkdir "$PARENT_PATH"
chmod 700 "$PARENT_PATH"
assert_failure_contains 'install-tree claim is unavailable' \
  helper "$PARENT_DESTINATION" --operation publish --claim "$PARENT_CLAIM"
assert_not_file "$PARENT_DESTINATION"
assert_eq "$(inode_of "$PARENT_DISPLACED/$(basename "$PARENT_STAGING")")" \
  "$PARENT_STAGING_INODE"
rmdir "$PARENT_PATH"
mv "$PARENT_DISPLACED" "$PARENT_PATH"
assert_contains "$(helper "$PARENT_DESTINATION" \
  --operation cleanup --claim "$PARENT_CLAIM")" \
  INSTALL_TREE_STAGING_CLEANED_EXACT

note "DEPLOY-PORTABILITY-008: unfrozen staging cannot cross the final-move gate"
UNFROZEN_PARENT="$SIMULATION_ROOT/unfrozen-parent"
UNFROZEN_DESTINATION="$UNFROZEN_PARENT/i00"
mkdir "$UNFROZEN_PARENT"
chmod 700 "$UNFROZEN_PARENT"
UNFROZEN_JSON="$(helper "$UNFROZEN_DESTINATION" \
  --operation claim --staging-name i00.partial.unfrozen)"
UNFROZEN_STAGING="$(json_field "$UNFROZEN_JSON" staging)"
UNFROZEN_CLAIM="$(json_field "$UNFROZEN_JSON" claim)"
assert_failure_contains 'must be frozen at mode 0511' \
  helper "$UNFROZEN_DESTINATION" --operation publish --claim "$UNFROZEN_CLAIM"
assert_contains "$(helper "$UNFROZEN_DESTINATION" \
  --operation cleanup --claim "$UNFROZEN_CLAIM")" \
  INSTALL_TREE_STAGING_CLEANED_EXACT

note "DEPLOY-PORTABILITY-008: installer delegates claim, verify, publish, and cleanup"
INSTALL_SOURCE="$(<"$I00_ROOT/bin/install-ops-bundle.sh")"
HELPER_SOURCE="$(<"$TOOL")"
for operation in claim verify publish cleanup; do
  assert_contains "$INSTALL_SOURCE" "--operation $operation"
done
assert_contains "$INSTALL_SOURCE" '"$CP_PATH" -pR'
for token in O_NOFOLLOW O_DIRECTORY '/proc/self/fd/3/' \
  '--no-clobber' '--no-target-directory' fsyncSync \
  'destination parent held/named identity changed' \
  'SYSTEM destination parent must be exact' \
  'validateSimulationRoot' 'simulationRoot'; do
  assert_contains "$HELPER_SOURCE" "$token"
done

finish
