#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

INSPECTOR="$I00_ROOT/bin/inspect-app-unit.mjs"
STAGING_ROOT=""
cleanup_app_unit_binding() {
  local rc=$?
  case "${STAGING_ROOT:-}" in
    /var/tmp/cosmos-df32-proof-[0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      chmod -R u+w "$STAGING_ROOT" 2>/dev/null || true
      rm -rf "$STAGING_ROOT"
      ;;
  esac
  cleanup_test_tmp "$rc"
  return "$rc"
}
trap cleanup_app_unit_binding EXIT

CANONICAL_TEST_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$TEST_TMP")"
ROOT="$CANONICAL_TEST_TMP/ip-ops-i00-sim-app-unit-binding"
BIN_DIR="$ROOT/bin"
UNIT_DIR="$ROOT/systemd"
SOURCE_DIR="$ROOT/accepted-donor/systemd"
RUNTIME_UNIT_DIR="$ROOT/runtime-systemd/cosmos-app.service.d"
MODE_FILE="$ROOT/mode"
COUNT_FILE="$ROOT/count"
SYSTEMCTL="$BIN_DIR/systemctl"
FRAGMENT="$UNIT_DIR/cosmos-app.service"
FRAGMENT_SOURCE="$SOURCE_DIR/cosmos-app.service"
ALT_FRAGMENT="$UNIT_DIR/substituted-cosmos-app.service"
DROP_IN="$UNIT_DIR/extra.conf"
PROOF_DROP_IN="$UNIT_DIR/cosmos-app.service.d/90-cosmos-app.conf"
PROOF_DROP_IN_RUNTIME_LINK="$RUNTIME_UNIT_DIR/90-cosmos-app.conf"
PROOF_ABSENT_SENTINEL="$ROOT/.do-not-start-cosmos-app"
RUNTIME_ENV="$ROOT/runtime.env"
NODE_BIN="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')"
ENV_BIN="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/usr/bin/env"))')"
UNSET_ENVIRONMENT='NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy'

node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const [modulePath, root] = process.argv.slice(2);
const { createSimulationRoot } = await import(pathToFileURL(modulePath).href);
createSimulationRoot(root);
NODE

write_proof_drop_in() {
  if [ -e "$PROOF_DROP_IN" ]; then chmod 600 "$PROOF_DROP_IN"; fi
  printf '%s\n' \
    '[Unit]' \
    "ConditionPathExists=$PROOF_ABSENT_SENTINEL" \
    '' \
    '[Service]' \
    'EnvironmentFile=' \
    "EnvironmentFile=$RUNTIME_ENV" \
    >"$PROOF_DROP_IN"
  chmod 400 "$PROOF_DROP_IN"
}

mkdir -p "$BIN_DIR" "$UNIT_DIR/cosmos-app.service.d" "$SOURCE_DIR" "$RUNTIME_UNIT_DIR"
chmod 700 "$ROOT" "$BIN_DIR" "$UNIT_DIR" "$UNIT_DIR/cosmos-app.service.d" \
  "$ROOT/accepted-donor" "$SOURCE_DIR" "$ROOT/runtime-systemd" "$RUNTIME_UNIT_DIR"
printf '%s\n' \
  '[Unit]' \
  'Description=fixture' \
  '[Service]' \
  'Type=simple' \
  "ExecStart=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $NODE_BIN server/dist/index.js" \
  >"$FRAGMENT_SOURCE"
cp "$FRAGMENT_SOURCE" "$FRAGMENT"
printf '%s\n' \
  '# substituted bytes' \
  '[Unit]' \
  'Description=fixture' \
  '[Service]' \
  'Type=simple' \
  "ExecStart=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases $NODE_BIN server/dist/index.js" \
  >"$ALT_FRAGMENT"
printf '%s\n' '[Service]' 'Environment=UNEXPECTED=1' >"$DROP_IN"
write_proof_drop_in
ln -s "$PROOF_DROP_IN" "$PROOF_DROP_IN_RUNTIME_LINK"
printf '%s\n' 'HOST=127.0.0.1' 'PORT=8080' >"$RUNTIME_ENV"
chmod 600 "$FRAGMENT_SOURCE" "$FRAGMENT" "$ALT_FRAGMENT" "$DROP_IN" "$RUNTIME_ENV"
printf 'normal\n' >"$MODE_FILE"
printf '0\n' >"$COUNT_FILE"
chmod 600 "$MODE_FILE" "$COUNT_FILE"

