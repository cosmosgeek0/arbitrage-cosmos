#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"
TEST_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$TEST_TMP")"
REAL_NODE="$(node -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$TEST_TMP/ip-ops-i00-sim-sanitizer-$$")"
STAGING_ALIAS_ROOT=
cleanup_sanitizer_test() {
  local rc="${1:-$?}"
  if [ -n "$STAGING_ALIAS_ROOT" ] && [ -d "$STAGING_ALIAS_ROOT" ]; then
    rmdir "$STAGING_ALIAS_ROOT" 2>/dev/null || true
  fi
  cleanup_test_tmp "$rc"
}
trap cleanup_sanitizer_test EXIT
sanitize() {
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
    --provenance-mode TEST --provenance-root "$SIMULATION_ROOT" "$@"
}

BASE="$SIMULATION_ROOT/deploy.env"
cat > "$BASE" <<ENV
COSMOS_ROOT=$SIMULATION_ROOT/cosmos
RELEASES_DIR=$SIMULATION_ROOT/cosmos/releases
CURRENT_LINK=$SIMULATION_ROOT/cosmos/current
PREVIOUS_LINK=$SIMULATION_ROOT/cosmos/previous
DATA_DIR=$SIMULATION_ROOT/data
OPS_STATE_DIR=$SIMULATION_ROOT/ops-state
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
PROBE_ENABLED=1
PROBE_PORT=8091
PROBE_BASE=http://127.0.0.1:8091
READINESS_GATE_PATHS="/health/live /health/ready"
POST_SWITCH_GATE_PATHS="/health/live /health/ready"
GATE_TIMEOUT_SEC=60
HTTP_TIMEOUT_SEC=5
LOCK_TIMEOUT_SEC=30
DEPLOY_LOCK=$SIMULATION_ROOT/ops-state/locks/deploy.lock
DEPLOY_LOG=$SIMULATION_ROOT/ops-state/deploy-log.jsonl
FROZEN_MARKER=$SIMULATION_ROOT/ops-state/deploy-frozen.json
MONEY_READY_MARKER=$SIMULATION_ROOT/ops-state/money-ready
EXPOSURE_CMD=
I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback
I00_OPS_READBACK_TIMEOUT_MS=750
ALERT_CMD=
ENV

note "provenance mode closes system, staging, test, and output root categories"
assert_failure_contains '--provenance-mode are required' \
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --env "$BASE" --output "$SIMULATION_ROOT/missing-mode.env" --profile deploy
SYSTEM_CATEGORY_PARENT="$(node -e 'process.stdout.write(require("fs").realpathSync("/tmp"))')/i00-release-switch.category-$$"
mkdir "$SYSTEM_CATEGORY_PARENT"
chmod 700 "$SYSTEM_CATEGORY_PARENT"
assert_failure_contains 'SYSTEM deploy donor env COSMOS_ROOT must equal the exact category path' \
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --provenance-mode SYSTEM \
  --env "$BASE" --output "$SYSTEM_CATEGORY_PARENT/deploy.env" --profile deploy
rmdir "$SYSTEM_CATEGORY_PARENT"
assert_failure_contains 'STAGING provenance root must be one exact /var/tmp/cosmos-df32-proof-<4>' \
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --provenance-mode STAGING --provenance-root "$SIMULATION_ROOT" \
  --env "$BASE" --output "$SIMULATION_ROOT/wrong-staging.env" --profile deploy
WRONG_TEST_CATEGORY="$SIMULATION_ROOT/wrong-test-category.env"
sed "s#^DATA_DIR=.*#DATA_DIR=$SIMULATION_ROOT/foreign-data#" "$BASE" >"$WRONG_TEST_CATEGORY"
assert_failure_contains 'TEST deploy donor env DATA_DIR must equal the exact category path' \
  sanitize --env "$WRONG_TEST_CATEGORY" \
  --output "$SIMULATION_ROOT/wrong-test-category.out" --profile deploy
assert_failure_contains 'TEST sanitized donor env output must remain below the marked simulation root' \
  sanitize --env "$BASE" --output "$TEST_TMP/outside-test-root.env" --profile deploy
