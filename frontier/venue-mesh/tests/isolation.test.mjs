import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MODULE = path.resolve(new URL('../', import.meta.url).pathname);
const REPO = path.resolve(MODULE, '../..');

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) return [full];
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('branch, accepted base, Dock ancestry, directive hash, and clean starting base remain pinned', () => {
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: REPO, encoding: 'utf8' }).trim(), 'f-venue-0715f');
  const acceptedBase = 'f0168cb37bd04d21bc90591ab2256770de3b75bc';
  const dock = 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5';
  execFileSync('git', ['merge-base', '--is-ancestor', acceptedBase, 'HEAD'], { cwd: REPO });
  assert.equal(execFileSync('git', ['merge-base', acceptedBase, 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), acceptedBase);
  execFileSync('git', ['merge-base', '--is-ancestor', dock, 'HEAD'], { cwd: REPO });
  assert.equal(execFileSync('git', ['merge-base', dock, 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), dock);
  assert.equal(sha256File(path.join(REPO, 'frontier/directives/Frontier.md')), '4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad');
});

test('all current worktree changes remain inside the exclusive VenueMesh root', () => {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const row of status) {
    const changedPath = row.slice(3).replace(/^"|"$/g, '');
    assert(changedPath.startsWith('frontier/venue-mesh/'), `out-of-scope path: ${changedPath}`);
  }
  const committedPaths = execFileSync('git', ['diff', '--name-only', 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5..HEAD'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const changedPath of committedPaths) assert(changedPath.startsWith('frontier/venue-mesh/'), `out-of-scope committed path: ${changedPath}`);
});

test('module contains no symlink escape', () => {
  const links = filesUnder(MODULE).filter((file) => fs.lstatSync(file).isSymbolicLink());
  assert.deepEqual(links, []);
});

test('runtime source imports only local code and the read-only Dock contract', () => {
  const sourceFiles = filesUnder(path.join(MODULE, 'src')).filter((file) => file.endsWith('.mjs'));
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert(specifier.startsWith('./') || specifier.startsWith('../../dock/src/'), `${path.basename(file)} imports ${specifier}`);
    }
  }
});