{
  printf '%s\n' '#!/bin/sh' 'set -eu'
  printf '%s\n' '[ "$1" = show ] && [ "$2" = cosmos-app.service ] || exit 91'
  printf '%s\n' '[ "$3" = --no-pager ] && [ "$4" = --all ] || exit 92'
  printf 'mode="$(/bin/cat %s)"\n' "$MODE_FILE"
  printf 'fragment=%s\n' "$FRAGMENT"
  printf 'drop_ins=%s\n' "$PROOF_DROP_IN_RUNTIME_LINK"
  printf '%s\n' 'reload=no' 'user=cosmos' 'group=cosmos'
  printf '%s\n' 'working_directory=/opt/cosmos/current'
  printf 'runtime_env=%s\n' "$RUNTIME_ENV"
  printf "unset_environment='%s'\n" "$UNSET_ENVIRONMENT"
  printf '%s\n' 'environment=' 'pass_environment=' 'set_credential='
  printf '%s\n' 'set_credential_encrypted=' 'load_credential='
  printf '%s\n' 'load_credential_encrypted=' 'import_credential='
  printf '%s\n' 'supplementary_groups=' 'dynamic_user=no' 'pam_name='
  printf '%s\n' 'capability_bounding_set=' 'ambient_capabilities='
  printf '%s\n' 'no_new_privileges=yes'
  printf '%s\n' 'exec_condition=' 'exec_start_pre=' 'exec_start_post='
  printf '%s\n' 'exec_reload=' 'exec_stop=' 'exec_stop_post='
  printf '%s\n' 'root_directory=' 'root_image=' 'mount_images=' 'extension_images='
  printf '%s\n' 'extension_directories=' 'exec_search_path='
  printf '%s\n' 'bind_paths=' 'bind_read_only_paths=' 'temporary_file_system='
  printf '%s\n' 'requires=' 'wants=network-online.target' 'requisite=' 'binds_to='
  printf '%s\n' 'part_of=' 'after=network-online.target' 'before=' 'conflicts='
  printf '%s\n' 'on_failure=' 'success_action=none' 'failure_action=none'
  printf '%s\n' 'names=cosmos-app.service' 'following=' 'on_success='
  printf '%s\n' 'on_success_job_mode=replace' 'on_failure_job_mode=replace'
  printf '%s\n' 'propagates_stop_to=' 'stop_propagated_from='
  printf '%s\n' 'propagates_reload_to=' 'reload_propagated_from='
  printf '%s\n' 'upholds=' 'joins_namespace_of='
  printf '%s\n' 'requires_mounts_for=' 'wants_mounts_for='
  printf '%s\n' 'default_dependencies=yes'
  printf '%s\n' 'job_timeout_action=none' 'start_limit_action=none'
  printf '%s\n' 'read_write_paths="/var/lib/cosmos /run/cosmos-app"'
  printf '%s\n' 'read_only_paths=' 'inaccessible_paths=' 'exec_paths=' 'no_exec_paths='
  printf '%s\n' 'runtime_directory=cosmos-app' 'runtime_directory_mode=700'
  printf '%s\n' 'runtime_directory_preserve=restart'
  printf '%s\n' 'state_directory=' 'state_directory_mode=755'
  printf '%s\n' 'cache_directory=' 'cache_directory_mode=755'
  printf '%s\n' 'logs_directory=' 'logs_directory_mode=755'
  printf '%s\n' 'configuration_directory=' 'configuration_directory_mode=755'
  printf '%s\n' 'service_type=simple' 'standard_input=null'
  printf '%s\n' 'standard_output=journal' 'standard_error=journal'
  printf '%s\n' 'sockets=' 'bus_name=' 'pid_file=' 'notify_access=none'
  printf '%s\n' 'fd_store_max=0' 'fd_store_preserve=no'
  printf '%s\n' 'root_directory_start_only=no'
  printf '%s\n' 'exec_start_flags='
  printf 'node=%s\n' "$NODE_BIN"
  printf '%s\n' 'case "$mode" in'
  printf '  substitution) fragment=%s ;;\n' "$ALT_FRAGMENT"
  printf '  drop-in) drop_ins="%s %s" ;;\n' "$PROOF_DROP_IN_RUNTIME_LINK" "$DROP_IN"
  printf '%s\n' '  stale) reload=yes ;;'
  printf '  wrong-node) node=%s ;;\n' "$ENV_BIN"
  printf '%s\n' '  wrong-user) user=root ;;'
  printf '%s\n' '  wrong-group) group=root ;;'
  printf '%s\n' '  wrong-working-directory) working_directory=/tmp ;;'
  printf '  wrong-runtime-env) runtime_env=%s ;;\n' "$FRAGMENT"
  printf '  alias-runtime-env) runtime_env=%s ;;\n' "$ROOT/runtime-alias.env"
  printf '%s\n' '  optional-runtime-env) optional=- ;;'
  printf '%s\n' '  extra-runtime-env) extra_runtime_env=1 ;;'
  printf '%s\n' '  missing-unset) unset_environment=${unset_environment#* } ;;'
  printf '%s\n' '  extra-unset) unset_environment="$unset_environment UNEXPECTED" ;;'
  printf '%s\n' '  environment) environment=UNEXPECTED=1 ;;'
  printf '%s\n' '  pass-environment) pass_environment=HOME ;;'
  printf '%s\n' '  credential) load_credential=unexpected:/tmp/unexpected ;;'
  printf '%s\n' '  supplementary-group) supplementary_groups=wheel ;;'
  printf '%s\n' '  dynamic-user) dynamic_user=yes ;;'
  printf '%s\n' '  pam-name) pam_name=login ;;'
  printf '%s\n' '  capability) capability_bounding_set=cap_sys_admin ;;'
  printf '%s\n' '  ambient-capability) ambient_capabilities=cap_net_admin ;;'
  printf '%s\n' '  new-privileges) no_new_privileges=no ;;'
  printf '%s\n' '  exec-condition) exec_condition=unexpected ;;'
  printf '%s\n' '  exec-start-pre) exec_start_pre=unexpected ;;'
  printf '%s\n' '  exec-start-post) exec_start_post=unexpected ;;'
  printf '%s\n' '  exec-reload) exec_reload=unexpected ;;'
  printf '%s\n' '  exec-stop) exec_stop=unexpected ;;'
  printf '%s\n' '  exec-stop-post) exec_stop_post=unexpected ;;'
  printf '%s\n' '  root-directory) root_directory=/tmp ;;'
  printf '%s\n' '  root-image) root_image=/tmp/root.img ;;'
  printf '%s\n' '  mount-image) mount_images=/tmp/root.img:/opt/cosmos/current ;;'
  printf '%s\n' '  extension-image) extension_images=/tmp/extension.img ;;'
  printf '%s\n' '  extension-directory) extension_directories=/tmp/extension ;;'
  printf '%s\n' '  exec-search-path) exec_search_path=/tmp ;;'
  printf '%s\n' '  bind-path) bind_paths=/tmp:/opt/cosmos/current ;;'
  printf '%s\n' '  bind-read-only-path) bind_read_only_paths=/tmp:/opt/cosmos/current ;;'
  printf '%s\n' '  temporary-file-system) temporary_file_system=/opt/cosmos/current ;;'
  printf '%s\n' '  success-action) success_action=reboot ;;'
  printf '%s\n' '  failure-action) failure_action=reboot ;;'
  printf '%s\n' '  job-timeout-action) job_timeout_action=reboot ;;'
  printf '%s\n' '  start-limit-action) start_limit_action=reboot ;;'
  printf '%s\n' '  on-failure) on_failure=unexpected.service ;;'
  printf '%s\n' '  dynamic-wants) wants="$wants unexpected.service" ;;'
  printf '%s\n' '  dynamic-alias) names="$names unexpected.service" ;;'
  printf '%s\n' '  on-success) on_success=unexpected.service ;;'
  printf '%s\n' '  propagates-stop) propagates_stop_to=unexpected.service ;;'
  printf '%s\n' '  upholds) upholds=unexpected.service ;;'
  printf '%s\n' '  standard-output) standard_output=file:/tmp/unexpected ;;'
  printf '%s\n' '  socket-authority) sockets=unexpected.socket ;;'
  printf '%s\n' '  bus-authority) bus_name=org.example.Unexpected ;;'
  printf '%s\n' '  pid-authority) pid_file=/tmp/unexpected.pid ;;'
  printf '%s\n' '  notify-authority) notify_access=all ;;'
  printf '%s\n' '  runtime-directory) runtime_directory=unexpected ;;'
  printf '%s\n' '  read-write-path) read_write_paths=/tmp ;;'
  printf '%s\n' '  root-directory-start-only) root_directory_start_only=yes ;;'
  printf '%s\n' '  exec-start-privileged) exec_start_flags=fully-privileged ;;'
  printf '%s\n' '  toctou)'
  printf '    count="$(/bin/cat %s)"\n' "$COUNT_FILE"
  printf '%s\n' '    if [ "$count" = 1 ]; then'
  printf '      printf "\\n# changed during inspection\\n" >>%s\n' "$FRAGMENT"
  printf '%s\n' '    fi'
  printf '    /bin/echo "$((count + 1))" >%s\n' "$COUNT_FILE"
  printf '%s\n' '    ;;' '  normal) ;;' '  *) exit 93 ;;' 'esac'
  printf '%s\n' "printf 'Id=cosmos-app.service\\n'"
  printf '%s\n' "printf 'Names=%s\\n' \"\$names\""
  printf '%s\n' "printf 'Following=%s\\n' \"\$following\""
  printf '%s\n' "printf 'LoadState=loaded\\n'"
  printf '%s\n' "printf 'FragmentPath=%s\\n' \"\$fragment\""
  printf '%s\n' "printf 'DropInPaths=%s\\n' \"\$drop_ins\""
  printf '%s\n' "printf 'NeedDaemonReload=%s\\n' \"\$reload\""
  printf '%s\n' "printf 'Requires=%s\\n' \"\$requires\""
  printf '%s\n' "printf 'Wants=%s\\n' \"\$wants\""
  printf '%s\n' "printf 'Requisite=%s\\n' \"\$requisite\""
  printf '%s\n' "printf 'BindsTo=%s\\n' \"\$binds_to\""
  printf '%s\n' "printf 'PartOf=%s\\n' \"\$part_of\""
  printf '%s\n' "printf 'After=%s\\n' \"\$after\""
  printf '%s\n' "printf 'Before=%s\\n' \"\$before\""
  printf '%s\n' "printf 'Conflicts=%s\\n' \"\$conflicts\""
  printf '%s\n' "printf 'OnFailure=%s\\n' \"\$on_failure\""
  printf '%s\n' "printf 'OnSuccess=%s\\n' \"\$on_success\""
  printf '%s\n' "printf 'OnSuccessJobMode=%s\\n' \"\$on_success_job_mode\""
  printf '%s\n' "printf 'OnFailureJobMode=%s\\n' \"\$on_failure_job_mode\""
  printf '%s\n' "printf 'PropagatesStopTo=%s\\n' \"\$propagates_stop_to\""
  printf '%s\n' "printf 'StopPropagatedFrom=%s\\n' \"\$stop_propagated_from\""
  printf '%s\n' "printf 'PropagatesReloadTo=%s\\n' \"\$propagates_reload_to\""
  printf '%s\n' "printf 'ReloadPropagatedFrom=%s\\n' \"\$reload_propagated_from\""
  printf '%s\n' "printf 'Upholds=%s\\n' \"\$upholds\""
  printf '%s\n' "printf 'JoinsNamespaceOf=%s\\n' \"\$joins_namespace_of\""
  printf '%s\n' "printf 'RequiresMountsFor=%s\\n' \"\$requires_mounts_for\""
  printf '%s\n' "printf 'WantsMountsFor=%s\\n' \"\$wants_mounts_for\""
  printf '%s\n' "printf 'DefaultDependencies=%s\\n' \"\$default_dependencies\""
  printf '%s\n' "printf 'SuccessAction=%s\\n' \"\$success_action\""
  printf '%s\n' "printf 'FailureAction=%s\\n' \"\$failure_action\""
  printf '%s\n' "printf 'JobTimeoutAction=%s\\n' \"\$job_timeout_action\""
  printf '%s\n' "printf 'StartLimitAction=%s\\n' \"\$start_limit_action\""
  printf '%s\n' "printf 'User=%s\\n' \"\$user\""
  printf '%s\n' "printf 'Group=%s\\n' \"\$group\""
  printf '%s\n' "printf 'WorkingDirectory=%s\\n' \"\$working_directory\""
  printf '%s\n' "printf 'Environment=%s\\n' \"\$environment\""
  printf '%s\n' "printf 'EnvironmentFiles=%s (ignore_errors=%s)\\n' \"\$runtime_env\" \"\${optional:-no}\""
  printf '%s\n' 'if [ "${extra_runtime_env:-0}" = 1 ]; then'
  printf '%s\n' "  printf 'EnvironmentFiles=%s (ignore_errors=no)\\n' \"$FRAGMENT\""
  printf '%s\n' 'fi'
  printf '%s\n' "printf 'UnsetEnvironment=%s\\n' \"\$unset_environment\""
  printf '%s\n' "printf 'PassEnvironment=%s\\n' \"\$pass_environment\""
  printf '%s\n' "printf 'SetCredential=%s\\n' \"\$set_credential\""
  printf '%s\n' "printf 'SetCredentialEncrypted=%s\\n' \"\$set_credential_encrypted\""
  printf '%s\n' "printf 'LoadCredential=%s\\n' \"\$load_credential\""
  printf '%s\n' "printf 'LoadCredentialEncrypted=%s\\n' \"\$load_credential_encrypted\""
  printf '%s\n' "printf 'ImportCredential=%s\\n' \"\$import_credential\""
  printf '%s\n' "printf 'SupplementaryGroups=%s\\n' \"\$supplementary_groups\""
  printf '%s\n' "printf 'DynamicUser=%s\\n' \"\$dynamic_user\""
  printf '%s\n' "printf 'PAMName=%s\\n' \"\$pam_name\""
  printf '%s\n' "printf 'CapabilityBoundingSet=%s\\n' \"\$capability_bounding_set\""
  printf '%s\n' "printf 'AmbientCapabilities=%s\\n' \"\$ambient_capabilities\""
  printf '%s\n' "printf 'NoNewPrivileges=%s\\n' \"\$no_new_privileges\""
  printf '%s\n' "printf 'RootDirectory=%s\\n' \"\$root_directory\""
  printf '%s\n' "printf 'RootImage=%s\\n' \"\$root_image\""
  printf '%s\n' "printf 'MountImages=%s\\n' \"\$mount_images\""
  printf '%s\n' "printf 'ExtensionImages=%s\\n' \"\$extension_images\""
  printf '%s\n' "printf 'ExtensionDirectories=%s\\n' \"\$extension_directories\""
  printf '%s\n' "printf 'ExecSearchPath=%s\\n' \"\$exec_search_path\""
  printf '%s\n' "printf 'BindPaths=%s\\n' \"\$bind_paths\""
  printf '%s\n' "printf 'BindReadOnlyPaths=%s\\n' \"\$bind_read_only_paths\""
  printf '%s\n' "printf 'TemporaryFileSystem=%s\\n' \"\$temporary_file_system\""
  printf '%s\n' "printf 'ReadWritePaths=%s\\n' \"\$read_write_paths\""
  printf '%s\n' "printf 'ReadOnlyPaths=%s\\n' \"\$read_only_paths\""
  printf '%s\n' "printf 'InaccessiblePaths=%s\\n' \"\$inaccessible_paths\""
  printf '%s\n' "printf 'ExecPaths=%s\\n' \"\$exec_paths\""
  printf '%s\n' "printf 'NoExecPaths=%s\\n' \"\$no_exec_paths\""
  printf '%s\n' "printf 'RuntimeDirectory=%s\\n' \"\$runtime_directory\""
  printf '%s\n' "printf 'RuntimeDirectoryMode=%s\\n' \"\$runtime_directory_mode\""
  printf '%s\n' "printf 'RuntimeDirectoryPreserve=%s\\n' \"\$runtime_directory_preserve\""
  printf '%s\n' "printf 'StateDirectory=%s\\n' \"\$state_directory\""
  printf '%s\n' "printf 'StateDirectoryMode=%s\\n' \"\$state_directory_mode\""
  printf '%s\n' "printf 'CacheDirectory=%s\\n' \"\$cache_directory\""
  printf '%s\n' "printf 'CacheDirectoryMode=%s\\n' \"\$cache_directory_mode\""
  printf '%s\n' "printf 'LogsDirectory=%s\\n' \"\$logs_directory\""
  printf '%s\n' "printf 'LogsDirectoryMode=%s\\n' \"\$logs_directory_mode\""
  printf '%s\n' "printf 'ConfigurationDirectory=%s\\n' \"\$configuration_directory\""
  printf '%s\n' "printf 'ConfigurationDirectoryMode=%s\\n' \"\$configuration_directory_mode\""
  printf '%s\n' "printf 'RootDirectoryStartOnly=%s\\n' \"\$root_directory_start_only\""
  printf '%s\n' "printf 'Type=%s\\n' \"\$service_type\""
  printf '%s\n' "printf 'StandardInput=%s\\n' \"\$standard_input\""
  printf '%s\n' "printf 'StandardOutput=%s\\n' \"\$standard_output\""
  printf '%s\n' "printf 'StandardError=%s\\n' \"\$standard_error\""
  printf '%s\n' "printf 'Sockets=%s\\n' \"\$sockets\""
  printf '%s\n' "printf 'BusName=%s\\n' \"\$bus_name\""
  printf '%s\n' "printf 'PIDFile=%s\\n' \"\$pid_file\""
  printf '%s\n' "printf 'NotifyAccess=%s\\n' \"\$notify_access\""
  printf '%s\n' "printf 'FileDescriptorStoreMax=%s\\n' \"\$fd_store_max\""
  printf '%s\n' "printf 'FileDescriptorStorePreserve=%s\\n' \"\$fd_store_preserve\""
  printf '%s\n' "printf 'ExecCondition=%s\\n' \"\$exec_condition\""
  printf '%s\n' "printf 'ExecStartPre=%s\\n' \"\$exec_start_pre\""
  printf '%s\n' \
    "printf 'ExecStart={ path=$ENV_BIN ; argv[]=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases %s server/dist/index.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n' \"\$node\""
  printf '%s\n' \
    "printf 'ExecStartEx={ path=$ENV_BIN ; argv[]=$ENV_BIN DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases %s server/dist/index.js ; flags=%s ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n' \"\$node\" \"\$exec_start_flags\""
  printf '%s\n' "printf 'ExecStartPost=%s\\n' \"\$exec_start_post\""
  printf '%s\n' "printf 'ExecReload=%s\\n' \"\$exec_reload\""
  printf '%s\n' "printf 'ExecStop=%s\\n' \"\$exec_stop\""
  printf '%s\n' "printf 'ExecStopPost=%s\\n' \"\$exec_stop_post\""
} >"$SYSTEMCTL"
chmod 700 "$SYSTEMCTL"

