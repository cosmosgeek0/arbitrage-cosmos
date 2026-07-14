#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
guard="$source_root/quant/scripts/check-scope.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
check() {
  local label="$1"
  shift
  if "$@"; then
    pass=$((pass + 1))
    printf 'ok %d - %s\n' "$pass" "$label"
  else
    printf 'not ok - %s\n' "$label" >&2
    exit 1
  fi
}

git -C "$tmp" init -q -b quant-edge-research-factory-20260712
git -C "$tmp" config user.name q00-test
git -C "$tmp" config user.email q00-test@example.invalid
mkdir -p "$tmp/quant/scripts"
cp "$guard" "$tmp/quant/scripts/check-scope.sh"
chmod +x "$tmp/quant/scripts/check-scope.sh"
printf 'seed\n' > "$tmp/seed.txt"
git -C "$tmp" add seed.txt quant/scripts/check-scope.sh
git -C "$tmp" commit -q -m seed
protocol_sha="$(git -C "$tmp" rev-parse HEAD)"

run_guard() {
  (
    cd "$tmp"
    Q_EXPECTED_BRANCH=quant-edge-research-factory-20260712 Q_PROTOCOL_SHA="$protocol_sha" \
      ./quant/scripts/check-scope.sh >/dev/null 2>&1
  )
}

guard_fails() {
  if run_guard; then
    return 1
  fi
  return 0
}

mkdir -p "$tmp/quant/docs"
printf 'allowed\n' > "$tmp/quant/docs/allowed.md"
git -C "$tmp" add quant/docs/allowed.md
check 'allows a staged quant path' run_guard
git -C "$tmp" reset -q

printf 'outside\n' > "$tmp/outside.txt"
git -C "$tmp" add outside.txt
check 'rejects a staged non-quant path' guard_fails
git -C "$tmp" reset -q
rm -f "$tmp/outside.txt"

git -C "$tmp" mv seed.txt quant/docs/moved-seed.txt
check 'rejects an outside-to-quant rename' guard_fails
git -C "$tmp" reset -q
mv "$tmp/quant/docs/moved-seed.txt" "$tmp/seed.txt"

printf 'frozen\n' > "$tmp/quant/DIRECTIVE_INPUTS.lock"
git -C "$tmp" add quant/DIRECTIVE_INPUTS.lock
check 'rejects the frozen lock' guard_fails
git -C "$tmp" reset -q
rm -f "$tmp/quant/DIRECTIVE_INPUTS.lock"

git -C "$tmp" switch -q -c wrong-branch
printf 'allowed\n' > "$tmp/quant/docs/other.md"
git -C "$tmp" add quant/docs/other.md
check 'rejects the wrong branch' guard_fails

git -C "$tmp" reset -q
rm -f "$tmp/quant/docs/other.md"
git -C "$tmp" switch -q quant-edge-research-factory-20260712
printf 'committed outside\n' > "$tmp/committed-outside.txt"
git -C "$tmp" add committed-outside.txt
git -C "$tmp" commit -q -m 'out-of-scope history'
git -C "$tmp" rm -q committed-outside.txt
git -C "$tmp" commit -q -m 'remove out-of-scope file'
printf 'next quant change\n' > "$tmp/quant/docs/after-outside.md"
git -C "$tmp" add quant/docs/after-outside.md
check 'rejects reverted out-of-scope commit history' guard_fails

[[ "$pass" -eq 6 ]] || { printf 'expected 6 checks, got %d\n' "$pass" >&2; exit 1; }
printf '6/6 Q00 scope-guard checks passed\n'
