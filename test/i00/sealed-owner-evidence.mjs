import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGitEvidence } from './verify-scope.mjs';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ACCEPTANCE_RECORD_PATH = 'fixtures/i00/living-director-input-acceptance.json';
const SHA256 = /^[a-f0-9]{64}$/u;

const OWNER_DIRECTIVE_SHA256 = Object.freeze({
  'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md': '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5',
  'IP_RUNTIME.md': '6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810',
  'IP_CONTROL.md': '5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278',
  'IP_OPS.md': '2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779',
  'IP_PROOF.md': 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6',
});

export const OWNER_DIRECTIVE_PATHS = Object.freeze(Object.keys(OWNER_DIRECTIVE_SHA256));

const I00_BASELINE_ROUTES = Object.freeze([
  '/api/state',
  '/api/system',
  '/api/events',
  '/api/config',
  '/api/engine/basis',
  '/api/engine/volume',
  '/api/markets',
  '/api/market/detail',
  '/api/wallet-balances',
  '/api/loans',
  '/api/orders/history',
  '/api/pnl',
  '/api/trade/preview',
  '/api/trade/test',
  '/api/trade/send',
  '/api/kill',
  '/api/live',
  '/api/aws-control/*',
]);
const I00_BASELINE_ROUTES_SHA256 = '6094f2eb554d601e0938344adcb20c60e4df83bd6c881ed7108972b5d1db3823';

