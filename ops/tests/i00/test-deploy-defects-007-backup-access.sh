#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

DROPIN="$REPO_ROOT/ops/templates/i00/systemd/cosmos-backup-config-read.conf.template"
TMPFILES="$REPO_ROOT/ops/templates/i00/tmpfiles/cosmos-backup-config-access.conf.template"
RUNBOOK="$REPO_ROOT/ops/docs/i00/RELEASE_AND_RECOVERY_RUNBOOK.md"

note "DEPLOY-DEFECTS-007(4): only the backup unit receives the config-read group"
assert_file "$DROPIN"
DROPIN_DIRECTIVES="$(grep -Ev '^[[:space:]]*(#|$)' "$DROPIN")"
EXPECTED_DROPIN='[Service]
SupplementaryGroups=cosmos-backup'
assert_eq "$DROPIN_DIRECTIVES" "$EXPECTED_DROPIN"

note "DEPLOY-DEFECTS-007(4): ACL scope is two exact non-secret config files"
assert_file "$TMPFILES"
DIRECTIVES="$(grep -Ev '^[[:space:]]*(#|$)' "$TMPFILES")"
EXPECTED_DIRECTIVES='a /etc/cosmos/cosmos-deploy.env - - - - user::rw-,group::r--,group:cosmos-backup:r--,mask::r--,other::---
a /etc/cosmos/cosmos-watchdog.env - - - - user::rw-,group::r--,group:cosmos-backup:r--,mask::r--,other::---'
assert_eq "$DIRECTIVES" "$EXPECTED_DIRECTIVES"

note "DEPLOY-DEFECTS-007(4): parsed template grants only unit-scoped read"
node - "$TMPFILES" <<'NODE' || fail_test "backup ACL permission model failed"
const fs = require('fs');
const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#'));
const expectedPaths = [
  '/etc/cosmos/cosmos-deploy.env',
  '/etc/cosmos/cosmos-watchdog.env',
];
if (lines.length !== 2) process.exit(1);
for (let index = 0; index < lines.length; index += 1) {
  const fields = lines[index].split(/\s+/);
  if (fields.length !== 7 || fields[0] !== 'a' || fields[1] !== expectedPaths[index]
      || fields.slice(2, 6).some((value) => value !== '-')) process.exit(2);
  const entries = fields[6].split(',');
  const expected = [
    'user::rw-',
    'group::r--',
    'group:cosmos-backup:r--',
    'mask::r--',
    'other::---',
  ];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) process.exit(3);
  const named = entries.find((entry) => entry.startsWith('group:cosmos-backup:'));
  const mask = entries.find((entry) => entry.startsWith('mask::'));
  const other = entries.find((entry) => entry.startsWith('other::'));
  const permissions = (entry) => entry?.split(':').at(-1);
  if (permissions(named) !== 'r--' || permissions(mask) !== 'r--'
      || permissions(other) !== '---') {
    process.exit(4);
  }
  if (permissions(named).includes('w') || permissions(mask).includes('w')
      || permissions(other).includes('r') || permissions(other).includes('w')) {
    process.exit(5);
  }
}
NODE
pass_assertion

note "DEPLOY-DEFECTS-007(4): host law preserves modes and excludes secrets"
RUNBOOK_TEXT="$(cat "$RUNBOOK")"
assert_contains "$RUNBOOK_TEXT" 'root:root` mode `0640'
assert_contains "$RUNBOOK_TEXT" 'root:root` mode `0600'
assert_contains "$RUNBOOK_TEXT" 'must not be added globally'
assert_contains "$RUNBOOK_TEXT" 'systemd-tmpfiles --create'
assert_contains "$RUNBOOK_TEXT" 'systemctl daemon-reload'
assert_contains "$RUNBOOK_TEXT" 'systemctl show --property=SupplementaryGroups'
assert_contains "$RUNBOOK_TEXT" 'getfacl --absolute-names --omit-header'
assert_contains "$RUNBOOK_TEXT" "grep -Fxc cosmos-backup"
assert_contains "$RUNBOOK_TEXT" 'return `0`, proving'

finish
