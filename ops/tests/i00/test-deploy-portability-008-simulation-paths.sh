#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

CREATE_ROOT="$I00_ROOT/bin/create-simulation-root.mjs"
VALIDATE_ENV="$I00_ROOT/bin/validate-simulation-env.mjs"
VALIDATE_PATH="$I00_ROOT/bin/validate-simulation-path.mjs"
SEAL_ROOT="$I00_ROOT/bin/seal-simulation-root.mjs"
HOSTILE_TMPDIR="$TEST_TMP/hostile-tmpdir"
mkdir "$HOSTILE_TMPDIR"
chmod 700 "$HOSTILE_TMPDIR"

note "simulation-root creation rejects raw relative and dot spellings before resolution"
create_relative_root() {
  (
    cd "$TEST_TMP"
    node "$CREATE_ROOT" --root "ip-ops-i00-sim-relative-$$"
  )
}
assert_failure_contains 'create path must be absolute and lexically canonical' \
  create_relative_root
mkdir "$TEST_TMP/create-physical"
ln -s "$TEST_TMP/create-physical" "$TEST_TMP/create-alias"
RAW_CREATE_ROOT="$TEST_TMP/create-alias/../ip-ops-i00-sim-raw-create-$$"
assert_failure_contains 'create path must be absolute and lexically canonical' \
  node "$CREATE_ROOT" --root "$RAW_CREATE_ROOT"
assert_not_file "$TEST_TMP/ip-ops-i00-sim-raw-create-$$"

SIMULATION_ROOT="$(TMPDIR="$HOSTILE_TMPDIR" node "$CREATE_ROOT" \
  --root "$TEST_TMP/ip-ops-i00-sim-df32-paths-$$")"
note "simulation-root create and validate ignore hostile inherited TMPDIR"
assert_eq "$(TMPDIR="$HOSTILE_TMPDIR" node \
  "$I00_ROOT/bin/validate-simulation-root.mjs" --root "$SIMULATION_ROOT")" \
  "$SIMULATION_ROOT"
