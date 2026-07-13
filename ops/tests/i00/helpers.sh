#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$TEST_DIR/../../.." && pwd -P)"
I00_ROOT="$REPO_ROOT/ops/i00"
DONOR_SHA=2cec412927fa2f64f05a0b2774b18e45f8ce4fa5
ASSERTIONS=0
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/ip-ops-i00.XXXXXX")"
cleanup_test_tmp() {
  chmod -R u+w "$TEST_TMP" 2>/dev/null || true
  rm -rf "$TEST_TMP"
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

make_release_inputs() {
  local source="$1" deps="$2" sha="$3" receipt="$4"
  local package_lock_sha deps_digest server_dist_digest web_dist_digest
  mkdir -p "$source/server/dist" "$source/web/dist" "$deps/fake-runtime"
  printf 'console.log("fixture server");\n' > "$source/server/dist/index.js"
  printf '<!doctype html><title>fixture</title>\n' > "$source/web/dist/index.html"
  printf '{"name":"fixture","private":true}\n' > "$source/package.json"
  printf '{"name":"fixture","lockfileVersion":3}\n' > "$source/package-lock.json"
  printf '{"name":"fixture-server","type":"module"}\n' > "$source/server/package.json"
  printf '{"name":"fake-runtime"}\n' > "$deps/fake-runtime/package.json"
  git -C "$REPO_ROOT" archive "$DONOR_SHA" ops/live | tar -x -C "$source"
  mkdir -p "$source/ops/templates" "$source/ops/docs"
  cp -R "$REPO_ROOT/ops/i00" "$source/ops/i00"
  cp -R "$REPO_ROOT/ops/templates/i00" "$source/ops/templates/i00"
  cp -R "$REPO_ROOT/ops/docs/i00" "$source/ops/docs/i00"
  package_lock_sha="$(shasum -a 256 "$source/package-lock.json" | awk '{print $1}')"
  deps_digest="$(node --input-type=module -e 'import {pathToFileURL} from "node:url"; const {treeDigest}=await import(pathToFileURL(process.argv[1]).href); process.stdout.write(treeDigest(process.argv[2]));' "$I00_ROOT/lib.mjs" "$deps")"
  server_dist_digest="$(node --input-type=module -e 'import {pathToFileURL} from "node:url"; const {treeDigest}=await import(pathToFileURL(process.argv[1]).href); process.stdout.write(treeDigest(process.argv[2]));' "$I00_ROOT/lib.mjs" "$source/server/dist")"
  web_dist_digest="$(node --input-type=module -e 'import {pathToFileURL} from "node:url"; const {treeDigest}=await import(pathToFileURL(process.argv[1]).href); process.stdout.write(treeDigest(process.argv[2]));' "$I00_ROOT/lib.mjs" "$source/web/dist")"
  node -e '
    const fs = require("fs");
    const [path, sha, packageLockSha256, runtimeDepsDigestSha256, serverDistDigestSha256, webDistDigestSha256] = process.argv.slice(1);
    fs.writeFileSync(path, JSON.stringify({
      schemaVersion: 1, status: "PASS", testedSha: sha, gitDirty: false,
      commands: [
        { command: "npm test", exitCode: 0 },
        { command: "npm run test:all", exitCode: 0 },
        { command: "bash ops/tests/i00/run-all.sh", exitCode: 0 }
      ],
      completedAtUtc: "2026-07-13T00:00:00Z",
      sourceTree: "SIMULATION_FIXTURE",
      packageLockSha256,
      runtimeDepsDigestSha256,
      serverDistDigestSha256,
      webDistDigestSha256
    }, null, 2) + "\n");
  ' "$receipt" "$sha" "$package_lock_sha" "$deps_digest" "$server_dist_digest" "$web_dist_digest"
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
    --schema-version 7 \
    --config-revision config-fixture \
    --model-revision UNAVAILABLE \
    --simulation-source >/dev/null
  printf '%s/releases/i00-%s' "$root" "$sha"
}
