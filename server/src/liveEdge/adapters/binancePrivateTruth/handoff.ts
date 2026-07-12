import { createHash } from 'node:crypto';

import {
  PRIVATE_DATA_BOUNDS,
  deepFreezePrivate,
  privateArray,
  privateIdentifier,
  privateRecord,
  privateSortedUnique,
  snapshotPrivateData,
} from './bounds.js';
import { validatePrivateTruthProjection } from './projection.js';
import {
  L05_PRIVATE_HANDOFF_SCHEMA,
  NO_PRIVATE_ACTION_AUTHORITY,
  type NoPrivateActionAuthority,
} from './types.js';

const INPUT_FIELDS = Object.freeze([
  'projection', 'mismatchCandidates', 'foreignEvidenceReferences',
] as const);
const MISMATCH_REASON_PATTERN = /^(?=.{3,128}$)(?=.*_)[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const FOREIGN_EVIDENCE_REFERENCE_PATTERN = /^foreign-(?:order|position|liability|trade):[0-9a-f]{24}$/;
const FOUNDATION_RESULT_REVISION_PATTERN = /^foundation-reconciliation-result:[0-9a-f]{24,64}$/;
const PRIVATE_SOURCE_CUT_REVISION_PATTERN = /^l05pcut_[0-9a-f]{64}$/;

export interface CreatePrivateComparisonHandoffInput {
  readonly projection: unknown;
  readonly mismatchCandidates: unknown;
  readonly foreignEvidenceReferences: unknown;
}

export interface L05PrivateComparisonHandoff extends NoPrivateActionAuthority {
  readonly schema: typeof L05_PRIVATE_HANDOFF_SCHEMA;
  readonly accountRealmId: string;
  readonly projectionRevision: string;
  readonly sourceCutRevisions: readonly string[];
  readonly mismatchCandidates: readonly string[];
  readonly foreignEvidenceReferences: readonly string[];
  readonly canonicalStatus: null;
  readonly recommendation: null;
  readonly canClearAmbiguity: false;
  readonly handoffRevision: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function revision(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function reasonStrings(value: unknown, label: string, maximum: number): readonly string[] {
  const rows = privateArray(value, label, maximum);
  return privateSortedUnique(rows.map((item, index) => {
    const reason = privateIdentifier(item, `${label}[${index}]`);
    if (!MISMATCH_REASON_PATTERN.test(reason)) {
      throw new TypeError(`${label}[${index}] must be an exact uppercase mismatch reason`);
    }
    return reason;
  }));
}

function foreignEvidenceReferences(value: unknown, label: string, maximum: number): readonly string[] {
  const rows = privateArray(value, label, maximum);
  return privateSortedUnique(rows.map((item, index) => {
    const reference = privateIdentifier(item, `${label}[${index}]`);
    if (!FOREIGN_EVIDENCE_REFERENCE_PATTERN.test(reference)) {
      throw new TypeError(`${label}[${index}] must be a closed foreign evidence reference`);
    }
    return reference;
  }));
}

/**
 * Emits comparison input only. Foundation still decides reconciliation and
 * Capital still decides economics, allocation, and reservation.
 */
export function createPrivateComparisonHandoff(
  inputValue: unknown,
): Readonly<L05PrivateComparisonHandoff> {
  const input = privateRecord(snapshotPrivateData(inputValue), INPUT_FIELDS, 'private comparison handoff');
  const source = validatePrivateTruthProjection(input.projection);
  if (source.reconciliationObservation !== null
    && (!FOUNDATION_RESULT_REVISION_PATTERN.test(source.reconciliationObservation.resultRevision)
      || !PRIVATE_SOURCE_CUT_REVISION_PATTERN.test(source.reconciliationObservation.sourceCutRevision))) {
    throw new TypeError('Foundation reconciliation revisions must use exact closed namespaces');
  }
  const suppliedMismatches = reasonStrings(
    input.mismatchCandidates,
    'mismatch candidates',
    PRIVATE_DATA_BOUNDS.maximumMismatches,
  );
  const foreignReferences = foreignEvidenceReferences(
    input.foreignEvidenceReferences,
    'foreign evidence references',
    PRIVATE_DATA_BOUNDS.maximumTrades,
  );
  const mismatchCandidates = privateSortedUnique([
    ...source.reasonCodes,
    ...suppliedMismatches,
    ...(source.entryEvidenceComplete ? [] : ['PRIVATE_PROJECTION_NOT_COMPLETE']),
  ]);
  if (mismatchCandidates.length > PRIVATE_DATA_BOUNDS.maximumMismatches) {
    throw new RangeError('private comparison mismatch capacity exceeded');
  }
  const sourceCutRevisions = privateSortedUnique([
    ...source.sourceFacts.map((fact) => fact.evidenceRevision),
    ...(source.reconciliationObservation === null
      ? []
      : [source.reconciliationObservation.sourceCutRevision]),
  ]);
  const semantic = {
    schema: L05_PRIVATE_HANDOFF_SCHEMA,
    accountRealmId: source.accountRealmId,
    projectionRevision: source.projectionRevision,
    sourceCutRevisions,
    mismatchCandidates,
    foreignEvidenceReferences: foreignReferences,
    canonicalStatus: null,
    recommendation: null,
    canClearAmbiguity: false,
  } as const;
  return deepFreezePrivate({
    ...semantic,
    handoffRevision: revision('l05hand_', semantic),
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}
