#!/usr/bin/env bash

set -euo pipefail

readonly EXPECTED_BRANCH='live-execution-control-proof-20260712'
readonly PRODUCTION_ANCHOR='3a8e17be71d21df14f6b236a563cb0595f9eb824'
readonly PROTECTED_LAUNCH='DIRECTOR_Q_L_TWO_LANE_LAUNCH.md'
readonly PROTECTED_DIRECTIVE='LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md'
readonly TEST_PROTECTED_LAUNCH_SHA256='cd0c247bbb59ed230c86dde21f9ecabd390c33730219b69144000aa8bccaeb56'
readonly TEST_PROTECTED_DIRECTIVE_SHA256='2a174f35cded53c2f537476c05d9633af54d09e0ed5558010a1e82216bb92a28'

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
gate_source="$script_dir/lane-worker-scope-gate.sh"

tmp_root=$(mktemp -d '/tmp/lane-worker-scope-tests.XXXXXX')
cleanup() {
  rm -rf -- "$tmp_root"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

test_count=0
pass_count=0
repo_serial=0
RUN_STATUS=0
RUN_OUTPUT=''
REPO=''
FUTURE_BASELINE=''

fail_test() {
  local label="$1"
  local detail="$2"

  printf 'not ok %s - %s\n' "$test_count" "$label"
  printf '  %s\n' "$detail"
  if [ -n "$RUN_OUTPUT" ]; then
    printf '  gate output: %s\n' "$RUN_OUTPUT"
  fi
  exit 1
}

pass_test() {
  local label="$1"
  pass_count=$((pass_count + 1))
  printf 'ok %s - %s\n' "$test_count" "$label"
}

configure_repo() {
  local repo="$1"
  git -C "$repo" config user.name 'Scope Gate Test'
  git -C "$repo" config user.email 'scope-gate@example.invalid'
  git -C "$repo" config commit.gpgsign false
}

commit_paths() {
  local repo="$1"
  local message="$2"
  shift 2
  git -C "$repo" add -A -- "$@"
  git -C "$repo" commit -q -m "$message"
}

install_gate() {
  local repo="$1"
  local anchor="$2"

  mkdir -p "$repo/ops/tests"
  sed -e "s/$PRODUCTION_ANCHOR/$anchor/g" \
    -e "s/26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06/$TEST_PROTECTED_LAUNCH_SHA256/g" \
    -e "s/40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037/$TEST_PROTECTED_DIRECTIVE_SHA256/g" \
    "$gate_source" \
    > "$repo/ops/tests/lane-worker-scope-gate.sh"
  chmod +x "$repo/ops/tests/lane-worker-scope-gate.sh"
  printf 'tracked fixture\n' > "$repo/ops/tests/fixture.txt"
  commit_paths "$repo" 'test: install allowed scope gate' \
    ops/tests/lane-worker-scope-gate.sh ops/tests/fixture.txt
}

copy_protected_inputs() {
  local repo="$1"
  printf '%s\n' 'synthetic scope-gate launch fixture' > "$repo/$PROTECTED_LAUNCH"
  printf '%s\n' 'synthetic scope-gate directive fixture' > "$repo/$PROTECTED_DIRECTIVE"
}

template_repo="$tmp_root/template"
mkdir -p "$template_repo"
git -C "$template_repo" init -q
configure_repo "$template_repo"
git -C "$template_repo" checkout -q -b "$EXPECTED_BRANCH"

mkdir -p "$template_repo/live-edge-receipts"
printf 'initial\n' > "$template_repo/live-edge-receipts/base.md"
commit_paths "$template_repo" 'test: initial allowed base' \
  live-edge-receipts/base.md

git -C "$template_repo" checkout -q -b canonical-import
mkdir -p "$template_repo/server/src"
printf 'canonical forbidden history\n' > "$template_repo/server/src/index.ts"
commit_paths "$template_repo" 'test: canonical imported forbidden path' \
  server/src/index.ts

git -C "$template_repo" checkout -q "$EXPECTED_BRANCH"
printf 'first-parent spine\n' > "$template_repo/live-edge-receipts/spine.md"
commit_paths "$template_repo" 'test: diverge canonical spine' \
  live-edge-receipts/spine.md
git -C "$template_repo" merge -q --no-ff canonical-import \
  -m 'director: canonical imported history'
template_anchor=$(git -C "$template_repo" rev-parse HEAD)
install_gate "$template_repo" "$template_anchor"
template_tip=$(git -C "$template_repo" rev-parse HEAD)

new_repo() {
  repo_serial=$((repo_serial + 1))
  REPO="$tmp_root/repo-$repo_serial"
  git clone -q "$template_repo" "$REPO"
  configure_repo "$REPO"
  copy_protected_inputs "$REPO"
}

run_gate() {
  local repo="$1"
  shift

  set +e
  RUN_OUTPUT=$(cd "$repo" && ops/tests/lane-worker-scope-gate.sh "$@" 2>&1)
  RUN_STATUS=$?
  set -e
}

expect_pass() {
  local label="$1"
  local repo="$2"
  shift 2

  test_count=$((test_count + 1))
  run_gate "$repo" "$@"
  if [ "$RUN_STATUS" -ne 0 ]; then
    fail_test "$label" "expected exit 0, got $RUN_STATUS"
  fi
  case "$RUN_OUTPUT" in
    L_WORKER_SCOPE_OK*) pass_test "$label" ;;
    *) fail_test "$label" 'missing success marker' ;;
  esac
}