inspect() {
  node "$INSPECTOR" \
    --systemctl "$SYSTEMCTL" \
    --unit cosmos-app.service \
    --node "$NODE_BIN" \
    --env "$ENV_BIN" \
    --runtime-env "$RUNTIME_ENV" \
    --provenance-mode TEST \
    --expected-fragment-path "$FRAGMENT" \
    --expected-fragment-source "$FRAGMENT_SOURCE" \
    --staging-root "$ROOT" \
    --proof-drop-in "$PROOF_DROP_IN" \
    --proof-drop-in-runtime-link "$PROOF_DROP_IN_RUNTIME_LINK" \
    --proof-absent-sentinel "$PROOF_ABSENT_SENTINEL" \
    "$@"
}

note "DEPLOY-PORTABILITY-008: exact loaded keyless app unit is accepted"
BASELINE="$(inspect)"
assert_contains "$BASELINE" '"status":"APP_UNIT_BINDING_VERIFIED"'
assert_contains "$BASELINE" "\"dropInPaths\":[\"$PROOF_DROP_IN_RUNTIME_LINK\"]"
assert_contains "$BASELINE" '"dropInState":"EXACT_STAGING_PROOF"'
assert_contains "$BASELINE" '"proofDropInOwner":"INVOKING_TEST_OWNER"'
assert_contains "$BASELINE" '"needDaemonReload":"no"'
assert_contains "$BASELINE" '"user":"cosmos"'
assert_contains "$BASELINE" '"group":"cosmos"'
assert_contains "$BASELINE" '"workingDirectory":"/opt/cosmos/current"'
assert_contains "$BASELINE" '"executionAuthorityState":"CLOSED"'
assert_contains "$BASELINE" '"environmentAuthorityState":"CLOSED"'
assert_contains "$BASELINE" '"identityAuthorityState":"CLOSED"'
assert_contains "$BASELINE" '"effectReachability":"Basis=LIVE_SYSTEM_MANAGER;Names=cosmos-app.service;'
assert_contains "$BASELINE" "\"runtimeEnvPath\":\"$RUNTIME_ENV\""
BASELINE_BINDING="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bindingSha256)' "$BASELINE")"
assert_success inspect --expected-binding-sha256 "$BASELINE_BINDING"

