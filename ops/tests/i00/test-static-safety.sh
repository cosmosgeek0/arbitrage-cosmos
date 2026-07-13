#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "shell and Node syntax checks"
SHELL_COUNT=0
while IFS= read -r file; do
  bash -n "$file"
  SHELL_COUNT=$((SHELL_COUNT + 1))
done < <(find "$REPO_ROOT/ops/i00" "$REPO_ROOT/ops/tests/i00" -type f -name '*.sh' | LC_ALL=C sort)
assert_eq "$SHELL_COUNT" 18
NODE_COUNT=0
while IFS= read -r file; do
  node --check "$file" >/dev/null
  NODE_COUNT=$((NODE_COUNT + 1))
done < <(find "$REPO_ROOT/ops/i00" -type f -name '*.mjs' | LC_ALL=C sort)
assert_eq "$NODE_COUNT" 24

note "no direct network implementation or service command in I00 source"
SOURCE="$(find "$REPO_ROOT/ops/i00" -type f \( -name '*.mjs' -o -name '*.sh' \) -print0 | xargs -0 cat)"
for forbidden in 'fetch(' 'https.request' 'http.request' 'cloudflare.com/client/v4' 'route53' 'systemctl enable' 'systemctl start' 'systemctl restart' 'aws secretsmanager'; do
  if printf '%s' "$SOURCE" | grep -F "$forbidden" >/dev/null; then fail_test "direct external action primitive found: $forbidden"; fi
  pass_assertion
done
assert_contains "$SOURCE" 'process.env.AWS_CLI'
assert_contains "$SOURCE" 'accepted donor deploy.sh is unavailable'
assert_contains "$SOURCE" 'accepted donor rollback.sh is unavailable'
assert_contains "$(cat "$I00_ROOT/bin/release-switch.sh")" 'verify-simulation-command.mjs'
assert_contains "$(cat "$I00_ROOT/bin/rollback-switch.sh")" 'verify-simulation-command.mjs'
assert_contains "$(cat "$I00_ROOT/bin/secrets-provider.mjs")" 'verify-simulation-command.mjs'
assert_contains "$SOURCE" 'verify-donor-root.mjs'
for forbidden_module in "from 'node:net'" "from 'node:http'" "from 'node:https'" "from 'node:dgram'" "from 'node:tls'"; do
  if printf '%s' "$SOURCE" | grep -F "$forbidden_module" >/dev/null; then fail_test "network module found: $forbidden_module"; fi
  pass_assertion
done

note "all changed paths stay inside IP_OPS section 3"
CHANGED="$({
  git -C "$REPO_ROOT" diff --name-only 420cc83e5512d54ca1b1c064c1041d89b23914a0..HEAD
  git -C "$REPO_ROOT" status --short --untracked-files=all | sed 's/^...//'
} | LC_ALL=C sort -u)"
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    IP_OPS.md|I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md) : ;;
    ops/i00/*|ops/tests/i00/*|ops/templates/i00/*|ops/docs/i00/*|IP_OPS_STATE.md|IP_OPS_RECEIPT.md|IP_OPS_ACTIVATION_REQUEST.md) : ;;
    *) fail_test "out-of-scope path: $path" ;;
  esac
  pass_assertion
done <<< "$CHANGED"
assert_eq "$(shasum -a 256 "$REPO_ROOT/IP_OPS.md" | awk '{print $1}')" 2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779
assert_eq "$(shasum -a 256 "$REPO_ROOT/I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md" | awk '{print $1}')" 9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5
finish
