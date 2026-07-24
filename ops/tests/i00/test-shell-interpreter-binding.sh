#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

WRAPPERS=(
  install-ops-bundle.sh
  release-switch.sh
  rollback-switch.sh
  backup-verify.sh
  restore-drill-verify.sh
)

note "production effect wrappers fix privileged Bash before any external command"
for name in "${WRAPPERS[@]}"; do
  wrapper="$I00_ROOT/bin/$name"
  source="$(cat "$wrapper")"
  assert_eq "$(sed -n '1p' "$wrapper")" '#!/bin/bash -p'
  safe_path_line="$(grep -n -m1 '^SAFE_PATH=' "$wrapper" | cut -d: -f1)"
  script_dir_line="$(grep -n -m1 '^SCRIPT_DIR=' "$wrapper" | cut -d: -f1)"
  [ "$safe_path_line" -lt "$script_dir_line" ] \
    || fail_test "$name does not close PATH before resolving its own location"
  pass_assertion
  assert_contains "$source" 'SAFE_PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"'
  assert_contains "$source" 'PATH="$SAFE_PATH"'
  assert_contains "$source" 'export PATH'
  assert_contains "$source" 'unset BASH_ENV ENV CDPATH GLOBIGNORE'
  assert_contains "$source" 'NODE_EXTRA_CA_CERTS'
  assert_contains "$source" 'NODE_COMPILE_CACHE'
  assert_contains "$source" 'NODE_PRESERVE_SYMLINKS_MAIN'
  assert_contains "$source" 'NODE_TLS_REJECT_UNAUTHORIZED'
  assert_contains "$source" 'LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH'
  assert_contains "$source" 'DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH'
  assert_contains "$source" 'OPENSSL_CONF OPENSSL_MODULES'
  assert_contains "$source" 'SSL_CERT_FILE SSL_CERT_DIR'
  assert_contains "$source" 'hash -p "$SIMULATION_NODE_PATH" node'
  if [ "$name" = install-ops-bundle.sh ]; then
    assert_contains "$source" 'I00_EFFECT_EXEC_BASH_FD'
    assert_contains "$source" "bash: '/proc/self/fd/17'"
    assert_contains "$source" 'I00_EFFECT_EXEC_NODE_FD'
    assert_contains "$source" "node: '/proc/self/fd/16'"
  elif [ "$name" = release-switch.sh ]; then
    assert_contains "$source" 'hash -p "$NODE_PATH" node'
    assert_contains "$source" 'fs.realpathSync("/bin/bash")'
    assert_contains "$source" 'running Bash does not match the fixed interpreter'
    assert_contains "$source" 'run-bound-effect.mjs'
    assert_contains "$source" '--i00-effect-environment "$DELEGATE_ENV"'
  else
    assert_contains "$source" 'hash -p "$NODE_PATH" node'
    assert_contains "$source" 'fs.realpathSync("/bin/bash")'
    assert_contains "$source" 'running Bash does not match the fixed interpreter'
    assert_contains "$source" 'bash-path:'
    assert_contains "$source" 'bash-sha256:'
    assert_contains "$source" 'bash-identity:'
  fi
done

note "privileged Node bootstrap precedes every production runtime execution"
for name in "${WRAPPERS[@]}"; do
  source="$(cat "$I00_ROOT/bin/$name")"
  assert_contains "$source" 'for candidate in /usr/bin/node; do'
  assert_contains "$source" '[ -O /usr/bin/stat ]'
  assert_contains "$source" "/usr/bin/stat -c '%u:%a'"
  assert_contains "$source" 'production Node bootstrap requires root'
  assert_contains "$source" 'fixed I00 tree verifier is unavailable'
  if [ "$name" = install-ops-bundle.sh ]; then
    assert_contains "$source" '"$NODE_PATH" "$BOUND_EFFECT_RUNNER"'
  else
    assert_contains "$source" 'run-fixed-node-gate.sh" inspect-executable.mjs'
  fi
  if printf '%s' "$source" | grep -F '/usr/bin/nodejs' >/dev/null; then
    fail_test "$name retains a divergent production Node candidate"
  fi
  pass_assertion
done

