import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../../../fixtures/productAssurance/systemic/assuranceCase');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

test('research basis records current primary sources and packet interpretations', () => {
  const research = read('RESEARCH_BASIS.md');
  for (const source of [
    'https://www.omg.org/spec/SACM',
    'https://doi.org/10.6028/NIST.SP.800-160v1r1',
    'https://standards.nasa.gov/standard/nasa/nasa-std-87398',
    'https://ntrs.nasa.gov/citations/20250002210',
    'https://www.npsa.gov.uk/security-best-practices/assurance',
    'https://www.hse.gov.uk/comah/sragtech/techmeascontsyst.htm',
  ]) assert(research.includes(source), source);
  assert(research.includes('Research checked: **2026-07-14**'));
  assert(research.includes('producer and verifier actors must differ'));
  assert(research.includes('never writes S1'));
});

test('safety catalog draft enumerates every mandatory claim exactly once', () => {
  const draft = read('generated/SAFETY_INVARIANT_CATALOG_ROWS.DRAFT.md');
  for (let number = 1; number <= 13; number += 1) {
    const claimId = `PA-S4-CLAIM-${String(number).padStart(3, '0')}`;
    assert.equal(draft.split(claimId).length - 1, 1, claimId);
  }
  assert(draft.includes('Status: `DRAFT`'));
  assert(draft.includes('authorityEffect=NONE'));
  for (const row of draft.split('\n').filter((line) => line.startsWith('| `PA-S4-CLAIM-'))) {
    assert(row.includes('| `EXTENDED` |'), row);
  }
});

test('telemetry and closure drafts remain packet-only and honest', () => {
  const coverage = read('generated/TELEMETRY_COVERAGE_MATRIX_ROWS.DRAFT.md');
  const closure = read('generated/AUTONOMY_CLOSURE_REPORT_ROWS.DRAFT.md');
  assert(coverage.includes('S1 read-only input; fan-in pending'));
  assert(coverage.includes('no telemetry producer, exporter, store, socket, or supervisor'));
  assert(closure.includes('`ABSENT_BY_DESIGN`'));
  assert(closure.includes('`MISSING_OWNER_INTEGRATION`'));
  assert(closure.includes('No row claims `INTEGRATED`, `LIVE`, `DEPLOYED_PROVED`, or `I00_ACCEPTED`.'));
  for (const row of [...coverage.split('\n'), ...closure.split('\n')].filter((line) => line.startsWith('| `PA-S4-'))) {
    assert(row.includes('| `EXTENDED` |'), row);
  }
});

test('insertion requests name existing owners and do not self-authorize', () => {
  const draft = read('generated/ASSURANCE_INSERTION_REQUEST.DRAFT.md');
  assert(draft.includes('director-owned fan-in requests'));
  assert(draft.includes('`MISSING_OWNER_INTEGRATION`'));
  assert(draft.includes('`EXTERNAL_CONFIGURATION`'));
  assert(draft.includes('without changing S1 reverse links'));
  assert(draft.includes('Do not recompute or mount this fixture module.'));
  for (const row of draft.split('\n').filter((line) => line.startsWith('| `PA-S4-'))) {
    assert(row.includes('| `EXTENDED` |'), row);
  }
});

test('packet state records only an allowed S4 lifecycle word', () => {
  const state = read('state/CASE_STATE.md');
  assert.match(state, /State: \*\*CASE_(?:IMPLEMENTED_AWAITING_FULL_LOOP|PRESTAGE_READY)\*\*/);
  assert(state.includes('SYNTHETIC_ONLY'));
  assert(state.includes('Authority effect | `NONE`'));
  assert(state.includes('No production, shared, Q/L, package, UI, runtime, or other satellite file was written.'));
});
