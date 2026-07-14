import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fail, sha256File } from './lib.mjs';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function safeArtifactReader(root) {
  const base = realpathSync(path.resolve(root));
  return (relativePath) => {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)
        || relativePath.includes('\\') || relativePath !== path.posix.normalize(relativePath)
        || relativePath.startsWith('../')) throw new Error('RELEASE_BROWSER_ARTIFACT_PATH_INVALID');
    const absolute = path.resolve(base, relativePath);
    if (!absolute.startsWith(`${base}${path.sep}`)) throw new Error('RELEASE_BROWSER_ARTIFACT_OUTSIDE_ROOT');
    const info = lstatSync(absolute, { throwIfNoEntry: false });
    if (!info?.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error('RELEASE_BROWSER_ARTIFACT_MISSING_OR_UNSAFE');
    return readFileSync(absolute);
  };
}

export async function validateCanonicalAcceptanceEvidence({
  receipt,
  receiptPath,
  browserPath,
  performancePath,
  artifactRoot,
  expectedSha,
  expectedTree,
}) {
  const releaseRoot = path.resolve(artifactRoot);
  const sourceValidator = path.join(MODULE_ROOT, 'test/i00/performance/local-acceptance.mjs');
  const validatorRoot = existsSync(sourceValidator) ? MODULE_ROOT : releaseRoot;
  let acceptanceModule;
  let performanceModule;
  try {
    acceptanceModule = await import(pathToFileURL(path.join(validatorRoot, 'test/i00/performance/local-acceptance.mjs')).href);
    performanceModule = await import(pathToFileURL(path.join(validatorRoot, 'test/i00/performance/local-proxy-soak.mjs')).href);
  } catch (error) {
    fail(`canonical acceptance validators are unavailable: ${error.message}`);
  }
  const browser = JSON.parse(readFileSync(browserPath, 'utf8'));
  const performance = JSON.parse(readFileSync(performancePath, 'utf8'));
  const browserDocumentValidation = acceptanceModule.validateBrowserDocument(browser, expectedSha, expectedTree);
  const browserArtifactValidation = acceptanceModule.validateBrowserArtifacts(browser, safeArtifactReader(artifactRoot));
  if (!browserDocumentValidation.passed || !browserArtifactValidation.passed) {
    fail(`canonical browser acceptance validation failed: ${[
      ...browserDocumentValidation.schemaErrors,
      ...browserDocumentValidation.semanticFailures,
      ...browserArtifactValidation.failures,
    ].join(',')}`);
  }
  if (JSON.stringify(browserArtifactValidation.artifacts) !== JSON.stringify(receipt.browserReceipt.artifacts)) {
    fail('canonical browser artifact inventory does not match the complete acceptance receipt');
  }
  const browserSchemas = [
    ['browser-receipt.schema.v2.json', 'schemaSha256'],
    ['browser-measurement.schema.v1.json', 'browserMeasurementSchemaSha256'],
    ['browser-capture.schema.v3.json', 'browserCaptureSchemaSha256'],
    ['browser-restart-measurement.schema.v1.json', 'browserRestartSchemaSha256'],
  ];
  for (const [file, field] of browserSchemas) {
    const schema = path.join(validatorRoot, 'test/i00/performance', file);
    if (sha256File(schema) !== receipt.browserReceipt[field]) {
      fail(`complete acceptance ${file} hash does not match the canonical schema`);
    }
  }
  const performanceValidation = performanceModule.validatePerformanceDocument(performance, {
    headSha: expectedSha,
    treeSha: expectedTree,
  });
  if (!performanceValidation.passed) {
    fail(`canonical performance acceptance validation failed: ${[
      ...performanceValidation.schemaErrors,
      ...performanceValidation.semanticFailures,
    ].join(',')}`);
  }
  const completeValidation = acceptanceModule.validateCompleteReceiptDocument(
    receipt,
    expectedSha,
    expectedTree,
    receipt.performanceReceipt,
    receipt.browserReceipt,
    {
      format: receipt.sourceFreeze.format,
      fileCount: receipt.sourceFreeze.fileCount,
      sha256: receipt.sourceFreeze.sha256,
      protectedOwnerDirectives: receipt.sourceFreeze.protectedOwnerDirectives.map((directive) => ({
        path: directive.path,
        sha256: directive.sha256,
      })),
    },
    receipt.sourceFreeze.evidence,
    readFileSync(receiptPath, 'utf8'),
  );
  if (!completeValidation.passed) {
    fail(`canonical complete acceptance validation failed: ${completeValidation.semanticFailures.join(',')}`);
  }
}