assert_not_file "$TEST_TMP/outside-test-root.env"
assert_failure_contains 'donor env input must be one lexical-canonical non-root absolute path' \
  sanitize --env deploy.env --output "$SIMULATION_ROOT/relative-input.out" --profile deploy
assert_failure_contains 'donor env input must be one lexical-canonical non-root absolute path' \
  sanitize --env "$SIMULATION_ROOT/./deploy.env" \
  --output "$SIMULATION_ROOT/dot-input.out" --profile deploy
ln -s "$BASE" "$SIMULATION_ROOT/deploy-input-alias.env"
assert_failure_contains 'physical non-symlink single-link regular file' \
  sanitize --env "$SIMULATION_ROOT/deploy-input-alias.env" \
  --output "$SIMULATION_ROOT/alias-input.out" --profile deploy
assert_failure_contains '--output must be one lexical-canonical non-root absolute path' \
  sanitize --env "$BASE" --output relative-output.env --profile deploy
assert_failure_contains '--output must be one lexical-canonical non-root absolute path' \
  sanitize --env "$BASE" --output "$SIMULATION_ROOT/./dot-output.env" --profile deploy
mkdir "$SIMULATION_ROOT/output-real"
chmod 700 "$SIMULATION_ROOT/output-real"
ln -s "$SIMULATION_ROOT/output-real" "$SIMULATION_ROOT/output-alias"
assert_failure_contains 'TEST sanitized donor env output must remain below the marked simulation root' \
  sanitize --env "$BASE" --output "$SIMULATION_ROOT/output-alias/deploy.env" --profile deploy
assert_failure_contains 'SYSTEM sanitized donor env output must use one exact physical /tmp wrapper parent' \
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --provenance-mode SYSTEM --env "$BASE" \
  --output "$SIMULATION_ROOT/arbitrary-private.env" --profile deploy
PHYSICAL_TMP="$(node -e 'process.stdout.write(require("fs").realpathSync("/tmp"))')"
HOSTILE_SYSTEM_PARENT="$PHYSICAL_TMP/i00-release-switch.hostile-$$"
mkdir "$HOSTILE_SYSTEM_PARENT"
chmod 700 "$HOSTILE_SYSTEM_PARENT"
assert_failure_contains 'outside the exact wrapper parent and caller leaf families' \
  node "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --provenance-mode SYSTEM --env "$BASE" \
  --output "$HOSTILE_SYSTEM_PARENT/not-deploy.env" --profile deploy
rmdir "$HOSTILE_SYSTEM_PARENT"

note "staging root rejects protected-root physical aliases through inaccessible projections"
STAGING_ALIAS_ROOT="/var/tmp/cosmos-df32-proof-cafe"
if [ -e "$STAGING_ALIAS_ROOT" ]; then
  fail_test "staging alias fixture path already exists"
fi
mkdir "$STAGING_ALIAS_ROOT"
chmod 700 "$STAGING_ALIAS_ROOT"
STAGING_ALIAS_HOOK="$TEST_TMP/staging-protected-alias-hook.mjs"
cat >"$STAGING_ALIAS_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const proof = process.env.DF32_STAGING_ALIAS_ROOT;
const originalLstatSync = fs.lstatSync;
const originalRealpathSync = fs.realpathSync;
fs.lstatSync = function guardedLstatSync(path, ...rest) {
  if (path === '/opt/cosmos') {
    const error = new Error('inaccessible protected alias');
    error.code = 'EACCES';
    throw error;
  }
  const stat = originalLstatSync.call(this, path, ...rest);
  if (path === proof) stat.uid = typeof stat.uid === 'bigint' ? 0n : 0;
  return stat;
};
fs.realpathSync = function guardedRealpathSync(path, ...rest) {
  if (path === proof) return proof;
  if (path === '/opt') return proof;
  return originalRealpathSync.call(this, path, ...rest);
};
syncBuiltinESMExports();
NODE
chmod 600 "$STAGING_ALIAS_HOOK"
assert_failure_contains 'physically projected protected production root union' \
  env DF32_STAGING_ALIAS_ROOT="$STAGING_ALIAS_ROOT" \
  node --import "$STAGING_ALIAS_HOOK" "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --provenance-mode STAGING --provenance-root "$STAGING_ALIAS_ROOT" \
  --env "$BASE" --output "$STAGING_ALIAS_ROOT/sanitized/deploy.env" --profile deploy