expect_failure() {
  local label="$1"
  local code="$2"
  local repo="$3"
  shift 3

  test_count=$((test_count + 1))
  run_gate "$repo" "$@"
  if [ "$RUN_STATUS" -eq 0 ]; then
    fail_test "$label" 'expected a non-zero exit'
  fi
  case "$RUN_OUTPUT" in
    *"code=$code"*) pass_test "$label" ;;
    *) fail_test "$label" "expected code=$code" ;;
  esac
}

create_future_director_merge() {
  local repo="$1"

  git -C "$repo" checkout -q -b future-director-import
  printf '{"canonical":true}\n' > "$repo/package.json"
  commit_paths "$repo" 'test: future canonical forbidden import' package.json
  git -C "$repo" checkout -q "$EXPECTED_BRANCH"
  git -C "$repo" merge -q --no-ff future-director-import \
    -m 'director: future canonical integration'
  FUTURE_BASELINE=$(git -C "$repo" rev-parse HEAD)
}

new_repo
expect_pass 'canonical director merge exempts imported forbidden history' "$REPO"
case "$RUN_OUTPUT" in
  *"baseline=$template_anchor"*) ;;
  *) fail_test 'canonical director merge exempts imported forbidden history' \
      "expected baseline=$template_anchor" ;;
esac
case "$RUN_OUTPUT" in
  *"head=$template_tip"*) ;;
  *) fail_test 'canonical director merge exempts imported forbidden history' \
      "expected head=$template_tip" ;;
esac

new_repo
mkdir -p "$REPO/server/src/liveEdge/adapters"
printf 'allowed\n' > "$REPO/server/src/liveEdge/adapters/allowed.ts"
commit_paths "$REPO" 'test: allowed worker commit' \
  server/src/liveEdge/adapters/allowed.ts
expect_pass 'allowlisted worker commit passes' "$REPO"

new_repo
printf '{}\n' > "$REPO/server/package.json"
commit_paths "$REPO" 'test: forbidden worker commit' server/package.json
expect_failure 'forbidden committed worker path fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'forbidden then reverted\n' > "$REPO/reverted-forbidden.txt"
commit_paths "$REPO" 'test: forbidden historical commit' reverted-forbidden.txt
git -C "$REPO" revert --no-edit HEAD >/dev/null
expect_failure 'later revert cannot erase an earlier violation' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
create_future_director_merge "$REPO"
expect_pass 'future canonical director merge advances the baseline' "$REPO"
case "$RUN_OUTPUT" in
  *"baseline=$FUTURE_BASELINE"*) ;;
  *) fail_test 'future canonical director merge advances the baseline' \
      "expected baseline=$FUTURE_BASELINE" ;;
esac
case "$RUN_OUTPUT" in
  *"head=$FUTURE_BASELINE"*) ;;
  *) fail_test 'future canonical director merge advances the baseline' \
      "expected head=$FUTURE_BASELINE" ;;
esac