note "DEPLOY-PORTABILITY-008: dynamic effect reachability is owner-visible and binding-exact"
for mode in dynamic-wants dynamic-alias on-success propagates-stop upholds
do
  printf '%s\n' "$mode" >"$MODE_FILE"
  DYNAMIC_BINDING="$(inspect)"
  assert_contains "$DYNAMIC_BINDING" unexpected.service
  assert_failure_contains 'differs from the authorized binding' \
    inspect --expected-binding-sha256 "$BASELINE_BINDING"
done

note "DEPLOY-PORTABILITY-008: direct FragmentPath substitution is rejected"
printf 'substitution\n' >"$MODE_FILE"
assert_failure_contains 'FragmentPath differs from the exact expected fragment' \
  inspect --expected-binding-sha256 "$BASELINE_BINDING"

note "DEPLOY-PORTABILITY-008: stale daemon state is rejected"
printf 'stale\n' >"$MODE_FILE"
assert_failure_contains 'NeedDaemonReload must be exactly no' inspect

note "DEPLOY-PORTABILITY-008: any drop-in is rejected for keyless deployment"
printf 'drop-in\n' >"$MODE_FILE"
assert_failure_contains 'must load only the exact isolated staging proof drop-in' inspect

note "DEPLOY-PORTABILITY-008: ExecStart must use the preview-bound Node"
printf 'wrong-node\n' >"$MODE_FILE"
assert_failure_contains 'does not use the exact preview-bound env and Node' inspect

