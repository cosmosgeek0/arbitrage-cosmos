#!/usr/bin/env node
/**
 * Lane B — deterministic canonical read-model proof.
 *
 * Fixtures mirror the existing v0 Decision/EngineProposal vocabulary but are
 * injected through the lane-local ports. There is no engine import, network,
 * wall clock, timer, environment read, or production wiring in this test.
 * Run after: npm run build -w server
 */
import { buildCanonicalReadModel } from '../../../dist/foundation/readModel/index.js';

const results = [];
function check(name, pass, detail = '') {
  const ok = pass === true;
  results.push({ name, pass: ok });
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function json(value) {
  return JSON.stringify(value);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function view(input) {
  const result = buildCanonicalReadModel(input);
  if (!result.ok) throw new Error(`expected view, got ${result.failure.code}: ${result.failure.message}`);
  return result.value;
}

const T0 = 1_750_000_000_000;
const NOW = T0 + 1_000;

function decision(over = {}) {
  return {
    symbol: 'BTCUSDT',
    ts: T0 + 100,
    kind: 'focus',
    rejectCode: null,
    humanReason: 'synthetic focus fixture',
    correlationId: 'cor_basis_tick_1',
    direction: 'long_spot_short_perp',
    netEdgePct: null,
    confidence: null,
    borrowStatus: null,
    evidence: { gapPct: 0.72, baselineReady: true },
    ...over,
  };
}

function proposal(over = {}) {
  return {
    id: 'basis-proposal-1',
    correlationId: 'cor_basis_tick_1',
    symbol: 'BTCUSDT',
    direction: 'long_spot_short_perp',
    createdTs: T0 + 100,
    updatedTs: T0 + 200,
    status: 'open',
    reason: 'synthetic official-shaped proposal fixture',
    netEdgePct: 0.41,
    confidence: 0.82,
    borrowStatus: 'not_needed',
    expiresAtMs: T0 + 60_000,
    sourceLocalRank: 0,
    rejectionReasons: null,
    evidence: { grossEdgePct: 0.72, fundingAdjPct: 0.01 },
    ...over,
  };
}

function snapshot(sourceId, over = {}) {
  return {
    sourceId,
    snapshotTimeMs: T0 + 300,
    receivedAtMs: T0 + 350,
    maxAgeMs: 10_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: 'cfg_synthetic_v1',
    decisions: [],
    proposals: [],
    ...over,
  };
}

function buildInput(over = {}) {
  return {
    nowMs: NOW,
    correlationId: 'cor_read_model_build_1',
    basis: null,
    volume: null,
    ...over,
  };
}

section('1. stable canonical identities');
{
  const d = decision();
  const p = proposal();
  const a = view(buildInput({ basis: snapshot('engine.basis.snapshot', { decisions: [d], proposals: [p] }) }));
  const b = view(buildInput({ basis: snapshot('engine.basis.snapshot', { decisions: [clone(d)], proposals: [clone(p)] }) }));
  check('decision canonical ID reproduces', a.basis.decisions[0].canonicalId === b.basis.decisions[0].canonicalId);
  check('proposal canonical ID reproduces', a.basis.proposals[0].canonicalId === b.basis.proposals[0].canonicalId);
  check('canonical ID namespaces are explicit', a.basis.decisions[0].canonicalId.startsWith('cdec_') && a.basis.proposals[0].canonicalId.startsWith('cprop_'));
  check('proposal source ID is preserved verbatim', a.basis.proposals[0].sourceId === p.id);
  check('decision semantic source key is stable', a.basis.decisions[0].sourceId === `${d.correlationId}|${d.symbol}|${d.ts}|${d.kind}`);
}

section('1b. supplied decision facts survive without cross-strategy derivation');
{
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      decisions: [decision({
        correlationId: 'cor_basis_known_facts',
        direction: 'short_spot_long_perp',
        netEdgePct: 0.37,
        confidence: null,
        borrowStatus: 'available',
      })],
    }),
    volume: snapshot('engine.volume.snapshot', {
      decisions: [decision({
        correlationId: 'cor_volume_known_facts',
        direction: 'long',
        netEdgePct: null,
        confidence: 0.73,
        borrowStatus: 'not_needed',
      })],
    }),
  }));
  const basis = built.basis.decisions[0];
  const volume = built.volume.decisions[0];
  check('Basis direction is preserved verbatim', basis.direction === 'short_spot_long_perp');
  check('Basis edge and borrow state are preserved when supplied', basis.netEdgePct === 0.37 && basis.borrowState === 'available');
  check('Volume direction is preserved verbatim', volume.direction === 'long');
  check('Volume confidence is preserved when supplied', volume.confidence === 0.73);
}

