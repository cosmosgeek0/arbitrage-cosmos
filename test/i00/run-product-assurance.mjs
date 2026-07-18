#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanIntegratedProductionOperations } from './product-assurance-operation-overlay.mjs';
import {
  validateProductAssuranceManifest,
  verifyProductAssuranceDonors,
  verifyProductAssuranceOperationReport,
  verifyProductAssuranceSuiteInventory,
} from './git-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/i00/product-assurance-manifest.v1.json');
const WRITE_MANIFEST_ARGUMENT = '--write-manifest';

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function regenerateManifest() {
  const current = readManifest();
  const operationReport = scanIntegratedProductionOperations();
  if (operationReport.uncovered !== 0) {
    throw new Error(`PRODUCT_ASSURANCE_OPERATION_SCAN_UNCOVERED:${operationReport.uncovered}`);
  }
  const generated = {
    ...current,
    operationScan: {
      schemaVersion: operationReport.schemaVersion,
      scriptPath: current.operationScan?.scriptPath,
      filesScanned: operationReport.filesScanned,
      discovered: operationReport.discovered,
      covered: operationReport.covered,
      uncovered: operationReport.uncovered,
    },
  };
  const validation = validateProductAssuranceManifest(generated);
  if (!validation.passed) {
    throw new Error(`PRODUCT_ASSURANCE_GENERATED_MANIFEST_INVALID:${validation.errors.join(',')}`);
  }
  const operationVerification = verifyProductAssuranceOperationReport(generated, operationReport);
  if (!operationVerification.passed) {
    throw new Error('PRODUCT_ASSURANCE_GENERATED_OPERATION_SCAN_INVALID');
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');
  process.stdout.write(`PRODUCT_ASSURANCE_MANIFEST_WRITTEN ${JSON.stringify(generated.operationScan)}\n`);
}

function exactNamePattern(names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return new RegExp(`^(?:${escaped.join('|')})$`, 'u');
}

async function runTestUnit(id, files, exactNames, expectedPasses) {
  const stream = run({
    files: files.map((file) => path.join(ROOT, file)),
    cwd: ROOT,
    concurrency: 1,
    execArgv: [],
    testNamePatterns: exactNames.length === 0 ? undefined : exactNamePattern(exactNames),
    timeout: 120_000,
  });
  let summary = null;
  const failures = [];
  for await (const event of stream) {
    if (event.type === 'test:fail') failures.push(Object.freeze({
      name: event.data.name,
      file: event.data.file ?? null,
      errorCode: event.data.details?.error?.code ?? null,
    }));
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
  }
  if (summary === null) throw new Error(`PRODUCT_ASSURANCE_SUMMARY_MISSING:${id}`);
  const counts = summary.counts;
  const passed = summary.success === true
    && counts.tests === expectedPasses
    && counts.passed === expectedPasses
    && counts.failed === 0
    && counts.cancelled === 0
    && counts.skipped === 0
    && counts.todo === 0
    && failures.length === 0;
  const result = Object.freeze({
    id,
    expectedPasses,
    tests: counts.tests,
    passed: counts.passed,
    failed: counts.failed,
    cancelled: counts.cancelled,
    skipped: counts.skipped,
    todo: counts.todo,
    durationMs: summary.duration_ms,
    failures: Object.freeze(failures),
    gatePassed: passed,
  });
  process.stdout.write(`PRODUCT_ASSURANCE_RUN ${JSON.stringify(result)}\n`);
  if (!passed) throw new Error(`PRODUCT_ASSURANCE_RUN_FAILED:${id}`);
  return result;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const unknown = arguments_.filter((argument) => argument !== WRITE_MANIFEST_ARGUMENT);
  if (unknown.length > 0 || arguments_.length > 1) {
    throw new Error(`PRODUCT_ASSURANCE_ARGUMENT_INVALID:${unknown[0] ?? arguments_[1]}`);
  }
  if (arguments_.includes(WRITE_MANIFEST_ARGUMENT)) {
    regenerateManifest();
    return;
  }

  const manifest = readManifest();
  const validation = validateProductAssuranceManifest(manifest);
  const inventory = verifyProductAssuranceSuiteInventory(manifest);
  const provenance = verifyProductAssuranceDonors(manifest);
  if (!validation.passed) throw new Error(`PRODUCT_ASSURANCE_MANIFEST_INVALID:${validation.errors.join(',')}`);
  if (!inventory.passed) throw new Error('PRODUCT_ASSURANCE_INVENTORY_INVALID');
  if (!provenance.passed) throw new Error('PRODUCT_ASSURANCE_PROVENANCE_INVALID');

  const provenanceResult = await runTestUnit(
    'INTEGRATION_PROVENANCE',
    ['test/i00/product-assurance-provenance.test.mjs'],
    [],
    manifest.expectedProvenancePasses,
  );
  const behaviorResults = [];
  for (const suite of manifest.suites) {
    for (const runEntry of suite.runs) {
      behaviorResults.push(await runTestUnit(
        runEntry.id,
        runEntry.files,
        runEntry.selection === 'EXACT_NAMES' ? runEntry.exactNames : [],
        runEntry.expectedPasses,
      ));
    }
  }
  const donorBehaviorPasses = behaviorResults.reduce((total, result) => total + result.passed, 0);
  if (donorBehaviorPasses !== manifest.expectedDonorBehaviorPasses) {
    throw new Error(`PRODUCT_ASSURANCE_DONOR_BEHAVIOR_TOTAL:${donorBehaviorPasses}`);
  }

  const integrationReplacementResult = await runTestUnit(
    manifest.integrationReplacement.id,
    [manifest.integrationReplacement.testFile],
    [manifest.integrationReplacement.exactName],
    manifest.integrationReplacement.expectedPasses,
  );
  const effectiveBehaviorPasses = donorBehaviorPasses + integrationReplacementResult.passed;
  if (effectiveBehaviorPasses !== manifest.expectedBehaviorPasses) {
    throw new Error(`PRODUCT_ASSURANCE_EFFECTIVE_BEHAVIOR_TOTAL:${effectiveBehaviorPasses}`);
  }

  const operationReport = scanIntegratedProductionOperations();
  const operationVerification = verifyProductAssuranceOperationReport(manifest, operationReport);
  if (!operationVerification.passed) throw new Error('PRODUCT_ASSURANCE_OPERATION_SCAN_INVALID');

  const result = Object.freeze({
    schemaVersion: manifest.schemaVersion,
    donor_behavior: donorBehaviorPasses,
    integration_replacement_behavior: integrationReplacementResult.passed,
    behavior: effectiveBehaviorPasses,
    provenance: provenanceResult.passed,
    operationScan: Object.freeze({
      filesScanned: operationReport.filesScanned,
      discovered: operationReport.discovered,
      covered: operationReport.covered,
      uncovered: operationReport.uncovered,
    }),
    skipped_callbacks: validation.skippedCallbacks,
    git_object_context_proofs: validation.gitObjectContextProofs,
    live_context_replacements: validation.liveContextReplacements,
    context_replacement_rows: validation.contextReplacementRows,
    donorContextCallbacksExecuted: 0,
    passed: true,
  });
  process.stdout.write(`PRODUCT_ASSURANCE_HARNESS_RESULT ${JSON.stringify(result)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`product assurance harness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