rmdir "$STAGING_ALIAS_ROOT"
STAGING_ALIAS_ROOT=

note "production sanitizer emits one canonical effective health/probe/marker contract"
OUT="$SIMULATION_ROOT/sanitized.env"
assert_success sanitize --env "$BASE" --output "$OUT" --profile deploy
assert_contains "$(cat "$OUT")" "HEALTH_BASE='http://127.0.0.1:8080'"
assert_contains "$(cat "$OUT")" "PROBE_ENABLED='1'"
assert_contains "$(cat "$OUT")" "PROBE_BASE='http://127.0.0.1:8091'"
assert_contains "$(cat "$OUT")" "READINESS_GATE_PATHS='/health/live /health/ready'"
assert_contains "$(cat "$OUT")" "POST_SWITCH_GATE_PATHS='/health/live /health/ready'"
assert_contains "$(cat "$OUT")" "DEPLOY_LOCK='$SIMULATION_ROOT/ops-state/locks/deploy.lock'"
assert_contains "$(cat "$OUT")" "DEPLOY_LOG='$SIMULATION_ROOT/ops-state/deploy-log.jsonl'"
assert_contains "$(cat "$OUT")" "FROZEN_MARKER='$SIMULATION_ROOT/ops-state/deploy-frozen.json'"
assert_contains "$(cat "$OUT")" "MONEY_READY_MARKER='$SIMULATION_ROOT/ops-state/money-ready'"
assert_contains "$(cat "$OUT")" "I00_OPS_READBACK_URL='http://127.0.0.1:8080/api/system-integration/ops/readback'"
assert_eq "$(grep -c '^EXPOSURE_CMD=' "$OUT" || true)" 0
assert_eq "$(grep -c '^ALERT_CMD=' "$OUT" || true)" 0
node - "$OUT" <<'NODE'
const fs = require('node:fs');
const keys = fs.readFileSync(process.argv[2], 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => line.slice(0, line.indexOf('=')))
  .sort();
const expected = [
  'APP_UNIT', 'COSMOS_DEPLOY_VIA_I00_WRAPPER', 'COSMOS_ROOT', 'CURRENT_LINK',
  'DATA_DIR', 'DEPLOY_LOCK', 'DEPLOY_LOG', 'FROZEN_MARKER', 'GATE_TIMEOUT_SEC',
  'HEALTH_BASE', 'HTTP_TIMEOUT_SEC', 'I00_OPS_READBACK_TIMEOUT_MS',
  'I00_OPS_READBACK_URL', 'LOCK_TIMEOUT_SEC',
  'MONEY_READY_MARKER', 'OPS_STATE_DIR', 'POST_SWITCH_GATE_PATHS', 'PREVIOUS_LINK',
  'PROBE_BASE', 'PROBE_ENABLED', 'PROBE_PORT', 'READINESS_GATE_PATHS', 'RELEASES_DIR',
].sort();
if (JSON.stringify(keys) !== JSON.stringify(expected)) process.exit(1);
NODE
pass_assertion
FALLBACK_LOG="$(
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/ TMPDIR=/tmp NODE="$REAL_NODE" \
    /bin/bash -p -c '. "$1"; . "$2"; alert warning DF32_ALERT_CMD_OMITTED "sealed fallback"' \
    _ "$OUT" "$REPO_ROOT/ops/live/bin/common.sh" 2>&1
)"
assert_contains "$FALLBACK_LOG" 'ALERT [warning] DF32_ALERT_CMD_OMITTED: sealed fallback'

