#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

REAL_TMP="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-secrets-$$")"
cleanup_secrets_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_secrets_test EXIT
mkdir -p "$SIMULATION_ROOT/fakes" "$SIMULATION_ROOT/credentials"
cp "$TEST_DIR/fixtures/fake-aws.sh" "$SIMULATION_ROOT/fakes/aws-fixture.sh"
chmod +x "$SIMULATION_ROOT/fakes/aws-fixture.sh"
node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$SIMULATION_ROOT" --commands "$SIMULATION_ROOT/fakes/aws-fixture.sh" >/dev/null
cat > "$TEST_TMP/provider.json" <<'JSON'
{"schemaVersion":1,"secretArn":"arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd","region":"ap-south-1","targetHost":"ip-10-0-0-10.internal","environment":"production","resultReceiptTarget":"/var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.result.json","reconciliationReceiptTarget":"/var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.reconciliation.json","requiredKeys":["BINANCE_API_KEY","BINANCE_API_SECRET"]}
JSON

note "fake exact-ARN provider materializes without stdout disclosure"
AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$SIMULATION_ROOT/credentials/app-secrets.json" --simulation --simulation-root "$SIMULATION_ROOT" >"$TEST_TMP/provider.stdout" 2>"$TEST_TMP/provider.stderr"
OUT="$(cat "$TEST_TMP/provider.stdout")"
assert_contains "$OUT" SECRET_MATERIALIZED_WITHOUT_DISCLOSURE
if cat "$TEST_TMP/provider.stdout" "$TEST_TMP/provider.stderr" | grep -F 'FAKE_SECRET_123456' >/dev/null; then fail_test 'provider disclosed the secret'; fi
pass_assertion
assert_file "$SIMULATION_ROOT/credentials/app-secrets.json"
assert_eq "$(stat -f '%Lp' "$SIMULATION_ROOT/credentials/app-secrets.json" 2>/dev/null || stat -c '%a' "$SIMULATION_ROOT/credentials/app-secrets.json")" 600
assert_eq "$(node -e 'const v=require(process.argv[1]);process.stdout.write(String(Object.keys(v).length))' "$SIMULATION_ROOT/credentials/app-secrets.json")" 2

note "missing provider, ambient credentials, and wildcard ARN fail closed"
assert_failure node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$TEST_TMP/none.json" --simulation
assert_failure env AWS_ACCESS_KEY_ID=FORBIDDEN AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$SIMULATION_ROOT/ambient.json" --simulation --simulation-root "$SIMULATION_ROOT"
node -e 'const fs=require("fs");const p=process.argv[1];const v=require(p);v.secretArn="arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/*";fs.writeFileSync(p,JSON.stringify(v));' "$TEST_TMP/provider.json"
assert_failure env AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$SIMULATION_ROOT/wild.json" --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure env AWS_CLI=/usr/local/bin/aws node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$SIMULATION_ROOT/real.json" --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure env AWS_CLI="$SIMULATION_ROOT/fakes/aws-fixture.sh" node "$I00_ROOT/bin/secrets-provider.mjs" --config "$TEST_TMP/provider.json" --output "$TEST_TMP/outside.json" --simulation --simulation-root "$SIMULATION_ROOT"
assert_failure node "$I00_ROOT/bin/create-simulation-root.mjs" --root /
ln -s "$SIMULATION_ROOT/fakes/aws-fixture.sh" "$SIMULATION_ROOT/fakes/aws-symlink.sh"
assert_failure node "$I00_ROOT/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_ROOT/fakes/aws-symlink.sh"
MALICIOUS_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-malicious-$$")"
printf '#!/usr/bin/env bash\nexec /usr/bin/systemctl "$@"\n' > "$MALICIOUS_ROOT/fake.sh"
chmod +x "$MALICIOUS_ROOT/fake.sh"
assert_failure node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$MALICIOUS_ROOT" --commands "$MALICIOUS_ROOT/fake.sh"
rm -rf "$MALICIOUS_ROOT"