new_repo
create_future_director_merge "$REPO"
printf 'post-baseline forbidden\n' > "$REPO/post-future-forbidden.txt"
commit_paths "$REPO" 'test: forbidden after future baseline' \
  post-future-forbidden.txt
expect_failure 'forbidden worker path after future baseline fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'single parent cannot be canonical\n' > "$REPO/single-parent-forbidden.txt"
commit_paths "$REPO" 'director: forged single-parent marker' \
  single-parent-forbidden.txt
expect_failure 'single-parent director subject is not exempt' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" checkout -q -b octopus-forbidden
printf 'octopus forbidden\n' > "$REPO/octopus-forbidden.txt"
commit_paths "$REPO" 'test: octopus forbidden parent' octopus-forbidden.txt
git -C "$REPO" checkout -q "$EXPECTED_BRANCH"
git -C "$REPO" checkout -q -b octopus-allowed
printf 'octopus allowed\n' > "$REPO/live-edge-receipts/octopus-allowed.md"
commit_paths "$REPO" 'test: octopus allowed parent' \
  live-edge-receipts/octopus-allowed.md
git -C "$REPO" checkout -q "$EXPECTED_BRANCH"
git -C "$REPO" merge -q --no-ff octopus-forbidden octopus-allowed \
  -m 'director: malformed three-parent marker' >/dev/null 2>&1
expect_failure 'three-parent director subject is not exempt' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" checkout -q -b wrong-prefix-import
printf 'wrong prefix import\n' > "$REPO/wrong-prefix-forbidden.txt"
commit_paths "$REPO" 'test: wrong-prefix forbidden side commit' \
  wrong-prefix-forbidden.txt
git -C "$REPO" checkout -q "$EXPECTED_BRANCH"
git -C "$REPO" merge -q --no-ff wrong-prefix-import \
  -m 'Director: wrong-case merge marker'
expect_failure 'two-parent nonprefix merge is not exempt' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" checkout -q -b side-director-base
mkdir -p "$REPO/live-edge-receipts"
printf 'side base\n' > "$REPO/live-edge-receipts/side-base.md"
commit_paths "$REPO" 'test: allowed side base' live-edge-receipts/side-base.md
git -C "$REPO" checkout -q -b side-director-import
printf 'side forbidden\n' > "$REPO/side-director-forbidden.txt"
commit_paths "$REPO" 'test: side director forbidden import' \
  side-director-forbidden.txt
git -C "$REPO" checkout -q side-director-base
printf 'side divergence\n' > "$REPO/live-edge-receipts/side-diverge.md"
commit_paths "$REPO" 'test: side director divergence' \
  live-edge-receipts/side-diverge.md
git -C "$REPO" merge -q --no-ff side-director-import \
  -m 'director: side-history marker only'
git -C "$REPO" checkout -q "$EXPECTED_BRANCH"
git -C "$REPO" merge -q --no-ff side-director-base \
  -m 'test: worker merges side history'
expect_failure 'side-history director marker cannot reset the baseline' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" checkout -q -b worker-import
printf 'worker merge import\n' > "$REPO/worker-merge-forbidden.txt"
commit_paths "$REPO" 'test: forbidden worker side commit' \
  worker-merge-forbidden.txt
git -C "$REPO" checkout -q "$EXPECTED_BRANCH"
git -C "$REPO" merge -q --no-ff worker-import \
  -m 'test: ordinary worker merge'
expect_failure 'worker merge cannot import a forbidden path' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" mv server/src/index.ts ops/tests/imported-index.ts
git -C "$REPO" commit -q -m 'test: rename forbidden path into allowlist'
expect_failure 'outside-to-inside rename exposes the forbidden source path' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'staged forbidden\n' >> "$REPO/server/src/index.ts"
git -C "$REPO" add -- server/src/index.ts
expect_failure 'staged forbidden tracked change fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'unstaged forbidden\n' >> "$REPO/server/src/index.ts"
expect_failure 'unstaged forbidden tracked change fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'untracked forbidden\n' > "$REPO/server/src/types.ts"
expect_failure 'untracked forbidden path fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
printf 'intent to add forbidden\n' > "$REPO/server/src/intent.ts"
git -C "$REPO" add -N -- server/src/intent.ts
expect_failure 'intent-to-add forbidden path fails' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
git -C "$REPO" update-index --assume-unchanged -- server/src/index.ts
printf 'hidden assume-unchanged mutation\n' >> "$REPO/server/src/index.ts"
expect_failure 'assume-unchanged cannot hide a forbidden tracked mutation' \
  'INDEX_VISIBILITY_MASKED' "$REPO" --final