section('2. exact duplicates collapse and reconcile');
{
  const d = decision();
  const p = proposal();
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      decisions: [d, clone(d)],
      proposals: [p, clone(p)],
    }),
  }));
  check('duplicate decisions collapse to one', built.basis.decisions.length === 1);
  check('duplicate proposals collapse to one', built.basis.proposals.length === 1);
  check('both duplicates are counted exactly', built.basis.reconciliation.duplicateDecisions === 1 && built.basis.reconciliation.duplicateProposals === 1);
  check('exact duplicates are not rejection failures', built.basis.rejects.length === 0);
}

section('3. distinct proposals are never merged');
{
  const p1 = proposal({ id: 'basis-proposal-A' });
  const p2 = proposal({ id: 'basis-proposal-B' });
  const built = view(buildInput({ basis: snapshot('engine.basis.snapshot', { proposals: [p1, p2] }) }));
  const sourceIds = built.basis.proposals.map((p) => p.sourceId).sort();
  check('same-symbol proposals with distinct source IDs both survive', built.basis.proposals.length === 2);
  check('distinct source IDs remain verbatim', json(sourceIds) === json(['basis-proposal-A', 'basis-proposal-B']));
  check('distinct proposals get distinct canonical IDs', new Set(built.basis.proposals.map((p) => p.canonicalId)).size === 2);
}

section('4. child input is not mutated or frozen');
{
  const inputEvidence = { nested: { levels: [1, 2, 3] }, knownZero: 0 };
  const input = buildInput({ basis: snapshot('engine.basis.snapshot', { proposals: [proposal({ evidence: inputEvidence })] }) });
  const before = json(input);
  const built = view(input);
  const outputEvidence = built.basis.proposals[0].evidence;
  check('input bytes are unchanged', json(input) === before);
  check('input evidence ownership is untouched', !Object.isFrozen(inputEvidence) && !Object.isFrozen(inputEvidence.nested));
  check('output evidence is a non-aliasing copy', outputEvidence !== inputEvidence && outputEvidence.nested !== inputEvidence.nested);
  check('canonical output is deeply immutable', Object.isFrozen(built) && Object.isFrozen(outputEvidence) && Object.isFrozen(outputEvidence.nested.levels));
}

section('5. absent facts remain explicitly unknown');
{
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      decisions: [decision({ direction: null, rejectCode: null, evidence: null })],
      proposals: [proposal({
        id: 'unknown-facts',
        netEdgePct: null,
        confidence: null,
        borrowStatus: null,
        expiresAtMs: null,
        sourceLocalRank: null,
        rejectionReasons: null,
        evidence: null,
      }), proposal({ id: 'known-zero', netEdgePct: 0 })],
    }),
  }));
  const d = built.basis.decisions[0];
  const unknown = built.basis.proposals.find((p) => p.sourceId === 'unknown-facts');
  const zero = built.basis.proposals.find((p) => p.sourceId === 'known-zero');
  check('missing decision direction remains UNKNOWN', d.direction === 'UNKNOWN');
  check('missing decision edge/confidence/borrow stay unknown', d.netEdgePct === null && d.confidence === null && d.borrowState === 'UNKNOWN');
  check('optional numeric facts remain null', unknown.netEdgePct === null && unknown.confidence === null && unknown.sourceLocalRank === null);
  check('missing borrow state remains UNKNOWN', unknown.borrowState === 'UNKNOWN');
  check('missing expiry and evidence remain null', unknown.expiresAtMs === null && unknown.evidence === null);
  check('known zero edge is preserved as zero', zero.netEdgePct === 0);
  check('no cross-strategy score is invented', !('score' in unknown) && !('score' in built));
}

