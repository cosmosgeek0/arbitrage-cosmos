#!/usr/bin/env bash
# ops/tests/helpers.sh — shared assertions and sandbox for the ops test suite.
#
# Every test runs fully local: loopback HTTP only, mock systemctl, sandboxed
# filesystem under mktemp. bash 3.2 compatible.
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OPS_LIVE="$(cd "$TESTS_DIR/../live" && pwd -P)"
BIN="$OPS_LIVE/bin"
FIXTURES="$TESTS_DIR/fixtures"

ASSERTIONS=0
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/cosmos-ops-test.XXXXXX")"
SANDBOX="$(cd -P -- "$SANDBOX" && pwd -P)"
_CLEANUP_PIDS=""

cleanup() {
  local p
  for p in $_CLEANUP_PIDS; do
    kill "$p" 2>/dev/null || true
  done
  chmod -R u+w "$SANDBOX" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

register_pid() { _CLEANUP_PIDS="$_CLEANUP_PIDS $1"; }

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
note() { echo "  - $*"; }

# Core ops suites source this helper before the donor common library. Bind the
# exact canonical Node executable once so common.sh never falls back to
# host-specific command paths or re-resolves an ambient `node` name.
# Prefer the production fixed interpreter when it exists, exactly as
# ops/tests/i00/helpers.sh already does. Without this the generic harness
# exports the ambient PATH Node, and common.sh then makes that single
# inherited path the ONLY guard candidate - so a hosted runner's tool-cache
# Node (whose ancestors carry group-write) aborts every suite at source time
# while a perfectly good /usr/bin/node sits unused.
if [ -f /usr/bin/node ] && [ ! -L /usr/bin/node ] && [ -x /usr/bin/node ]; then
  export NODE=/usr/bin/node
else
_OPS_TEST_NODE="$(
  unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_ICU_DATA \
    NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_DEBUG NODE_DEBUG_NATIVE \
    OPENSSL_CONF SSL_CERT_FILE SSL_CERT_DIR \
    LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
    DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH
  command node -e '
    const fs = require("fs");
    process.stdout.write(fs.realpathSync(process.execPath));
  '
)" || fail "trusted Node executable is unavailable"
case "$_OPS_TEST_NODE" in
  /*) ;;
  *) fail "trusted Node executable did not resolve to an absolute path" ;;
esac
[ -f "$_OPS_TEST_NODE" ] && [ ! -L "$_OPS_TEST_NODE" ] && [ -x "$_OPS_TEST_NODE" ] \
  || fail "trusted Node executable is not one canonical executable file"
export NODE="$_OPS_TEST_NODE"
unset _OPS_TEST_NODE
fi

assert_eq() { # got expected label
  ASSERTIONS=$((ASSERTIONS + 1))
  [ "$1" = "$2" ] || fail "${3:-values differ}: expected [$2] got [$1]"
}
assert_ne() { # got not_expected label
  ASSERTIONS=$((ASSERTIONS + 1))
  [ "$1" != "$2" ] || fail "${3:-values should differ}: both are [$1]"
}
assert_file() { ASSERTIONS=$((ASSERTIONS + 1)); [ -f "$1" ] || fail "expected file: $1"; }
assert_no_file() { ASSERTIONS=$((ASSERTIONS + 1)); [ ! -e "$1" ] || fail "expected absent: $1"; }
assert_dir() { ASSERTIONS=$((ASSERTIONS + 1)); [ -d "$1" ] || fail "expected directory: $1"; }
assert_grep() { # pattern file label
  ASSERTIONS=$((ASSERTIONS + 1))
  grep -Eq "$1" "$2" || fail "${3:-pattern not found}: /$1/ in $2"
}
assert_not_grep() { # pattern file label
  ASSERTIONS=$((ASSERTIONS + 1))
  ! grep -Eq "$1" "$2" || fail "${3:-forbidden pattern found}: /$1/ in $2"
}
assert_link_target() { # link expected_target label
  ASSERTIONS=$((ASSERTIONS + 1))
  [ -L "$1" ] || fail "${3:-not a symlink}: $1"
  local got; got="$(readlink "$1")"
  [ "$got" = "$2" ] || fail "${3:-link target}: $1 -> [$got], expected [$2]"
}

# assert_rc EXPECTED_RC CMD... — run CMD, compare exit code (errexit-safe).
assert_rc() {
  local want="$1"; shift
  local rc=0
  "$@" || rc=$?
  ASSERTIONS=$((ASSERTIONS + 1))
  [ "$rc" = "$want" ] || fail "exit code: expected $want got $rc for: $*"
}

pick_port() {
  "$NODE" -e '
    const s = require("net").createServer();
    s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });
  '
}

wait_http() { # url [timeout_sec]
  local url="$1" timeout="${2:-10}"
  local deadline=$(( $(date -u +%s) + timeout ))
  while ! curl -fsS -m 2 -o /dev/null "$url" 2>/dev/null; do
    if [ "$(date -u +%s)" -ge "$deadline" ]; then
      fail "timeout waiting for $url"
    fi
    sleep 0.2
  done
}

start_fake_app() { # port [behavior_file] -> echoes pid
  local port="$1" behavior="${2:-}"
  PORT="$port" BEHAVIOR_FILE="$behavior" "$NODE" "$FIXTURES/fake-app.mjs" >/dev/null 2>&1 &
  local pid=$!
  register_pid "$pid"
  wait_http "http://127.0.0.1:$port/api/health"
  echo "$pid"
}

finish() { echo "OK ($ASSERTIONS assertions)"; }
