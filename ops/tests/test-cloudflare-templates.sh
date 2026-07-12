#!/usr/bin/env bash
# ops/tests/test-cloudflare-templates.sh — operator-boundary templates carry
# placeholders only and encode the §24.2 shape (loopback origin, catch-all
# refusal, operator-only Access policy).
. "$(dirname "$0")/helpers.sh"

YML="$OPS_LIVE/cloudflare/cloudflared-config.yml.template"
ACCESS="$OPS_LIVE/cloudflare/access-app.json.template"

note "cloudflared config template"
assert_grep '^tunnel: REPLACE_ME_TUNNEL_UUID$' "$YML" "tunnel id is a placeholder"
assert_grep '^credentials-file: /etc/cloudflared/REPLACE_ME_TUNNEL_UUID\.json$' "$YML" "credentials path placeholder"
assert_grep 'hostname: REPLACE_ME_APP_HOSTNAME' "$YML" "hostname is a placeholder"
assert_grep 'service: http://127\.0\.0\.1:8080' "$YML" "origin is loopback only"
assert_grep 'service: http_status:404' "$YML" "catch-all refusal rule"
assert_not_grep '	' "$YML" "no tabs in yaml"
# the catch-all must be the LAST ingress rule
LAST_SERVICE="$(grep -E '^[[:space:]]+- service:|^[[:space:]]+service:' "$YML" | tail -1)"
ASSERTIONS=$((ASSERTIONS + 1))
echo "$LAST_SERVICE" | grep -q 'http_status:404' || fail "catch-all 404 is not the last ingress rule"

note "Access application template"
assert_rc 0 node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$ACCESS"
assert_grep 'REPLACE_ME_APP_HOSTNAME' "$ACCESS" "app domain is a placeholder"
assert_grep 'REPLACE_ME_OPERATOR_EMAIL' "$ACCESS" "operator email is a placeholder"
assert_grep '"session_duration"' "$ACCESS" "session duration declared"
assert_grep '"decision": "allow"' "$ACCESS" "explicit allow policy"
assert_not_grep '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$ACCESS" "no real email addresses"

note "README documents the boundary invariants"
README="$OPS_LIVE/cloudflare/README.md"
assert_grep '127\.0\.0\.1:8080' "$README" "loopback origin documented"
assert_grep 'SSM Session' "$README" "no-SSH administration documented"
assert_grep 'CF_ACCESS_AUD' "$README" "origin JWT validation documented"

finish
