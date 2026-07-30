#!/usr/bin/env bash
# Dedicated source/composition proof for the staging logging overlay.
. "$(dirname "$0")/helpers.sh"

REPO_ROOT="$(cd "$TESTS_DIR/../.." && pwd -P)"
BASE="$REPO_ROOT/ops/live/systemd/cosmos-app.service"
I00="$REPO_ROOT/ops/templates/i00/systemd/cosmos-app-i00.conf.template"
LOGGING="$REPO_ROOT/ops/templates/logging/systemd/95-cosmos-app-logging.conf.template"
ENVIRONMENT="$REPO_ROOT/server/src/bootstrap/environment.ts"

service_values() { # key files...
  local key="$1"
  shift
  awk -v key="$key" '
    FNR == 1 { section = "" }
    /^\[/ { section = $0; next }
    section == "[Service]" && index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value == "") {
        count = 0
        next
      }
      values[++count] = value
    }
    END {
      for (i = 1; i <= count; i += 1) print values[i]
    }
  ' "$@"
}

service_last_value() { # key files...
  local key="$1"
  shift
  service_values "$key" "$@" | tail -1
}

note "logging overlay owns policy only"
assert_file "$LOGGING"
assert_eq "$(grep -c '^\[Service\]$' "$LOGGING")" 1 "one Service section"
for key in SyslogLevelPrefix LogLevelMax LogRateLimitIntervalSec LogRateLimitBurst; do
  assert_eq "$(grep -c "^${key}=" "$LOGGING")" 1 "$key declared exactly once"
done
assert_not_grep '^ExecStart=' "$LOGGING" "logging overlay does not own process entry"
assert_not_grep '^Environment(File)?=' "$LOGGING" "logging overlay carries no environment values"
assert_not_grep '(TOKEN|SECRET|PASSWORD|API_KEY)=' "$LOGGING" "logging overlay carries no secret assignment"

note "base + I00 + logging compose without changing the accepted entrypoint"
COMPOSED_EXEC_START="$(service_values ExecStart "$BASE" "$I00" "$LOGGING")"
assert_eq "$(printf '%s\n' "$COMPOSED_EXEC_START" | grep -c .)" 1 "one effective ExecStart"
assert_eq "$COMPOSED_EXEC_START" \
  "/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases /usr/bin/node /usr/local/lib/cosmos-ops/i00/bin/app-entrypoint.mjs" \
  "accepted I00 entrypoint remains exact"

assert_eq "$(service_last_value SyslogLevelPrefix "$BASE" "$I00" "$LOGGING")" yes \
  "priority prefixes enabled"
assert_eq "$(service_last_value LogLevelMax "$BASE" "$I00" "$LOGGING")" info \
  "info and higher priorities retained"
assert_eq "$(service_last_value LogRateLimitIntervalSec "$BASE" "$I00" "$LOGGING")" 0 \
  "unit-wide journal interval disabled"
assert_eq "$(service_last_value LogRateLimitBurst "$BASE" "$I00" "$LOGGING")" 0 \
  "unit-wide journal burst disabled"

note "production bootstrap installs the selective application policy"
assert_grep "import \\{ installProductionLogging \\} from '../ops/productionLogging\\.js';" \
  "$ENVIRONMENT" "logging policy import present"
assert_grep "installProductionLogging\\(\\{ environment: process\\.env\\.NODE_ENV \\}\\);" \
  "$ENVIRONMENT" "production-only logging install present"

finish