note "authorization scope and expiry are exact"
cat > "$TEST_TMP/auth.json" <<'JSON'
{
  "schemaVersion": 2,
  "authorizationId": "auth-secret-materialization-20260713-001",
  "operator": "ops-owner-17",
  "status": "APPROVED",
  "actionClasses": ["SECRET_MATERIALIZATION"],
  "scope": "cosmos-production-secret-materialization",
  "deployedSha": "0123456789abcdef0123456789abcdef01234567",
  "configVersion": "config-i00-production-17",
  "riskVersion": "risk-i00-production-9",
  "nonce": "9f2c712dba93ab3274f6f71be245a76761957cd7d7a557676354264138b8f10e",
  "serverPreviewDigest": "sha256:3aa38a96963e373aafce346d961eb0f631c5b0863cbf6f99a1e169a51cabfe89",
  "account": "aws:123456789012",
  "environment": "production",
  "host": "ip-10-0-0-10.internal",
  "issuedAtUtc": "2026-07-13T00:00:00Z",
  "startsAtUtc": "2026-07-13T00:15:00Z",
  "expiresAtUtc": "2026-07-13T01:00:00Z",
  "allowedCommands": ["secrets-provider"],
  "allowedEndpoints": ["arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd"],
  "allowedProducts": ["AWS Secrets Manager"],
  "allowedCredentials": {
    "types": ["AWS_INSTANCE_PROFILE_ROLE"],
    "permissions": ["secretsmanager:GetSecretValue"]
  },
  "preconditions": ["target config validated", "credential output parent is root-owned tmpfs"],
  "maximumEffect": {
    "capital": "ZERO",
    "notional": "ZERO",
    "operational": "read one exact secret version into one 0600 runtime credential"
  },
  "rollback": "stop provider and remove the runtime credential",
  "recovery": "leave service stopped and preserve a redacted failure receipt",
  "ownerApproval": {
    "approver": "ops-owner-17",
    "approvedAtUtc": "2026-07-13T00:10:00Z",
    "reference": "approval-20260713-001"
  },
  "receiptTargets": {
    "result": "/var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.result.json",
    "reconciliation": "/var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.reconciliation.json"
  }
}
JSON
AUTH_CLOCK=(--simulation-clock --now 2026-07-13T00:30:00Z)
AUTH_BASE=(--input "$TEST_TMP/auth.json" --class SECRET_MATERIALIZATION "${AUTH_CLOCK[@]}" --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production)
assert_success node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}"
assert_success node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" \
  --expected-scope cosmos-production-secret-materialization \
  --expected-account aws:123456789012 \
  --expected-endpoint arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd \
  --expected-product "AWS Secrets Manager" \
  --expected-credential-type AWS_INSTANCE_PROFILE_ROLE \
  --expected-permission secretsmanager:GetSecretValue \
  --expected-result-receipt /var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.result.json \
  --expected-reconciliation-receipt /var/lib/cosmos/receipts/auth-secret-materialization-20260713-001.reconciliation.json \
  --expected-maximum-capital ZERO \
  --expected-maximum-notional ZERO \
  --expected-maximum-effect "read one exact secret version into one 0600 runtime credential"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$TEST_TMP/auth.json" --class SERVICE_RELEASE_SWITCH "${AUTH_CLOCK[@]}" --command release-switch --expected-host ip-10-0-0-10.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$TEST_TMP/auth.json" --class SECRET_MATERIALIZATION --simulation-clock --now 2026-07-13T02:00:00Z --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$TEST_TMP/auth.json" --class SECRET_MATERIALIZATION "${AUTH_CLOCK[@]}" --command secrets-provider --expected-host other-host.internal --expected-environment production
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" --input "$TEST_TMP/auth.json" --class SECRET_MATERIALIZATION --now 2026-07-13T00:30:00Z --command secrets-provider --expected-host ip-10-0-0-10.internal --expected-environment production

note "authorization rejects missing, empty, placeholder, broadened, and reused scope"
mutate_auth() {
  local output="$1" expression="$2"
  node -e 'const fs=require("fs");const [source,output,expression]=process.argv.slice(1);const value=JSON.parse(fs.readFileSync(source,"utf8"));new Function("value", expression)(value);fs.writeFileSync(output,JSON.stringify(value));' "$TEST_TMP/auth.json" "$output" "$expression"
}
mutate_auth "$TEST_TMP/auth-missing.json" 'delete value.receiptTargets;'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-missing.json}"
mutate_auth "$TEST_TMP/auth-missing-start.json" 'delete value.startsAtUtc;'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-missing-start.json}"
for field in operator deployedSha configVersion riskVersion nonce serverPreviewDigest; do
  mutate_auth "$TEST_TMP/auth-missing-$field.json" "delete value.$field;"
  assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-missing-$field.json}"
done
mutate_auth "$TEST_TMP/auth-extra.json" 'value.unreviewedBinding="forbidden";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-extra.json}"
mutate_auth "$TEST_TMP/auth-short-sha.json" 'value.deployedSha="0123456789abcdef";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-short-sha.json}"
mutate_auth "$TEST_TMP/auth-short-nonce.json" 'value.nonce="deadbeef";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-short-nonce.json}"
mutate_auth "$TEST_TMP/auth-bad-preview.json" 'value.serverPreviewDigest="sha256:abcd";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-bad-preview.json}"
mutate_auth "$TEST_TMP/auth-empty.json" 'value.preconditions=[];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-empty.json}"
mutate_auth "$TEST_TMP/auth-placeholder.json" 'value.account="REPLACE_ME_ACCOUNT";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-placeholder.json}"
mutate_auth "$TEST_TMP/auth-broadened.json" 'value.actionClasses.push("SERVICE_RELEASE_SWITCH");'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-broadened.json}"
mutate_auth "$TEST_TMP/auth-wildcard.json" 'value.allowedCommands=["*"];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-wildcard.json}"
mutate_auth "$TEST_TMP/auth-secret-field.json" 'value.allowedCredentials.secretValue="forbidden";'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-secret-field.json}"
mutate_auth "$TEST_TMP/auth-withdrawal.json" 'value.allowedCredentials.permissions=["exchange:Withdraw"];'
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]/$TEST_TMP\/auth.json/$TEST_TMP\/auth-withdrawal.json}"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-account aws:999999999999
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-endpoint arn:aws:secretsmanager:ap-south-1:123456789012:secret:some-other-secret
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-product "Cloudflare Tunnel"
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-credential-type AWS_STATIC_ACCESS_KEY
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-permission secretsmanager:PutSecretValue
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-result-receipt /tmp/reused-result.json
assert_failure node "$I00_ROOT/bin/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-maximum-effect "read any secret"
finish
