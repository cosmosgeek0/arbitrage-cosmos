#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$TEST_DIR/../../.." && pwd -P)"
I00_ROOT="$REPO_ROOT/ops/i00"
DONOR_SHA=2cec412927fa2f64f05a0b2774b18e45f8ce4fa5
ASSERTIONS=0
if [ -f /usr/bin/node ] && [ ! -L /usr/bin/node ] && [ -x /usr/bin/node ]; then
  I00_TEST_HELPER_NODE=/usr/bin/node
else
  I00_TEST_HELPER_NODE_BOOTSTRAP="$(command -v node)" \
    || { printf 'NOT OK: fixed test helper Node is unavailable\n' >&2; exit 1; }
  case "$I00_TEST_HELPER_NODE_BOOTSTRAP" in
    /*) ;;
    *) printf 'NOT OK: test helper Node bootstrap is not absolute\n' >&2; exit 1 ;;
  esac
  I00_TEST_HELPER_NODE="$(
    unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS \
      NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE \
      NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE \
      NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN \
      LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
      DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
      OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR
    "$I00_TEST_HELPER_NODE_BOOTSTRAP" -e \
      'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))'
  )" || { printf 'NOT OK: test helper Node bootstrap failed\n' >&2; exit 1; }
fi
# Suites in this tree invoke a bare `node`. The tooling they exercise binds the
# fixed interpreter resolved above, and the two must be the same file or the
# identity bindings legitimately disagree. On a developer machine there is only
# one interpreter, so this is invisible; a hosted runner puts a second one
# earlier on PATH. Put the resolved interpreter's directory first so a bare
# `node` is the same file the tooling uses. Resolution itself is unchanged.
PATH="$(dirname "$I00_TEST_HELPER_NODE"):$PATH"
export PATH
for I00_TEST_MKTEMP_CANDIDATE in /usr/bin/mktemp /bin/mktemp; do
  if [ -f "$I00_TEST_MKTEMP_CANDIDATE" ] \
      && [ ! -L "$I00_TEST_MKTEMP_CANDIDATE" ] \
      && [ -x "$I00_TEST_MKTEMP_CANDIDATE" ]; then
    I00_TEST_MKTEMP="$I00_TEST_MKTEMP_CANDIDATE"
    break
  fi
done
[ -n "${I00_TEST_MKTEMP:-}" ] \
  || { printf 'NOT OK: fixed test helper mktemp is unavailable\n' >&2; exit 1; }
FIXED_TEST_TMP_PARENT="$(
  unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS \
    NODE_V8_COVERAGE NODE_ICU_DATA NODE_DEBUG NODE_DEBUG_NATIVE \
    NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_DISABLE_COMPILE_CACHE \
    NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN \
    LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
    DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
    OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR
  "$I00_TEST_HELPER_NODE" -e \
    'process.stdout.write(require("fs").realpathSync("/tmp"))'
)"
if [ -n "${I00_TEST_TMP_OVERRIDE:-}" ]; then
  TEST_TMP="$(
    "$I00_TEST_HELPER_NODE" --input-type=module - "$I00_TEST_TMP_OVERRIDE" <<'NODE'
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const target = process.argv[2];
const parent = dirname(target);
const fail = (message) => {
  process.stderr.write(`NOT OK: exact test temp override ${message}\n`);
  process.exit(1);
};
if (!isAbsolute(target) || resolve(target) !== target
    || basename(target) !== 'test-tmp'
    || !/^\/var\/tmp\/cosmos-df32-proof-[0-9a-f]{4}$/u.test(parent)) {
  fail('is not the fixed staging child');
}
const parentNamed = lstatSync(parent, { bigint: true });
if (!parentNamed.isDirectory() || parentNamed.isSymbolicLink()
    || realpathSync(parent) !== parent
    || (parentNamed.mode & 0o777n) !== 0o700n
    || (typeof process.getuid === 'function'
      && parentNamed.uid !== BigInt(process.getuid()))) {
  fail('parent binding is invalid');
}
if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
  fail('must be absent before exact creation');
}
let descriptor;
try {
  descriptor = openSync(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const opened = fstatSync(descriptor, { bigint: true });
  if (opened.dev !== parentNamed.dev || opened.ino !== parentNamed.ino) {
    fail('parent identity changed before creation');
  }
  const anchored = `/proc/self/fd/${descriptor}/test-tmp`;
  if (realpathSync(`/proc/self/fd/${descriptor}`) !== parent) {
    fail('parent descriptor is not the fixed staging root');
  }
  mkdirSync(anchored, { mode: 0o700 });
  const created = lstatSync(target, { bigint: true });
  const openedAfter = fstatSync(descriptor, { bigint: true });
  const namedAfter = lstatSync(parent, { bigint: true });
  if (!created.isDirectory() || created.isSymbolicLink()
      || realpathSync(target) !== target
      || (created.mode & 0o777n) !== 0o700n
      || openedAfter.dev !== opened.dev || openedAfter.ino !== opened.ino
      || namedAfter.dev !== opened.dev || namedAfter.ino !== opened.ino) {
    fail('identity changed during exact creation');
  }
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
process.stdout.write(target);
NODE
  )" || exit 1
else
  TEST_TMP="$("$I00_TEST_MKTEMP" -d "$FIXED_TEST_TMP_PARENT/ip-ops-i00.XXXXXX")"
fi
cleanup_test_tmp() {
  local rc="${1:-$?}"
  chmod -R u+w "$TEST_TMP" 2>/dev/null || true
  rm -rf "$TEST_TMP"
  return "$rc"
}
trap cleanup_test_tmp EXIT

note() { printf '  - %s\n' "$*"; }
pass_assertion() { ASSERTIONS=$((ASSERTIONS + 1)); }
fail_test() { printf 'NOT OK: %s\n' "$*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail_test "expected [$2], got [$1]"; pass_assertion; }
assert_contains() { printf '%s' "$1" | grep -F -- "$2" >/dev/null || fail_test "missing text [$2]"; pass_assertion; }
assert_file() { [ -f "$1" ] || fail_test "missing file $1"; pass_assertion; }
assert_not_file() { [ ! -e "$1" ] || fail_test "unexpected path $1"; pass_assertion; }
assert_success() { "$@" >/dev/null 2>&1 || fail_test "command failed: $*"; pass_assertion; }
assert_failure() { if "$@" >/dev/null 2>&1; then fail_test "command unexpectedly passed: $*"; fi; pass_assertion; }
assert_failure_contains() {
  local expected="$1" output rc
  shift
  set +e
  output="$("$@" 2>&1)"; rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail_test "command unexpectedly passed: $*"
  printf '%s' "$output" | grep -F -- "$expected" >/dev/null || fail_test "failure did not contain [$expected]: $output"
  pass_assertion
}
finish() { printf 'OK (%s assertions)\n' "$ASSERTIONS"; }

materialize_donor() {
  local target="$1"
  mkdir -p "$target"
  git -C "$REPO_ROOT" archive "$DONOR_SHA" ops/live ops/tests | tar -x -C "$target"
}

materialize_effective_l15() {
  local target="$1"
  mkdir -p "$target/ops"
  cp -R "$REPO_ROOT/ops/live" "$target/ops/live"
}

make_release_inputs() {
  local source="$1" deps="$2" sha="$3" receipt="$4"
  local tree=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  mkdir -p "$source/server/dist" "$source/web/dist" \
    "$deps/fake-runtime" "$deps/better-sqlite3" "$deps/ws"
  printf 'console.log("fixture server");\n' > "$source/server/dist/index.js"
  printf 'export const LEDGER_SCHEMA_VERSION = 1;\nexport const LEDGER_ROLLBACK_FLOOR = 1;\n' > "$source/server/dist/ledger.js"
  printf '<!doctype html><title>fixture</title>\n' > "$source/web/dist/index.html"
  printf '{"name":"fixture","private":true}\n' > "$source/package.json"
  printf '{"name":"fixture","lockfileVersion":3}\n' > "$source/package-lock.json"
  printf '{"name":"fixture-server","type":"module"}\n' > "$source/server/package.json"
  printf '{"name":"fake-runtime"}\n' > "$deps/fake-runtime/package.json"
  printf '{"name":"better-sqlite3","version":"0.0.0-fixture","main":"index.cjs"}\n' > "$deps/better-sqlite3/package.json"
  printf 'module.exports = function FixtureDatabase() { throw new Error("FIXTURE_DATABASE_NOT_EXECUTABLE"); };\n' > "$deps/better-sqlite3/index.cjs"
  printf '{"name":"ws","version":"0.0.0-fixture","main":"index.cjs"}\n' > "$deps/ws/package.json"
  printf 'module.exports = class FixtureWebSocket {};\n' > "$deps/ws/index.cjs"
  mkdir -p "$source/ops"
  cp -R "$REPO_ROOT/ops/live" "$source/ops/live"
  mkdir -p "$source/ops/templates" "$source/ops/docs"
  cp -R "$REPO_ROOT/ops/i00" "$source/ops/i00"
  cp -R "$REPO_ROOT/ops/templates/i00" "$source/ops/templates/i00"
  cp -R "$REPO_ROOT/ops/docs/i00" "$source/ops/docs/i00"
  mkdir -p "$source/test/i00/performance"
  for file in donor-equality.mjs verify-scope.mjs scope-security.mjs; do
    cp "$REPO_ROOT/test/i00/$file" "$source/test/i00/$file"
  done
  for file in contract.mjs local-acceptance.mjs local-proxy-soak.mjs app-probe.mjs schema.v1.json protected-owner-directives.bundle.v1.json browser-receipt.schema.v2.json browser-measurement.schema.v1.json browser-capture.schema.v3.json browser-restart-measurement.schema.v1.json; do
    cp "$REPO_ROOT/test/i00/performance/$file" "$source/test/i00/performance/$file"
  done
  node "$TEST_DIR/fixtures/make-complete-acceptance.mjs" "$source" "$receipt" "$sha" "$tree" >/dev/null
}

assemble_fixture_release() {
  local root="$1" sha="$2"
  make_release_inputs "$root/source" "$root/deps" "$sha" "$root/tested.json"
  node "$I00_ROOT/bin/assemble-release.mjs" \
    --source-root "$root/source" \
    --runtime-deps "$root/deps" \
    --output-root "$root/releases" \
    --tested-sha "$sha" \
    --tested-receipt "$root/tested.json" \
    --built-at-utc 2026-07-13T00:00:00Z \
    --config-revision config-fixture \
    --model-revision UNAVAILABLE \
    --simulation-source >/dev/null
  printf '%s/releases/i00-%s' "$root" "$sha"
}
