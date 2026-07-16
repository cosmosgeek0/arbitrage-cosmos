#!/usr/bin/env bash

set -euo pipefail

readonly EXPECTED_BRANCH='live-execution-control-proof-20260712'
readonly KNOWN_DIRECTOR_ANCHOR='3a8e17be71d21df14f6b236a563cb0595f9eb824'
readonly PROTECTED_LAUNCH='DIRECTOR_Q_L_TWO_LANE_LAUNCH.md'
readonly PROTECTED_LAUNCH_SHA256='26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06'
readonly PROTECTED_DIRECTIVE='LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md'
readonly PROTECTED_DIRECTIVE_SHA256='40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037'

# The gate audits the repository containing this script. Inherited Git
# location/object/index overrides must not redirect any of its reads.
unset GIT_DIR
unset GIT_WORK_TREE
unset GIT_COMMON_DIR
unset GIT_INDEX_FILE
unset GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES
unset GIT_QUARANTINE_PATH
unset GIT_NAMESPACE
unset GIT_SHALLOW_FILE
unset GIT_REPLACE_REF_BASE
unset GIT_CEILING_DIRECTORIES
unset GIT_DISCOVERY_ACROSS_FILESYSTEM
unset GIT_CONFIG_COUNT
unset GIT_CONFIG_PARAMETERS
unset GIT_CONFIG_SYSTEM
unset GIT_CONFIG_GLOBAL
unset GIT_CONFIG_NOSYSTEM
export GIT_NO_REPLACE_OBJECTS=1

blocked() {
  local code="$1"
  shift

  printf 'L_WORKER_SCOPE_BLOCKED code=%s' "$code"
  while [ "$#" -gt 0 ]; do
    printf ' %s' "$1"
    shift
  done
  printf '\n'
  exit 1
}

usage() {
  printf 'usage: %s [--final]\n' "${0##*/}" >&2
  exit 2
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || blocked 'MISSING_TOOL' "tool=$1"
}

quote_path() {
  local quoted
  printf -v quoted '%q' "$1"
  printf '%s' "$quoted"
}

