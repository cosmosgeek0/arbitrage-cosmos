#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

INSPECTOR="$I00_ROOT/bin/inspect-effect-identity.mjs"
FIXTURE_REQUESTED="$TEST_TMP/effect-identity"
mkdir -m 700 "$FIXTURE_REQUESTED"
FIXTURE="$(node -e 'process.stdout.write(require("fs").realpathSync.native(process.argv[1]))' "$FIXTURE_REQUESTED")"
UNIT="$FIXTURE/cosmos-backup.service"
ID_BIN="$FIXTURE/id"
GETENT_BIN="$FIXTURE/getent"
CALLS="$FIXTURE/calls"
CURRENT_UID="$(node -e 'process.stdout.write(String(process.geteuid()))')"
CURRENT_GID="$(node -e 'process.stdout.write(String(process.getegid()))')"

cat >"$UNIT" <<'EOF'
[Unit]
Description=Bound effect fixture

[Service]
User=cosmos
Group=cosmos
ExecStart=/bin/true
EOF
cat >"$ID_BIN" <<EOF
#!/bin/sh
printf 'id:%s:%s\n' "\$1" "\$2" >>"$CALLS"
case "\$1:\$2" in
  -u:cosmos) printf '%s\n' "$CURRENT_UID" ;;
  -g:cosmos) printf '999999\n' ;;
  *) exit 1 ;;
esac
EOF
cat >"$GETENT_BIN" <<EOF
#!/bin/sh
printf 'getent:%s:%s\n' "\$1" "\$2" >>"$CALLS"
[ "\$1:\$2" = "group:cosmos" ] || exit 1
printf 'cosmos:x:%s:\\n' "$CURRENT_GID"
EOF
chmod 600 "$UNIT"
chmod 700 "$ID_BIN" "$GETENT_BIN"

inspect() {
  node "$INSPECTOR" \
    --unit "$UNIT" --id "$ID_BIN" --getent "$GETENT_BIN" \
    --expected-user cosmos --expected-group cosmos
}

note "effect identity binds sealed unit user and explicit group resolution"
INITIAL="$(inspect)"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).uid)' "$INITIAL")" "$CURRENT_UID"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).gid)' "$INITIAL")" "$CURRENT_GID"
assert_contains "$(cat "$CALLS")" 'id:-u:cosmos'
ASSERTIONS=$((ASSERTIONS + 1))
if grep -F -- 'id:-g:cosmos' "$CALLS" >/dev/null; then
  fail_test "group identity was derived from the user instead of the sealed group"
fi
assert_contains "$(cat "$CALLS")" 'getent:group:cosmos'

note "unit identity changes are visible to the caller recheck"
printf '\n# identity change\n' >>"$UNIT"
CHANGED="$(inspect)"
ASSERTIONS=$((ASSERTIONS + 1))
[ "$CHANGED" != "$INITIAL" ] || fail_test "unit identity change was not reflected"

note "duplicate and mismatched unit identities are rejected"
cat >"$UNIT" <<'EOF'
[Service]
User=cosmos
User=cosmos
Group=cosmos
EOF
assert_failure_contains 'duplicate User binding' inspect
cat >"$UNIT" <<'EOF'
[Service]
User=cosmos
Group=operators
EOF
assert_failure_contains 'does not bind the sealed intended user/group' inspect

note "group resolver output must identify the explicit sealed group"
cat >"$UNIT" <<'EOF'
[Service]
User=cosmos
Group=cosmos
EOF
cat >"$GETENT_BIN" <<EOF
#!/bin/sh
printf 'other:x:%s:\\n' "$CURRENT_GID"
EOF
chmod 700 "$GETENT_BIN"
assert_failure_contains 'effect gid resolution returned an invalid identifier' inspect

note "resolver aliases and action-time executable mutation are rejected"
ln -s "$ID_BIN" "$FIXTURE/id-alias"
assert_failure_contains 'identity resolver must be one canonical absolute path' \
  node "$INSPECTOR" \
    --unit "$UNIT" --id "$FIXTURE/id-alias" --getent "$GETENT_BIN" \
    --expected-user cosmos --expected-group cosmos

MUTATING_ID_BIN="$FIXTURE/id-mutating"
cat >"$MUTATING_ID_BIN" <<EOF
#!/bin/sh
printf '%s\n' "$CURRENT_UID"
printf '\n# changed\n' >>"\$0"
EOF
chmod 700 "$MUTATING_ID_BIN"
assert_failure_contains 'identity resolver identity or digest changed around action-time invocation' \
  node "$INSPECTOR" \
    --unit "$UNIT" --id "$MUTATING_ID_BIN" --getent "$GETENT_BIN" \
    --expected-user cosmos --expected-group cosmos

cat >"$ID_BIN" <<EOF
#!/bin/sh
[ "\$1:\$2" = "-u:cosmos" ] || exit 1
printf '%s\n' "$CURRENT_UID"
EOF
MUTATING_GETENT_BIN="$FIXTURE/getent-mutating"
cat >"$MUTATING_GETENT_BIN" <<EOF
#!/bin/sh
[ "\$1:\$2" = "group:cosmos" ] || exit 1
printf 'cosmos:x:%s:\\n' "$CURRENT_GID"
printf '\n# changed\n' >>"\$0"
EOF
chmod 700 "$ID_BIN" "$MUTATING_GETENT_BIN"
assert_failure_contains 'group resolver identity or digest changed around action-time invocation' \
  node "$INSPECTOR" \
    --unit "$UNIT" --id "$ID_BIN" --getent "$MUTATING_GETENT_BIN" \
    --expected-user cosmos --expected-group cosmos

note "final revalidation rejects a resolver that cross-mutates the sealed unit"
CROSS_MUTATING_GETENT_BIN="$FIXTURE/getent-cross-mutating"
CROSS_MUTATION_CALLS="$FIXTURE/getent-cross-mutation-calls"
cat >"$CROSS_MUTATING_GETENT_BIN" <<EOF
#!/bin/sh
[ "\$1:\$2" = "group:cosmos" ] || exit 1
count=0
if [ -f "$CROSS_MUTATION_CALLS" ]; then
  IFS= read -r count <"$CROSS_MUTATION_CALLS"
fi
count=\$((count + 1))
printf '%s\n' "\$count" >"$CROSS_MUTATION_CALLS"
printf 'cosmos:x:%s:\\n' "$CURRENT_GID"
if [ "\$count" -eq 2 ]; then
  printf '\n# cross-mutated after resolver use\n' >>"$UNIT"
fi
EOF
chmod 700 "$CROSS_MUTATING_GETENT_BIN"
assert_failure_contains 'effect unit identity or digest changed around action-time invocation' \
  node "$INSPECTOR" \
    --unit "$UNIT" --id "$ID_BIN" --getent "$CROSS_MUTATING_GETENT_BIN" \
    --expected-user cosmos --expected-group cosmos

finish