note "DEPLOY-PORTABILITY-008: service privilege and working-directory readbacks are exact"
printf 'wrong-user\n' >"$MODE_FILE"
assert_failure_contains 'exact cosmos user and group' inspect
printf 'wrong-group\n' >"$MODE_FILE"
assert_failure_contains 'exact cosmos user and group' inspect
printf 'wrong-working-directory\n' >"$MODE_FILE"
assert_failure_contains 'WorkingDirectory must be exactly' inspect

note "DEPLOY-PORTABILITY-008: the sole runtime EnvironmentFile is exact and non-optional"
printf 'wrong-runtime-env\n' >"$MODE_FILE"
assert_failure_contains 'sole exact non-optional runtime EnvironmentFile' inspect
printf 'optional-runtime-env\n' >"$MODE_FILE"
assert_failure_contains 'sole exact non-optional runtime EnvironmentFile' inspect
printf 'extra-runtime-env\n' >"$MODE_FILE"
assert_failure_contains 'sole exact non-optional runtime EnvironmentFile' inspect

note "DEPLOY-PORTABILITY-008: runtime UnsetEnvironment closure is complete and exact"
printf 'missing-unset\n' >"$MODE_FILE"
assert_failure_contains 'complete runtime closure' inspect

note "DEPLOY-PORTABILITY-008: filesystem namespace remapping is absent"
for mode in root-directory root-image mount-image extension-image extension-directory \
  exec-search-path bind-path bind-read-only-path temporary-file-system \
  root-directory-start-only
