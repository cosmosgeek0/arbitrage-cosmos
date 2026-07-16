#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "shell and Node syntax checks"
SHELL_COUNT=0
while IFS= read -r file; do
  bash -n "$file"
  SHELL_COUNT=$((SHELL_COUNT + 1))
done < <(find "$REPO_ROOT/ops/i00" "$REPO_ROOT/ops/tests/i00" -type f -name '*.sh' | LC_ALL=C sort)
[ "$SHELL_COUNT" -ge 18 ] || fail_test "expected at least 18 shell artifacts, got $SHELL_COUNT"
pass_assertion
NODE_COUNT=0
while IFS= read -r file; do
  node --check "$file" >/dev/null
  NODE_COUNT=$((NODE_COUNT + 1))
done < <(find "$REPO_ROOT/ops/i00" "$REPO_ROOT/ops/tests/i00" -type f -name '*.mjs' | LC_ALL=C sort)
[ "$NODE_COUNT" -ge 24 ] || fail_test "expected at least 24 Node artifacts, got $NODE_COUNT"
pass_assertion

note "only the bounded numeric-loopback exposure client implements HTTP"
NETWORK_CLIENT="$I00_ROOT/bin/exposure-from-app.mjs"
assert_file "$NETWORK_CLIENT"
SOURCE="$(find "$REPO_ROOT/ops/i00" -type f \( -name '*.mjs' -o -name '*.sh' \) ! -path "$NETWORK_CLIENT" -print0 | xargs -0 cat)"
for forbidden in 'fetch(' 'https.request' 'http.request' 'cloudflare.com/client/v4' 'route53' 'systemctl enable' 'systemctl start' 'systemctl restart' 'aws secretsmanager'; do
  if printf '%s' "$SOURCE" | grep -F "$forbidden" >/dev/null; then fail_test "direct external action primitive found: $forbidden"; fi
  pass_assertion
done
assert_contains "$SOURCE" 'process.env.AWS_CLI'
assert_contains "$SOURCE" 'effective L15 deploy.sh is unavailable'
assert_contains "$SOURCE" 'effective L15 rollback.sh is unavailable'
assert_contains "$(cat "$I00_ROOT/bin/release-switch.sh")" 'verify-simulation-command.mjs'
assert_contains "$(cat "$I00_ROOT/bin/rollback-switch.sh")" 'verify-simulation-command.mjs'
assert_contains "$(cat "$I00_ROOT/bin/secrets-provider.mjs")" 'verify-simulation-command.mjs'
assert_contains "$SOURCE" 'verify-donor-root.mjs'
for forbidden_module in "from 'node:net'" "from 'node:http'" "from 'node:https'" "from 'node:dgram'" "from 'node:tls'"; do
  if printf '%s' "$SOURCE" | grep -F "$forbidden_module" >/dev/null; then fail_test "network module found: $forbidden_module"; fi
  pass_assertion
done
assert_contains "$(cat "$NETWORK_CLIENT")" "from 'node:http'"
assert_contains "$(cat "$NETWORK_CLIENT")" '127.0.0.1'
assert_contains "$(cat "$NETWORK_CLIENT")" '/api/system-integration/ops/readback'

note "accepted donor ancestry and donor-owned bytes remain exact after fan-in"
INTEGRATED="$(node "$I00_ROOT/bin/verify-donor.mjs" --repo "$REPO_ROOT" --integrated)"
assert_contains "$INTEGRATED" 'INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED'
assert_contains "$INTEGRATED" '"acceptedDonorAncestor":true'
assert_contains "$INTEGRATED" '"workingBytesExact":true'
assert_eq "$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(String(v.integration.integratedDonorTestFiles))' "$INTEGRATED")" 17
assert_eq "$(git -C "$REPO_ROOT" rev-parse HEAD:ops/live)" \
  "$(node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.integration.effectiveLiveTree)' "$INTEGRATED")"
SEALED_OWNER_EVIDENCE="$(node "$REPO_ROOT/test/i00/sealed-owner-evidence.mjs" \
  --root "$REPO_ROOT" \
  --path IP_OPS.md \
  --path I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md)"
assert_contains "$SEALED_OWNER_EVIDENCE" '"path":"IP_OPS.md","sha256":"2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779"'
assert_contains "$SEALED_OWNER_EVIDENCE" '"path":"I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md","sha256":"9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5"'
finish