MINIMAL="$SIMULATION_ROOT/minimal.env"
grep -Ev '^(PROBE_ENABLED|PROBE_BASE|READINESS_GATE_PATHS|POST_SWITCH_GATE_PATHS|DEPLOY_LOCK|DEPLOY_LOG|FROZEN_MARKER|MONEY_READY_MARKER)=' "$BASE" > "$MINIMAL"
MINIMAL_OUT="$SIMULATION_ROOT/minimal-sanitized.env"
assert_success sanitize --env "$MINIMAL" --output "$MINIMAL_OUT" --profile deploy
for exact in \
  "PROBE_ENABLED='1'" \
  "PROBE_BASE='http://127.0.0.1:8091'" \
  "READINESS_GATE_PATHS='/health/live /health/ready'" \
  "POST_SWITCH_GATE_PATHS='/health/live /health/ready'" \
  "DEPLOY_LOCK='$SIMULATION_ROOT/ops-state/locks/deploy.lock'" \
  "DEPLOY_LOG='$SIMULATION_ROOT/ops-state/deploy-log.jsonl'" \
  "FROZEN_MARKER='$SIMULATION_ROOT/ops-state/deploy-frozen.json'" \
  "MONEY_READY_MARKER='$SIMULATION_ROOT/ops-state/money-ready'"; do
  assert_contains "$(cat "$MINIMAL_OUT")" "$exact"
done
assert_eq "$(grep -c '^ALERT_CMD=' "$MINIMAL_OUT" || true)" 0

note "effect profiles force one wrapper-supplied nested Bash and reject env selection"
BOUND_ROOT="$SIMULATION_ROOT"
BOUND_DATA="$BOUND_ROOT/data"
BOUND_OPS="$BOUND_ROOT/ops-state"
BOUND_BACKUPS="$BOUND_ROOT/backups"
mkdir -p "$BOUND_DATA" "$BOUND_OPS" "$BOUND_BACKUPS"
chmod 700 "$BOUND_ROOT"
REAL_BASH="$(node -e 'process.stdout.write(require("fs").realpathSync("/bin/bash"))')"
REAL_ENV="$(node -e 'process.stdout.write(require("fs").realpathSync("/usr/bin/env"))')"
REAL_ECHO="$(node -e 'process.stdout.write(require("fs").realpathSync("/bin/echo"))')"
BOUND_DEPLOY_ENV="$BOUND_ROOT/bound-deploy.env"
cat > "$BOUND_DEPLOY_ENV" <<EOF
COSMOS_ROOT=$BOUND_ROOT/cosmos
RELEASES_DIR=$BOUND_ROOT/cosmos/releases
CURRENT_LINK=$BOUND_ROOT/cosmos/current
PREVIOUS_LINK=$BOUND_ROOT/cosmos/previous
DATA_DIR=$BOUND_DATA
OPS_STATE_DIR=$BOUND_OPS
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
GATE_TIMEOUT_SEC=60
HTTP_TIMEOUT_SEC=5
LOCK_TIMEOUT_SEC=30
I00_OPS_READBACK_TIMEOUT_MS=750
I00_OPS_READBACK_URL=http://127.0.0.1:8080/api/system-integration/ops/readback
EOF
BOUND_DEPLOY_OUT="$BOUND_ROOT/deploy.sanitized.env"
assert_failure_contains '--bash is required for exact deploy effect bindings' \
  sanitize \
  --env "$BOUND_DEPLOY_ENV" --output "$BOUND_DEPLOY_OUT" --profile deploy \
  --node "$REAL_NODE" --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" \
  --require-effect-bindings
assert_not_file "$BOUND_DEPLOY_OUT"
assert_failure_contains '--env-bin is required for exact deploy effect bindings' \
  sanitize \
  --env "$BOUND_DEPLOY_ENV" --output "$BOUND_DEPLOY_OUT" --profile deploy \
  --node "$REAL_NODE" --bash "$REAL_BASH" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" \
  --require-effect-bindings
assert_not_file "$BOUND_DEPLOY_OUT"
assert_success sanitize \
  --env "$BOUND_DEPLOY_ENV" --output "$BOUND_DEPLOY_OUT" --profile deploy \
  --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" --require-effect-bindings