do
  printf '%s\n' "$mode" >"$MODE_FILE"
  assert_failure inspect
done
printf 'extra-unset\n' >"$MODE_FILE"
assert_failure_contains 'complete runtime closure' inspect

note "DEPLOY-PORTABILITY-008: auxiliary execution, environment, and identity authority is closed"
for mode in environment pass-environment credential supplementary-group dynamic-user \
  pam-name capability ambient-capability new-privileges exec-condition exec-start-pre \
  exec-start-privileged exec-start-post exec-reload exec-stop exec-stop-post
do
  printf '%s\n' "$mode" >"$MODE_FILE"
  assert_failure inspect
done

note "DEPLOY-PORTABILITY-008: effective action, I/O, socket, and writable-path authority is closed"
for mode in success-action failure-action job-timeout-action start-limit-action \
  on-failure standard-output socket-authority bus-authority pid-authority \
  notify-authority runtime-directory read-write-path
do
  printf '%s\n' "$mode" >"$MODE_FILE"
  assert_failure inspect
done

note "DEPLOY-PORTABILITY-008: the loaded fragment remains byte-equal to the accepted donor"
printf 'normal\n' >"$MODE_FILE"
for directive in \
  'Wants=unexpected.service' \
  'OnFailure=unexpected.service' \
  'SuccessAction=reboot' \
  'StandardOutput=file:/tmp/unexpected' \
  'RuntimeDirectory=unexpected' \
  'StateDirectory=unexpected' \
  'CacheDirectory=unexpected' \
  'LogsDirectory=unexpected' \
  'ConfigurationDirectory=unexpected'
do
  printf '\n%s\n' "$directive" >>"$FRAGMENT"
  assert_failure_contains 'fragment bytes differ from the accepted donor source' inspect
  cp "$FRAGMENT_SOURCE" "$FRAGMENT"
  chmod 600 "$FRAGMENT"