section('6. freshness is isolated per source');
{
  const nowMs = T0 + 20_000;
  const built = view(buildInput({
    nowMs,
    basis: snapshot('engine.basis.snapshot', {
      snapshotTimeMs: T0,
      receivedAtMs: T0 + 10,
      maxAgeMs: 500,
      proposals: [proposal({ id: 'stale-basis' })],
    }),
    volume: snapshot('engine.volume.snapshot', {
      snapshotTimeMs: nowMs - 100,
      receivedAtMs: nowMs - 50,
      maxAgeMs: 500,
      proposals: [proposal({ id: 'healthy-volume', direction: 'long', correlationId: 'cor_volume_tick_1' })],
    }),
  }));
  check('Basis source is independently stale', built.basis.freshness.state === 'STALE' && built.basis.freshness.effectiveAuthority === 'UNAVAILABLE');
  check('Volume source remains independently fresh', built.volume.freshness.state === 'FRESH' && built.volume.freshness.effectiveAuthority === 'SYNTHETIC_TEST');
  check('stale visibility does not hide healthy Volume', built.volume.proposals.length === 1 && built.ordered.some((r) => r.sourceId === 'healthy-volume'));
}

section('7. source disappearance is explicit');
{
  const built = view(buildInput({
    basis: null,
    volume: snapshot('engine.volume.snapshot', { decisions: [decision({ correlationId: 'cor_volume_tick_1', direction: 'long' })] }),
  }));
  check('declared missing Basis is ABSENT', built.basis.presence === 'ABSENT' && built.basis.snapshotTimestamp === null);
  check('present Volume remains visible', built.volume.presence === 'PRESENT' && built.volume.decisions.length === 1);

  const undeclared = buildCanonicalReadModel({
    nowMs: NOW,
    correlationId: 'cor_missing_source',
    volume: null,
  });
  check('omitted source is a named failure', !undeclared.ok && undeclared.failure.code === 'SOURCE_PRESENCE_UNDECLARED');
  check('omission never masquerades as an empty source', !undeclared.ok && undeclared.failure.safeCurrentState === 'READ_MODEL_NOT_BUILT');
}

section('8. malformed timestamps fail closed without cross-source loss');
{
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', { decisions: [decision({ ts: T0 + 0.5 })] }),
    volume: snapshot('engine.volume.snapshot', { proposals: [proposal({ id: 'volume-ok', direction: 'long' })] }),
  }));
  check('malformed record time is rejected by name', built.basis.rejects.length === 1 && built.basis.rejects[0].code === 'MALFORMED_TIMESTAMP');
  check('malformed record never enters canonical output', built.basis.decisions.length === 0);
  check('record rejection reconciles exactly', built.basis.reconciliation.rejectedDecisions === 1 && built.basis.reconciliation.balanced);
  check('other source survives record rejection', built.volume.proposals.length === 1);

  const badSnapshot = view(buildInput({
    basis: snapshot('engine.basis.snapshot', { snapshotTimeMs: -1, proposals: [proposal()] }),
    volume: snapshot('engine.volume.snapshot'),
  }));
  check('malformed snapshot time marks only that source INVALID', badSnapshot.basis.presence === 'INVALID' && badSnapshot.basis.failure.code === 'SNAPSHOT_PROVENANCE_INVALID');
  check('invalid snapshot records are explicitly rejected', badSnapshot.basis.rejects.length === 1 && badSnapshot.basis.reconciliation.rejectedProposals === 1);
  check('healthy sibling source is still PRESENT', badSnapshot.volume.presence === 'PRESENT');
}

section('9. every input record reconciles to canonical, duplicate, or rejected');
{
  const goodDecision = decision({ correlationId: 'cor_count_good' });
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      decisions: [goodDecision, clone(goodDecision), decision({ correlationId: 'cor_count_bad', ts: Number.NaN })],
      proposals: [proposal({ id: 'count-p1' }), proposal({ id: 'count-p2' })],
    }),
    volume: snapshot('engine.volume.snapshot', {
      decisions: [decision({ correlationId: 'cor_count_volume', direction: 'long' })],
      proposals: [proposal({ id: 'count-invalid-evidence', evidence: undefined })],
    }),
  }));
  const b = built.basis.reconciliation;
  const v = built.volume.reconciliation;
  check('Basis decision counts balance 3 = 1 + 1 + 1', b.inputDecisions === 3 && b.canonicalDecisions === 1 && b.duplicateDecisions === 1 && b.rejectedDecisions === 1);
  check('Basis proposal counts balance 2 = 2 + 0 + 0', b.inputProposals === 2 && b.canonicalProposals === 2 && b.duplicateProposals === 0 && b.rejectedProposals === 0);
  check('Volume counts balance 2 = 1 + 0 + 1', v.inputDecisions === 1 && v.canonicalDecisions === 1 && v.inputProposals === 1 && v.rejectedProposals === 1);
  check('missing evidence is rejected, never coerced to null', built.volume.rejects[0].code === 'EVIDENCE_INVALID');
  check('global counts balance 7 = 4 + 1 + 2', built.reconciliation.inputRecords === 7 && built.reconciliation.canonicalRecords === 4 && built.reconciliation.duplicateRecords === 1 && built.reconciliation.rejectedRecords === 2);
  check('all reconciliation flags are true', b.balanced && v.balanced && built.reconciliation.balanced);
}