case "$SIMULATION_ROOT" in
  "$HOSTILE_TMPDIR"/*) fail_test "simulation root followed inherited TMPDIR" ;;
  *) pass_assertion ;;
esac

note "simulation command sealing rejects raw relative and symlink-dot spellings"
printf '#!/usr/bin/env bash\nexit 0\n' >"$SIMULATION_ROOT/curl.sh"
chmod 700 "$SIMULATION_ROOT/curl.sh"
seal_relative_command() {
  (
    cd "$SIMULATION_ROOT"
    node "$SEAL_ROOT" --root "$SIMULATION_ROOT" --commands curl.sh
  )
}
assert_failure_contains 'command path must be absolute and lexically canonical' \
  seal_relative_command
mkdir "$SIMULATION_ROOT/command-physical"
ln -s "$SIMULATION_ROOT/command-physical" "$SIMULATION_ROOT/command-alias"
RAW_COMMAND="$SIMULATION_ROOT/command-alias/../curl.sh"
assert_failure_contains 'command path must be absolute and lexically canonical' \
  node "$SEAL_ROOT" --root "$SIMULATION_ROOT" --commands "$RAW_COMMAND"
assert_not_file "$SIMULATION_ROOT/.ip-ops-i00-simulation-commands.json"
ln -s "$SIMULATION_ROOT/curl.sh" "$SIMULATION_ROOT/curl-leaf-alias.sh"
assert_failure_contains 'non-symlink executable regular file' \
  node "$SEAL_ROOT" --root "$SIMULATION_ROOT" \
  --commands "$SIMULATION_ROOT/curl-leaf-alias.sh"
mkdir "$SIMULATION_ROOT/command-real-parent"
cp "$SIMULATION_ROOT/curl.sh" "$SIMULATION_ROOT/command-real-parent/curl.sh"
chmod 700 "$SIMULATION_ROOT/command-real-parent/curl.sh"
ln -s "$SIMULATION_ROOT/command-real-parent" \
  "$SIMULATION_ROOT/command-parent-alias"
assert_failure_contains 'command path must already be physical and canonical' \
  node "$SEAL_ROOT" --root "$SIMULATION_ROOT" \
  --commands "$SIMULATION_ROOT/command-parent-alias/curl.sh"

note "simulation command sealing rejects a hostile root swap before publication"
SWAP_ROOT="$(node "$CREATE_ROOT" \
  --root "$TEST_TMP/ip-ops-i00-sim-df32-seal-swap-$$")"
printf '#!/usr/bin/env bash\nexit 0\n' >"$SWAP_ROOT/curl.sh"
chmod 700 "$SWAP_ROOT/curl.sh"
assert_success node --input-type=module - \
  "$I00_ROOT/simulation-safety.mjs" "$SWAP_ROOT" <<'NODE'
import {
  mkdirSync, renameSync, rmSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
const [modulePath, root] = process.argv.slice(2);
const { sealSimulationCommands } = await import(pathToFileURL(modulePath).href);
const original = `${root}.held-original`;
const commands = [`${root}/curl.sh`];
commands.map = function hostileMap(callback) {
  const entries = Array.prototype.map.call(this, callback);
  renameSync(root, original);
  mkdirSync(root, { mode: 0o700 });
  return entries;
};
let rejected = false;
try {
  sealSimulationCommands(root, commands);
} catch (error) {
  rejected = /identity changed/u.test(String(error?.message));
} finally {
  rmSync(root, { recursive: true, force: true });
  renameSync(original, root);
}
if (!rejected) process.exit(1);
NODE
assert_not_file "$SWAP_ROOT/.ip-ops-i00-simulation-commands.json"

OUTSIDE="$TEST_TMP/outside-simulation-root"
mkdir -p "$OUTSIDE/anchor"
ln -s "$OUTSIDE/anchor" "$SIMULATION_ROOT/alias"

note "simulation-root validation rejects raw alias dot-dot traversal"
mkdir "$TEST_TMP/physical"
PHYSICAL_SIMULATION_ROOT="$(node "$CREATE_ROOT" \
  --root "$TEST_TMP/physical/ip-ops-i00-sim-df32-paths-$$")"
mkdir "$TEST_TMP/physical/anchor"
ln -s "$TEST_TMP/physical/anchor" "$TEST_TMP/root-alias"
RAW_SIMULATION_ROOT="$TEST_TMP/root-alias/../ip-ops-i00-sim-df32-paths-$$"
assert_failure_contains 'simulation root path must be absolute and lexically canonical' \
  node "$I00_ROOT/bin/validate-simulation-root.mjs" --root "$RAW_SIMULATION_ROOT"
[ -d "$PHYSICAL_SIMULATION_ROOT" ] || fail_test "physical hostile simulation root changed"
pass_assertion

write_layout_env() {
  local output="$1" ops_state="$2"
  printf '%s\n' \
    "COSMOS_ROOT=$SIMULATION_ROOT/cosmos" \
    "RELEASES_DIR=$SIMULATION_ROOT/cosmos/releases" \
    "CURRENT_LINK=$SIMULATION_ROOT/cosmos/current" \
    "PREVIOUS_LINK=$SIMULATION_ROOT/cosmos/previous" \
    "DATA_DIR=$SIMULATION_ROOT/data" \
    "OPS_STATE_DIR=$ops_state" \
    "APP_UNIT=cosmos-app.service" \
    "HEALTH_BASE=http://127.0.0.1:8080" \
    >"$output"
  chmod 600 "$output"
}

note "simulation environment input and output are exact root direct children"
write_layout_env "$TEST_TMP/outside-layout.env" "$SIMULATION_ROOT/ops-state"
assert_failure_contains 'raw canonical direct child' \
  node "$VALIDATE_ENV" \
  --env "$TEST_TMP/outside-layout.env" \
  --root "$SIMULATION_ROOT" \
  --output "$SIMULATION_ROOT/outside-layout.sanitized.env"
write_layout_env "$SIMULATION_ROOT/direct-layout.env" "$SIMULATION_ROOT/ops-state"
mkdir "$SIMULATION_ROOT/nested-output"
assert_failure_contains 'raw canonical direct child' \
  node "$VALIDATE_ENV" \
  --env "$SIMULATION_ROOT/direct-layout.env" \
  --root "$SIMULATION_ROOT" \
  --output "$SIMULATION_ROOT/nested-output/sanitized.env"
assert_not_file "$SIMULATION_ROOT/nested-output/sanitized.env"

note "ordinary missing simulation paths remain inside the marked root"
assert_success node "$VALIDATE_PATH" \
  --root "$SIMULATION_ROOT" --path "$SIMULATION_ROOT/future/child"
assert_failure_contains 'simulation path must already be physical and canonical' \
  node "$VALIDATE_PATH" \
  --root "$SIMULATION_ROOT" \
  --path "$SIMULATION_ROOT/command-alias/future/child"

note "release-switch simulation env rejects raw alias dot-dot traversal"
RELEASE_RAW="$SIMULATION_ROOT/alias/../release-effect"
write_layout_env "$SIMULATION_ROOT/release-hostile.env" "$RELEASE_RAW"
assert_failure_contains 'OPS_STATE_DIR must be an absolute path below the marked simulation root' \
  node "$VALIDATE_ENV" \
  --env "$SIMULATION_ROOT/release-hostile.env" \
  --root "$SIMULATION_ROOT" \
  --output "$SIMULATION_ROOT/release-sanitized.env"
assert_not_file "$OUTSIDE/release-effect"

note "release-switch rejects raw relative, dot, and symlink release endpoints"
RELEASE_SWITCH_COMMON=(
  --env-file "$TEST_TMP/not-reached.env"
  --runtime-env "$TEST_TMP/not-reached-runtime.env"
  --sqlite /usr/bin/env
  --host "$TEST_TMP/not-reached-host.json"
  --supervisor "$TEST_TMP/not-reached-supervisor.json"
  --simulation
  --simulation-root "$SIMULATION_ROOT"
  --provenance-mode TEST
)
invoke_release_switch() {
  env DONOR_ROOT="$REPO_ROOT/ops/live" \
    bash "$I00_ROOT/bin/release-switch.sh" "$@" "${RELEASE_SWITCH_COMMON[@]}"
}
mkdir "$SIMULATION_ROOT/release-physical"
ln -s "$SIMULATION_ROOT/release-physical" "$SIMULATION_ROOT/release-leaf-alias"
mkdir "$SIMULATION_ROOT/release-parent"
ln -s "$SIMULATION_ROOT/release-parent" "$SIMULATION_ROOT/release-parent-alias"
mkdir "$SIMULATION_ROOT/release-parent/release"
assert_failure_contains '--release must be one absolute lexical path' \
  invoke_release_switch --release release-physical
assert_failure_contains '--release must be one absolute lexical canonical path' \
  invoke_release_switch --release "$SIMULATION_ROOT/./release-physical"
assert_failure_contains 'non-symlink unpacked release directory' \
  invoke_release_switch --release "$SIMULATION_ROOT/release-leaf-alias"
assert_failure_contains 'not physically canonical' \
  invoke_release_switch --release "$SIMULATION_ROOT/release-parent-alias/release"

note "ops-bundle installer rejects raw relative, dot, and symlink release endpoints"
invoke_ops_install() {
  bash "$I00_ROOT/bin/install-ops-bundle.sh" \
    --release "$1" \
    --destination "$SIMULATION_ROOT/installed-i00" \
    --simulation \
    --simulation-root "$SIMULATION_ROOT"
}
assert_failure_contains 'absolute lexical canonical path' \
  invoke_ops_install release-physical
assert_failure_contains 'absolute lexical canonical path' \
  invoke_ops_install "$SIMULATION_ROOT/./release-physical"
assert_failure_contains 'non-symlink unpacked release directory' \
  invoke_ops_install "$SIMULATION_ROOT/release-leaf-alias"
assert_failure_contains 'not physically canonical' \
  invoke_ops_install "$SIMULATION_ROOT/release-parent-alias/release"

note "rollback-switch simulation env rejects raw alias dot-dot traversal"
ROLLBACK_RAW="$SIMULATION_ROOT/alias/../rollback-effect"
write_layout_env "$SIMULATION_ROOT/rollback-hostile.env" "$ROLLBACK_RAW"
assert_failure_contains 'OPS_STATE_DIR must be an absolute path below the marked simulation root' \
  node "$VALIDATE_ENV" \
  --env "$SIMULATION_ROOT/rollback-hostile.env" \
  --root "$SIMULATION_ROOT" \
  --output "$SIMULATION_ROOT/rollback-sanitized.env"
assert_not_file "$OUTSIDE/rollback-effect"

note "backup simulation path rejects raw alias dot-dot traversal"
BACKUP_RAW="$SIMULATION_ROOT/alias/../backup-effect"
assert_failure_contains 'simulation path must be absolute and lexically canonical' \
  node "$VALIDATE_PATH" --root "$SIMULATION_ROOT" --path "$BACKUP_RAW"
assert_not_file "$OUTSIDE/backup-effect"

note "restore simulation path rejects raw alias dot-dot traversal"
RESTORE_RAW="$SIMULATION_ROOT/alias/../restore-effect"
assert_failure_contains 'simulation path must be absolute and lexically canonical' \
  node "$VALIDATE_PATH" --root "$SIMULATION_ROOT" --path "$RESTORE_RAW"
assert_not_file "$OUTSIDE/restore-effect"

note "lexically canonical symlink descendants are rejected before containment"
CANONICAL_ALIAS="$SIMULATION_ROOT/alias/restore-effect"
assert_failure_contains 'simulation path must already be physical and canonical' \
  node "$VALIDATE_PATH" --root "$SIMULATION_ROOT" --path "$CANONICAL_ALIAS"

note "all four simulation wrappers retain the shared physical-path gate"
assert_contains "$(<"$I00_ROOT/bin/release-switch.sh")" validate-simulation-env.mjs
assert_contains "$(<"$I00_ROOT/bin/rollback-switch.sh")" validate-simulation-env.mjs
assert_contains "$(<"$I00_ROOT/bin/backup-verify.sh")" validate-simulation-path.mjs
assert_contains "$(<"$I00_ROOT/bin/restore-drill-verify.sh")" validate-simulation-path.mjs

finish
