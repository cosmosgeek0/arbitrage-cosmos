import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { OPERATION_KINDS } from '../productAssurance/production-operation-scan.mjs';
import {
  NEWS_CONTEXT_OVERLAY_AUTHORITY,
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
  const verified = verifyProductAssuranceOperationReport(manifest, report);
  assert.equal(verified.passed, true, JSON.stringify({ expected: manifest.operationScan, observed: {
    filesScanned: report.filesScanned,
    discovered: report.discovered,
    covered: report.covered,
    uncovered: report.uncovered,
  }, checks: verified.checks }));
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
