import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanProductionOperations } from '../productAssurance/production-operation-scan.mjs';
import { verifyProductAssuranceOperationReport } from './git-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/i00/product-assurance-manifest.v1.json'), 'utf8'));

test('assembled production operation scan matches the final manifest denominator with zero uncovered sites', () => {
  const report = scanProductionOperations();
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
});
