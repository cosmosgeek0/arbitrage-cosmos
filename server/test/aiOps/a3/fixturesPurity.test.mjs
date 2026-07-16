import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../..');
const fixtureRoot = join(root, 'fixtures/aiOps/a3');
const sourceRoot = join(root, 'server/src/aiOps/adapters');
const archivedShadowRoot = join(root, 'docs/archive/aiOps/a3/shadow');

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
    const fixture = await json('prestage-configuration.v1.json');
    assert.equal(fixture.schema, 'AI_OPS_A3_PRESTAGE_CONFIGURATION_V1');
    assert.equal(fixture.releaseStatus, 'BUILT_AND_TESTED');
    assert.equal(fixture.landedBaseSha, '492e3f69b054c85686bcfc4c09dbff4ababeda3f');
    assert.deepEqual(fixture.exactConfigurationStates, a3.PROVIDER_CONFIGURATION_STATES);
    assert.deepEqual(fixture.identityRows.map((row) => row.role), a3.AI_OPS_IDENTITY_ROLES);
    assert.equal(fixture.providerActivation, 'FORBIDDEN');
    assert.equal(fixture.realProviderProtocols, 'MISSING');
    assert.equal(fixture.realWebhookDialects, 'MISSING');
    assert.equal(fixture.canonicalProviderReadinessProjection, 'MISSING');
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
    assert.deepEqual(fixture.map((row) => row.rowId), expectedIds);
    const exactKeys = ['schema', 'version', 'rowId', 'status', 'requestedOwner', 'targetSeam', 'reason', 'contract', 'tests', 'expectedBehavior', 'wiringState', 'authorityCreated'].sort();
    for (const row of fixture) {
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
    const fixture = await json('integration-dependencies.v1.json');
    assert.equal(fixture.schema, 'AI_OPS_A3_INTEGRATION_DEPENDENCIES_V1');
    assert.equal(fixture.releaseStatus, 'BUILT_AND_TESTED');
    assert.equal(fixture.authorityGranted, false);
    assert.equal(fixture.dependencies.length >= 10, true);
    assert.equal(fixture.dependencies.every((row) => ['PENDING_PARALLEL_LANE', 'PENDING_SHARED_OWNER_INSERTION'].includes(row.state)), true);
    const ids = fixture.dependencies.map((row) => row.dependenceId);
    for (const required of ['A1-CANONICAL-CONTRACTS', 'LEDGER-ATOMIC-DEDUP-AUDIT', 'STATE-DIALECT-ADAPTER', 'ISOLATED-WORKTREE-RUNNER']) {
      assert.equal(ids.includes(required), true, required);
    }
  });

  it('binds the real port gate to landed base, sealed provenance and non-authoritative registry evidence', async () => {
    const fixture = await json('port-entry-gate.v1.json');
    assert.equal(fixture.schema, 'AI_OPS_A3_PORT_ENTRY_GATE_V1');
    assert.equal(fixture.releaseStatus, 'BUILT_AND_TESTED');
    assert.equal(fixture.authorityGranted, false);
    assert.equal(fixture.providerActivation, 'FORBIDDEN');
    assert.equal(fixture.landedBaseSha, '492e3f69b054c85686bcfc4c09dbff4ababeda3f');
    assert.equal(fixture.shadowA3SealSha, 'c345fbb42e25ea2139ea447e99b2c5036822770d');
    assert.equal(fixture.shadowA3xSealSha, 'c6397f548b068450a8f666e191fc270295791867');
    assert.equal(fixture.shadowEvidenceAcceptedAsPortEvidence, false);
    assert.equal(fixture.insertionRequestRegistryCommitSha, '08e0beaa54c4c3ca9c24276785d6a302f751a226');
    assert.equal(fixture.insertionRequestRegistryBlobSha, '5f76b29a81b6af4eee7a156afc16979fea02635e');
    assert.equal(fixture.insertionRequestSchemaBlobSha, '042456c58b1cd5b6eb179c0c9c289f6e69d06034');
    assert.deepEqual(fixture.rows.map((row) => [row.itemId, row.classification]), [
      ['fake-openai-api-adapter', 'BUILT_AND_TESTED'],
      ['fake-anthropic-api-adapter', 'BUILT_AND_TESTED'],
      ['owner-operated-subscription-cli-workers', 'NOT_CONFIGURED'],
      ['approved-web-search-tool', 'SYNTHETIC_ONLY'],
      ['repository-inspection-tools', 'SYNTHETIC_ONLY'],
      ['sandboxed-patch-proposals', 'BUILT_AND_TESTED'],
      ['api-vs-subscription-capability-separation', 'BUILT_AND_TESTED'],
      ['real-provider-protocols-credentials-and-endpoints', 'REFERENCE_ONLY'],
      ['duplicate-provider-tool-patch-or-persistence-authority', 'REJECT_DUPLICATE'],
    ]);
    assert.equal(fixture.rows.every((row) => typeof row.existingOwner === 'string' && typeof row.disposition === 'string'), true);
  });

  it('preserves the two sealed historical receipts byte-identically while excluding them from active evidence', async () => {
    const expected = new Map([
      ['A3_SHADOW_ARTIFACT_RECEIPT.v1.json', 'd8d2d03532ce313dd88680a76ad9d1618338f66b0c1e9760abda83236e9a65f3'],
      ['A3X_SHADOW_ARTIFACT_RECEIPT.v1.json', '70c4e42fabc8a2bb587713c1e0befdaeea96b496bfc43cc2a8a25d77c0609d96'],
    ]);
    assert.deepEqual((await readdir(archivedShadowRoot)).sort(), [...expected.keys()].sort());
    for (const [name, digest] of expected) {
      const bytes = await readFile(join(archivedShadowRoot, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
    }
  });
});

describe('A3 production source purity', () => {
  it('contains no active shadow release label or shadow adapter version', async () => {
    for (const directory of [sourceRoot, fixtureRoot]) {
      for (const file of await filesUnder(directory)) {
        const source = await readFile(file, 'utf8');
        assert.doesNotMatch(source, /SHADOW_SPECULATIVE|a3-shadow-v1/u, file);
      }
    }
  });

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
