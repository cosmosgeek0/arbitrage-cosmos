import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLASSIFICATIONS,
  ENTRY_GATE_PATH,
  EXPECTED_IMPLEMENTATION_PATHS,
  EXPECTED_INSERTION_REQUEST_IDS,
  INSERTION_REQUESTS_PATH,
  PORT_RECEIPT_PATH,
  SOURCE_RECEIPT_PATH,
  hasIssue,
  listPacketFiles,
  loadJson,
  validateEntryGate,
  validateGitBindings,
  validateHistoricalSourceReceipt,
  validateHistoricalSourceReceiptBytes,
  validateInsertionRequests,
  validateWorkingTreeScope,
} from './contract.mjs';

const entryGate = loadJson(ENTRY_GATE_PATH);
const insertionRequests = loadJson(INSERTION_REQUESTS_PATH);
const sourceReceipt = loadJson(SOURCE_RECEIPT_PATH);

test('real port entry gate classifies all fourteen items with the exact vocabulary', () => {
  assert.deepEqual(validateEntryGate(entryGate), []);
  assert.deepEqual([...entryGate.classificationVocabulary].sort(), [...CLASSIFICATIONS].sort());
  assert.equal(entryGate.rows.length, 14);
  assert.equal(new Set(entryGate.rows.map((row) => row.id)).size, 14);
});

test('port gate binds exact landed base, sealed source, donor, corrections, registry, and branch', () => {
  assert.deepEqual(validateGitBindings(entryGate), []);
});

test('shadow receipt is byte-identical historical provenance and transfers no acceptance', () => {
  assert.deepEqual(validateHistoricalSourceReceipt(sourceReceipt), []);
  assert.deepEqual(validateHistoricalSourceReceiptBytes(), []);
  assert.equal(entryGate.sourceShadow.receiptUse, 'HISTORICAL_PROVENANCE_ONLY');
  assert.equal(entryGate.sourceShadow.acceptanceTransferred, false);
});

test('only missing or adapted rows build and every build path stays packet-local', () => {
  for (const row of entryGate.rows) {
    const buildable = row.classification === 'MISSING_BUILD' || row.classification === 'ADAPT_EXISTING';
    assert.equal(row.portBuildPaths.length > 0, buildable, row.id);
    for (const path of row.portBuildPaths) assert.match(path, /^(?:fixtures|test)\/opsShadow\//u, row.id);
  }
});

test('current watchdog and restore corrections are adapted while duplicate owners are rejected', () => {
  const byId = new Map(entryGate.rows.map((row) => [row.id, row]));
  assert.equal(byId.get('OPS-WATCHDOG').classification, 'ADAPT_EXISTING');
  assert.equal(byId.get('OPS-RESTORE-ISOLATED').classification, 'ADAPT_EXISTING');
  assert.equal(byId.get('OPS-RESTORE-PRODUCTION').classification, 'REFERENCE_ONLY');
  assert.equal(byId.get('OPS-NEW-OPERATIONAL-OWNER').classification, 'REJECT_DUPLICATE');
  assert(entryGate.dedupEvidence.some((entry) => entry.id === 'OPS-PORT-PLAN-DESTINATION' && entry.disposition === 'REJECT_DUPLICATE'));
});

test('hostile classification and missing row fail closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows[0].classification = 'READY';
  hostile.rows.pop();
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'CLASSIFICATION_INVALID'));
  assert(hasIssue(issues, 'CLASSIFICATION_RULING_MISMATCH'));
  assert(hasIssue(issues, 'CLASSIFICATION_ROW_SET_INVALID'));
});

test('stale planner A5 destination and operational template copy fail closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows.find((row) => row.id === 'OPS-RUN16-CONFORMANCE').portBuildPaths.push(
    'fixtures/aiOps/a5/ops/copied-owner.json',
    'ops/live/new-owner.sh',
  );
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'BUILD_PATH_OUTSIDE_EXCLUSIVE_SCOPE'));
  assert(hasIssue(issues, 'OPERATIONAL_TEMPLATE_COPY_FORBIDDEN'));
});