assert_eq "$(grep -c "^I00_BASH='$REAL_BASH'\$" "$BOUND_DEPLOY_OUT")" 1
assert_eq "$(grep -c "^I00_ENV='$REAL_ENV'\$" "$BOUND_DEPLOY_OUT")" 1
assert_eq "$(grep -Ec '^(EXPOSURE_CMD|ALERT_CMD)=' "$BOUND_DEPLOY_OUT" || true)" 0
assert_contains "$(cat "$BOUND_DEPLOY_OUT")" \
  "I00_OPS_READBACK_URL='http://127.0.0.1:8080/api/system-integration/ops/readback'"
for exact_timeout in \
  "GATE_TIMEOUT_SEC='60'" \
  "HTTP_TIMEOUT_SEC='5'" \
  "LOCK_TIMEOUT_SEC='30'" \
  "I00_OPS_READBACK_TIMEOUT_MS='750'"; do
  assert_contains "$(cat "$BOUND_DEPLOY_OUT")" "$exact_timeout"
done
BOUND_MISSING_TIMEOUT="$BOUND_ROOT/deploy.missing-timeout.env"
grep -v '^I00_OPS_READBACK_TIMEOUT_MS=' "$BOUND_DEPLOY_ENV" >"$BOUND_MISSING_TIMEOUT"
assert_failure_contains 'authorized donor env I00_OPS_READBACK_TIMEOUT_MS must equal 750' \
  sanitize --env "$BOUND_MISSING_TIMEOUT" --output "$BOUND_ROOT/missing-timeout.out" \
  --profile deploy --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" --require-effect-bindings
BOUND_DIVERGENT_TIMEOUT="$BOUND_ROOT/deploy.divergent-timeout.env"
sed 's/^HTTP_TIMEOUT_SEC=.*/HTTP_TIMEOUT_SEC=6/' \
  "$BOUND_DEPLOY_ENV" >"$BOUND_DIVERGENT_TIMEOUT"
assert_failure_contains 'authorized donor env HTTP_TIMEOUT_SEC must equal 5' \
  sanitize --env "$BOUND_DIVERGENT_TIMEOUT" --output "$BOUND_ROOT/divergent-timeout.out" \
  --profile deploy --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" --require-effect-bindings
BOUND_NAMED_EXPOSURE="$BOUND_ROOT/deploy.named-exposure.env"
printf '%s\n' "$(cat "$BOUND_DEPLOY_ENV")" \
  'EXPOSURE_CMD=/usr/local/lib/cosmos-ops/i00/bin/exposure-from-app.mjs' \
  >"$BOUND_NAMED_EXPOSURE"
assert_failure_contains 'donor env rejects named EXPOSURE_CMD selection' \
  sanitize --env "$BOUND_NAMED_EXPOSURE" --output "$BOUND_ROOT/named-exposure.out" \
  --profile deploy --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" --require-effect-bindings
BOUND_NAMED_ALERT="$BOUND_ROOT/deploy.named-alert.env"
printf '%s\n' "$(cat "$BOUND_DEPLOY_ENV")" \
  'ALERT_CMD=/usr/local/lib/cosmos-ops/bin/alert-log.sh' >"$BOUND_NAMED_ALERT"
assert_failure_contains 'donor env rejects named ALERT_CMD selection' \
  sanitize --env "$BOUND_NAMED_ALERT" --output "$BOUND_ROOT/named-alert.out" \
  --profile deploy --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --systemctl "$REAL_ECHO" --curl "$REAL_ECHO" --require-effect-bindings

note "risk producer channel emits sanitized bytes only on inherited descriptor 3"
assert_success node - "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  "$SIMULATION_ROOT" "$BOUND_DEPLOY_ENV" "$REAL_NODE" "$REAL_BASH" \
  "$REAL_ENV" "$REAL_ECHO" <<'NODE'
