import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  fail, isFullSha, readJson, requireExactKeys,
} from './lib.mjs';

export const COMPLETE_ACCEPTANCE_SCHEMA = 'i00.local-acceptance.v1';
export const COMPLETE_ACCEPTANCE_TRUTH = 'LOCAL_COMPLETE_ACCEPTANCE_MEASURED';
export const COMPLETE_ACCEPTANCE_STEP_COUNT = 10;
export const SOURCE_FREEZE_FORMAT = 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INTEGRATION_BRANCH = 'i00-product-assembly-20260713';
const Q_DONOR = Object.freeze({
  donorSha: '02b4eccc8d2ef53b830cafae06e5175715fa6ebb',
  donorTree: '5c86cebf0966cedd7ba01c56a01704b4f7bd0224',
  receiptPath: 'quant/RECEIPTS/Q17_ACCEPTANCE.md',
  receiptSha256: '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc',
});
const Q_ENVIRONMENT = Object.freeze({
  pythonVersion: '3.13.14',
  pyprojectSha256: 'a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81',
  uvLockSha256: '716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29',
  manifestSha256: 'b83ef8e8be73d5a98bae3309649531136890444edd81b71fe3b503feb6fdbc0e',
});

const PLAN = Object.freeze([
  Object.freeze({ id: 'q_current_gate', kind: 'Q_CURRENT', command: ['node', 'test/run-quant-gates.mjs'] }),
  Object.freeze({ id: 'root_test', kind: 'COMMAND', command: ['npm', 'test'] }),
  Object.freeze({ id: 'repository_test_all', kind: 'COMMAND', command: ['npm', 'run', 'test:all'] }),
  Object.freeze({ id: 'ops_all_local', kind: 'COMMAND', command: ['bash', 'ops/tests/run-all.sh'] }),
  Object.freeze({ id: 'ops_i00_all_local', kind: 'COMMAND', command: ['bash', 'ops/tests/i00/run-all.sh'] }),
  Object.freeze({ id: 'generated_report_parity', kind: 'REPORT_PARITY', command: [] }),
  Object.freeze({ id: 'local_proxy_performance', kind: 'PERFORMANCE' }),
  Object.freeze({ id: 'browser_receipt', kind: 'BROWSER_RECEIPT', command: [] }),
  Object.freeze({ id: 'source_freeze', kind: 'SOURCE_FREEZE', command: [] }),
  Object.freeze({ id: 'diff_check', kind: 'COMMAND', command: ['git', 'diff', '--check'] }),
]);

const COMMON_STEP_KEYS = Object.freeze([
  'id', 'command', 'cwdRelative', 'startedAtUtc', 'endedAtUtc', 'durationMs',
  'exitCode', 'exitSignal', 'timedOut', 'stdoutBytes', 'stderrBytes',
  'stdoutSha256', 'stderrSha256', 'parsedCounts', 'secretFindings',
  'outputOverflow', 'passed',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertSha256(value, label) {
  assert(typeof value === 'string' && SHA256_PATTERN.test(value), `${label} must be a lowercase SHA-256`);
}

function assertIsoUtc(value, label) {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), `${label} must be an exact UTC timestamp`);
}

function assertNonnegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
}