test('hostile acceptance transfer, base, donor, or amendment binding fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.sourceShadow.acceptanceTransferred = true;
  hostile.portBase.sha = '0'.repeat(40);
  hostile.operationalOwner.immutableDonor.acceptedOpsLiveTree = '1'.repeat(40);
  hostile.operationalOwner.authorizedAmendments.effectiveOpsLiveTree = '2'.repeat(40);
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'SOURCE_SHADOW_BINDING_MISMATCH'));
  assert(hasIssue(issues, 'BASE_BINDING_MISMATCH'));
  assert(hasIssue(issues, 'DONOR_BINDING_MISMATCH'));
  assert(hasIssue(issues, 'AMENDMENT_BINDING_MISMATCH'));
});

test('typed insertion handoff is the exact draft registry row set', () => {
  assert.deepEqual(validateInsertionRequests(insertionRequests), []);
  assert.deepEqual(insertionRequests.rows.map((row) => row.rowId).sort(), [...EXPECTED_INSERTION_REQUEST_IDS].sort());
});

test('typed insertion values remain exact to the immutable pinned registry', () => {
  const hostile = structuredClone(insertionRequests);
  hostile.rows[0].tests[0] = 'Plausible but paraphrased validation text.';
  assert(hasIssue(validateInsertionRequests(hostile), 'INSERTION_ROW_REGISTRY_VALUE_MISMATCH'));
});

test('applied, authoritative, miswired, or untyped insertion row fails closed', () => {
  const hostile = structuredClone(insertionRequests);
  hostile.requestsApplied = true;
  hostile.rows[0].status = 'APPLIED';
  hostile.rows[0].authorityCreated = true;
  hostile.rows[0].wiringState = 'READY';
  hostile.rows[0].controlDraft = { forbidden: true };
  const issues = validateInsertionRequests(hostile);
  assert(hasIssue(issues, 'INSERTION_AUTHORITY_FORBIDDEN'));
  assert(hasIssue(issues, 'INSERTION_ROW_SHAPE_INVALID'));
  assert(hasIssue(issues, 'INSERTION_REQUEST_STATUS_INVALID'));
  assert(hasIssue(issues, 'INSERTION_WIRING_STATE_INVALID'));
});

test('unknown registry row in a source disposition fails closed', () => {
  const hostile = structuredClone(insertionRequests);
  hostile.sourceRequestDispositions[0].registryRowIds = ['AIOPS-IR-FABRICATED-999'];
  assert(hasIssue(validateInsertionRequests(hostile), 'SOURCE_DISPOSITION_REGISTRY_ROW_INVALID'));
});

test('known but misassigned registry row in a source disposition fails closed', () => {
  const hostile = structuredClone(insertionRequests);
  hostile.sourceRequestDispositions[0].registryRowIds = ['AIOPS-IR-TEST-MOUNT-026'];
  assert(hasIssue(validateInsertionRequests(hostile), 'SOURCE_DISPOSITION_RULING_MISMATCH'));
});

test('all lane files are the exact ten implementation files plus only the optional receipt seal', () => {
  const files = listPacketFiles();
  const paths = files.map((entry) => entry.path);
  const byPath = (left, right) => left.localeCompare(right);
  const expectedWithoutReceipt = [...EXPECTED_IMPLEMENTATION_PATHS].sort(byPath);
  const expectedWithReceipt = [...EXPECTED_IMPLEMENTATION_PATHS, PORT_RECEIPT_PATH].sort(byPath);
  assert(
    JSON.stringify(paths) === JSON.stringify(expectedWithoutReceipt)
      || JSON.stringify(paths) === JSON.stringify(expectedWithReceipt),
    `unexpected packet path set: ${paths.join(', ')}`,
  );
  for (const entry of files) {
    assert.equal(entry.kind, 'file', entry.path);
    assert.match(entry.path, /^(?:fixtures|test)\/opsShadow\//u);
    if (entry.path.startsWith('fixtures/')) assert.match(entry.path, /\.json$/u);
    if (entry.path.startsWith('test/')) assert.match(entry.path, /\.mjs$/u);
    assert.doesNotMatch(entry.path, /\.(?:service|timer|sh|ya?ml|template)$/u);
  }
});

test('working tree has no change outside the two exclusive roots', () => {
  assert.deepEqual(validateWorkingTreeScope(), []);
});
