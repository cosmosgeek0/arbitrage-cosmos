import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { verifySealedOwnerDirective } from '../i00/sealed-owner-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRODUCT_SOURCE = join(ROOT, 'server', 'src', 'productAssurance');
const PROTECTED_INPUT = Object.freeze({
  path: 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md',
  sha256: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5',
});
const PROTECTED_DEDUP_MATRIX = Object.freeze({
  path: 'fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md',
  sha256: '22686d2cd1c54bbc39af56399298a0ed9563bbc8643ad4f0e498718de83cb2cd',
});
const CORE_ALLOWED_PREFIXES = Object.freeze([
  'server/src/productAssurance/',
  'server/test/productAssurance/',
  'test/productAssurance/',
  'fixtures/productAssurance/generated/',
  'fixtures/productAssurance/receipts/',
  'fixtures/productAssurance/fixtures-root/',
]);
const SATELLITE_SYSTEMIC_PREFIXES = Object.freeze([
  'fixtures/productAssurance/systemic/',
  'test/productAssurance/systemic/',
]);
const SECRET_SCAN_ROOTS = Object.freeze([
  PRODUCT_SOURCE,
  join(ROOT, 'server', 'test', 'productAssurance'),
  join(ROOT, 'test', 'productAssurance'),
  join(ROOT, 'fixtures', 'productAssurance', 'generated'),
  join(ROOT, 'fixtures', 'productAssurance', 'receipts'),
  join(ROOT, 'fixtures', 'productAssurance', 'fixtures-root'),
]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (entry.isFile()) return [path];
      throw new Error(`unsupported non-file entry in assurance territory: ${relative(ROOT, path)}`);
    })
    .sort();
}

function gitPaths(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.split('\0').filter(Boolean);
}

function isSatelliteSystemicPath(path) {
  return SATELLITE_SYSTEMIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isCoreAllowedPath(path) {
  return CORE_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) && !isSatelliteSystemicPath(path);
}

export function verifyProtectedInput() {
  const evidence = verifySealedOwnerDirective(ROOT, PROTECTED_INPUT.path);
  assert.equal(evidence.sha256, PROTECTED_INPUT.sha256, `protected owner input SHA-256 mismatch: ${PROTECTED_INPUT.path}`);
  assert.ok(['LIVE_OWNER_FILE', 'SEALED_CANDIDATE_HASH'].includes(evidence.evidenceMode));
  return Object.freeze({
    path: PROTECTED_INPUT.path,
    sha256: evidence.sha256,
    untracked: evidence.liveFilePresent,
    evidenceMode: evidence.evidenceMode,
  });
}

export function verifyProtectedDedupMatrix() {
  const absolutePath = join(ROOT, PROTECTED_DEDUP_MATRIX.path);
  assert.equal(existsSync(absolutePath), true, `protected dedup matrix is missing: ${PROTECTED_DEDUP_MATRIX.path}`);
  assert.equal(lstatSync(absolutePath).isFile(), true, `protected dedup matrix is not a regular file: ${PROTECTED_DEDUP_MATRIX.path}`);
  assert.deepEqual(
    gitPaths(['ls-files', '--cached', '-z', '--', PROTECTED_DEDUP_MATRIX.path]),
    [PROTECTED_DEDUP_MATRIX.path],
    `protected dedup matrix must remain the exact tracked path: ${PROTECTED_DEDUP_MATRIX.path}`,
  );
  const sha256 = createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
  assert.equal(sha256, PROTECTED_DEDUP_MATRIX.sha256, `protected dedup matrix SHA-256 mismatch: ${PROTECTED_DEDUP_MATRIX.path}`);
  return Object.freeze({ path: PROTECTED_DEDUP_MATRIX.path, sha256, tracked: true });
}

export function scanPathScope(baseCommit) {
  const changed = gitPaths(['diff', '--name-only', '--no-renames', '--diff-filter=ACDMRTUXB', '-z', baseCommit, '--']);
  const untracked = gitPaths(['ls-files', '--others', '--exclude-standard', '-z']);
  const considered = [...new Set([...changed, ...untracked])].sort();
  const satelliteSystemic = considered.filter(isSatelliteSystemicPath);
  const forbidden = considered.filter((path) => path !== PROTECTED_INPUT.path && !isCoreAllowedPath(path));
  return Object.freeze({
    baseCommit,
    considered: Object.freeze(considered),
    forbidden: Object.freeze(forbidden),
    satelliteSystemic: Object.freeze(satelliteSystemic),
  });
}