section('10. ordering is deterministic and uses no quality score');
{
  const decisions = [
    decision({ correlationId: 'cor_closed', kind: 'ignore', direction: null }),
    decision({ correlationId: 'cor_rejected', kind: 'reject', rejectCode: 'risk_blocked', direction: null }),
  ];
  const proposals = [
    proposal({ id: 'order-rank-3', sourceLocalRank: 3, status: 'open' }),
    proposal({ id: 'order-expired', sourceLocalRank: 0, status: 'expired' }),
    proposal({ id: 'order-rank-1', sourceLocalRank: 1, status: 'open' }),
  ];
  const a = view(buildInput({ basis: snapshot('engine.basis.snapshot', { decisions, proposals }) }));
  const b = view(buildInput({ basis: snapshot('engine.basis.snapshot', { decisions: [...decisions].reverse(), proposals: [...proposals].reverse() }) }));
  check('shuffled inputs produce byte-identical canonical ordering', json(a.ordered) === json(b.ordered));
  check('OPEN source-local rank 1 precedes rank 3', a.ordered.findIndex((r) => r.sourceId === 'order-rank-1') < a.ordered.findIndex((r) => r.sourceId === 'order-rank-3'));
  check('lifecycle order is OPEN then EXPIRED then REJECTED then CLOSED', json(a.ordered.map((r) => r.lifecycle)) === json(['OPEN', 'OPEN', 'EXPIRED', 'REJECTED', 'CLOSED']));
  check('edge and confidence never participate in a generated score', a.ordered.every((r) => !('score' in r)));
}

section('11. source-local ranks never become cross-strategy ranks');
{
  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      proposals: [proposal({ id: 'basis-rank-9', sourceLocalRank: 9 }), proposal({ id: 'basis-rank-1', sourceLocalRank: 1 })],
    }),
    volume: snapshot('engine.volume.snapshot', {
      proposals: [proposal({ id: 'volume-rank-0', direction: 'long', correlationId: 'cor_volume_rank', sourceLocalRank: 0 })],
    }),
  }));
  check('records are source-grouped before local rank comparison', json(built.ordered.map((r) => r.source)) === json(['BASIS', 'BASIS', 'VOLUME']));
  check('Basis ranks order only the Basis slice', json(built.ordered.map((r) => r.sourceId)) === json(['basis-rank-1', 'basis-rank-9', 'volume-rank-0']));
  check('local rank values are preserved verbatim', json(built.ordered.map((r) => r.sourceLocalRank)) === json([1, 9, 0]));
}

section('12. authority, observation time, expiry, evidence, and config provenance survive');
{
  const built = view(buildInput({
    nowMs: T0 + 900,
    basis: snapshot('recorded.basis.replay', {
      snapshotTimeMs: T0 + 400,
      receivedAtMs: T0 + 450,
      maxAgeMs: 2_000,
      authority: 'RECORDED_REPLAY',
      completeness: 'PARTIAL',
      configVersion: 'cfg_basis_recorded_7',
      proposals: [proposal({ id: 'provenance-proposal', updatedTs: T0 + 333, expiresAtMs: T0 + 9_999, evidence: { childFact: 'verbatim' } })],
    }),
  }));
  const p = built.basis.proposals[0];
  check('source event time is not overwritten by receipt/evaluation time', p.observedAt.sourceTimeMs === T0 + 333 && p.observedAt.receivedAtMs === T0 + 450);
  check('authority and completeness are preserved', p.observedAt.authority === 'RECORDED_REPLAY' && p.observedAt.completeness === 'PARTIAL');
  check('source identity and age budget are preserved', p.observedAt.sourceId === 'recorded.basis.replay' && p.observedAt.maxAgeMs === 2_000);
  check('expiry, child evidence, and config version are preserved', p.expiresAtMs === T0 + 9_999 && p.evidence.childFact === 'verbatim' && p.configVersion === 'cfg_basis_recorded_7');
  check('snapshot provenance remains separately visible', built.basis.snapshotTimestamp.sourceTimeMs === T0 + 400 && built.basis.freshness.basis === 'SOURCE_TIME');
}

