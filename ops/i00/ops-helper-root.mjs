import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYSTEM_OPS_HELPER_PARENT = '/usr/local/lib/cosmos-ops';
export const OPS_HELPER_APP_ENTRYPOINT_RELATIVE = 'bin/app-entrypoint.mjs';
export const OPS_HELPER_SECRET_MATERIALIZATION_RELATIVE =
  'bin/secret-materialization.mjs';
export const OPS_HELPER_ROOT_PLACEHOLDER = 'REPLACE_ME_OPS_HELPER_ROOT';

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalAbsolute(value, label) {
  assert(typeof value === 'string'
    && isAbsolute(value)
    && resolve(value) === value
    && !/[\u0000-\u001f\u007f]/u.test(value),
  `${label} must be one canonical absolute path`);
  return value;
}

export function deriveOpsHelperBinding({
  testedSha,
  i00EnforcementTreeDigestSha256,
  rootMode,
  proofRoot = null,
}) {
  assert(FULL_SHA.test(testedSha),
    'ops helper binding requires one full lowercase tested SHA');
  assert(SHA256.test(i00EnforcementTreeDigestSha256),
    'ops helper binding requires one lowercase I00 enforcement tree digest');
  assert(['SYSTEM', 'STAGING', 'TEST'].includes(rootMode),
    'ops helper binding root mode is unsupported');

  let parent;
  if (rootMode === 'SYSTEM') {
    assert(proofRoot === null || proofRoot === 'NONE',
      'SYSTEM ops helper binding rejects a proof root');
    parent = SYSTEM_OPS_HELPER_PARENT;
  } else {
    const proof = canonicalAbsolute(proofRoot, `${rootMode} ops helper proof root`);
    parent = resolve(proof, 'install');
  }
  const leaf = `i00-${testedSha}-${i00EnforcementTreeDigestSha256}`;
  const root = resolve(parent, leaf);
  assert(dirname(root) === parent,
    'ops helper root escaped its canonical parent');

  return Object.freeze({
    testedSha,
    i00EnforcementTreeDigestSha256,
    rootMode,
    parent,
    root,
    appEntrypoint: resolve(root, OPS_HELPER_APP_ENTRYPOINT_RELATIVE),
    secretMaterialization: resolve(
      root,
      OPS_HELPER_SECRET_MATERIALIZATION_RELATIVE,
    ),
  });
}

export function validateOpsHelperBinding(value) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    'ops helper binding must be one object');
  const bindingKeys = [
    'testedSha',
    'i00EnforcementTreeDigestSha256',
    'rootMode',
    'parent',
    'root',
    'appEntrypoint',
    'secretMaterialization',
  ];
  assert(Object.keys(value).sort().join('\0') === bindingKeys.sort().join('\0'),
    'ops helper binding has an unexpected field set');
  const expected = deriveOpsHelperBinding({
    testedSha: value.testedSha,
    i00EnforcementTreeDigestSha256: value.i00EnforcementTreeDigestSha256,
    rootMode: value.rootMode,
    proofRoot: value.rootMode === 'SYSTEM' ? null : dirname(value.parent),
  });
  for (const key of bindingKeys) {
    assert(value[key] === expected[key],
      `ops helper binding ${key} differs from the canonical derivation`);
  }
  return expected;
}

function runCli() {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const option = process.argv[index];
    const value = process.argv[index + 1];
    assert(/^--(?:release-json|root-mode|proof-root)$/u.test(option ?? '')
      && value !== undefined,
    'ops helper binding CLI arguments are invalid');
    const name = option.slice(2);
    assert(args[name] === undefined,
      `duplicate ops helper binding argument --${name}`);
    args[name] = value;
  }
  assert(args['release-json'] && args['root-mode'],
    '--release-json and --root-mode are required');
  const releasePath = canonicalAbsolute(
    args['release-json'],
    'ops helper release JSON',
  );
  assert(realpathSync(releasePath) === releasePath,
    'ops helper release JSON must be physically canonical');
  const release = JSON.parse(readFileSync(releasePath, 'utf8'));
  const binding = deriveOpsHelperBinding({
    testedSha: release.testedSha,
    i00EnforcementTreeDigestSha256:
      release.l15OpsProvenance?.i00EnforcementTreeDigestSha256,
    rootMode: args['root-mode'],
    proofRoot: args['root-mode'] === 'SYSTEM'
      ? null
      : args['proof-root'],
  });
  process.stdout.write(`${JSON.stringify(binding)}\n`);
}

if (process.argv[1] !== undefined
    && isAbsolute(process.argv[1])
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`I00_OPS_BLOCKED: ${error.message}\n`);
    process.exit(1);
  }
}