done

note "DEPLOY-PORTABILITY-008: the sole proof drop-in bytes, link, and absent sentinel are exact"
chmod 600 "$PROOF_DROP_IN"
printf '# unexpected override\n' >>"$PROOF_DROP_IN"
chmod 400 "$PROOF_DROP_IN"
assert_failure_contains 'proof drop-in bytes or ownership are not exact' inspect
write_proof_drop_in
rm "$PROOF_DROP_IN_RUNTIME_LINK"
ln -s "$DROP_IN" "$PROOF_DROP_IN_RUNTIME_LINK"
assert_failure_contains 'runtime link target differs' inspect
rm "$PROOF_DROP_IN_RUNTIME_LINK"
ln -s "$PROOF_DROP_IN" "$PROOF_DROP_IN_RUNTIME_LINK"
printf 'present\n' >"$PROOF_ABSENT_SENTINEL"
chmod 600 "$PROOF_ABSENT_SENTINEL"
assert_failure_contains 'proof absent sentinel must remain absent' inspect
rm "$PROOF_ABSENT_SENTINEL"

note "DEPLOY-PORTABILITY-008: runtime environment aliases and out-of-root staging paths are refused"
ln -s "$RUNTIME_ENV" "$ROOT/runtime-alias.env"
printf 'alias-runtime-env\n' >"$MODE_FILE"
assert_failure_contains 'not canonical' node "$INSPECTOR" \
  --systemctl "$SYSTEMCTL" --unit cosmos-app.service --node "$NODE_BIN" --env "$ENV_BIN" \
  --runtime-env "$ROOT/runtime-alias.env" --expected-fragment-path "$FRAGMENT" \
  --provenance-mode TEST \
  --expected-fragment-source "$FRAGMENT_SOURCE" --staging-root "$ROOT" \
  --proof-drop-in "$PROOF_DROP_IN" \
  --proof-drop-in-runtime-link "$PROOF_DROP_IN_RUNTIME_LINK" \
  --proof-absent-sentinel "$PROOF_ABSENT_SENTINEL"
assert_failure_contains 'requires one exact marked simulation root' node "$INSPECTOR" \
  --systemctl "$SYSTEMCTL" --unit cosmos-app.service --node "$NODE_BIN" --env "$ENV_BIN" \
  --runtime-env "$RUNTIME_ENV" --expected-fragment-path "$ALT_FRAGMENT" \
  --provenance-mode TEST \
  --expected-fragment-source "$FRAGMENT_SOURCE" --staging-root "$BIN_DIR" \
  --proof-drop-in "$PROOF_DROP_IN" \
  --proof-drop-in-runtime-link "$PROOF_DROP_IN_RUNTIME_LINK" \
  --proof-absent-sentinel "$PROOF_ABSENT_SENTINEL"

note "DEPLOY-PORTABILITY-008: unit bytes cannot change during inspection"
printf 'toctou\n' >"$MODE_FILE"
printf '0\n' >"$COUNT_FILE"
assert_failure_contains 'app unit binding changed during inspection' inspect