const FORBIDDEN_IMPORT_FRAGMENTS = Object.freeze([
  '/quant/',
  '/liveEdge/',
  '/binance/',
  '/services/orders',
  '/services/loans',
  'node:fs',
  'node:child_process',
  '@aws-sdk/',
  'better-sqlite3',
  'ws',
]);

const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  ['IMPORT_TIME_CLOCK', /\bDate\.now\s*\(/u],
  ['RANDOMNESS', /\bMath\.random\s*\(/u],
  ['ENVIRONMENT_READ', /\bprocess\.env\b/u],
  ['TIMER', /\b(?:setTimeout|setInterval|setImmediate)\s*\(/u],
  ['NETWORK_FETCH', /\bfetch\s*\(/u],
  ['WEBSOCKET', /\bnew\s+WebSocket\b/u],
]);

export function scanImportPurity() {
  const findings = [];
  for (const path of walk(PRODUCT_SOURCE).filter((candidate) => extname(candidate) === '.ts')) {
    const sourceText = readFileSync(path, 'utf8');
    const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (FORBIDDEN_IMPORT_FRAGMENTS.some((fragment) => specifier === fragment || specifier.includes(fragment))) {
        findings.push({ code: 'FORBIDDEN_IMPORT', path: relative(ROOT, path), value: specifier });
      }
    }
    for (const [code, pattern] of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(sourceText)) findings.push({ code, path: relative(ROOT, path), value: pattern.source });
    }
  }
  return Object.freeze(findings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`)));
}

export function scanSecretLiterals() {
  // Keep signatures split so the scanner scans its own file without matching
  // the signatures rather than an actual credential literal.
  const patterns = Object.freeze([
    ['AWS_ACCESS_KEY_ID', new RegExp(['\\bA', 'KIA[0-9A-Z]{16}\\b'].join(''), 'u')],
    ['PRIVATE_KEY_BLOCK', new RegExp([
      '-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}\\r?\\n',
      '[A-Za-z0-9+/=\\r\\n]{40,}',
      '-{5}END (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}',
    ].join(''), 'u')],
    ['GITHUB_TOKEN', new RegExp(['\\bgh', '[pousr]_[A-Za-z0-9]{30,}\\b'].join(''), 'u')],
    ['SLACK_TOKEN', new RegExp(['\\bxox', '[abprs]-[A-Za-z0-9-]{20,}\\b'].join(''), 'u')],
    ['ASSIGNED_SECRET', new RegExp([
      '\\b(?:api[_-]?(?:key|secret)|apiKey|apiSecret|secretAccessKey|access[_-]?token|auth[_-]?token|password|passphrase|private[_-]?key|privateKey|listen[_-]?key|listenKey|credential)',
      '\\s*[:=]\\s*[\'"`][^\'"`\\r\\n$]{16,}[\'"`]',
    ].join(''), 'iu')],
    ['BEARER_TOKEN', new RegExp(['\\bBearer\\s+', '[A-Za-z0-9._~+/-]{24,}={0,2}\\b'].join(''), 'u')],
  ]);
  const findings = [];
  const files = [...new Set(SECRET_SCAN_ROOTS.flatMap(walk))].sort();
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    for (const [code, pattern] of patterns) {
      if (pattern.test(text)) findings.push(Object.freeze({ code, path: relative(ROOT, path) }));
    }
  }
  return Object.freeze(findings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseIndex = process.argv.indexOf('--base');
  const baseCommit = baseIndex >= 0 ? process.argv[baseIndex + 1] : null;
  assert.match(baseCommit ?? '', /^[a-f0-9]{40}$/u, '--base must be a full Git commit SHA');
  const protectedInput = verifyProtectedInput();
  const protectedDedupMatrix = verifyProtectedDedupMatrix();
  const scope = scanPathScope(baseCommit);
  const purity = scanImportPurity();
  const secrets = scanSecretLiterals();
  assert.deepEqual(scope.satelliteSystemic, [], `A-CORE may not write satellite systemic paths:\n${scope.satelliteSystemic.join('\n')}`);
  assert.deepEqual(scope.forbidden, [], `forbidden changed paths:\n${scope.forbidden.join('\n')}`);
  assert.deepEqual(purity, [], `productAssurance purity findings:\n${JSON.stringify(purity, null, 2)}`);
  assert.deepEqual(secrets, [], `secret-like literals:\n${JSON.stringify(secrets, null, 2)}`);
  process.stdout.write(`${JSON.stringify({
    verdict: 'PASS',
    changedPathCount: scope.considered.length,
    protectedInputSha256: protectedInput.sha256,
    protectedDedupMatrixSha256: protectedDedupMatrix.sha256,
    purityFindingCount: 0,
    secretFindingCount: 0,
  })}\n`);
}
