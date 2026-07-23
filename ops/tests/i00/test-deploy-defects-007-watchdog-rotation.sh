#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

WATCHDOG_UNIT="$REPO_ROOT/ops/live/systemd/cosmos-watchdog.service"
LOGROTATE_TEMPLATE="$REPO_ROOT/ops/templates/i00/logrotate/cosmos-ops"

note "DEPLOY-DEFECTS-007(5): watchdog writer remains the confined root service"
assert_file "$WATCHDOG_UNIT"
assert_file "$LOGROTATE_TEMPLATE"
if grep -Eq '^[[:space:]]*(User|Group)=' "$WATCHDOG_UNIT"; then
  fail_test "watchdog writer identity is no longer the systemd root default"
fi
pass_assertion
assert_contains "$(cat "$WATCHDOG_UNIT")" 'UMask=0077'
assert_contains "$(cat "$WATCHDOG_UNIT")" 'ReadWritePaths=/var/lib/cosmos /var/backups/cosmos'

note "DEPLOY-DEFECTS-007(5): rotation and replacement ownership match each writer"
node - "$LOGROTATE_TEMPLATE" <<'NODE' || fail_test "logrotate writer identity contract failed"
const fs = require('node:fs');

const source = fs.readFileSync(process.argv[2], 'utf8')
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*/, '').trim())
  .filter(Boolean)
  .join('\n');
const stanzas = [...source.matchAll(/([^{}\n]+)\s*\{([^{}]*)\}/g)].map((match) => ({
  paths: match[1].trim().split(/\s+/),
  directives: match[2].trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
}));
if (stanzas.length !== 2) process.exit(1);

const globRegex = (pattern) => new RegExp(`^${pattern
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '[^/]*')
  .replace(/\?/g, '[^/]')}$`);
const matching = (path) => stanzas.filter((stanza) =>
  stanza.paths.some((pattern) => globRegex(pattern).test(path)));
const directive = (stanza, name) =>
  stanza.directives.find((line) => line === name || line.startsWith(`${name} `));

const topLevel = matching('/var/lib/cosmos/ops/deploy-log.jsonl');
const watchdog = matching('/var/lib/cosmos/ops/watchdog/alerts.jsonl');
if (topLevel.length !== 1 || watchdog.length !== 1 || topLevel[0] === watchdog[0]) {
  process.exit(2);
}
if (JSON.stringify(topLevel[0].paths) !== JSON.stringify(['/var/lib/cosmos/ops/*.jsonl'])) {
  process.exit(3);
}
if (JSON.stringify(watchdog[0].paths)
    !== JSON.stringify(['/var/lib/cosmos/ops/watchdog/alerts.jsonl'])) {
  process.exit(4);
}
if (directive(topLevel[0], 'su') !== 'su cosmos cosmos'
    || directive(topLevel[0], 'create') !== 'create 0600 cosmos cosmos') {
  process.exit(5);
}
if (directive(watchdog[0], 'su') !== 'su root root'
    || directive(watchdog[0], 'create') !== 'create 0600 root root') {
  process.exit(6);
}
for (const stanza of stanzas) {
  for (const expected of [
    'daily',
    'maxsize 10M',
    'rotate 14',
    'missingok',
    'notifempty',
    'compress',
    'delaycompress',
  ]) {
    if (!stanza.directives.includes(expected)) process.exit(7);
  }
  const create = directive(stanza, 'create')?.split(/\s+/);
  const su = directive(stanza, 'su')?.split(/\s+/);
  if (!create || !su || create.length !== 4 || su.length !== 3
      || create[1] !== '0600'
      || create[2] !== su[1]
      || create[3] !== su[2]) {
    process.exit(8);
  }
}
NODE
pass_assertion

note "DEPLOY-DEFECTS-007(5): no broad nested wildcard or weaker file mode remains"
if grep -F '/var/lib/cosmos/ops/*/*.jsonl' "$LOGROTATE_TEMPLATE" >/dev/null; then
  fail_test "non-root rotation stanza still captures the root-written watchdog log"
fi
pass_assertion
if grep -Eq '^[[:space:]]*create[[:space:]]+0?6[4-7][0-7]' "$LOGROTATE_TEMPLATE"; then
  fail_test "logrotate template widens group or other permissions"
fi
pass_assertion

finish