const { spawnSync } = require('node:child_process');
const [script, root, input, node, bash, env, effect] = process.argv.slice(2);
const common = [
  script,
  '--provenance-mode', 'TEST',
  '--provenance-root', root,
  '--env', input,
  '--result-fd', '3',
  '--profile', 'deploy',
  '--node', node,
  '--bash', bash,
  '--env-bin', env,
  '--systemctl', effect,
  '--curl', effect,
  '--require-effect-bindings',
];
const result = spawnSync(process.execPath, common, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
});
if (result.status !== 0 || result.stderr !== '') process.exit(1);
let status;
try { status = JSON.parse(result.stdout); } catch { process.exit(2); }
if (JSON.stringify(status) !== '{"status":"SANITIZED_DONOR_ENV_EMITTED"}') process.exit(3);
const emitted = result.output[3];
if (typeof emitted !== 'string'
    || !emitted.includes(`COSMOS_ROOT='${root}/cosmos'`)
    || !emitted.includes(`I00_BASH='${bash}'`)
    || result.stdout.includes('COSMOS_ROOT=')
    || result.stdout.includes(root)) process.exit(4);
const noDescriptor = spawnSync(process.execPath, common, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (noDescriptor.status === 0
    || (!noDescriptor.stderr.includes('inherited non-filesystem descriptor')
      && !noDescriptor.stderr.includes('could not be emitted'))) process.exit(5);
const both = spawnSync(process.execPath, [
  ...common,
  '--output', `${root}/forbidden-retained.env`,
], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
});
if (both.status === 0 || !both.stderr.includes('exactly one of --output or --result-fd 3')) {
  process.exit(6);
}
const noBindings = spawnSync(process.execPath, common.filter(
  (value) => value !== '--require-effect-bindings',
), {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
});
if (noBindings.status === 0
    || !noBindings.stderr.includes('--result-fd 3 requires exact effect bindings')) {
  process.exit(7);
}
NODE
assert_not_file "$SIMULATION_ROOT/forbidden-retained.env"

cp "$BOUND_DEPLOY_ENV" "$BOUND_ROOT/deploy-caller-bash.env"
printf 'I00_BASH=/tmp/caller-bash\n' >> "$BOUND_ROOT/deploy-caller-bash.env"
assert_failure_contains 'donor env key I00_BASH is outside the closed deploy profile' \
  sanitize \
  --env "$BOUND_ROOT/deploy-caller-bash.env" \
  --output "$BOUND_ROOT/deploy-caller-bash.out" --profile deploy
assert_not_file "$BOUND_ROOT/deploy-caller-bash.out"
cp "$BOUND_DEPLOY_ENV" "$BOUND_ROOT/deploy-caller-env.env"
printf 'I00_ENV=/tmp/caller-env\n' >> "$BOUND_ROOT/deploy-caller-env.env"
assert_failure_contains 'donor env key I00_ENV is outside the closed deploy profile' \
  sanitize \
  --env "$BOUND_ROOT/deploy-caller-env.env" \
  --output "$BOUND_ROOT/deploy-caller-env.out" --profile deploy
assert_not_file "$BOUND_ROOT/deploy-caller-env.out"

note "sanitized output exact-create rejects a swapped parent identity"
SANITIZER_SWAP_PARENT="$SIMULATION_ROOT/sanitizer-parent-swap"
SANITIZER_SWAP_DISPLACED="$SIMULATION_ROOT/sanitizer-parent-swap.displaced"
mkdir "$SANITIZER_SWAP_PARENT"
chmod 700 "$SANITIZER_SWAP_PARENT"
SANITIZER_SWAP_HOOK="$TEST_TMP/sanitizer-parent-swap-hook.mjs"
cat >"$SANITIZER_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const target = process.env.DF32_SANITIZER_PARENT_SWAP_TARGET;
const displaced = process.env.DF32_SANITIZER_PARENT_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  const descriptor = originalOpenSync.call(this, path, flags, ...rest);
  if (!swapped
      && path === target
      && (Number(flags) & (fs.constants.O_DIRECTORY ?? 0)) !== 0) {
    swapped = true;
    fs.renameSync(target, displaced);
    fs.mkdirSync(target, { mode: 0o700 });
  }
  return descriptor;
};
syncBuiltinESMExports();
NODE
chmod 600 "$SANITIZER_SWAP_HOOK"
assert_failure_contains 'sanitized donor env output parent path identity changed' \
  env DF32_SANITIZER_PARENT_SWAP_TARGET="$SANITIZER_SWAP_PARENT" \
    DF32_SANITIZER_PARENT_SWAP_DISPLACED="$SANITIZER_SWAP_DISPLACED" \
    node --import "$SANITIZER_SWAP_HOOK" "$I00_ROOT/bin/sanitize-donor-env.mjs" \
    --provenance-mode TEST --provenance-root "$SIMULATION_ROOT" \
    --env "$BOUND_DEPLOY_ENV" \
    --output "$SANITIZER_SWAP_PARENT/deploy.sanitized.env" \
    --profile deploy