section('13. exact-ID conflicts and unsafe evidence fail closed');
{
  const p1 = proposal({ id: 'same-id' });
  const p2 = proposal({ id: 'same-id', reason: 'different child reason' });
  const p3 = proposal({ id: 'same-id', createdTs: T0 + 101 });
  const p4 = proposal({ id: 'same-id', correlationId: 'cor_different_source_path' });
  const conflict = view(buildInput({ basis: snapshot('engine.basis.snapshot', { proposals: [p1, p2, p3, p4] }) }));
  check('same ID with different content is not mistaken for a duplicate', conflict.basis.proposals.length === 0 && conflict.basis.reconciliation.duplicateProposals === 0);
  check('dropped proposal fields still participate in exact equivalence', conflict.basis.rejects.length === 4 && conflict.basis.rejects.every((r) => r.code === 'CANONICAL_ID_CONFLICT'));
  check('proposal conflict counts still reconcile', conflict.basis.reconciliation.rejectedProposals === 4 && conflict.basis.reconciliation.balanced);

  const decisionConflict = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      decisions: [decision({ humanReason: 'reason A' }), decision({ humanReason: 'reason B' })],
    }),
  }));
  check('dropped decision reason prevents false exact deduplication', decisionConflict.basis.decisions.length === 0 && decisionConflict.basis.rejects.length === 2);
  check('decision reason conflict is named and balanced', decisionConflict.basis.rejects.every((r) => r.code === 'CANONICAL_ID_CONFLICT') && decisionConflict.basis.reconciliation.balanced);

  const protoEvidence = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const safe = view(buildInput({ basis: snapshot('engine.basis.snapshot', { proposals: [proposal({ id: 'proto-safe', evidence: protoEvidence })] }) }));
  const copied = safe.basis.proposals[0].evidence;
  check('special evidence keys remain own data without prototype mutation', Object.getPrototypeOf(copied) === null && Object.prototype.hasOwnProperty.call(copied, '__proto__') && copied.__proto__.polluted === true);

  const accessorEvidence = {};
  Object.defineProperty(accessorEvidence, 'hiddenGetter', { enumerable: true, get: () => 1 });
  const unsafe = view(buildInput({ basis: snapshot('engine.basis.snapshot', { proposals: [proposal({ id: 'accessor-rejected', evidence: accessorEvidence })] }) }));
  check('accessor evidence is rejected as non-plain data', unsafe.basis.proposals.length === 0 && unsafe.basis.rejects[0].code === 'EVIDENCE_INVALID');

  const sparseLevels = new Array(2);
  sparseLevels[0] = 1;
  const sparseEvidence = view(buildInput({
    basis: snapshot('engine.basis.snapshot', {
      proposals: [proposal({ id: 'sparse-evidence-rejected', evidence: { levels: sparseLevels } })],
    }),
  }));
  check('sparse evidence arrays are rejected, never converted to null slots', sparseEvidence.basis.proposals.length === 0 && sparseEvidence.basis.rejects[0].code === 'EVIDENCE_INVALID');
}

section('14. sparse record arrays become named rejects and reconcile');
{
  const decisions = new Array(3);
  decisions[0] = decision({ correlationId: 'cor_sparse_d0' });
  decisions[2] = decision({ correlationId: 'cor_sparse_d2' });
  const proposals = new Array(2);
  proposals[1] = proposal({ id: 'sparse-p1' });

  const built = view(buildInput({
    basis: snapshot('engine.basis.snapshot', { decisions, proposals }),
  }));
  check('sparse decision slot is a named record rejection', built.basis.decisions.length === 2 && built.basis.reconciliation.rejectedDecisions === 1);
  check('sparse proposal slot is a named record rejection', built.basis.proposals.length === 1 && built.basis.reconciliation.rejectedProposals === 1);
  check('both sparse slots use PORT_RECORD_INVALID', built.basis.rejects.length === 2 && built.basis.rejects.every((r) => r.code === 'PORT_RECORD_INVALID'));
  check('sparse array lengths reconcile exactly', built.basis.reconciliation.inputDecisions === 3 && built.basis.reconciliation.inputProposals === 2 && built.basis.reconciliation.balanced);
  check('global sparse counts reconcile', built.reconciliation.inputRecords === 5 && built.reconciliation.canonicalRecords === 3 && built.reconciliation.rejectedRecords === 2 && built.reconciliation.balanced);
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} checks passed${failed ? `; ${failed} FAILED` : ''}.`);
if (failed > 0) process.exit(1);