test('runtime source has no environment, clock, random, timer, filesystem, socket, or fetch side effect', () => {
  const source = filesUnder(path.join(MODULE, 'src')).filter((file) => file.endsWith('.mjs')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const expression of [
    /process\.env/,
    /Date\.now\s*\(/,
    /Math\.random\s*\(/,
    /setTimeout\s*\(/,
    /setInterval\s*\(/,
    /fetch\s*\(/,
    /new\s+WebSocket\s*\(/,
    /node:fs/,
    /node:net/,
    /node:http/,
    /node:https/,
    /node:dgram/,
    /node:tls/,
    /child_process/,
  ]) assert.equal(expression.test(source), false, `forbidden runtime expression ${expression}`);
});

test('runtime exports no live connector, persistence, registry writer, or effect router', async () => {
  const api = await import('../src/index.mjs');
  const names = Object.keys(api);
  for (const forbidden of ['subscribe', 'connect', 'executeOrder', 'placeOrder', 'borrow', 'repay', 'transfer', 'withdraw', 'persist', 'deploy', 'mount', 'writeCanonical', 'registerSource', 'promoteFeature']) {
    assert.equal(names.includes(forbidden), false, `forbidden export ${forbidden}`);
  }
});

test('every JSON artifact parses and every source hash is lowercase SHA-256 or explicit null', () => {
  for (const file of filesUnder(MODULE).filter((entry) => entry.endsWith('.json'))) JSON.parse(fs.readFileSync(file, 'utf8'));
  const sourceInputs = JSON.parse(fs.readFileSync(path.join(MODULE, 'fixtures/source-cards/review-inputs.v1.json'), 'utf8'));
  for (const card of sourceInputs.cards) {
    assert(/^[a-f0-9]{64}$/.test(card.sourcePolicy.documentationContentSha256));
    assert(card.sourcePolicy.termsContentSha256 === null || /^[a-f0-9]{64}$/.test(card.sourcePolicy.termsContentSha256));
  }
  const contractHashes = fs.readFileSync(path.join(MODULE, 'CONTRACT_HASHES.sha256'), 'utf8').trim().split('\n');
  for (const row of contractHashes) {
    const match = /^([a-f0-9]{64})  (frontier\/venue-mesh\/.+)$/.exec(row);
    assert(match, `invalid contract hash row: ${row}`);
    assert.equal(sha256File(path.join(REPO, match[2])), match[1], `contract hash mismatch: ${match[2]}`);
  }
  const localSchema = JSON.parse(fs.readFileSync(path.join(MODULE, 'contracts/v1/venue-mesh-v1.schema.json'), 'utf8'));
  for (const definition of [
    'FixedPointV1', 'FeatureValueV1', 'InstrumentGraphV1', 'EvidenceSourceV1', 'EvidenceQualityV1',
    'BookTickerPayloadV1', 'TradePayloadV1', 'BookPayloadV1', 'MarkPayloadV1', 'IndexPayloadV1',
    'FundingPayloadV1', 'OpenInterestPayloadV1', 'LiquidationPayloadV1', 'ContextPayloadV1',
    'MarketEvidenceEnvelopeV1', 'VenueUnavailableEvidenceAdapterResultV1', 'VenueDislocationProjectionV1',
  ]) assert.equal(localSchema.$defs[definition].additionalProperties, false, `${definition} must reject authority-shaped extras`);
  assert.equal(JSON.stringify(localSchema).includes('orderRequest'), false);
});

test('honesty corpus pins all 17 mandatory hostile cases', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(MODULE, 'fixtures/honesty-corpus.v1.json'), 'utf8'));
  const expected = [
    'SAME_TICKER_DIFFERENT_ASSET', 'QUOTE_OR_MULTIPLIER_MISMATCH', 'SPOT_DERIVATIVE_MISMATCH',
    'TIMESTAMP_UNIT_MISMATCH', 'PER_VENUE_FRESHNESS', 'SEQUENCE_GAP_RESNAPSHOT',
    'REST_STREAM_DISAGREEMENT', 'DELISTED_OR_SUSPENDED', 'MAINTENANCE_AND_RATE_LIMIT',
    'SPREAD_ERASED_BY_COSTS', 'RETENTION_FORBIDDEN_OR_UNPROVEN', 'COPIED_SOURCE_COLLAPSE',
    'TERMS_REVISION_EXPIRY', 'POST_CUTOFF_CONTEXT', 'UNOFFICIAL_PROJECT_CLAIM',
    'MISSING_IS_NOT_ZERO', 'OBSERVATION_NOT_ORDER_INSTRUCTION',
  ];
  assert.deepEqual(corpus.requiredCases, expected);
  assert.deepEqual(Object.keys(corpus.caseTests).sort(), [...expected].sort());
  const executedTestSource = fs.readFileSync(path.join(MODULE, 'tests/venue-mesh.test.mjs'), 'utf8');
  for (const caseId of expected) {
    assert(Array.isArray(corpus.caseTests[caseId]) && corpus.caseTests[caseId].length > 0, `${caseId} lacks test binding`);
    for (const testName of corpus.caseTests[caseId]) assert(executedTestSource.includes(`test('${testName}'`), `${caseId} missing executed test ${testName}`);
  }
  assert.equal(corpus.globalExpectedPosture.moneyPathPresent, false);
});

test('isolated preview is deterministic stdout-only JSON with no control authority', () => {
  const first = execFileSync(process.execPath, ['frontier/venue-mesh/preview/render-preview.mjs'], { cwd: REPO, encoding: 'utf8' });
  const second = execFileSync(process.execPath, ['frontier/venue-mesh/preview/render-preview.mjs'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(first, second);
  const preview = JSON.parse(first);
  assert.equal(preview.previewClass, 'ISOLATED_MODULE_PREVIEW');
  assert.equal(preview.cockpitProjectionClaimed, false);
  assert.equal(preview.canonical, false);
  assert.equal(preview.dislocations[0].state, 'UNKNOWN');
});