new_repo
git -C "$REPO" update-index --skip-worktree -- server/src/index.ts
printf 'hidden skip-worktree mutation\n' >> "$REPO/server/src/index.ts"
expect_failure 'skip-worktree cannot hide a forbidden tracked mutation' \
  'INDEX_VISIBILITY_MASKED' "$REPO" --final

new_repo
printf 'replace-hidden worker violation\n' > "$REPO/replace-forbidden.txt"
commit_paths "$REPO" 'test: forbidden commit hidden by replace ref' \
  replace-forbidden.txt
replaced_commit=$(git -C "$REPO" rev-parse HEAD)
replaced_parent=$(git -C "$REPO" rev-parse 'HEAD^')
replaced_tree=$(git -C "$REPO" rev-parse 'HEAD^{tree}')
replacement_commit=$(printf 'director: forged replacement baseline\n' | \
  git -C "$REPO" commit-tree "$replaced_tree" \
    -p "$replaced_parent" -p "$template_anchor")
git -C "$REPO" replace "$replaced_commit" "$replacement_commit"
expect_failure 'replace ref cannot forge a director baseline' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO" --final

new_repo
alternate_index="$tmp_root/alternate-index-$repo_serial"
GIT_INDEX_FILE="$alternate_index" git -C "$REPO" read-tree HEAD
GIT_INDEX_FILE="$alternate_index" git -C "$REPO" update-index --refresh \
  >/dev/null
git -C "$REPO" rm -q --cached -- server/src/index.ts
test_count=$((test_count + 1))
set +e
RUN_OUTPUT=$(cd "$REPO" && GIT_INDEX_FILE="$alternate_index" \
  ops/tests/lane-worker-scope-gate.sh --final 2>&1)
RUN_STATUS=$?
set -e
if [ "$RUN_STATUS" -eq 0 ]; then
  fail_test 'alternate index cannot hide a forbidden staged deletion' \
    'expected a non-zero exit'
fi
case "$RUN_OUTPUT" in
  *'code=PATH_OUTSIDE_ALLOWLIST'*)
    pass_test 'alternate index cannot hide a forbidden staged deletion'
    ;;
  *)
    fail_test 'alternate index cannot hide a forbidden staged deletion' \
      'expected code=PATH_OUTSIDE_ALLOWLIST'
    ;;
esac

new_repo
race_bin="$tmp_root/race-bin-$repo_serial"
race_flag="$tmp_root/race-flag-$repo_serial"
race_target=$(git -C "$REPO" rev-parse 'HEAD^')
real_git=$(command -v git)
mkdir -p "$race_bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "${1-}" = "diff-files" ] && [ ! -e "$SCOPE_RACE_FLAG" ]; then' \
  '  "$SCOPE_REAL_GIT" "$@"' \
  '  status=$?' \
  '  : > "$SCOPE_RACE_FLAG"' \
  '  "$SCOPE_REAL_GIT" update-ref HEAD "$SCOPE_RACE_TARGET"' \
  '  exit "$status"' \
  'fi' \
  'exec "$SCOPE_REAL_GIT" "$@"' \
  > "$race_bin/git"
chmod +x "$race_bin/git"
test_count=$((test_count + 1))
set +e
RUN_OUTPUT=$(cd "$REPO" && \
  PATH="$race_bin:$PATH" \
  SCOPE_REAL_GIT="$real_git" \
  SCOPE_RACE_FLAG="$race_flag" \
  SCOPE_RACE_TARGET="$race_target" \
  ops/tests/lane-worker-scope-gate.sh --final 2>&1)
RUN_STATUS=$?
set -e
if [ "$RUN_STATUS" -eq 0 ]; then
  fail_test 'HEAD movement during the gate invalidates the proof' \
    'expected a non-zero exit'
fi
case "$RUN_OUTPUT" in
  *'code=HEAD_CHANGED_DURING_GATE'*)
    pass_test 'HEAD movement during the gate invalidates the proof'
    ;;
  *)
    fail_test 'HEAD movement during the gate invalidates the proof' \
      'expected code=HEAD_CHANGED_DURING_GATE'
    ;;