assert_eq "$(find "$SANITIZER_SWAP_PARENT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
assert_eq "$(find "$SANITIZER_SWAP_DISPLACED" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0

BOUND_BACKUP_ENV="$BOUND_ROOT/backup.env"
cat > "$BOUND_BACKUP_ENV" <<EOF
DATA_DIR=$BOUND_DATA
BACKUP_DIR=$BOUND_BACKUPS
OPS_STATE_DIR=$BOUND_OPS
EOF
BOUND_BACKUP_OUT="$BOUND_ROOT/backup.sanitized.env"
assert_success sanitize \
  --env "$BOUND_BACKUP_ENV" --output "$BOUND_BACKUP_OUT" --profile backup \
  --node "$REAL_NODE" --bash "$REAL_BASH" --env-bin "$REAL_ENV" \
  --sqlite "$REAL_ECHO" --tar "$REAL_ECHO" \
  --require-effect-bindings
assert_eq "$(grep -c "^I00_BASH='$REAL_BASH'\$" "$BOUND_BACKUP_OUT")" 1
assert_eq "$(grep -c "^I00_ENV='$REAL_ENV'\$" "$BOUND_BACKUP_OUT")" 1
assert_eq "$(grep -c "^BACKUP_LOCK='$BOUND_BACKUPS/.lock'\$" "$BOUND_BACKUP_OUT")" 1
assert_eq "$(grep -c "^EVIDENCE_PATHS=''\$" "$BOUND_BACKUP_OUT")" 1
cp "$BOUND_BACKUP_ENV" "$BOUND_ROOT/backup-evidence-paths.env"
printf 'EVIDENCE_PATHS=%s\n' "$BOUND_DATA" >>"$BOUND_ROOT/backup-evidence-paths.env"
assert_failure_contains 'authorized backup donor env EVIDENCE_PATHS must be empty' \
  sanitize \
  --env "$BOUND_ROOT/backup-evidence-paths.env" \
  --output "$BOUND_ROOT/backup-evidence-paths.out" --profile backup
assert_not_file "$BOUND_ROOT/backup-evidence-paths.out"
cp "$BOUND_BACKUP_ENV" "$BOUND_ROOT/backup-hostile-lock.env"
printf 'BACKUP_LOCK=%s\n' "$BOUND_OPS/foreign.lock" >>"$BOUND_ROOT/backup-hostile-lock.env"
assert_failure_contains 'BACKUP_LOCK must remain inside the canonical backup directory' \
  sanitize \
  --env "$BOUND_ROOT/backup-hostile-lock.env" \
  --output "$BOUND_ROOT/backup-hostile-lock.out" --profile backup
assert_not_file "$BOUND_ROOT/backup-hostile-lock.out"

note "release and rollback delegate only the deploy-profile sanitized env"
for binding in 'release-switch.sh|deploy.sh' 'rollback-switch.sh|rollback.sh'; do
  wrapper="${binding%%|*}"
  donor="${binding#*|}"
  source="$(cat "$I00_ROOT/bin/$wrapper")"
  assert_contains "$source" '"$NODE_PATH" "$SCRIPT_DIR/sanitize-donor-env.mjs"'
  assert_contains "$source" '--env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy'
  assert_contains "$source" '--bash "$BASH_PATH"'
  assert_contains "$source" '--env-bin "$ENV_PATH"'
  assert_contains "$source" '"$SCRIPT_DIR/run-bound-effect.mjs"'
  assert_contains "$source" "-- \"\$DONOR_ROOT/bin/$donor\""
  assert_contains "$source" '--i00-effect-environment "$DELEGATE_ENV"'
  if printf '%s' "$source" | grep -F "I00_EFFECT_CLASS=" >/dev/null; then
    fail_test "$wrapper retains caller-selected effect class state"
  fi
  pass_assertion