LAUNCHER_SOURCE="$(cat "$I00_ROOT/bin/run-fixed-node-gate.sh")"
assert_eq "$(sed -n '1p' "$I00_ROOT/bin/run-fixed-node-gate.sh")" '#!/bin/bash -p'
assert_contains "$LAUNCHER_SOURCE" 'for candidate in /usr/bin/node; do'
assert_contains "$LAUNCHER_SOURCE" '[ -O "$bootstrap" ]'
assert_contains "$LAUNCHER_SOURCE" "/usr/bin/stat -c '%u:%a'"
assert_contains "$LAUNCHER_SOURCE" 'fixed Node launcher requires root'
assert_contains "$LAUNCHER_SOURCE" 'LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH'
assert_contains "$LAUNCHER_SOURCE" 'DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH'
assert_contains "$LAUNCHER_SOURCE" 'NODE_COMPILE_CACHE'
assert_contains "$LAUNCHER_SOURCE" 'OPENSSL_CONF OPENSSL_MODULES'
assert_contains "$LAUNCHER_SOURCE" 'SSL_CERT_FILE SSL_CERT_DIR'
assert_contains "$LAUNCHER_SOURCE" 'exec /usr/bin/env -i'
assert_contains "$LAUNCHER_SOURCE" 'if [ "$1" = --attest-tree ]; then'
assert_contains "$LAUNCHER_SOURCE" 'tree attestation accepts no gate arguments'
assert_contains "$LAUNCHER_SOURCE" 'trusted_i00_tree_snapshot'
assert_contains "$LAUNCHER_SOURCE" 'fixed I00 gate tree identity changed'
assert_contains "$LAUNCHER_SOURCE" 'app-entrypoint.mjs|assemble-release.mjs|create-private-temp.mjs'
if printf '%s' "$LAUNCHER_SOURCE" | grep -E '/usr/(local/)?bin/nodejs?' \
    | grep -v '/usr/bin/node' >/dev/null; then
  fail_test 'launcher retains a divergent production Node candidate'
fi
pass_assertion

note "donor effects use an explicit privileged Bash under a closed environment"
for binding in \
  'release-switch.sh|deploy.sh' \
  'rollback-switch.sh|rollback.sh' \
  'backup-verify.sh|backup.sh' \
  'restore-drill-verify.sh|restore.sh'
do
  wrapper="${binding%%|*}"
  donor="${binding#*|}"
  source="$(cat "$I00_ROOT/bin/$wrapper")"
  assert_contains "$source" 'run-bound-effect.mjs'
  assert_contains "$source" "\"\$DONOR_ROOT/bin/$donor\""
  assert_contains "$source" '--i00-effect-environment'
  assert_contains "$source" 'verify-donor-root.mjs'
  assert_contains "$source" 'effective donor tree changed around'
  assert_contains "$source" 'effective donor root identity changed around'
  if printf '%s\n' "$source" \
      | grep -E "^[[:space:]]*\"\\\$DONOR_ROOT/bin/$donor\"" >/dev/null; then
    fail_test "$wrapper retains direct shebang-based donor execution"
  fi
  pass_assertion
done

note "release-switch delegates only the producer-bound fixed effect class"
RELEASE_SWITCH_SOURCE="$(cat "$I00_ROOT/bin/release-switch.sh")"
assert_eq "$(grep -c -- '--class SERVICE_RELEASE_SWITCH' "$I00_ROOT/bin/release-switch.sh")" 1
assert_contains "$RELEASE_SWITCH_SOURCE" 'run-bound-effect.mjs'
assert_contains "$RELEASE_SWITCH_SOURCE" '-- "$DONOR_ROOT/bin/deploy.sh"'
RELEASE_RUNNER_LINE="$(grep -n -m1 '"$NODE_BIN" "$SCRIPT_DIR/run-bound-effect.mjs"' \
  "$I00_ROOT/bin/release-switch.sh" | cut -d: -f1)"
RELEASE_RECORDER_LINE="$(grep -n -m1 '"$NODE_BIN" "$SCRIPT_DIR/record-release-switch-receipt.mjs"' \
  "$I00_ROOT/bin/release-switch.sh" | cut -d: -f1)"
RELEASE_POSTCHECK_LINE="$(awk -v recorder="$RELEASE_RECORDER_LINE" \
  'NR > recorder && /require_first_host_directory_binding/ { print NR; exit }' \
  "$I00_ROOT/bin/release-switch.sh")"
[ "$RELEASE_RUNNER_LINE" -lt "$RELEASE_RECORDER_LINE" ] \
  && [ "$RELEASE_RECORDER_LINE" -lt "$RELEASE_POSTCHECK_LINE" ] \
  || fail_test "release-switch receipt recorder does not precede post-effect checks"
pass_assertion
if printf '%s\n' "$RELEASE_SWITCH_SOURCE" \
  | grep -E '^[[:space:]]*(export[[:space:]]+)?I00_EFFECT_CLASS=' >/dev/null; then
  fail_test 'release-switch retains ambient effect-class authority'
fi
pass_assertion

note "ops-bundle filesystem effects use descriptor-bound executables and roots"
INSTALL_SOURCE="$(cat "$I00_ROOT/bin/install-ops-bundle.sh")"
for binding in \
  'mkdir|27' \
  'cp|28' \
  'chmod|29' \
  'mv|30' \
  'rm|31'
do
  command="${binding%%|*}"
  descriptor="${binding#*|}"
  upper="$(printf '%s' "$command" | tr '[:lower:]' '[:upper:]')"
  assert_contains "$INSTALL_SOURCE" "I00_EFFECT_EXEC_${upper}_FD"
  assert_contains "$INSTALL_SOURCE" "/proc/self/fd/$descriptor"
