import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLASSIFICATIONS,
  ENTRY_GATE_PATH,
  EXPECTED_INSERTION_REQUEST_IDS,
  INSERTION_REQUESTS_PATH,
  hasIssue,
  listShadowFiles,
  loadJson,
  validateEntryGate,
  validateGitBindings,
  validateInsertionRequests,
  validateWorkingTreeScope,
} from './contract.mjs';

const entryGate = loadJson(ENTRY_GATE_PATH);
const insertionRequests = loadJson(INSERTION_REQUESTS_PATH);

test('entry gate classifies every proposed item with the exact five-value vocabulary', () => {
  assert.deepEqual(validateEntryGate(entryGate), []);
  assert.deepEqual([...entryGate.classificationVocabulary].sort(), [...CLASSIFICATIONS].sort());
  assert.equal(entryGate.rows.length, 14);
  assert.equal(new Set(entryGate.rows.map((row) => row.id)).size, 14);
});

test('entry gate binds the exact base, accepted donor, donor parent, trees, and branch', () => {
  assert.deepEqual(validateGitBindings(entryGate), []);
});

test('only MISSING_BUILD and ADAPT_EXISTING rows have packet build paths', () => {
  for (const row of entryGate.rows) {
    const buildable = row.classification === 'MISSING_BUILD' || row.classification === 'ADAPT_EXISTING';
    assert.equal(row.shadowBuildPaths.length > 0, buildable, row.id);
  }
});

test('operational owners are adopted while new operational copies are rejected', () => {
  const byId = new Map(entryGate.rows.map((row) => [row.id, row]));
  for (const id of [
    'OPS-SYSTEMD-UNITS',
    'OPS-WATCHDOG',
    'OPS-BACKUP',
    'OPS-RESTORE-ISOLATED',
    'OPS-ROLLBACK',
    'OPS-CLOUDFLARE',
    'OPS-SECRETS-IAM',
    'OPS-SECRETS-PROVIDER',
  ]) assert.equal(byId.get(id).classification, 'ADOPT_EXISTING', id);
  assert.equal(byId.get('OPS-RESTORE-PRODUCTION').classification, 'REFERENCE_ONLY');
  assert.equal(byId.get('OPS-NEW-OPERATIONAL-OWNER').classification, 'REJECT_DUPLICATE');
});

test('hostile classification outside the vocabulary fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows[0].classification = 'READY';
  assert(hasIssue(validateEntryGate(hostile), 'CLASSIFICATION_INVALID'));
  assert(hasIssue(validateEntryGate(hostile), 'CLASSIFICATION_RULING_MISMATCH'));
});

test('hostile build path on an adopted row fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows.find((row) => row.id === 'OPS-WATCHDOG').shadowBuildPaths = ['fixtures/opsShadow/watchdog.sh'];
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'NON_BUILDABLE_ROW_HAS_PATH'));
  assert(hasIssue(issues, 'OPERATIONAL_TEMPLATE_COPY_FORBIDDEN'));
});

test('hostile out-of-scope build path fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows.find((row) => row.id === 'OPS-RUN16-CONFORMANCE').shadowBuildPaths.push('ops/live/new-owner.sh');
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'BUILD_PATH_OUTSIDE_EXCLUSIVE_SCOPE'));
  assert(hasIssue(issues, 'OPERATIONAL_TEMPLATE_COPY_FORBIDDEN'));
});

test('missing classification row fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.rows.pop();
  assert(hasIssue(validateEntryGate(hostile), 'CLASSIFICATION_ROW_SET_INVALID'));
});

test('wrong base or donor binding fails closed', () => {
  const hostile = structuredClone(entryGate);
  hostile.base.sha = '0'.repeat(40);
  hostile.donor.opsLiveTree = '1'.repeat(40);
  const issues = validateEntryGate(hostile);
  assert(hasIssue(issues, 'BASE_BINDING_MISMATCH'));
  assert(hasIssue(issues, 'DONOR_BINDING_MISMATCH'));
});

test('insertion requests remain the exact draft reference-only set', () => {
  assert.deepEqual(validateInsertionRequests(insertionRequests), []);
  assert.deepEqual(insertionRequests.requests.map((request) => request.id).sort(), [...EXPECTED_INSERTION_REQUEST_IDS].sort());
});

test('applied insertion request or weakened production restore request fails closed', () => {
  const applied = structuredClone(insertionRequests);
  applied.requestsApplied = true;
  assert(hasIssue(validateInsertionRequests(applied), 'INSERTION_AUTHORITY_FORBIDDEN'));

  const weakened = structuredClone(insertionRequests);
  weakened.requests.find((request) => request.id === 'OPS-SHADOW-IR-RESTORE-001').request = 'copy database into place';
  const issues = validateInsertionRequests(weakened);
  assert(hasIssue(issues, 'INSERTION_REQUEST_INCOMPLETE'));
  assert(hasIssue(issues, 'RESTORE_INSERTION_INCOMPLETE'));
});

test('all packet files are regular metadata or test modules under exclusive roots', () => {
  const files = listShadowFiles();
  assert(files.length >= 8);
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
