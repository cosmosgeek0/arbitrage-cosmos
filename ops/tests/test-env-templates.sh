#!/usr/bin/env bash
# ops/tests/test-env-templates.sh — every env template is documented,
# shell-safe KEY=VALUE, and carries placeholders instead of secrets.
. "$(dirname "$0")/helpers.sh"

TEMPLATES="$(ls "$OPS_LIVE/env/"*.env.template)"
[ -n "$TEMPLATES" ] || fail "no env templates found"

for t in $TEMPLATES; do
  note "checking $(basename "$t")"

  # 1. every non-comment, non-blank line is KEY=VALUE with an UPPER_SNAKE key
  BAD="$(grep -vE '^[[:space:]]*#' "$t" | grep -vE '^[[:space:]]*$' | grep -vE '^[A-Z_][A-Z0-9_]*=' || true)"
  ASSERTIONS=$((ASSERTIONS + 1))
  [ -z "$BAD" ] || fail "$t: non KEY=VALUE content: $BAD"

  # 2. sensitive-named vars must carry REPLACE_ME_ placeholders (or be empty)
  SENSITIVE="$(grep -E '^[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSPHRASE|AUD|APIKEY|API_KEY)[A-Z0-9_]*=' "$t" || true)"
  if [ -n "$SENSITIVE" ]; then
    BADSEC="$(printf '%s\n' "$SENSITIVE" | grep -vE '=(REPLACE_ME_[A-Z0-9_]*)?$' || true)"
    ASSERTIONS=$((ASSERTIONS + 1))
    [ -z "$BADSEC" ] || fail "$t: sensitive var without placeholder value: $BADSEC"
  fi

  # 3. every assignment is documented: nearest preceding non-blank line is a comment
  UNDOC="$(awk '
    /^[[:space:]]*#/ { prev = "comment"; next }
    /^[[:space:]]*$/ { next }
    /^[A-Z_][A-Z0-9_]*=/ { if (prev != "comment" && prev != "assign") print NR": "$0; prev = "assign"; next }
    { prev = "other" }
  ' "$t")"
  ASSERTIONS=$((ASSERTIONS + 1))
  [ -z "$UNDOC" ] || fail "$t: undocumented assignment (no comment block above): $UNDOC"

  # 4. loopback discipline: any HOST/BASE value with an IP must be 127.0.0.1
  ASSERTIONS=$((ASSERTIONS + 1))
  ! grep -E '^(HOST|HEALTH_BASE)=' "$t" | grep -vE '127\.0\.0\.1' | grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
    || fail "$t: non-loopback address in HOST/HEALTH_BASE"

  # 5. the template can actually be sourced by the scripts' env loader
  ASSERTIONS=$((ASSERTIONS + 1))
  ( set -a; . "$t"; set +a ) >/dev/null 2>&1 || fail "$t: not shell-sourceable"
done

note "cross-file consistency: app HOST/PORT match deploy HEALTH_BASE"
APP_T="$OPS_LIVE/env/cosmos-app.env.template"
DEPLOY_T="$OPS_LIVE/env/cosmos-deploy.env.template"
PORT_LINE="$(grep -E '^PORT=' "$APP_T" | cut -d= -f2)"
assert_grep "^HEALTH_BASE=http://127\.0\.0\.1:$PORT_LINE\$" "$DEPLOY_T" "deploy gate targets the app port"
assert_grep '^HOST=127\.0\.0\.1$' "$APP_T" "app binds loopback"

finish
