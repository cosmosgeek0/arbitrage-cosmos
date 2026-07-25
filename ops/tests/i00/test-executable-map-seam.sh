#!/usr/bin/env bash
# Seam test: the executable descriptor maps in the live common shell and in the
# authorized-effect handoff producer must agree, per class, for every class they
# both declare.
#
# Both sides are parsed from THEIR OWN file. Neither is quoted from the other:
# reading one side twice agrees with itself by construction and cannot see a seam.
#
# The parse is gated on a hard-coded anchor read by eye. A parser that mis-reads
# both sides identically also agrees with itself, so a silent parse drift must
# fail here rather than quietly compare two corrupted lists.
#
# It does NOT require the two maps to declare the same CLASS SET. They deliberately
# do not: classes whose bootstrap policy is not the common shell never reach the
# shell consumer and are absent from it by design. Only classes present in BOTH
# are compared.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/helpers.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
SHELL_SRC="$ROOT/ops/live/bin/common.sh"
HANDOFF_SRC="$ROOT/ops/i00/bin/verify-authorized-effect-handoff.mjs"
assert_file "$SHELL_SRC"
assert_file "$HANDOFF_SRC"

note "descriptor maps agree per class, parsed independently from each side"
RESULT="$("$NODE" - "$SHELL_SRC" "$HANDOFF_SRC" <<'NODE'
const fs = require('fs');
const [shellPath, handoffPath] = process.argv.slice(2);
const shellSrc = fs.readFileSync(shellPath, 'utf8');
const handoffSrc = fs.readFileSync(handoffPath, 'utf8');

const shellMap = () => {
  const m = /const executableMaps = \{([\s\S]*?)\n\};/.exec(shellSrc);
  if (!m) throw new Error('PARSE: shell executableMaps not found');
  const out = {};
  for (const c of m[1].matchAll(/(\w+):\s*\{([\s\S]*?)\n  \}/g)) {
    out[c[1]] = [...c[2].matchAll(/(\w+):\s*fd\((\d+)\)/g)].map((x) => `${x[1]}:${x[2]}`).sort();
  }
  return out;
};
const handoffMap = () => {
  const m = /const expected = \{([\s\S]*?)\n  \};/.exec(handoffSrc);
  if (!m) throw new Error('PARSE: handoff expected map not found');
  const out = {};
  for (const part of `\n${m[1]}`.split(/\n    (?=\w+: \[)/)) {
    const h = /^\s*(\w+): \[([\s\S]*)/.exec(part);
    if (!h) continue;
    out[h[1]] = [...h[2].matchAll(/\['(\w+)',\s*(\d+)\]/g)].map((x) => `${x[1]}:${x[2]}`).sort();
  }
  return out;
};
const a = shellMap();
const b = handoffMap();

// ANCHOR: values read by eye from each file. If a parse silently drifts, fail here
// rather than compare two corrupted lists.
const anchors = [
  ['shell', a, 'BACKUP_CREATE', 10],
  ['handoff', b, 'SERVICE_RELEASE_SWITCH', 8],
];
for (const [side, map, cls, count] of anchors) {
  const got = (map[cls] || []).length;
  if (got !== count) throw new Error(`ANCHOR: ${side} ${cls} expected ${count} keys, parsed ${got} - parser drifted`);
}

const shared = Object.keys(a).filter((c) => c in b).sort();
if (shared.length === 0) throw new Error('PARSE: no classes declared by both sides');
const bad = [];
for (const c of shared) {
  if (a[c].join(',') !== b[c].join(',')) {
    bad.push(`${c}: shell=[${a[c]}] handoff=[${b[c]}]`);
  }
}
if (bad.length) throw new Error(`SEAM: ${bad.length} class(es) disagree -> ${bad.join(' | ')}`);
process.stdout.write(`compared ${shared.length} shared classes, all agree`);
NODE
)"
note "$RESULT"
assert_eq "${RESULT%%,*}" "compared 4 shared classes" "shared class count"

finish
