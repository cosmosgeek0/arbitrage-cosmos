import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { OPERATION_KINDS } from '../productAssurance/production-operation-scan.mjs';
import {
  OPERATION_POLICY_REGISTRY,
  scanOperationCoverage,
  validateOperationPolicy,
} from '../../server/dist/productAssurance/index.js';
import {
  NEWS_CONTEXT_OVERLAY_AUTHORITY,
  scanIntegratedOperationPolicyCoverage,
  scanIntegratedProductionOperations,
  verifyNewsContextOverlayAuthority,
} from './product-assurance-operation-overlay.mjs';
import { verifyProductAssuranceOperationReport } from './git-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/i00/product-assurance-manifest.v1.json'), 'utf8'));
const DATABASE_KINDS = new Set([
  OPERATION_KINDS.DATABASE_OPEN,
  OPERATION_KINDS.DATABASE_QUERY,
  OPERATION_KINDS.DATABASE_MUTATION,
  OPERATION_KINDS.DATABASE_TRANSACTION,
]);

test('assembled production operation scan matches the final manifest denominator with zero uncovered sites', () => {
  assert.equal(verifyNewsContextOverlayAuthority(NEWS_CONTEXT_OVERLAY_AUTHORITY), true);
  for (const mutation of [
    { sourceCommit: '0'.repeat(40) },
    { sourceBlob: '0'.repeat(40) },
    { sourceDigestAlgorithm: 'sha512' },
    { sourceSha256: '0'.repeat(64) },
    { rulingCommit: '0'.repeat(40) },
    { ownerId: 'FORGED_OWNER' },
    { disposition: 'REPLACE_CANONICAL' },
    { operationClass: 'NON_IDEMPOTENT_MUTATION' },
    { operationId: 'OP_PUBLIC_HTTP_READ' },
    { siteId: 'OPSITE_SUBSTITUTED' },
    { path: 'server/src/services/other.ts' },
    { line: NEWS_CONTEXT_OVERLAY_AUTHORITY.line - 1 },
    { column: NEWS_CONTEXT_OVERLAY_AUTHORITY.column + 1 },
    { rawKind: OPERATION_KINDS.NETWORK_HTTP_REQUEST },
    { rawSymbol: 'fetch:POST' },
    { effectiveKind: OPERATION_KINDS.MUTATION_CALL },
    { effectiveSymbol: 'fetch:POST' },
  ]) {
    assert.equal(verifyNewsContextOverlayAuthority({
      ...NEWS_CONTEXT_OVERLAY_AUTHORITY,
      ...mutation,
    }), false, JSON.stringify(mutation));
  }
  assert.equal(verifyNewsContextOverlayAuthority({
    ...NEWS_CONTEXT_OVERLAY_AUTHORITY,
    duplicateTuple: true,
  }), false);

  const report = scanIntegratedProductionOperations();
  const policyCoverage = scanIntegratedOperationPolicyCoverage({
    canonicalRegistry: OPERATION_POLICY_REGISTRY,
    coverageScanner: scanOperationCoverage,
    operationReport: report,
  });
  const verified = verifyProductAssuranceOperationReport(manifest, report, policyCoverage);
  assert.equal(verified.passed, true, JSON.stringify({ expected: manifest.operationScan, observed: {
    filesScanned: report.filesScanned,
    discovered: report.discovered,
    covered: report.covered,
    policyCovered: policyCoverage.registeredSiteCount,
    uncovered: report.uncovered,
  }, checks: verified.checks }));
  assert.equal(policyCoverage.verdict, 'PASS', JSON.stringify(policyCoverage));
  assert.equal(policyCoverage.registeredSiteCount, report.discovered);
  assert.deepEqual(policyCoverage.unknownPolicyIds, []);
  assert.deepEqual(policyCoverage.duplicateOperationIds, []);
  assert.equal(
    policyCoverage.policies.every((policy) => validateOperationPolicy(policy).length === 0),
    true,
    JSON.stringify(policyCoverage.policies
      .map((policy) => [policy.operationId, validateOperationPolicy(policy)])
      .filter(([, issues]) => issues.length > 0)),
  );

  const policyById = new Map(policyCoverage.policies.map((policy) => [policy.operationId, policy]));
  assert.deepEqual(
    policyById.get('OP_BINANCE_PRIVATE_SIGNED_GET_READ')?.implementationPaths,
    ['server/src/binance/privateReadClient.ts'],
  );
  assert.deepEqual(
    policyById.get('OP_L07_EXCHANGE_TWIN_SYNTHETIC_STATE_REDUCTION')?.implementationPaths,
    ['server/src/liveEdge/adapters/exchangeTwin/twin.ts'],
  );
  assert.equal(
    policyById.get('OP_RUNTIME_IN_MEMORY_QUEUE')?.implementationPaths
      .includes('server/src/binance/profile.ts'),
    true,
  );
  assert.equal(
    policyById.get('OP_RUNTIME_IN_MEMORY_QUEUE')?.implementationPaths
      .includes('server/src/liveEdge/integration/assessmentBridge.ts'),
    true,
  );

  const withoutPrivatePolicy = policyCoverage.policies
    .filter((policy) => policy.operationId !== 'OP_BINANCE_PRIVATE_SIGNED_GET_READ');
  const missingPrivateCoverage = scanOperationCoverage(withoutPrivatePolicy, report.sites);
  assert.equal(missingPrivateCoverage.verdict, 'FAIL');
  assert.deepEqual(missingPrivateCoverage.unknownPolicyIds, ['OP_BINANCE_PRIVATE_SIGNED_GET_READ']);

  const rawNewsSites = report.sites.map((site) => site.siteId === NEWS_CONTEXT_OVERLAY_AUTHORITY.siteId
    ? Object.freeze({
      ...site,
      kind: NEWS_CONTEXT_OVERLAY_AUTHORITY.rawKind,
      symbol: NEWS_CONTEXT_OVERLAY_AUTHORITY.rawSymbol,
    })
    : site);
  const rawNewsCoverage = scanOperationCoverage(policyCoverage.policies, rawNewsSites);
  assert.equal(rawNewsCoverage.verdict, 'FAIL');
  assert.equal(
    rawNewsCoverage.uncoveredSites.some((site) => site.siteId === NEWS_CONTEXT_OVERLAY_AUTHORITY.siteId),
    true,
  );

  const duplicatePolicyCoverage = scanOperationCoverage(
    [...policyCoverage.policies, policyCoverage.policies[0]],
    report.sites,
  );
  assert.equal(duplicatePolicyCoverage.verdict, 'FAIL');
  assert.equal(duplicatePolicyCoverage.reasonCodes.includes('DUPLICATE_OPERATION_POLICY_ID'), true);

  const unknownSiteCoverage = scanOperationCoverage(policyCoverage.policies, [
    ...report.sites,
    Object.freeze({
      siteId: 'OPSITE_G1_HOSTILE_UNKNOWN',
      path: 'server/src/g1Hostile.ts',
      line: 1,
      kind: OPERATION_KINDS.NETWORK_HTTP_REQUEST,
      symbol: 'fetch:GET',
      operationId: 'OP_G1_UNKNOWN',
    }),
  ]);
  assert.equal(unknownSiteCoverage.verdict, 'FAIL');
  assert.deepEqual(unknownSiteCoverage.unknownPolicyIds, ['OP_G1_UNKNOWN']);

  assert.equal(report.discovered, report.covered);
  assert.equal(report.uncovered, 0);
  assert.deepEqual(report.uncoveredSites, []);
  const databaseSites = report.sites.filter((site) => DATABASE_KINDS.has(site.rawKind));
  assert.ok(databaseSites.length > 0, 'the canonical Ledger database denominator must be present');
  assert.equal(
    databaseSites.every((site) => site.path === 'server/src/ledger.ts'),
    true,
    JSON.stringify(databaseSites.filter((site) => site.path !== 'server/src/ledger.ts')),
  );
  assert.equal(
    databaseSites.every((site) => site.operationId === 'OP_LEDGER_SQLITE'),
    true,
    JSON.stringify(databaseSites.filter((site) => site.operationId !== 'OP_LEDGER_SQLITE')),
  );
});