if [ "$(id -u)" -eq 0 ] \
    && [ -x /usr/bin/systemd-analyze ] \
    && [ -x /usr/bin/node ] \
    && [ -x /usr/bin/env ]; then
  note "DEPLOY-PORTABILITY-008: root Linux proves the private offline STAGING unit"
  for offset in $(seq 0 32); do
    candidate="$(printf '/var/tmp/cosmos-df32-proof-%04x' "$((($$ + offset) & 65535))")"
    if [ ! -e "$candidate" ]; then
      STAGING_ROOT="$candidate"
      break
    fi
  done
  [ -n "$STAGING_ROOT" ] || fail_test "no exact STAGING proof root is available"
  STAGING_SUFFIX="${STAGING_ROOT##*-}"
  STAGING_UNIT="cosmos-df32-proof-${STAGING_SUFFIX}.service"
  STAGING_UNIT_ROOT="$STAGING_ROOT/systemd"
  STAGING_FRAGMENT="$STAGING_UNIT_ROOT/$STAGING_UNIT"
  STAGING_DROP_IN="$STAGING_UNIT_ROOT/$STAGING_UNIT.d/90-cosmos-df32-proof-${STAGING_SUFFIX}.conf"
  STAGING_SOURCE="$STAGING_ROOT/accepted-donor/systemd/cosmos-app.service"
  STAGING_RUNTIME_ENV="$STAGING_ROOT/runtime/cosmos-app.env"
  STAGING_SYSTEMCTL="$STAGING_ROOT/tools/systemctl"
  STAGING_STATE="$STAGING_ROOT/runtime/systemctl-state"
  STAGING_SENTINEL="$STAGING_ROOT/.do-not-start-cosmos-df32-proof-${STAGING_SUFFIX}"
  mkdir -m 700 "$STAGING_ROOT"
  mkdir -m 700 \
    "$STAGING_UNIT_ROOT" \
    "$STAGING_UNIT_ROOT/$STAGING_UNIT.d" \
    "$STAGING_ROOT/runtime" \
    "$STAGING_ROOT/tools" \
    "$STAGING_ROOT/accepted-donor" \
    "$STAGING_ROOT/accepted-donor/systemd"
  cp "$REPO_ROOT/ops/live/systemd/cosmos-app.service" "$STAGING_FRAGMENT"
  cp "$REPO_ROOT/ops/live/systemd/cosmos-app.service" "$STAGING_SOURCE"
  printf '%s\n' \
    '[Unit]' \
    "ConditionPathExists=$STAGING_SENTINEL" \
    '' \
    '[Service]' \
    'EnvironmentFile=' \
    "EnvironmentFile=$STAGING_RUNTIME_ENV" \
    >"$STAGING_DROP_IN"
  printf '%s\n' 'HOST=127.0.0.1' 'PORT=8080' >"$STAGING_RUNTIME_ENV"
  printf 'inactive\n' >"$STAGING_STATE"
  {
    printf '%s\n' '#!/bin/sh' 'set -eu'
    printf '[ "$#" -eq 2 ] && [ "$1" = is-active ] && [ "$2" = %s ] || exit 91\n' \
      "$STAGING_UNIT"
    printf 'state="$(/bin/cat %s)"\n' "$STAGING_STATE"
    printf '%s\n' '[ "$state" = inactive ] || exit 92' "printf 'inactive\\n'" 'exit 3'
  } >"$STAGING_SYSTEMCTL"
  chmod 400 "$STAGING_FRAGMENT" "$STAGING_SOURCE" "$STAGING_DROP_IN"
  chmod 500 "$STAGING_SYSTEMCTL"
  chmod 600 "$STAGING_RUNTIME_ENV" "$STAGING_STATE"

  staging_inspect() {
    node "$INSPECTOR" \
      --systemctl "$STAGING_SYSTEMCTL" \
      --unit "$STAGING_UNIT" \
      --node /usr/bin/node \
      --env /usr/bin/env \
      --runtime-env "$STAGING_RUNTIME_ENV" \
      --provenance-mode STAGING \
      --expected-fragment-path "$STAGING_FRAGMENT" \
      --expected-fragment-source "$STAGING_SOURCE" \
      --staging-root "$STAGING_ROOT" \
      --offline-unit-root "$STAGING_UNIT_ROOT" \
      --systemd-analyze /usr/bin/systemd-analyze \
      --proof-drop-in "$STAGING_DROP_IN" \
      --proof-absent-sentinel "$STAGING_SENTINEL" \
      "$@"
  }

  STAGING_BASELINE="$(staging_inspect)"
  assert_contains "$STAGING_BASELINE" '"inspectionMode":"PRIVATE_OFFLINE_UNIT_ROOT"'
  assert_contains "$STAGING_BASELINE" '"needDaemonReload":"not-applicable-offline"'
  assert_contains "$STAGING_BASELINE" "\"offlineUnitRoot\":\"$STAGING_UNIT_ROOT\""
  assert_contains "$STAGING_BASELINE" "\"systemctlPath\":\"$STAGING_SYSTEMCTL\""
  assert_contains "$STAGING_BASELINE" "\"systemdAnalyzePath\":\"/usr/bin/systemd-analyze\""
  assert_contains "$STAGING_BASELINE" '"proofDropInRuntimeLinkPath":null'

  note "DEPLOY-PORTABILITY-008: STAGING refuses host manager paths and runtime links"
  assert_failure_contains 'exact proof-suffixed offline layout' node "$INSPECTOR" \
    --systemctl /usr/bin/systemctl \
    --unit "$STAGING_UNIT" \
    --node /usr/bin/node \
    --env /usr/bin/env \
    --runtime-env "$STAGING_RUNTIME_ENV" \
    --provenance-mode STAGING \
    --expected-fragment-path "$STAGING_FRAGMENT" \
    --expected-fragment-source "$STAGING_SOURCE" \
    --staging-root "$STAGING_ROOT" \
    --offline-unit-root "$STAGING_UNIT_ROOT" \
    --systemd-analyze /usr/bin/systemd-analyze \
    --proof-drop-in "$STAGING_DROP_IN" \
    --proof-absent-sentinel "$STAGING_SENTINEL"
  assert_failure node "$INSPECTOR" \
    --systemctl "$STAGING_SYSTEMCTL" \
    --unit "$STAGING_UNIT" \
    --node /usr/bin/node \
    --env /usr/bin/env \
    --runtime-env "$STAGING_RUNTIME_ENV" \
    --provenance-mode STAGING \
    --expected-fragment-path "$STAGING_FRAGMENT" \
    --expected-fragment-source "$STAGING_SOURCE" \
    --staging-root "$STAGING_ROOT" \
    --offline-unit-root "$STAGING_UNIT_ROOT" \
    --systemd-analyze /usr/bin/systemd-analyze \
    --proof-drop-in "$STAGING_DROP_IN" \
    --proof-drop-in-runtime-link "/run/systemd/system/$STAGING_UNIT.d/90-cosmos-df32-proof-${STAGING_SUFFIX}.conf" \
    --proof-absent-sentinel "$STAGING_SENTINEL"
else
  note "DEPLOY-PORTABILITY-008: private offline STAGING proof runs in the root Linux gate"
fi

finish