function fail(code, detail = '') {
  throw new Error(detail === '' ? code : `${code}:${detail}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashesEqual(left, right) {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function git(root, args, encoding = 'utf8') {
  try {
    return runGitEvidence({
      cwd: root,
      args,
      output: encoding === null ? 'binary' : 'text',
    }).stdout;
  } catch (error) {
    const detail = error?.stderr?.toString('utf8').trim() || error?.message || 'UNKNOWN';
    fail('SEALED_OWNER_GIT_PROOF_FAILED', detail);
  }
}

function exactNulPaths(output) {
  return output.split('\0').filter(Boolean);
}

function assertRepoRoot(root) {
  const resolved = realpathSync(path.resolve(root));
  const observed = realpathSync(path.resolve(git(resolved, ['rev-parse', '--show-toplevel']).trim()));
  if (observed !== resolved) fail('SEALED_OWNER_ROOT_MUST_BE_GIT_TOPLEVEL', resolved);
  return resolved;
}

function committedAcceptanceRecord(root) {
  const tracked = exactNulPaths(git(root, ['ls-files', '--cached', '-z', '--', ACCEPTANCE_RECORD_PATH]));
  if (tracked.length !== 1 || tracked[0] !== ACCEPTANCE_RECORD_PATH) {
    fail('SEALED_OWNER_ACCEPTANCE_RECORD_NOT_TRACKED', ACCEPTANCE_RECORD_PATH);
  }

  let document;
  try {
    document = JSON.parse(git(root, ['show', `HEAD:${ACCEPTANCE_RECORD_PATH}`]));
  } catch (error) {
    if (error instanceof SyntaxError) fail('SEALED_OWNER_ACCEPTANCE_RECORD_INVALID_JSON', ACCEPTANCE_RECORD_PATH);
    throw error;
  }

  if (document?.schemaVersion !== 'I00_LIVING_DIRECTOR_INPUT_ACCEPTANCE_V1'
      || document?.ruling !== 'D-LAUNCH-7'
      || document?.historicalPacketPinsPreserved !== true
      || document?.acceptAssemblyWorkingTreeCopies !== false
      || !Array.isArray(document?.ownerDirectives)) {
    fail('SEALED_OWNER_ACCEPTANCE_RECORD_POLICY_INVALID', ACCEPTANCE_RECORD_PATH);
  }

  const rows = document.ownerDirectives;
  if (rows.length !== OWNER_DIRECTIVE_PATHS.length) {
    fail('SEALED_OWNER_ACCEPTANCE_PATH_SET_MISMATCH', String(rows.length));
  }
  const byPath = new Map();
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).sort().join(',') !== 'path,sha256'
        || typeof row.path !== 'string' || typeof row.sha256 !== 'string'
        || byPath.has(row.path)) {
      fail('SEALED_OWNER_ACCEPTANCE_ROW_INVALID', String(row?.path ?? 'UNKNOWN'));
    }
    byPath.set(row.path, row.sha256);
  }
  for (const directivePath of OWNER_DIRECTIVE_PATHS) {
    const expected = OWNER_DIRECTIVE_SHA256[directivePath];
    const recorded = byPath.get(directivePath);
    if (!hashesEqual(recorded ?? '', expected)) {
      fail('SEALED_OWNER_ACCEPTANCE_HASH_MISMATCH', directivePath);
    }
  }
  for (const directivePath of byPath.keys()) {
    if (!(directivePath in OWNER_DIRECTIVE_SHA256)) {
      fail('SEALED_OWNER_ACCEPTANCE_PATH_SET_MISMATCH', directivePath);
    }
  }

  return Object.freeze({
    path: ACCEPTANCE_RECORD_PATH,
    commit: git(root, ['rev-parse', 'HEAD']).trim(),
    ownerDirectives: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
  });
}

export function sealedOwnerDirectiveSha256(relativePath) {
  return OWNER_DIRECTIVE_SHA256[relativePath] ?? null;
}

export function verifySealedOwnerDirective(root, relativePath) {
  const resolvedRoot = assertRepoRoot(root);
  const expectedSha256 = sealedOwnerDirectiveSha256(relativePath);
  if (expectedSha256 === null) fail('SEALED_OWNER_PATH_NOT_AUTHORIZED', String(relativePath));
  const acceptance = committedAcceptanceRecord(resolvedRoot);

  const tracked = exactNulPaths(git(resolvedRoot, ['ls-files', '--cached', '-z', '--', relativePath]));
  if (tracked.length !== 0) fail('SEALED_OWNER_DIRECTIVE_MUST_NOT_BE_TRACKED', relativePath);

  const absolute = path.join(resolvedRoot, relativePath);
  const info = lstatSync(absolute, { throwIfNoEntry: false });
  if (info === undefined) {
    const status = git(resolvedRoot, [
      '-c', 'status.renames=false',
      'status', '--porcelain=v1', '-z', '--untracked-files=all',
    ]);
    if (status !== '') fail('SEALED_OWNER_FALLBACK_REQUIRES_CLEAN_CANDIDATE', relativePath);
    return Object.freeze({
      path: relativePath,
      sha256: expectedSha256,
      evidenceMode: 'SEALED_CANDIDATE_HASH',
      liveFilePresent: false,
      gitStatus: 'ABSENT_FROM_CLEAN_CANDIDATE',
      acceptanceRecord: acceptance.path,
      acceptanceCommit: acceptance.commit,
    });
  }

  if (!info.isFile() || info.isSymbolicLink()) {
    fail('SEALED_OWNER_LIVE_FILE_NOT_REGULAR', relativePath);
  }
  const actualSha256 = sha256(readFileSync(absolute));
  if (!hashesEqual(actualSha256, expectedSha256)) {
    fail('SEALED_OWNER_LIVE_HASH_MISMATCH', relativePath);
  }
  const status = git(resolvedRoot, [
    '-c', 'status.renames=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', relativePath,
  ]);
  if (status !== `?? ${relativePath}\0`) {
    fail('SEALED_OWNER_LIVE_FILE_MUST_BE_EXACT_UNTRACKED_PATH', relativePath);
  }
  return Object.freeze({
    path: relativePath,
    sha256: actualSha256,
    evidenceMode: 'LIVE_OWNER_FILE',
    liveFilePresent: true,
    gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT',
    acceptanceRecord: acceptance.path,
    acceptanceCommit: acceptance.commit,
  });
}

export function verifySealedOwnerDirectives(root, relativePaths = OWNER_DIRECTIVE_PATHS) {
  if (!Array.isArray(relativePaths) || relativePaths.length === 0
      || new Set(relativePaths).size !== relativePaths.length) {
    fail('SEALED_OWNER_REQUEST_PATH_SET_INVALID');
  }
  return Object.freeze(relativePaths.map((relativePath) => verifySealedOwnerDirective(root, relativePath)));
}

function liveI00BaselineRoutes(root) {
  const source = readFileSync(path.join(root, 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'), 'utf8');
  const match = source.match(/Observed baseline routes include:\s*```text\s*([\s\S]*?)```/u);
  if (match === null) fail('SEALED_OWNER_LIVE_CLAIM_GAP', 'I00_BASELINE_ROUTES');
  return match[1].trim().split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
}

export function verifySealedOwnerClaim(root, relativePath, claimId) {
  const evidence = verifySealedOwnerDirective(root, relativePath);
  if (relativePath !== 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'
      || claimId !== 'I00_BASELINE_ROUTES') {
    fail('SEALED_OWNER_CLAIM_NOT_RECORDED', `${relativePath}:${claimId}`);
  }
  const claimDigest = sha256(Buffer.from(`${I00_BASELINE_ROUTES.join('\n')}\n`, 'utf8'));
  if (!hashesEqual(claimDigest, I00_BASELINE_ROUTES_SHA256)) {
    fail('SEALED_OWNER_CLAIM_CONSTANT_INVALID', claimId);
  }
  if (evidence.liveFilePresent) {
    const liveRoutes = liveI00BaselineRoutes(path.resolve(root));
    const liveDigest = sha256(Buffer.from(`${liveRoutes.join('\n')}\n`, 'utf8'));
    if (!hashesEqual(liveDigest, I00_BASELINE_ROUTES_SHA256)) {
      fail('SEALED_OWNER_LIVE_CLAIM_MISMATCH', claimId);
    }
  }
  return Object.freeze({
    id: claimId,
    ownerPath: relativePath,
    ownerSha256: evidence.sha256,
    claimSha256: I00_BASELINE_ROUTES_SHA256,
    evidenceMode: evidence.evidenceMode,
    value: Object.freeze([...I00_BASELINE_ROUTES]),
  });
}

function parseCli(argv) {
  const result = { root: MODULE_ROOT, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') result.root = argv[++index];
    else if (argument === '--path') result.paths.push(argv[++index]);
    else fail('SEALED_OWNER_CLI_ARGUMENT_INVALID', String(argument));
  }
  if (typeof result.root !== 'string' || result.root.length === 0
      || result.paths.length === 0 || result.paths.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    fail('SEALED_OWNER_CLI_ARGUMENT_INVALID');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const evidence = verifySealedOwnerDirectives(options.root, options.paths);
    process.stdout.write(`SEALED_OWNER_EVIDENCE_VERIFIED ${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