is_allowlisted_path() {
  case "$1" in
    server/src/liveEdge/integration/* | \
    server/src/liveEdge/adapters/* | \
    server/test/liveEdge/* | \
    ops/live/* | \
    ops/tests/* | \
    web/src/features/liveControl/adapters/* | \
    web/src/features/edgeResearch/adapters/* | \
    live-edge-receipts/* | \
    LIVE_EXECUTION_BUILD_STATE.md | \
    LIVE_EDGE_COMPONENTS.md | \
    LIVE_EDGE_RECEIPT.md)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_allowlisted_path() {
  local path="$1"
  local source="$2"
  local quoted

  if ! is_allowlisted_path "$path"; then
    quoted=$(quote_path "$path")
    blocked 'PATH_OUTSIDE_ALLOWLIST' "source=$source" "path=$quoted"
  fi
}

is_qualifying_director_merge() {
  local commit="$1"
  local parents
  local parent
  local parent_count=0
  local subject

  parents=$(git show -s --format=%P "$commit") || \
    blocked 'GIT_METADATA_READ_FAILED' "commit=$commit" 'field=parents'
  for parent in $parents; do
    parent_count=$((parent_count + 1))
  done
  [ "$parent_count" -eq 2 ] || return 1

  subject=$(git show -s --format=%s "$commit") || \
    blocked 'GIT_METADATA_READ_FAILED' "commit=$commit" 'field=subject'
  case "$subject" in
    director:*) return 0 ;;
    *) return 1 ;;
  esac
}

verify_protected_input() {
  local path="$1"
  local expected_sha256="$2"
  local actual_sha256
  local git_status

  [ -e "$path" ] || blocked 'PROTECTED_MISSING' "path=$path"
  if [ -L "$path" ] || [ ! -f "$path" ]; then
    blocked 'PROTECTED_NOT_REGULAR' "path=$path"
  fi

  actual_sha256=$(shasum -a 256 -- "$path") || \
    blocked 'PROTECTED_HASH_READ_FAILED' "path=$path"
  actual_sha256=${actual_sha256%% *}
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    blocked 'PROTECTED_HASH_MISMATCH' "path=$path" \
      "expected=$expected_sha256" "actual=$actual_sha256"
  fi

  if git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    blocked 'PROTECTED_TRACKED_OR_STAGED' "path=$path"
  else
    git_status=$?
    if [ "$git_status" -ne 1 ]; then
      blocked 'PROTECTED_INDEX_READ_FAILED' "path=$path" "exit=$git_status"
    fi
  fi
  if git check-ignore -q -- "$path"; then
    blocked 'PROTECTED_IGNORED' "path=$path"
  else
    git_status=$?
    if [ "$git_status" -ne 1 ]; then
      blocked 'PROTECTED_IGNORE_READ_FAILED' "path=$path" "exit=$git_status"
    fi
  fi
}

mode='WORKTREE'
if [ "$#" -gt 1 ]; then
  usage
fi
if [ "$#" -eq 1 ]; then
  [ "$1" = '--final' ] || usage
  mode='FINAL'
fi

require_tool git
require_tool shasum
require_tool mktemp
require_tool rm

script_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P) || \
  blocked 'SCRIPT_REPOSITORY_RESOLVE_FAILED'
repo_root=$(git -C "$script_repo" rev-parse --show-toplevel 2>/dev/null) || \
  blocked 'NOT_A_GIT_WORKTREE'
cd "$repo_root"

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || \
  blocked 'DETACHED_HEAD'
if [ "$branch" != "$EXPECTED_BRANCH" ]; then
  blocked 'BRANCH_MISMATCH' "expected=$EXPECTED_BRANCH" "actual=$branch"
fi

grafts_path=$(git rev-parse --git-path info/grafts) || \
  blocked 'GRAFT_PATH_READ_FAILED'
if [ -e "$grafts_path" ] || [ -L "$grafts_path" ]; then
  blocked 'LEGACY_GRAFTS_PRESENT' "path=$(quote_path "$grafts_path")"
fi

checked_head=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null) || \
  blocked 'HEAD_NOT_A_COMMIT'
git cat-file -e "${KNOWN_DIRECTOR_ANCHOR}^{commit}" 2>/dev/null || \
  blocked 'ANCHOR_MISSING' "anchor=$KNOWN_DIRECTOR_ANCHOR"
if ! git merge-base --is-ancestor "$KNOWN_DIRECTOR_ANCHOR" "$checked_head"; then
  blocked 'ANCHOR_NOT_ANCESTOR' "anchor=$KNOWN_DIRECTOR_ANCHOR"
fi

tmp_dir=$(mktemp -d '/tmp/lane-worker-scope.XXXXXX') || \
  blocked 'TEMP_CREATE_FAILED'
cleanup() {
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

git rev-list --first-parent "$checked_head" > "$tmp_dir/first-parent" || \
  blocked 'FIRST_PARENT_READ_FAILED'

baseline=''
anchor_on_first_parent=0
while IFS= read -r commit; do
  if [ -z "$baseline" ] && is_qualifying_director_merge "$commit"; then
    baseline="$commit"
  fi
  if [ "$commit" = "$KNOWN_DIRECTOR_ANCHOR" ]; then
    anchor_on_first_parent=1
    break
  fi
done < "$tmp_dir/first-parent"

if [ "$anchor_on_first_parent" -ne 1 ]; then
  blocked 'ANCHOR_NOT_ON_FIRST_PARENT' "anchor=$KNOWN_DIRECTOR_ANCHOR"
fi
if [ -z "$baseline" ]; then
  blocked 'NO_DIRECTOR_BASELINE' "anchor=$KNOWN_DIRECTOR_ANCHOR"
fi

verify_protected_input "$PROTECTED_LAUNCH" "$PROTECTED_LAUNCH_SHA256"
verify_protected_input "$PROTECTED_DIRECTIVE" "$PROTECTED_DIRECTIVE_SHA256"

git ls-files -v -z -- > "$tmp_dir/index-visibility" || \
  blocked 'INDEX_VISIBILITY_READ_FAILED'
while IFS= read -r -d '' index_entry; do
  index_tag=${index_entry:0:1}
  index_path=${index_entry:2}
  case "$index_tag" in
    S | [a-z])
      blocked 'INDEX_VISIBILITY_MASKED' "tag=$index_tag" \
        "path=$(quote_path "$index_path")"
      ;;
  esac
done < "$tmp_dir/index-visibility"

git rev-list --reverse "${baseline}..${checked_head}" \
  > "$tmp_dir/worker-commits" || \
  blocked 'WORKER_HISTORY_READ_FAILED' "baseline=$baseline"

worker_commits=0
committed_path_observations=0
while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  worker_commits=$((worker_commits + 1))
  commit_stream="$tmp_dir/commit-$worker_commits"
  git diff-tree -m --root --no-commit-id --name-only -z -r --no-renames \
    "$commit" > "$commit_stream" || \
    blocked 'COMMIT_DIFF_READ_FAILED' "commit=$commit"

  while IFS= read -r -d '' path; do
    committed_path_observations=$((committed_path_observations + 1))
    assert_allowlisted_path "$path" "commit:$commit"
  done < "$commit_stream"
done < "$tmp_dir/worker-commits"

git diff-index --cached --name-only -z --no-renames "$checked_head" -- \
  > "$tmp_dir/staged" || blocked 'STAGED_DIFF_READ_FAILED'
git diff-files --name-only -z --no-renames -- \
  > "$tmp_dir/unstaged" || blocked 'UNSTAGED_DIFF_READ_FAILED'
git ls-files --others --exclude-standard -z -- \
  > "$tmp_dir/untracked" || blocked 'UNTRACKED_READ_FAILED'

staged_paths=0
while IFS= read -r -d '' path; do
  staged_paths=$((staged_paths + 1))
  assert_allowlisted_path "$path" 'worktree:staged'
done < "$tmp_dir/staged"

unstaged_paths=0
while IFS= read -r -d '' path; do
  unstaged_paths=$((unstaged_paths + 1))
  assert_allowlisted_path "$path" 'worktree:unstaged'
done < "$tmp_dir/unstaged"

untracked_paths=0
protected_untracked=0
while IFS= read -r -d '' path; do
  untracked_paths=$((untracked_paths + 1))
  case "$path" in
    "$PROTECTED_LAUNCH" | "$PROTECTED_DIRECTIVE")
      protected_untracked=$((protected_untracked + 1))
      ;;
    *)
      assert_allowlisted_path "$path" 'worktree:untracked'
      ;;
  esac
done < "$tmp_dir/untracked"

if [ "$protected_untracked" -ne 2 ]; then
  blocked 'PROTECTED_UNTRACKED_SET_INVALID' \
    "expected=2" "actual=$protected_untracked"
fi

if [ "$mode" = 'FINAL' ]; then
  tracked_dirty=$((staged_paths + unstaged_paths))
  if [ "$tracked_dirty" -ne 0 ]; then
    blocked 'FINAL_TRACKED_DIRTY' "path_observations=$tracked_dirty"
  fi
  if [ "$untracked_paths" -ne 2 ]; then
    blocked 'FINAL_UNTRACKED_SET_INVALID' \
      "expected=2" "actual=$untracked_paths"
  fi
fi

ending_head=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null) || \
  blocked 'HEAD_CHANGED_DURING_GATE' "start=$checked_head" 'end=INVALID'
if [ "$ending_head" != "$checked_head" ]; then
  blocked 'HEAD_CHANGED_DURING_GATE' "start=$checked_head" "end=$ending_head"
fi
ending_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || \
  blocked 'BRANCH_CHANGED_DURING_GATE' "start=$EXPECTED_BRANCH" 'end=DETACHED'
if [ "$ending_branch" != "$EXPECTED_BRANCH" ]; then
  blocked 'BRANCH_CHANGED_DURING_GATE' \
    "start=$EXPECTED_BRANCH" "end=$ending_branch"
fi

printf 'L_WORKER_SCOPE_OK baseline=%s head=%s worker_commits=%s committed_path_observations=%s staged_paths=%s unstaged_paths=%s untracked_paths=%s protected_inputs=%s mode=%s\n' \
  "$baseline" \
  "$checked_head" \
  "$worker_commits" \
  "$committed_path_observations" \
  "$staged_paths" \
  "$unstaged_paths" \
  "$untracked_paths" \
  "$protected_untracked" \
  "$mode"
