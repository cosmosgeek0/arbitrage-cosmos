import {
  makeStableFailure,
  sortedUnique,
  type EvidenceKind,
  type NormalizedEvidence,
  type SequenceRange,
  type StableFailure,
} from '../contracts/index.js';
import type { EvidenceSetAssessment, SequenceCursor } from './types.js';

export type SequenceAssessment =
  | { state: 'OK'; failure: null }
  | { state: 'GAP'; failure: StableFailure }
  | { state: 'DUPLICATE' | 'OUT_OF_ORDER'; failure: StableFailure };

export function assessSequence(
  sequence: SequenceRange,
  cursor: SequenceCursor | null | undefined,
  sourceRecordId: string,
  component = 'evidence.sequence',
  semantics: 'CONTIGUOUS' | 'MONOTONIC_CURSOR' = 'CONTIGUOUS',
): SequenceAssessment {
  if (!cursor) return { state: 'OK', failure: null };
  if (cursor.recentSourceRecordIds?.includes(sourceRecordId)) {
    return {
      state: 'DUPLICATE',
      failure: makeStableFailure('DUPLICATE_EVENT', component, 'source record was already observed', 'sourceRecordId'),
    };
  }

  if (!/^\d+$/.test(cursor.last)) {
    return {
      state: 'OUT_OF_ORDER',
      failure: makeStableFailure('INVALID_VALUE', component, 'sequence cursor must be a decimal string', 'previousSequence.last'),
    };
  }

  const cursorLast = BigInt(cursor.last);
  const first = BigInt(sequence.first);
  const last = BigInt(sequence.last);
  if (last < cursorLast) {
    return {
      state: 'OUT_OF_ORDER',
      failure: makeStableFailure('OUT_OF_ORDER_EVENT', component, 'event ends before the accepted sequence cursor', 'sequence.last'),
    };
  }
  if (last === cursorLast) {
    return {
      state: 'DUPLICATE',
      failure: makeStableFailure('DUPLICATE_EVENT', component, 'event does not advance the accepted sequence cursor', 'sequence.last'),
    };
  }

  // bookTicker update IDs advance monotonically but are not a contiguous event sequence.
  if (semantics === 'MONOTONIC_CURSOR') return { state: 'OK', failure: null };

  if (sequence.previous !== null) {
    const previous = BigInt(sequence.previous);
    if (previous < cursorLast) {
      return {
        state: 'OUT_OF_ORDER',
        failure: makeStableFailure('OUT_OF_ORDER_EVENT', component, 'event previous-update link trails the accepted sequence cursor', 'sequence.previous'),
      };
    }
    if (previous > cursorLast) {
      return {
        state: 'GAP',
        failure: makeStableFailure('SEQUENCE_GAP', component, 'event previous-update link skips the accepted sequence cursor', 'sequence.previous'),
      };
    }
  }

  if (first > cursorLast + 1n) {
    return {
      state: 'GAP',
      failure: makeStableFailure('SEQUENCE_GAP', component, 'event begins after the next expected sequence', 'sequence.first'),
    };
  }
  return { state: 'OK', failure: null };
}

export function assessEvidenceSet(
  evidence: readonly NormalizedEvidence[],
  requiredKinds: readonly EvidenceKind[],
  targetInstrumentId: string,
  component = 'evidence.set',
): EvidenceSetAssessment {
  const scopedEvidence = evidence.filter((item) => item.instrument.instrumentId === targetInstrumentId);
  const observedKinds = sortedUnique(scopedEvidence.map((item) => item.kind)) as EvidenceKind[];
  const missingKinds = sortedUnique(requiredKinds.filter((kind) => !observedKinds.includes(kind))) as EvidenceKind[];
  const failures: StableFailure[] = [];
  if (missingKinds.length > 0) {
    failures.push(makeStableFailure(
      'INCOMPLETE_EVIDENCE',
      component,
      `required evidence kinds are missing: ${missingKinds.join(',')}`,
      'requiredKinds',
      scopedEvidence.map((item) => item.id),
    ));
  }
  for (const item of scopedEvidence) {
    if (item.truth.freshness.state === 'STALE') {
      failures.push(makeStableFailure('STALE_SOURCE', component, 'evidence set contains stale source evidence', 'truth.freshness', [item.id]));
    }
    if (item.truth.completeness.state !== 'COMPLETE') {
      failures.push(makeStableFailure('INCOMPLETE_EVIDENCE', component, 'evidence set contains partial evidence', 'truth.completeness', [item.id]));
    }
  }
  failures.sort((left, right) => left.id.localeCompare(right.id));
  return { complete: failures.length === 0, observedKinds, missingKinds, failures };
}
