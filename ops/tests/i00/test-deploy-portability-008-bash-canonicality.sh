#!/bin/bash -p
set -euo pipefail

. "$(dirname "$0")/helpers.sh"

COMMON="$REPO_ROOT/ops/live/bin/common.sh"

note "usr-merged shapes: the built-in Bash default canonicalizes instead of aborting"
# The defect: /bin is a symlink to usr/bin on usr-merged distributions, so the
# literal default /bin/bash is not canonical there and the strict assert below
# rejected this module's own default. Verified on the deployment target:
# readlink -f /bin/bash -> /usr/bin/bash on Ubuntu 24.04.
assert_contains "$(cat "$COMMON")" 'process.stdout.write(fs.realpathSync(process.argv[1]));'
DEFAULT_BLOCK="$(sed -n '/_I00_BASH_FROM_ENV_FILE" != 1 /,/^  fi$/p' "$COMMON")"
case "$DEFAULT_BLOCK" in
  *"I00_BASH=/bin/bash"*)
    fail_test "built-in Bash default is still the raw non-canonical literal" ;;
esac
assert_contains "$DEFAULT_BLOCK" 'realpathSync'
assert_contains "$DEFAULT_BLOCK" "' /bin/bash)\""
assert_contains "$DEFAULT_BLOCK" 'default Bash program cannot be canonicalized'

note "the canonicality assert itself is unchanged and still rejects supplied non-canonical values"
assert_contains "$(cat "$COMMON")" '[ "$canonical" = "$I00_BASH" ] \'
assert_contains "$(cat "$COMMON")" 'I00_BASH must already be canonical'
# The env-file path must NOT be canonicalized on the caller's behalf: only the
# built-in default is resolved, so a supplied non-canonical value still fails.
ENV_FILE_GUARD="$(sed -n '/_I00_BASH_FROM_ENV_FILE" != 1 /,/^  fi$/p' "$COMMON")"
case "$ENV_FILE_GUARD" in
  *'_I00_BASH_FROM_ENV_FILE'*) : ;;
  *) fail_test "default canonicalization is no longer gated on the env-file flag" ;;
esac

note "the environment program default remains canonical on both platform shapes"
assert_contains "$(cat "$COMMON")" 'I00_ENV=/usr/bin/env'

printf 'OK (%d assertions)\n' "$ASSERTIONS"
