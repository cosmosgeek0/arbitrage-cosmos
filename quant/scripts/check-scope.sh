#!/usr/bin/env bash
set -euo pipefail

expected_branch="${Q_EXPECTED_BRANCH:-quant-edge-research-factory-20260712}"
protocol_sha="${Q_PROTOCOL_SHA:-73e1a1ff7daa48df8dac45713fc5f106842edafc}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'Q_SCOPE_FAIL: %s\n' "$*" >&2
  exit 1
}

validate_lane_path() {
  local origin="$1"
  local path="$2"
  case "$path" in
    quant/*) ;;
    *) fail "$origin path is outside quant/**: $path" ;;
  esac
  [[ "$path" != "quant/DIRECTIVE_INPUTS.lock" ]] || fail "$origin path touches the frozen lock"
}

branch="$(git branch --show-current)"
[[ "$branch" == "$expected_branch" ]] || fail "branch $branch is not $expected_branch"
git cat-file -e "${protocol_sha}^{commit}" 2>/dev/null || fail "protocol commit $protocol_sha is unavailable"
git merge-base --is-ancestor "$protocol_sha" HEAD || fail "HEAD does not descend from protocol commit $protocol_sha"

frozen_paths=(
  EDGE_PROTOCOL_V1.md
  packages/edge-protocol
  packages/edge-protocol-tests
  quant/DIRECTIVE_INPUTS.lock
)
git diff --quiet "$protocol_sha" -- "${frozen_paths[@]}" || fail "a frozen protocol/input path differs from $protocol_sha"

while IFS= read -r -d '' path; do
  [[ -n "$path" ]] || continue
  validate_lane_path "committed protocol..HEAD" "$path"
done < <(git log --format= --name-only --no-renames -z "$protocol_sha"..HEAD)

staged=0
while IFS= read -r -d '' path; do
  staged=$((staged + 1))
  validate_lane_path "staged" "$path"
done < <(git diff --cached --name-only --no-renames --diff-filter=ACMRDTUXB -z)

(( staged > 0 )) || fail "no staged Q-lane paths"
git diff --cached --check
printf 'Q_SCOPE_OK: branch=%s protocol=%s staged_paths=%d\n' "$branch" "$protocol_sha" "$staged"