esac

new_repo
printf '%s\n' "$(git -C "$REPO" rev-parse HEAD)" > "$REPO/.git/info/grafts"
expect_failure 'legacy graft metadata cannot rewrite audited ancestry' \
  'LEGACY_GRAFTS_PRESENT' "$REPO" --final

new_repo
rm -- "$REPO/$PROTECTED_LAUNCH"
expect_failure 'missing protected input fails' 'PROTECTED_MISSING' "$REPO"

new_repo
printf 'tampered\n' >> "$REPO/$PROTECTED_LAUNCH"
expect_failure 'changed protected input fails exact SHA-256' \
  'PROTECTED_HASH_MISMATCH' "$REPO"

new_repo
rm -- "$REPO/$PROTECTED_LAUNCH"
ln -s "$PROTECTED_DIRECTIVE" "$REPO/$PROTECTED_LAUNCH"
expect_failure 'symlinked protected input fails regular-file proof' \
  'PROTECTED_NOT_REGULAR' "$REPO"

new_repo
git -C "$REPO" add -- "$PROTECTED_LAUNCH"
expect_failure 'staged protected input is not exempt' \
  'PROTECTED_TRACKED_OR_STAGED' "$REPO"

new_repo
printf '%s\n' "$PROTECTED_LAUNCH" >> "$REPO/.git/info/exclude"
expect_failure 'ignored protected input is not proven untracked' \
  'PROTECTED_IGNORED' "$REPO"

no_baseline_repo="$tmp_root/no-baseline"
mkdir -p "$no_baseline_repo/live-edge-receipts"
git -C "$no_baseline_repo" init -q
configure_repo "$no_baseline_repo"
git -C "$no_baseline_repo" checkout -q -b "$EXPECTED_BRANCH"
printf 'ordinary anchor\n' > "$no_baseline_repo/live-edge-receipts/base.md"
commit_paths "$no_baseline_repo" 'test: ordinary anchor without director merge' \
  live-edge-receipts/base.md
ordinary_anchor=$(git -C "$no_baseline_repo" rev-parse HEAD)
install_gate "$no_baseline_repo" "$ordinary_anchor"
copy_protected_inputs "$no_baseline_repo"
expect_failure 'missing qualifying first-parent director baseline fails' \
  'NO_DIRECTOR_BASELINE' "$no_baseline_repo"

new_repo
space_path='ops/tests/name with spaces.txt'
printf 'space safe\n' > "$REPO/$space_path"
commit_paths "$REPO" 'test: allowlisted filename with spaces' "$space_path"
expect_pass 'allowlisted committed filename with spaces is preserved' "$REPO"

new_repo
newline_path=$'ops/tests/name\nwith-newline.txt'
printf 'newline safe\n' > "$REPO/$newline_path"
commit_paths "$REPO" 'test: allowlisted filename with newline' "$newline_path"
expect_pass 'allowlisted committed filename with newline is preserved' "$REPO"

new_repo
forbidden_newline_path=$'server/src/forbidden\nname.ts'
printf 'newline forbidden\n' > "$REPO/$forbidden_newline_path"
expect_failure 'forbidden untracked filename with newline is not truncated' \
  'PATH_OUTSIDE_ALLOWLIST' "$REPO"

new_repo
expect_pass 'final mode accepts exactly two protected untracked inputs' \
  "$REPO" --final

new_repo
printf 'allowed but dirty\n' >> "$REPO/ops/tests/fixture.txt"
expect_failure 'final mode rejects an allowlisted tracked change' \
  'FINAL_TRACKED_DIRTY' "$REPO" --final

new_repo
printf 'extra\n' > "$REPO/ops/tests/extra-untracked.txt"
expect_failure 'final mode rejects extra allowlisted untracked input' \
  'FINAL_UNTRACKED_SET_INVALID' "$REPO" --final

new_repo
git -C "$REPO" checkout -q -b wrong-branch
expect_failure 'exact branch mismatch fails' 'BRANCH_MISMATCH' "$REPO"

printf '1..%s\n' "$test_count"
printf 'L_WORKER_SCOPE_TESTS_OK assertions=%s passed=%s failed=0\n' \
  "$test_count" "$pass_count"
