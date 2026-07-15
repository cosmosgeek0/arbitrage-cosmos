import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const fixtureRoot = join(root, 'fixtures/aiOps/providerAdapters');
const sourceRoot = join(root, 'server/src/aiOps/providerAdapters');

async function json(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), 'utf8'));
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

describe('A3 fixtures and insertion requests', () => {
  it('binds the exact five states, four separate identities and synthetic references', async () => {
    const fixture = await json('shadow-configuration.v1.json');
    assert.deepEqual(fixture.exactConfigurationStates, a3.PROVIDER_CONFIGURATION_STATES);
    assert.deepEqual(fixture.identityRows.map((row) => row.role), a3.AI_OPS_IDENTITY_ROLES);
    assert.equal(fixture.providerActivation, 'FORBIDDEN');
    assert.equal(fixture.syntheticCredentialReferences.every((value) => value.startsWith('TEST_ONLY_INVALID_CREDENTIAL_REFERENCE_')), true);
  });

  it('serializes all and only the accepted A3 shared insertion-request IDs', async () => {
    const fixture = await json('insertion-requests.v1.json');
    const expectedIds = [
      'AIOPS-IR-COMPOSITION-001', 'AIOPS-IR-ROUTES-002', 'AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-AUTH-004',
      'AIOPS-IR-PACKAGE-006', 'AIOPS-IR-DEPLOYMENT-007', 'AIOPS-IR-REMEDIATION-010', 'AIOPS-IR-TELEMETRY-012',
      'AIOPS-IR-EGRESS-016', 'AIOPS-IR-SENTINEL-020', 'AIOPS-IR-AUDIT-021', 'AIOPS-IR-MANAGED-INVENTORY-022',
      'AIOPS-IR-APPROVAL-023', 'AIOPS-IR-CONFIG-025', 'AIOPS-IR-TEST-MOUNT-026',
    ];
    assert.deepEqual(fixture.rows.map((row) => row.rowId), expectedIds);
    const exactKeys = ['schema', 'version', 'rowId', 'status', 'requestedOwner', 'targetSeam', 'reason', 'contract', 'tests', 'expectedBehavior', 'wiringState', 'authorityCreated'].sort();
    for (const row of fixture.rows) {
      assert.deepEqual(Object.keys(row).sort(), exactKeys);
      assert.equal(row.schema, 'InsertionRequestRowV1');
      assert.equal(row.version, 1);
      assert.equal(row.status, 'DRAFT');
      assert.equal(row.wiringState, `PENDING_BACKEND:${row.rowId}`);
      assert.equal(row.authorityCreated, false);
      assert.equal(row.contract.length > 0 && row.tests.length > 0 && row.expectedBehavior.length > 0, true);
    }
  });

  it('records unfinished I00 interfaces as explicit non-authoritative dependences', async () => {
    const fixture = await json('unfinished-interface-dependences.v1.json');
    assert.equal(fixture.authorityGranted, false);
    assert.equal(fixture.dependences.length >= 10, true);
    assert.equal(fixture.dependences.every((row) => row.state === 'UNFINISHED_I00_INTERFACE'), true);
    const ids = fixture.dependences.map((row) => row.dependenceId);
    for (const required of ['A1-CANONICAL-CONTRACTS', 'LEDGER-ATOMIC-DEDUP-AUDIT', 'STATE-DIALECT-ADAPTER', 'ISOLATED-WORKTREE-RUNNER']) {
      assert.equal(ids.includes(required), true, required);
    }
  });

  it('persists the A3X entry-gate classification without pretending ordered-base ancestry', async () => {
    const fixture = await json('a3x-entry-gate.v1.json');
    assert.equal(fixture.shadowStatus, 'SHADOW_SPECULATIVE');
    assert.equal(fixture.authorityGranted, false);
    assert.equal(fixture.orderedBaseSha, '098f7b9449ab3b1c26bda19f51537bfea01d4c48');
    assert.equal(fixture.sealedArtifactInputSha, 'c345fbb42e25ea2139ea447e99b2c5036822770d');
    assert.equal(fixture.actualLineageBaseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
    assert.equal(fixture.orderedBaseIsAncestor, false);
    assert.deepEqual(fixture.rows.map((row) => [row.itemId, row.classification]), [
      ['fake-openai-api-adapter', 'MISSING_BUILD'],
      ['fake-anthropic-api-adapter', 'MISSING_BUILD'],
      ['owner-operated-subscription-cli-workers', 'ADAPT_EXISTING'],
      ['approved-web-search-tool', 'ADAPT_EXISTING'],
      ['repository-inspection-tools', 'MISSING_BUILD'],
      ['sandboxed-patch-proposals', 'ADAPT_EXISTING'],
      ['api-vs-subscription-capability-separation', 'ADAPT_EXISTING'],
      ['real-provider-protocols-credentials-and-endpoints', 'REFERENCE_ONLY'],
      ['duplicate-provider-tool-patch-or-persistence-authority', 'REJECT_DUPLICATE'],
    ]);
    assert.equal(fixture.rows.every((row) => typeof row.existingOwner === 'string' && typeof row.disposition === 'string'), true);
  });
});

describe('A3 production source purity', () => {
  it('contains no provider SDK, network, process, filesystem, ambient clock, timer or environment access', async () => {
    const files = (await readdir(sourceRoot)).filter((name) => name.endsWith('.ts')).sort();
    assert.equal(files.length >= 9, true);
    const forbidden = [
      /\bfetch\s*\(/u,
      /\bnew\s+WebSocket\b/u,
      /node:(?:http|https|net|tls|dns|dgram|child_process|fs)/u,
      /\bprocess\.env\b/u,
      /\bDate\.now\s*\(/u,
      /\bMath\.random\s*\(/u,
      /\bset(?:Timeout|Interval)\s*\(/u,
      /@anthropic-ai\/sdk/u,
      /\bopenai\b.*from/u,
    ];
    for (const file of files) {
      const source = await readFile(join(sourceRoot, file), 'utf8');
      for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
    }
  });

  it('contains no realistic credential prefixes or real provider endpoints', async () => {
    const allRoots = [sourceRoot, fixtureRoot];
    const forbidden = [/sk-[A-Za-z0-9]{12}/u, /ghp_[A-Za-z0-9]{12}/u, /AIza[A-Za-z0-9_-]{12}/u, /api\.openai\.com/u, /api\.anthropic\.com/u];
    for (const directory of allRoots) {
      for (const file of await filesUnder(directory)) {
        const source = await readFile(file, 'utf8');
        for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
      }
    }
  });
});
