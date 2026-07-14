#!/usr/bin/env bash
# ops/tests/test-secret-scanner.sh — nothing under ops/live may contain
# anything that even resembles a real credential, hostname, IP, or endpoint.
# The boundary is: placeholders only (REPLACE_ME_*), loopback only (127.0.0.1).
. "$(dirname "$0")/helpers.sh"

FILES="$(find "$OPS_LIVE" -type f | sort)"
[ -n "$FILES" ] || fail "no files under ops/live"

scan_forbid() { # pattern label
  local hits
  hits="$(grep -rEl "$1" "$OPS_LIVE" || true)"
  ASSERTIONS=$((ASSERTIONS + 1))
  [ -z "$hits" ] || fail "$2 found in: $hits"
}

note "credential patterns"
scan_forbid 'AKIA[0-9A-Z]{16}' "AWS access key id"
scan_forbid 'ASIA[0-9A-Z]{16}' "AWS temporary key id"
scan_forbid 'BEGIN( [A-Z]+)? PRIVATE KEY' "private key material"
scan_forbid 'eyJ[A-Za-z0-9_-]{10,}\.' "JWT-like token"
scan_forbid 'ghp_[A-Za-z0-9]{20,}' "GitHub token"
scan_forbid 'xox[bpars]-' "Slack token"
scan_forbid 'sk_(live|test)_' "Stripe-style key"
scan_forbid '[0-9a-f]{64}' "64-hex blob (key/hash material does not belong in templates)"
scan_forbid 'hooks\.slack\.com|discord(app)?\.com/api/webhooks' "webhook URL"

note "network endpoints: loopback only"
IP_HITS="$(grep -rEoh '([0-9]{1,3}\.){3}[0-9]{1,3}' "$OPS_LIVE" | sort -u | grep -v '^127\.0\.0\.1$' || true)"
ASSERTIONS=$((ASSERTIONS + 1))
[ -z "$IP_HITS" ] || fail "non-loopback IP literal(s) in ops/live: $IP_HITS"

note "hostnames: placeholders and documented format suffixes only"
DOMAIN_ALLOWLIST='^(cloudflareaccess\.com|anthropic\.com|claude\.com)$'
DOMAIN_HITS="$(grep -rEoh '[A-Za-z0-9][A-Za-z0-9-]*\.(com|net|org|io|dev|cloud)' "$OPS_LIVE" \
  | sort -u | grep -vE "$DOMAIN_ALLOWLIST" || true)"
ASSERTIONS=$((ASSERTIONS + 1))
[ -z "$DOMAIN_HITS" ] || fail "unexpected hostname(s) in ops/live: $DOMAIN_HITS"

note "no email addresses"
EMAIL_HITS="$(grep -rEoh '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$OPS_LIVE" | sort -u || true)"
ASSERTIONS=$((ASSERTIONS + 1))
[ -z "$EMAIL_HITS" ] || fail "email address(es) in ops/live: $EMAIL_HITS"

note "the scanner itself is alive (must catch a seeded canary)"
CANARY="$SANDBOX/canary"
mkdir -p "$CANARY"
echo 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE' > "$CANARY/leak.txt"
HITS="$(grep -rEl 'AKIA[0-9A-Z]{16}' "$CANARY" || true)"
assert_ne "$HITS" "" "scanner detects a seeded AWS key"

finish