function assertNonnegativeNumber(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a non-negative finite number`);
}

function assertEmptyArray(value, label) {
  assert(Array.isArray(value) && value.length === 0, `${label} must be an exact empty array`);
}

function assertSafeRelativePath(relative, label) {
  assert(typeof relative === 'string'
    && relative.length > 0
    && !path.isAbsolute(relative)
    && !relative.includes('\\')
    && relative === path.posix.normalize(relative)
    && relative !== '..'
    && !relative.startsWith('../'), `${label} must be a contained POSIX relative path`);
}

function readRegularFile(file, label, maximumBytes = 64 * 1024 * 1024) {
  const absolute = path.resolve(file);
  let info;
  try {
    info = lstatSync(absolute);
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  assert(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  assert(info.size > 0 && info.size <= maximumBytes, `${label} has an invalid size`);
  return Object.freeze({ absolute, bytes: readFileSync(absolute) });
}

function containedEvidencePath(root, relative, label) {
  assertSafeRelativePath(relative, label);
  const base = realpathSync(path.resolve(root));
  const absolute = path.resolve(base, relative);
  assert(absolute.startsWith(`${base}${path.sep}`), `${label} escapes the evidence root`);
  const file = readRegularFile(absolute, label);
  assert(realpathSync(file.absolute) === file.absolute, `${label} must not traverse a symlink`);
  return file;
}

function assertDescriptor(descriptor, expectedKeys, label) {
  requireExactKeys(descriptor, expectedKeys, label);
  assertSafeRelativePath(descriptor.relativePath, `${label}.relativePath`);
  assertSha256(descriptor.sha256, `${label}.sha256`);
  assertNonnegativeInteger(descriptor.byteLength, `${label}.byteLength`);
  assert(descriptor.byteLength > 0, `${label}.byteLength must be positive`);
}

function assertProtectedOwnerDirectives(rows, label) {
  assert(Array.isArray(rows) && rows.length > 0, `${label} must be a non-empty array`);
  const paths = new Set();
  for (const [index, row] of rows.entries()) {
    requireExactKeys(row, ['path', 'sha256', 'gitStatus'], `${label}[${index}]`);
    assertSafeRelativePath(row.path, `${label}[${index}].path`);
    assertSha256(row.sha256, `${label}[${index}].sha256`);
    assert(row.gitStatus === 'UNTRACKED_PROTECTED_OWNER_INPUT', `${label}[${index}].gitStatus is invalid`);
    assert(!paths.has(row.path), `${label} contains a duplicate path`);
    paths.add(row.path);
  }
}

function assertHashPinnedOwnerDirectives(rows, label) {
  assert(Array.isArray(rows) && rows.length > 0, `${label} must be a non-empty array`);
  const paths = new Set();
  for (const [index, row] of rows.entries()) {
    requireExactKeys(row, ['path', 'sha256'], `${label}[${index}]`);
    assertSafeRelativePath(row.path, `${label}[${index}].path`);
    assertSha256(row.sha256, `${label}[${index}].sha256`);
    assert(!paths.has(row.path), `${label} contains a duplicate path`);
    paths.add(row.path);
  }
}

function assertPlan(receipt, expectedSha) {
  assert(Array.isArray(receipt.plan) && receipt.plan.length === PLAN.length, 'complete acceptance plan must contain exactly 10 steps');
  for (let index = 0; index < PLAN.length; index += 1) {
    const actual = receipt.plan[index];
    const expected = PLAN[index];
    requireExactKeys(actual, ['id', 'kind', 'command'], `complete acceptance plan[${index}]`);
    assert(actual.id === expected.id && actual.kind === expected.kind, `complete acceptance plan[${index}] identity/order is invalid`);
    assert(Array.isArray(actual.command), `complete acceptance plan[${index}].command must be an array`);
    if (expected.command) {
      assert(exactJson(actual.command, expected.command), `complete acceptance plan ${expected.id} command is invalid`);
    } else {
      assert(actual.command.length === 4
        && /(?:^|\/)node(?:\.exe)?$/.test(actual.command[0])
        && actual.command[1] === 'test/i00/performance/local-proxy-soak.mjs'
        && actual.command[2] === '--run'
        && actual.command[3] === '--duration-seconds=<bounded>', 'complete acceptance performance plan is invalid');
    }
  }
  assert(isFullSha(expectedSha), 'complete acceptance expected candidate SHA is invalid');
}

function assertStepCommand(step, plan, recordedPlan, expectedSha) {
  assert(Array.isArray(step.command), `complete acceptance step ${step.id}.command must be an array`);
  if (plan.command) {
    assert(exactJson(step.command, plan.command), `complete acceptance step ${step.id} command is invalid`);
    return;
  }
  const duration = Number(step.command[4]?.slice('--duration-seconds='.length));
  assert(step.command.length === 6
    && step.command[0] === recordedPlan.command[0]
    && step.command[1] === 'test/i00/performance/local-proxy-soak.mjs'
    && step.command[2] === '--run'
    && step.command[3] === `--tested-sha=${expectedSha}`
    && /^--duration-seconds=\d+$/.test(step.command[4])
    && Number.isSafeInteger(duration) && duration >= 60 && duration <= 3_600
    && /^--out=local-proxy-performance-[0-9]{17}-[0-9]+\.json$/.test(step.command[5]), 'complete acceptance measured performance command is invalid');
}

function assertStep(step, plan, recordedPlan, receiptStart, receiptEnd, expectedSha) {
  const extraKeys = plan.kind === 'REPORT_PARITY' ? ['artifacts']
    : plan.kind === 'SOURCE_FREEZE'
      ? ['initial', 'final', 'initialEvidence', 'finalInitialEvidence', 'performanceEvidence']
      : [];
  requireExactKeys(step, [...COMMON_STEP_KEYS, ...extraKeys], `complete acceptance step ${plan.id}`);
  assert(step.id === plan.id, `complete acceptance step ${plan.id} identity/order is invalid`);
  assertStepCommand(step, plan, recordedPlan, expectedSha);
  assert(step.cwdRelative === '.', `complete acceptance step ${plan.id}.cwdRelative is invalid`);
  assertIsoUtc(step.startedAtUtc, `complete acceptance step ${plan.id}.startedAtUtc`);
  assertIsoUtc(step.endedAtUtc, `complete acceptance step ${plan.id}.endedAtUtc`);
  assert(Date.parse(step.startedAtUtc) >= receiptStart
    && Date.parse(step.endedAtUtc) >= Date.parse(step.startedAtUtc)
    && Date.parse(step.endedAtUtc) <= receiptEnd, `complete acceptance step ${plan.id} chronology is invalid`);
  assertNonnegativeNumber(step.durationMs, `complete acceptance step ${plan.id}.durationMs`);
  assert(step.exitCode === 0 && step.exitSignal === null && step.timedOut === false
    && step.outputOverflow === false && step.passed === true, `complete acceptance step ${plan.id} did not pass exactly`);
  assertNonnegativeInteger(step.stdoutBytes, `complete acceptance step ${plan.id}.stdoutBytes`);
  assertNonnegativeInteger(step.stderrBytes, `complete acceptance step ${plan.id}.stderrBytes`);
  assertSha256(step.stdoutSha256, `complete acceptance step ${plan.id}.stdoutSha256`);
  assertSha256(step.stderrSha256, `complete acceptance step ${plan.id}.stderrSha256`);
  assert(isPlainObject(step.parsedCounts), `complete acceptance step ${plan.id}.parsedCounts must be an object`);
  for (const [key, values] of Object.entries(step.parsedCounts)) {
    assert(typeof key === 'string' && Array.isArray(values) && values.length > 0
      && values.every((value) => Number.isSafeInteger(value) && value >= 0), `complete acceptance step ${plan.id}.parsedCounts is invalid`);
  }
  assertEmptyArray(step.secretFindings, `complete acceptance step ${plan.id}.secretFindings`);
}

function assertEvidenceManifest(manifest, label) {
  requireExactKeys(manifest, ['entries', 'sha256'], label);
  assert(Array.isArray(manifest.entries) && manifest.entries.length > 0, `${label}.entries must be non-empty`);
  const paths = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    requireExactKeys(entry, ['relativePath', 'sha256', 'byteLength'], `${label}.entries[${index}]`);
    assertDescriptor(entry, ['relativePath', 'sha256', 'byteLength'], `${label}.entries[${index}]`);
    assert(!paths.has(entry.relativePath), `${label} contains a duplicate evidence path`);
    paths.add(entry.relativePath);
  }
  assertSha256(manifest.sha256, `${label}.sha256`);
  assert(manifest.sha256 === sha256(JSON.stringify(manifest.entries)), `${label}.sha256 does not bind its ordered entries`);
}

function assertSourceFreeze(receipt) {
  requireExactKeys(receipt.sourceFreeze, ['format', 'fileCount', 'sha256', 'evidence', 'protectedOwnerDirectives'], 'complete acceptance sourceFreeze');
  assert(receipt.sourceFreeze.format === SOURCE_FREEZE_FORMAT, 'complete acceptance sourceFreeze.format is invalid');
  assertNonnegativeInteger(receipt.sourceFreeze.fileCount, 'complete acceptance sourceFreeze.fileCount');
  assert(receipt.sourceFreeze.fileCount > 0, 'complete acceptance sourceFreeze.fileCount must be positive');
  assertSha256(receipt.sourceFreeze.sha256, 'complete acceptance sourceFreeze.sha256');
  assertProtectedOwnerDirectives(receipt.sourceFreeze.protectedOwnerDirectives, 'complete acceptance sourceFreeze.protectedOwnerDirectives');
  assert(exactJson(receipt.sourceFreeze.protectedOwnerDirectives, receipt.source.protectedOwnerDirectives), 'complete acceptance sourceFreeze protected inputs do not match source truth');
  assertEvidenceManifest(receipt.sourceFreeze.evidence, 'complete acceptance sourceFreeze.evidence');
  const step = receipt.steps.find((candidate) => candidate?.id === 'source_freeze');
  assert(step !== undefined, 'complete acceptance source_freeze step is missing');
  for (const label of ['initial', 'final']) {
    requireExactKeys(step[label], ['format', 'fileCount', 'sha256', 'protectedOwnerDirectives'], `complete acceptance source_freeze.${label}`);
    assert(step[label].format === SOURCE_FREEZE_FORMAT
      && step[label].fileCount === receipt.sourceFreeze.fileCount
      && step[label].sha256 === receipt.sourceFreeze.sha256, `complete acceptance source_freeze.${label} does not match the frozen source`);
    assertHashPinnedOwnerDirectives(step[label].protectedOwnerDirectives, `complete acceptance source_freeze.${label}.protectedOwnerDirectives`);
    assert(exactJson(step[label].protectedOwnerDirectives, receipt.sourceFreeze.protectedOwnerDirectives.map(({ path: directivePath, sha256: directiveSha256 }) => ({ path: directivePath, sha256: directiveSha256 }))), `complete acceptance source_freeze.${label} protected hashes do not match source truth`);
  }
  assertEvidenceManifest(step.initialEvidence, 'complete acceptance source_freeze.initialEvidence');
  assertEvidenceManifest(step.finalInitialEvidence, 'complete acceptance source_freeze.finalInitialEvidence');
  assert(exactJson(step.initialEvidence, receipt.sourceFreeze.evidence)
    && exactJson(step.finalInitialEvidence, receipt.sourceFreeze.evidence), 'complete acceptance source_freeze initial evidence changed');
  assertEvidenceManifest(step.performanceEvidence, 'complete acceptance source_freeze.performanceEvidence');
  assert(step.performanceEvidence.entries.length === 1
    && step.performanceEvidence.entries[0].relativePath === receipt.performanceReceipt.relativePath
    && step.performanceEvidence.entries[0].sha256 === receipt.performanceReceipt.sha256
    && step.performanceEvidence.entries[0].byteLength === receipt.performanceReceipt.byteLength, 'complete acceptance source_freeze performance evidence is unbound');
}

function assertReceiptDescriptorBindings(receipt) {
  assertDescriptor(receipt.performanceReceipt, [
    'relativePath', 'sha256', 'byteLength', 'schemaVersion', 'overall',
    'schemaValid', 'schemaErrors', 'semanticFailures', 'secretFindings', 'passed',
  ], 'complete acceptance performanceReceipt');
  assert(receipt.performanceReceipt.schemaVersion === 'i00.local-proxy-performance.v1'
    && receipt.performanceReceipt.overall === 'PASS'
    && receipt.performanceReceipt.schemaValid === true
    && receipt.performanceReceipt.passed === true, 'complete acceptance performanceReceipt status is invalid');
  for (const key of ['schemaErrors', 'semanticFailures', 'secretFindings']) {
    assertEmptyArray(receipt.performanceReceipt[key], `complete acceptance performanceReceipt.${key}`);
  }
  assertDescriptor(receipt.browserReceipt, [
    'relativePath', 'sha256', 'byteLength', 'runCount', 'routeCaptureCount', 'artifactCount', 'restart', 'schemaSha256',
    'browserMeasurementSchemaSha256', 'browserCaptureSchemaSha256', 'browserRestartSchemaSha256', 'schemaValid',
    'schemaErrors', 'semanticFailures', 'artifacts', 'secretFindings', 'passed',
  ], 'complete acceptance browserReceipt');
  assert(receipt.browserReceipt.runCount === 6, 'complete acceptance browserReceipt.runCount is invalid');
  assert(receipt.browserReceipt.routeCaptureCount === 126, 'complete acceptance browserReceipt.routeCaptureCount is invalid');
  assert(receipt.browserReceipt.artifactCount === 194, 'complete acceptance browserReceipt.artifactCount is invalid');
  requireExactKeys(receipt.browserReceipt.restart, [
    'performed', 'webSocketClose1012Observed', 'postRestartRendered', 'diagnosticSelector',
    'reconnectGeneration', 'measurementPath', 'measurementSha256',
  ], 'complete acceptance browserReceipt.restart');
  assert(receipt.browserReceipt.restart.performed === true
    && receipt.browserReceipt.restart.webSocketClose1012Observed === true
    && receipt.browserReceipt.restart.postRestartRendered === true
    && receipt.browserReceipt.restart.diagnosticSelector === '#i00-ws-close-diagnostic'
    && Number.isSafeInteger(receipt.browserReceipt.restart.reconnectGeneration)
    && receipt.browserReceipt.restart.reconnectGeneration >= 1,
  'complete acceptance browserReceipt.restart is invalid');
  assertSafeRelativePath(receipt.browserReceipt.restart.measurementPath, 'complete acceptance browserReceipt.restart.measurementPath');
  assertSha256(receipt.browserReceipt.restart.measurementSha256, 'complete acceptance browserReceipt.restart.measurementSha256');
  assertSha256(receipt.browserReceipt.schemaSha256, 'complete acceptance browserReceipt.schemaSha256');
  assertSha256(receipt.browserReceipt.browserMeasurementSchemaSha256, 'complete acceptance browserReceipt.browserMeasurementSchemaSha256');
  assertSha256(receipt.browserReceipt.browserCaptureSchemaSha256, 'complete acceptance browserReceipt.browserCaptureSchemaSha256');
  assertSha256(receipt.browserReceipt.browserRestartSchemaSha256, 'complete acceptance browserReceipt.browserRestartSchemaSha256');
  assert(receipt.browserReceipt.schemaValid === true && receipt.browserReceipt.passed === true, 'complete acceptance browserReceipt status is invalid');
  for (const key of ['schemaErrors', 'semanticFailures', 'secretFindings']) {
    assertEmptyArray(receipt.browserReceipt[key], `complete acceptance browserReceipt.${key}`);
  }
  assert(Array.isArray(receipt.browserReceipt.artifacts)
    && receipt.browserReceipt.artifacts.length === receipt.browserReceipt.artifactCount,
  'complete acceptance browserReceipt.artifacts must match artifactCount');
  const artifactPaths = new Set();
  for (const [index, artifact] of receipt.browserReceipt.artifacts.entries()) {
    assertDescriptor(artifact, ['relativePath', 'sha256', 'byteLength', 'mediaType'], `complete acceptance browserReceipt.artifacts[${index}]`);
    assert(['image/png', 'application/json', 'application/vnd.i00.browser-capture+json', 'application/vnd.i00.browser-restart-measurement+json'].includes(artifact.mediaType), `complete acceptance browserReceipt.artifacts[${index}].mediaType is invalid`);
    assert(!artifactPaths.has(artifact.relativePath), 'complete acceptance browserReceipt.artifacts contains a duplicate path');
    artifactPaths.add(artifact.relativePath);
  }
  const restartArtifact = receipt.browserReceipt.artifacts.find((artifact) => artifact.relativePath === receipt.browserReceipt.restart.measurementPath);
  assert(restartArtifact?.sha256 === receipt.browserReceipt.restart.measurementSha256
    && restartArtifact.mediaType === 'application/vnd.i00.browser-restart-measurement+json',
  'complete acceptance browserReceipt.restart artifact binding is invalid');
}

function loadBoundEvidence({ receipt, evidenceRoot, browserPath, performancePath, verifyReferencedArtifacts }) {
  const browserFile = browserPath
    ? readRegularFile(browserPath, 'browser acceptance receipt')
    : containedEvidencePath(evidenceRoot, receipt.browserReceipt.relativePath, 'browser acceptance receipt');
  const performanceFile = performancePath
    ? readRegularFile(performancePath, 'performance acceptance receipt')
    : containedEvidencePath(evidenceRoot, receipt.performanceReceipt.relativePath, 'performance acceptance receipt');
  assert(browserFile.bytes.length === receipt.browserReceipt.byteLength
    && sha256(browserFile.bytes) === receipt.browserReceipt.sha256, 'browser acceptance bytes do not match the complete receipt');
  assert(performanceFile.bytes.length === receipt.performanceReceipt.byteLength
    && sha256(performanceFile.bytes) === receipt.performanceReceipt.sha256, 'performance acceptance bytes do not match the complete receipt');
  let browser;
  let performance;
  try {
    browser = JSON.parse(browserFile.bytes.toString('utf8'));
    performance = JSON.parse(performanceFile.bytes.toString('utf8'));
  } catch (error) {
    fail(`bound browser/performance acceptance evidence is not valid JSON: ${error.message}`);
  }
  if (verifyReferencedArtifacts) {
    for (const artifact of receipt.browserReceipt.artifacts) {
      const file = containedEvidencePath(evidenceRoot, artifact.relativePath, `browser acceptance artifact ${artifact.relativePath}`);
      assert(file.bytes.length === artifact.byteLength && sha256(file.bytes) === artifact.sha256, `browser acceptance artifact ${artifact.relativePath} does not match its bound bytes`);
    }
  }
  return Object.freeze({ browserFile, performanceFile, browser, performance });
}

export function validateCompleteAcceptanceReceipt({
  receiptPath,
  expectedSha,
  expectedTree,
  evidenceRoot,
  browserPath,
  performancePath,
  verifyReferencedArtifacts = false,
  builtAtUtc = null,
}) {
  assert(isFullSha(expectedSha), 'complete acceptance expected candidate SHA must be a full lowercase Git SHA');
  assert(isFullSha(expectedTree), 'complete acceptance expected candidate tree must be a full lowercase Git SHA');
  const receiptFile = readRegularFile(receiptPath, 'complete local-acceptance receipt');
  const receipt = readJson(receiptFile.absolute, 'complete local-acceptance receipt');
  requireExactKeys(receipt, [
    'schemaVersion', 'truthClass', 'runId', 'startedAtUtc', 'endedAtUtc', 'source',
    'sourceFreeze', 'qExactDonor', 'uv', 'plan', 'steps', 'missingSteps',
    'performanceReceipt', 'browserReceipt', 'externalBoundary', 'secretScan', 'passed',
  ], 'complete local-acceptance receipt');
  assert(receipt.schemaVersion === COMPLETE_ACCEPTANCE_SCHEMA
    && receipt.truthClass === COMPLETE_ACCEPTANCE_TRUTH, 'complete local-acceptance receipt identity is invalid');
  assert(typeof receipt.runId === 'string' && /^[A-Za-z0-9._-]{6,128}$/.test(receipt.runId), 'complete local-acceptance receipt runId is invalid');
  assertIsoUtc(receipt.startedAtUtc, 'complete local-acceptance receipt startedAtUtc');
  assertIsoUtc(receipt.endedAtUtc, 'complete local-acceptance receipt endedAtUtc');
  const receiptStart = Date.parse(receipt.startedAtUtc);
  const receiptEnd = Date.parse(receipt.endedAtUtc);
  assert(receiptEnd >= receiptStart, 'complete local-acceptance receipt chronology is invalid');
  if (builtAtUtc !== null) {
    assertIsoUtc(builtAtUtc, 'release builtAtUtc');
    assert(receiptEnd <= Date.parse(builtAtUtc), 'complete local-acceptance receipt ended after the release build');
  }
  requireExactKeys(receipt.source, ['branch', 'headSha', 'treeSha', 'worktreeState', 'protectedOwnerDirectives'], 'complete acceptance source');
  assert(receipt.source.branch === INTEGRATION_BRANCH, 'complete acceptance source branch is invalid');
  assert(receipt.source.headSha === expectedSha && receipt.source.treeSha === expectedTree, 'complete acceptance candidate SHA/tree mismatch');
  assert(receipt.source.worktreeState === 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE', 'complete acceptance source is not frozen');
  assertProtectedOwnerDirectives(receipt.source.protectedOwnerDirectives, 'complete acceptance source.protectedOwnerDirectives');
  requireExactKeys(receipt.qExactDonor, ['donorSha', 'donorTree', 'receiptPath', 'receiptSha256', 'venv'], 'complete acceptance qExactDonor');
  for (const [key, value] of Object.entries(Q_DONOR)) assert(receipt.qExactDonor[key] === value, `complete acceptance qExactDonor.${key} is invalid`);
  requireExactKeys(receipt.qExactDonor.venv, ['resolvedPathSha256', 'pythonSha256', 'integrity'], 'complete acceptance qExactDonor.venv');
  assertSha256(receipt.qExactDonor.venv.resolvedPathSha256, 'complete acceptance qExactDonor.venv.resolvedPathSha256');
  assertSha256(receipt.qExactDonor.venv.pythonSha256, 'complete acceptance qExactDonor.venv.pythonSha256');
  const qIntegrity = receipt.qExactDonor.venv.integrity;
  requireExactKeys(qIntegrity, [
    'implementation', 'pythonVersion', 'pyprojectSha256', 'uvLockSha256',
    'manifestSha256', 'distributionCount', 'pipCheck', 'pytestPluginPolicy',
  ], 'complete acceptance qExactDonor.venv.integrity');
  assert(qIntegrity.implementation === 'CPython'
    && qIntegrity.pythonVersion === Q_ENVIRONMENT.pythonVersion
    && qIntegrity.pyprojectSha256 === Q_ENVIRONMENT.pyprojectSha256
    && qIntegrity.uvLockSha256 === Q_ENVIRONMENT.uvLockSha256
    && qIntegrity.manifestSha256 === Q_ENVIRONMENT.manifestSha256
    && Number.isSafeInteger(qIntegrity.distributionCount) && qIntegrity.distributionCount > 0,
  'complete acceptance Q environment provenance is invalid');
  requireExactKeys(qIntegrity.pipCheck, ['exitCode', 'stdoutSha256', 'stderrSha256', 'passed'], 'complete acceptance qExactDonor.venv.integrity.pipCheck');
  assert(qIntegrity.pipCheck.exitCode === 0 && qIntegrity.pipCheck.passed === true, 'complete acceptance Q pip integrity check did not pass');
  assertSha256(qIntegrity.pipCheck.stdoutSha256, 'complete acceptance qExactDonor.venv.integrity.pipCheck.stdoutSha256');
  assertSha256(qIntegrity.pipCheck.stderrSha256, 'complete acceptance qExactDonor.venv.integrity.pipCheck.stderrSha256');
  requireExactKeys(qIntegrity.pytestPluginPolicy, ['autoLoad', 'explicit'], 'complete acceptance qExactDonor.venv.integrity.pytestPluginPolicy');
  assert(qIntegrity.pytestPluginPolicy.autoLoad === 'DISABLED'
    && exactJson(qIntegrity.pytestPluginPolicy.explicit, ['_hypothesis_pytestplugin', 'pytest_cov.plugin']),
  'complete acceptance Q pytest plugin policy is invalid');
  requireExactKeys(receipt.uv, ['resolvedPathSha256', 'binarySha256'], 'complete acceptance uv');
  assertSha256(receipt.uv.resolvedPathSha256, 'complete acceptance uv.resolvedPathSha256');
  assertSha256(receipt.uv.binarySha256, 'complete acceptance uv.binarySha256');
  assertPlan(receipt, expectedSha);
  assert(Array.isArray(receipt.steps) && receipt.steps.length === PLAN.length, 'complete acceptance must contain exactly 10 measured step results');
  for (let index = 0; index < PLAN.length; index += 1) assertStep(receipt.steps[index], PLAN[index], receipt.plan[index], receiptStart, receiptEnd, expectedSha);
  assertEmptyArray(receipt.missingSteps, 'complete acceptance missingSteps');
  assertReceiptDescriptorBindings(receipt);
  assertSourceFreeze(receipt);
  requireExactKeys(receipt.externalBoundary, ['privateReads', 'signedCalls', 'awsCloudflare', 'deployPush', 'moneyPaths'], 'complete acceptance externalBoundary');
  assert(exactJson(receipt.externalBoundary, {
    privateReads: 'OWNER_GATED_NOT_RUN',
    signedCalls: 'OWNER_GATED_NOT_RUN',
    awsCloudflare: 'OWNER_GATED_NOT_RUN',
    deployPush: 'NOT_RUN',
    moneyPaths: 'FORBIDDEN_NOT_RUN',
  }), 'complete acceptance external boundary truth is invalid');
  requireExactKeys(receipt.secretScan, ['findings', 'passed'], 'complete acceptance secretScan');
  assertEmptyArray(receipt.secretScan.findings, 'complete acceptance secretScan.findings');
  assert(receipt.secretScan.passed === true && receipt.passed === true, 'complete acceptance did not pass');

  const bound = loadBoundEvidence({
    receipt,
    evidenceRoot,
    browserPath,
    performancePath,
    verifyReferencedArtifacts,
  });
  assert(bound.browser?.source?.headSha === expectedSha && bound.browser?.source?.treeSha === expectedTree,
    'browser acceptance candidate identity mismatch');
  assert(bound.performance?.source?.headSha === expectedSha && bound.performance?.source?.treeSha === expectedTree,
    'performance acceptance candidate identity mismatch');
  const evidenceEntries = new Map(receipt.sourceFreeze.evidence.entries.map((entry) => [entry.relativePath, entry]));
  for (const descriptor of [receipt.browserReceipt, ...receipt.browserReceipt.artifacts]) {
    const entry = evidenceEntries.get(descriptor.relativePath);
    assert(entry?.sha256 === descriptor.sha256 && entry?.byteLength === descriptor.byteLength, `complete acceptance source freeze omits bound browser evidence ${descriptor.relativePath}`);
  }
  const performanceStep = receipt.steps.find((step) => step?.id === 'local_proxy_performance');
  const browserStep = receipt.steps.find((step) => step?.id === 'browser_receipt');
  assert(performanceStep?.stdoutBytes > 0, 'complete acceptance performance step has no measured command output');
  assert(browserStep?.stdoutSha256 === receipt.browserReceipt.sha256
    && browserStep?.stdoutBytes === receipt.browserReceipt.byteLength, 'complete acceptance browser step is not bound to its measured receipt');

  return Object.freeze({
    receipt,
    receiptPath: receiptFile.absolute,
    receiptSha256: sha256(receiptFile.bytes),
    browserPath: bound.browserFile.absolute,
    browserSha256: sha256(bound.browserFile.bytes),
    performancePath: bound.performanceFile.absolute,
    performanceSha256: sha256(bound.performanceFile.bytes),
  });
}

export function computeGitSourceFreeze({ sourceRoot, revision, protectedOwnerDirectives }) {
  assert(isFullSha(revision), 'candidate revision for source-freeze validation is invalid');
  const root = realpathSync(path.resolve(sourceRoot));
  let rawRows;
  try {
    rawRows = execFileSync('git', ['-C', root, 'ls-tree', '-r', '-z', '--full-tree', revision], { encoding: 'utf8' });
  } catch (error) {
    fail(`candidate source-freeze Git inventory failed: ${error.message}`);
  }
  const treeRows = rawRows.split('\0').filter(Boolean).map((row) => {
    const tab = row.indexOf('\t');
    const metadata = row.slice(0, tab).split(' ');
    assert(tab >= 0 && metadata.length === 3 && metadata[1] === 'blob', 'candidate source-freeze Git row is invalid');
    return { mode: metadata[0], objectSha: metadata[2], relativePath: row.slice(tab + 1) };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  const objectShas = treeRows.map((row) => row.objectSha);
  let batch;
  try {
    batch = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: `${objectShas.join('\n')}\n`,
      encoding: null,
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (error) {
    fail(`candidate source-freeze Git blob read failed: ${error.message}`);
  }
  const blobs = [];
  let offset = 0;
  for (const expectedSha of objectShas) {
    const newline = batch.indexOf(0x0a, offset);
    assert(newline >= 0, 'candidate source-freeze Git blob header is missing');
    const [actualSha, type, sizeText] = batch.subarray(offset, newline).toString('ascii').split(' ');
    const size = Number(sizeText);
    assert(actualSha === expectedSha && type === 'blob' && Number.isSafeInteger(size) && size >= 0, 'candidate source-freeze Git blob header is invalid');
    const start = newline + 1;
    const end = start + size;
    assert(end < batch.length && batch[end] === 0x0a, 'candidate source-freeze Git blob body is invalid');
    blobs.push(batch.subarray(start, end));
    offset = end + 1;
  }
  assert(offset === batch.length, 'candidate source-freeze Git blob response has trailing bytes');
  const inventory = [
    ...treeRows.map((row, index) => ({
      relativePath: row.relativePath,
      kind: row.mode === '120000' ? 'SYMLINK' : 'FILE',
      bytes: blobs[index],
    })),
    ...protectedOwnerDirectives.map((directive) => ({
      relativePath: directive.path,
      kind: 'HASH_PINNED_OWNER_DIRECTIVE',
      bytes: Buffer.from(directive.sha256, 'utf8'),
    })),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  const digest = createHash('sha256');
  for (const entry of inventory) {
    digest.update(`${entry.relativePath}\0${entry.kind}\0`);
    digest.update(entry.bytes);
    digest.update('\0');
  }
  return Object.freeze({
    format: SOURCE_FREEZE_FORMAT,
    fileCount: inventory.length,
    sha256: digest.digest('hex'),
    protectedOwnerDirectives: Object.freeze(protectedOwnerDirectives.map(({ path: directivePath, sha256: directiveSha256 }) => Object.freeze({ path: directivePath, sha256: directiveSha256 }))),
  });
}

export function validateGitSourceFreeze({ sourceRoot, revision, receipt }) {
  const actual = computeGitSourceFreeze({
    sourceRoot,
    revision,
    protectedOwnerDirectives: receipt.source.protectedOwnerDirectives,
  });
  assert(receipt.sourceFreeze.format === actual.format
    && receipt.sourceFreeze.fileCount === actual.fileCount
    && receipt.sourceFreeze.sha256 === actual.sha256, 'complete acceptance sourceFreeze does not match the candidate Git blobs and protected directives');
}