done

CASE_NUMBER=0
reject_line() {
  local key="$1" replacement="$2" expected="$3"
  CASE_NUMBER=$((CASE_NUMBER + 1))
  local input="$SIMULATION_ROOT/rejected-$CASE_NUMBER.env" output="$SIMULATION_ROOT/rejected-$CASE_NUMBER.out"
  awk -v key="$key" -v replacement="$replacement" '
    index($0, key "=") == 1 { print replacement; found=1; next }
    { print }
    END { if (!found) exit 2 }
  ' "$BASE" > "$input"
  assert_failure_contains "$expected" sanitize --env "$input" --output "$output" --profile deploy
  assert_not_file "$output"
}

note "every deploy authority path rejects an existing-ancestor symlink alias"
AUTHORITY_REAL="$TEST_TMP/authority-real"
AUTHORITY_ALIAS="$TEST_TMP/authority-alias"
mkdir "$AUTHORITY_REAL"
ln -s "$AUTHORITY_REAL" "$AUTHORITY_ALIAS"
for key in COSMOS_ROOT RELEASES_DIR CURRENT_LINK PREVIOUS_LINK DATA_DIR OPS_STATE_DIR; do
  reject_line "$key" "$key=$AUTHORITY_ALIAS/$key" \
    "donor env $key existing ancestor chain contains a symlink alias"
done

note "hostile bases, gate weakening, disabled probes, and marker aliases are rejected"
reject_line HEALTH_BASE 'HEALTH_BASE=http://localhost:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=http://0.0.0.0:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=https://127.0.0.1:8080' 'exact numeric-loopback HTTP origin'
reject_line HEALTH_BASE 'HEALTH_BASE=http://127.0.0.1:8080/' 'not canonically encoded'
reject_line HEALTH_BASE 'HEALTH_BASE=http://127.0.0.1:8080?gate=weak' 'contains executable or ambiguous shell syntax'
reject_line PROBE_BASE 'PROBE_BASE=http://127.0.0.1:8092' 'must match the numeric-loopback probe port'
reject_line PROBE_BASE 'PROBE_BASE=http://192.0.2.10:8091' 'exact numeric-loopback HTTP origin'
reject_line PROBE_ENABLED 'PROBE_ENABLED=0' 'must keep the pre-switch probe enabled'
reject_line PROBE_PORT 'PROBE_PORT=8080' 'must differ from the production HEALTH_BASE port'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS=/health/live' 'exact liveness and semantic-readiness gates'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS="/health/live /health/trade-ready"' 'exact liveness and semantic-readiness gates'
reject_line READINESS_GATE_PATHS 'READINESS_GATE_PATHS="/health/ready /health/live"' 'exact liveness and semantic-readiness gates'
reject_line POST_SWITCH_GATE_PATHS 'POST_SWITCH_GATE_PATHS=/health/live' 'exact liveness and semantic-readiness gates'
reject_line DEPLOY_LOCK 'DEPLOY_LOCK=/var/backups/cosmos/foreign.lock' 'canonical ops-state directory'
reject_line DEPLOY_LOG 'DEPLOY_LOG=/var/backups/cosmos/foreign.jsonl' 'canonical ops-state directory'
reject_line FROZEN_MARKER 'FROZEN_MARKER=/tmp/deploy-frozen.json' 'canonical ops-state directory'
reject_line MONEY_READY_MARKER 'MONEY_READY_MARKER=/tmp/money-ready' 'canonical ops-state directory'
reject_line OPS_STATE_DIR 'OPS_STATE_DIR=/var/lib/cosmos/ops/../other' 'canonical absolute directory'
reject_line EXPOSURE_CMD 'EXPOSURE_CMD=/tmp/print-none' 'rejects named EXPOSURE_CMD selection'
reject_line I00_OPS_READBACK_URL 'I00_OPS_READBACK_URL=http://127.0.0.1:9090/api/system-integration/ops/readback' 'authenticated numeric-loopback app origin'
finish