done
assert_contains "$INSTALL_SOURCE" 'I00_AUTHORIZED_EFFECT_WRITE_ROOT_DESTINATION_PARENT_FD'
assert_contains "$INSTALL_SOURCE" 'I00_AUTHORIZED_EFFECT_READ_ROOT_RELEASE_SOURCE_FD'
assert_contains "$INSTALL_SOURCE" 'local release_cap=/proc/self/fd/51'
assert_contains "$INSTALL_SOURCE" 'local write_cap=/proc/self/fd/40'
assert_contains "$INSTALL_SOURCE" 'trap cleanup_authorized_staging EXIT'
assert_contains "$INSTALL_SOURCE" '--authorization-consumption "$AUTHORIZATION_CONSUMPTION"'
assert_contains "$INSTALL_SOURCE" 'FIXED_I00_TREE_INITIAL="$("$FIXED_GATE_LAUNCHER" --attest-tree)"'
assert_contains "$INSTALL_SOURCE" 'require_fixed_i00_tree'
assert_contains "$INSTALL_SOURCE" 'require_outer_bash_binding'
assert_contains "$INSTALL_SOURCE" '"$FIXED_GATE_LAUNCHER" validate-release.mjs'
assert_contains "$INSTALL_SOURCE" '"$FIXED_GATE_LAUNCHER" validate-authorization.mjs'
assert_contains "$INSTALL_SOURCE" '"$FIXED_GATE_LAUNCHER" record-authorized-action-outcome.mjs'
assert_contains "$INSTALL_SOURCE" 'running Bash differs from the risk-bound Bash endpoint'
INSTALL_RUNNER_LINE="$(grep -n -m1 '"$NODE_PATH" "$BOUND_EFFECT_RUNNER"' \
  "$I00_ROOT/bin/install-ops-bundle.sh" | cut -d: -f1)"
INSTALL_RECORDER_LINE="$(grep -n -m1 '"$FIXED_GATE_LAUNCHER" record-authorized-action-outcome.mjs' \
  "$I00_ROOT/bin/install-ops-bundle.sh" | cut -d: -f1)"
INSTALL_POSTCHECK_LINE="$(awk -v recorder="$INSTALL_RECORDER_LINE" \
  'NR > recorder && /require_fixed_i00_tree/ { print NR; exit }' \
  "$I00_ROOT/bin/install-ops-bundle.sh")"
[ "$INSTALL_RUNNER_LINE" -lt "$INSTALL_RECORDER_LINE" ] \
  && [ "$INSTALL_RECORDER_LINE" -lt "$INSTALL_POSTCHECK_LINE" ] \
  || fail_test "ops-bundle outcome recorder does not precede post-effect checks"
pass_assertion
for forbidden in --uid --gid --program --authorization-expires-at-utc \
  --evidence-valid-until-utc --receipt-reserve-sec; do
  if printf '%s\n' "$INSTALL_SOURCE" | grep -F -- "$forbidden" >/dev/null; then
    fail_test "ops-bundle installer retains legacy runner control $forbidden"
  fi
  pass_assertion
done
if printf '%s\n' "$INSTALL_SOURCE" \
    | grep -E '^[[:space:]]*(mkdir|cp|chmod|mv|rm)([[:space:]]|$)' >/dev/null; then
  fail_test 'ops-bundle installer retains a PATH-resolved filesystem effect'
fi
pass_assertion

note "hostile startup and command-search environment cannot run before wrapper refusal"
HOSTILE_BIN="$TEST_TMP/hostile-bin"
mkdir "$HOSTILE_BIN"
PATH_MARKER="$TEST_TMP/path-marker"
NODE_MARKER="$TEST_TMP/node-marker"
cat >"$HOSTILE_BIN/dirname" <<EOF
#!/bin/bash -p
printf 'unexpected\\n' >"$PATH_MARKER"
exec /usr/bin/dirname "\$@"
EOF
cat >"$HOSTILE_BIN/node" <<EOF
#!/bin/bash -p
printf 'unexpected\\n' >"$NODE_MARKER"
exit 97
EOF
chmod 755 "$HOSTILE_BIN/dirname"
chmod 755 "$HOSTILE_BIN/node"
for name in "${WRAPPERS[@]}"; do
  marker="$TEST_TMP/$name.bash-env-marker"
  startup="$TEST_TMP/$name.bash-env"
  printf "printf 'unexpected\\\\n' >'%s'\n" "$marker" >"$startup"
  set +e
  /usr/bin/env BASH_ENV="$startup" \
    PATH="$HOSTILE_BIN:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin" \
    "$I00_ROOT/bin/$name" --df32-unsupported-option >/dev/null 2>&1
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail_test "$name unexpectedly accepted the hostile invocation"
  pass_assertion
  assert_not_file "$marker"
  assert_not_file "$PATH_MARKER"
  assert_not_file "$NODE_MARKER"
done

finish
