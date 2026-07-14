import { createHash } from 'node:crypto';

import {
  PRIVATE_DATA_BOUNDS,
  deepFreezePrivate,
  privateArray,
  privateIdentifier,
  privateInteger,
  privateRecord,
  privateSortedUnique,
  privateString,
  snapshotPrivateData,
} from './bounds.js';
import {
  requiredLifecycleProductsForPosture,
  validatePrivateLifecycleWitness,
  type PrivateLifecycleWitness,
} from './lifecycleBinding.js';
import { validatePrivateTruthProjection } from './projection.js';
import {
  L05_PRIVATE_WAITING_SCHEMA,
  NO_PRIVATE_ACTION_AUTHORITY,
  type NoPrivateActionAuthority,
} from './types.js';

const INSTRUMENT_REVISION_PATTERN = /^l04-instrument-spec:[0-9a-f]{24}$/;
const INSTRUMENT_EVIDENCE_REVISION_PATTERN = /^l04-instrument-source-evidence:[0-9a-f]{24}$/;
const INSTRUMENT_SNAPSHOT_REVISION_PATTERN = /^l04-instrument-registry-snapshot:[0-9a-f]{24}$/;
const PRIVATE_PROJECTION_REVISION_PATTERN = /^l05proj_[0-9a-f]{64}$/;
const PRIVATE_PERMISSION_REVISION_PATTERN = /^l05perm_[0-9a-f]{64}$/;
const PRIVATE_LIFECYCLE_REVISION_PATTERN = /^l05lifecycle_[0-9a-f]{64}$/;
const PRIVATE_RECONCILIATION_CUT_REVISION_PATTERN = /^l05pcut_[0-9a-f]{64}$/;

const INPUT_FIELDS = Object.freeze([
  'binding', 'currentSymbol', 'currentInstrumentRevision', 'currentInstrumentEvidenceRevision',
  'currentInstrumentSnapshotRevision', 'projection', 'permissionRevisions',
  'lifecycleWitnesses', 'reconciliationCutRevision', 'evaluatedAtMs',
] as const);

const CREATE_BINDING_FIELDS = Object.freeze([
  'currentSymbol', 'currentInstrumentRevision', 'currentInstrumentEvidenceRevision',
  'currentInstrumentSnapshotRevision', 'projection', 'lifecycleWitnesses',
] as const);

const BINDING_FIELDS = Object.freeze([
  'schema', 'symbol', 'instrumentRevision', 'instrumentEvidenceRevision',
  'instrumentSnapshotRevision', 'privateProjectionRevision',
  'permissionRevisions', 'lifecycleRevisions', 'reconciliationCutRevision',
  'evaluatedAtMs', 'validUntilMs', 'persistenceProven',
  'sendEligible', 'accountReadAuthority', 'mutationAuthority',
  'reconciliationAuthority', 'capitalAuthority', 'riskAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

export interface DecideWaitingPrivateTruthInput {
  readonly binding: unknown;
  readonly currentSymbol: unknown;
  readonly currentInstrumentRevision: unknown;
  readonly currentInstrumentEvidenceRevision: unknown;
  readonly currentInstrumentSnapshotRevision: unknown;
  readonly projection: unknown;
  readonly permissionRevisions: unknown;
  readonly lifecycleWitnesses: unknown;
  readonly reconciliationCutRevision: unknown;
  readonly evaluatedAtMs: unknown;
}

export interface CreateWaitingPrivateTruthBindingInput {
  readonly currentSymbol: unknown;
  readonly currentInstrumentRevision: unknown;
  readonly currentInstrumentEvidenceRevision: unknown;
  readonly currentInstrumentSnapshotRevision: unknown;
  readonly projection: unknown;
  readonly lifecycleWitnesses: unknown;
}

export interface L05WaitingPrivateTruthBinding extends NoPrivateActionAuthority {
  readonly schema: typeof L05_PRIVATE_WAITING_SCHEMA;
  readonly symbol: string;
  readonly instrumentRevision: string;
  readonly instrumentEvidenceRevision: string;
  readonly instrumentSnapshotRevision: string;
  readonly privateProjectionRevision: string;
  readonly permissionRevisions: readonly string[];
  readonly lifecycleRevisions: readonly string[];
  readonly reconciliationCutRevision: string | null;
  readonly evaluatedAtMs: number;
  readonly validUntilMs: number;
  /** This value comparison is not proof that a binding was durably persisted. */
  readonly persistenceProven: false;
}

export interface L05WaitingPrivateTruthDecision extends NoPrivateActionAuthority {
  readonly state: 'CURRENT_NON_SENDABLE' | 'REVALIDATION_REQUIRED' | 'BLOCKED';
  readonly reasonCodes: readonly string[];
  readonly bindingRevision: string;
  readonly persistenceProven: false;
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

function exactRevision(value: unknown, label: string, pattern: RegExp): string {
  const parsed = privateIdentifier(value, label);
  if (!pattern.test(parsed)) throw new TypeError(`${label} must use its exact owner namespace`);
  return parsed;
}

function sortedRevisions(
  value: unknown,
  label: string,
  maximum: number,
  pattern: RegExp,
): readonly string[] {
  const rows = privateArray(value, label, maximum);
  const parsed = rows.map((item, index) => exactRevision(item, `${label}[${index}]`, pattern));
  const sorted = privateSortedUnique(parsed);
  if (sorted.length !== parsed.length
    || sorted.some((item, index) => item !== parsed[index])) {
    throw new TypeError(`${label} must be sorted and unique`);
  }
  return sorted;
}

function canonicalSymbol(value: unknown): string {
  const symbol = privateString(value, 'waiting symbol', 128);
  if (symbol.normalize('NFC') !== symbol
    || symbol.toUpperCase() !== symbol
    || !/^[\p{L}\p{N}._-]+$/u.test(symbol)) {
    throw new TypeError('waiting symbol must match the canonical L04 instrument token grammar');
  }
  return symbol;
}

function nullableRevision(value: unknown, label: string, pattern: RegExp): string | null {
  return value === null ? null : exactRevision(value, label, pattern);
}

function binding(value: unknown): Readonly<L05WaitingPrivateTruthBinding> {
  const record = privateRecord(value, BINDING_FIELDS, 'private waiting binding');
  if (record.schema !== L05_PRIVATE_WAITING_SCHEMA) throw new TypeError('private waiting binding schema mismatch');
  const evaluatedAtMs = privateInteger(record.evaluatedAtMs, 'binding evaluatedAtMs');
  const validUntilMs = privateInteger(record.validUntilMs, 'binding validUntilMs');
  if (validUntilMs < evaluatedAtMs) throw new TypeError('private waiting validity precedes evaluation');
  if (record.persistenceProven !== false
    || record.sendEligible !== false
    || record.accountReadAuthority !== 'NONE'
    || record.mutationAuthority !== 'NONE'
    || record.reconciliationAuthority !== 'NONE'
    || record.capitalAuthority !== 'NONE'
    || record.riskAuthority !== 'NONE'
    || record.externalActionAuthorization !== 'NONE'
    || record.actionAuthority !== 'NONE_RECORD_ONLY') {
    throw new TypeError('private waiting binding cannot claim persistence or authority');
  }
  const permissionRevisions = sortedRevisions(
    record.permissionRevisions,
    'binding permission revisions',
    2,
    PRIVATE_PERMISSION_REVISION_PATTERN,
  );
  if (permissionRevisions.length !== 2) {
    throw new TypeError('binding must carry distinct read and execution permission revisions');
  }
  return deepFreezePrivate({
    schema: L05_PRIVATE_WAITING_SCHEMA,
    symbol: canonicalSymbol(record.symbol),
    instrumentRevision: exactRevision(
      record.instrumentRevision,
      'binding instrument revision',
      INSTRUMENT_REVISION_PATTERN,
    ),
    instrumentEvidenceRevision: exactRevision(
      record.instrumentEvidenceRevision,
      'binding instrument evidence revision',
      INSTRUMENT_EVIDENCE_REVISION_PATTERN,
    ),
    instrumentSnapshotRevision: exactRevision(
      record.instrumentSnapshotRevision,
      'binding instrument snapshot revision',
      INSTRUMENT_SNAPSHOT_REVISION_PATTERN,
    ),
    privateProjectionRevision: exactRevision(
      record.privateProjectionRevision,
      'binding private projection revision',
      PRIVATE_PROJECTION_REVISION_PATTERN,
    ),
    permissionRevisions,
    lifecycleRevisions: sortedRevisions(
      record.lifecycleRevisions,
      'binding lifecycle revisions',
      PRIVATE_DATA_BOUNDS.maximumSources,
      PRIVATE_LIFECYCLE_REVISION_PATTERN,
    ),
    reconciliationCutRevision: nullableRevision(
      record.reconciliationCutRevision,
      'binding reconciliation cut revision',
      PRIVATE_RECONCILIATION_CUT_REVISION_PATTERN,
    ),
    evaluatedAtMs,
    validUntilMs,
    persistenceProven: false as const,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function lifecycleWitnesses(value: unknown): readonly Readonly<PrivateLifecycleWitness>[] {
  const rows = privateArray(value, 'current lifecycle witnesses', 3);
  const witnesses = rows.map((row) => validatePrivateLifecycleWitness(row));
  witnesses.sort((left, right) => left.product < right.product ? -1 : left.product > right.product ? 1 : 0);
  if (new Set(witnesses.map((witness) => witness.product)).size !== witnesses.length) {
    throw new TypeError('current lifecycle witnesses must use distinct products');
  }
  return Object.freeze(witnesses);
}

function lifecycleOwnerRestRevision(
  witness: Readonly<PrivateLifecycleWitness>,
): string | null {
  const state = witness.state;
  if (state.product === 'SPOT' || state.product === 'USD_M_PERPETUAL') {
    return state.ownerRestCut?.reconciliationRevision ?? null;
  }
  return null;
}

function minimumValidity(
  projectionValidUntilMs: number | null,
  witnesses: readonly Readonly<PrivateLifecycleWitness>[],
): number | null {
  const values = [
    projectionValidUntilMs,
    ...witnesses.map((witness) => witness.validUntilMs),
  ];
  return values.some((value) => value === null)
    ? null
    : Math.min(...values as number[]);
}

function assertLifecycleProjectionBinding(
  projection: ReturnType<typeof validatePrivateTruthProjection>,
  witnesses: readonly Readonly<PrivateLifecycleWitness>[],
): void {
  if (!projection.entryEvidenceComplete || projection.completeness !== 'COMPLETE') {
    throw new TypeError('private projection is not complete');
  }
  if (projection.targetSymbol === null) {
    throw new TypeError('private projection target symbol is required');
  }
  const requiredProducts = requiredLifecycleProductsForPosture(projection.posture);
  if (!same(witnesses.map((witness) => witness.product), requiredProducts)) {
    throw new TypeError('private lifecycle product set mismatch');
  }
  if (witnesses.some((witness) => witness.accountRealmId !== projection.accountRealmId)) {
    throw new TypeError('private lifecycle account realm mismatch');
  }
  if (witnesses.some((witness) => !witness.acceptableForOwnerComparison)) {
    throw new TypeError('private lifecycle witness is not owner-comparison ready');
  }
  if (witnesses.some((witness) => (
    witness.observedAtMs > projection.evaluatedAtMs
      || witness.evaluatedAtMs > projection.evaluatedAtMs
      || witness.validUntilMs === null
      || projection.evaluatedAtMs > witness.validUntilMs
  ))) {
    throw new TypeError('private lifecycle witness is not current at the projection cut');
  }
  const productCuts = projection.reconciliationObservation?.productCutRevisions ?? null;
  if (productCuts === null || witnesses.some((witness) => (
    witness.product !== 'MARGIN'
      && lifecycleOwnerRestRevision(witness) !== productCuts[witness.product]
  ))) {
    throw new TypeError('private lifecycle owner cut is not Foundation-product-cut bound');
  }
}

/**
 * Canonically captures the exact comparison values for a later waiting check.
 * The returned value is immutable and non-authoritative. Its
 * `persistenceProven=false` marker is explicit: callers still need the
 * canonical Ledger/integration owner to persist or attest workflow history.
 */
export function createWaitingPrivateTruthBinding(
  inputValue: unknown,
): Readonly<L05WaitingPrivateTruthBinding> {
  const input = privateRecord(
    snapshotPrivateData(inputValue),
    CREATE_BINDING_FIELDS,
    'private waiting binding input',
  );
  const projection = validatePrivateTruthProjection(input.projection);
  const witnesses = lifecycleWitnesses(input.lifecycleWitnesses);
  assertLifecycleProjectionBinding(projection, witnesses);
  const currentSymbol = canonicalSymbol(input.currentSymbol);
  if (currentSymbol !== projection.targetSymbol) {
    throw new TypeError('waiting symbol does not match private projection target');
  }
  const permissionRevisions = privateSortedUnique(
    projection.permissions.map((item) => item.revision),
  );
  if (permissionRevisions.length !== 2) {
    throw new TypeError('private waiting binding requires exact permission evidence');
  }
  const reconciliationCutRevision = projection
    .reconciliationObservation?.sourceCutRevision ?? null;
  if (reconciliationCutRevision === null || projection.validUntilMs === null) {
    throw new TypeError('private waiting binding requires reconciliation and validity');
  }
  const validUntilMs = minimumValidity(projection.validUntilMs, witnesses);
  if (validUntilMs === null || validUntilMs < projection.evaluatedAtMs) {
    throw new TypeError('private waiting binding evidence is already expired');
  }
  return deepFreezePrivate({
    schema: L05_PRIVATE_WAITING_SCHEMA,
    symbol: currentSymbol,
    instrumentRevision: exactRevision(
      input.currentInstrumentRevision,
      'current instrument revision',
      INSTRUMENT_REVISION_PATTERN,
    ),
    instrumentEvidenceRevision: exactRevision(
      input.currentInstrumentEvidenceRevision,
      'current instrument evidence revision',
      INSTRUMENT_EVIDENCE_REVISION_PATTERN,
    ),
    instrumentSnapshotRevision: exactRevision(
      input.currentInstrumentSnapshotRevision,
      'current instrument snapshot revision',
      INSTRUMENT_SNAPSHOT_REVISION_PATTERN,
    ),
    privateProjectionRevision: projection.projectionRevision,
    permissionRevisions,
    lifecycleRevisions: privateSortedUnique(
      witnesses.map((witness) => witness.lifecycleRevision),
    ),
    reconciliationCutRevision,
    evaluatedAtMs: projection.evaluatedAtMs,
    validUntilMs,
    persistenceProven: false as const,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

function output(
  state: L05WaitingPrivateTruthDecision['state'],
  reasonCodes: readonly string[],
  bindingRevision: string,
): Readonly<L05WaitingPrivateTruthDecision> {
  return deepFreezePrivate({
    state,
    reasonCodes: privateSortedUnique(reasonCodes),
    bindingRevision,
    persistenceProven: false as const,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

/**
 * Rebuilds full lifecycle witnesses before comparing their derived revisions.
 * CURRENT_NON_SENDABLE means every evidence binding is unchanged; it never
 * means an order may be sent.
 */
export function decideWaitingPrivateTruth(
  inputValue: unknown,
): Readonly<L05WaitingPrivateTruthDecision> {
  const rejectedRevision = revision('l05wait_', { state: 'INPUT_REJECTED' });
  try {
    const input = privateRecord(snapshotPrivateData(inputValue), INPUT_FIELDS, 'private waiting decision');
    const prior = binding(input.binding);
    const currentProjection = validatePrivateTruthProjection(input.projection);
    const evaluatedAtMs = privateInteger(input.evaluatedAtMs, 'waiting evaluatedAtMs');
    const currentSymbol = canonicalSymbol(input.currentSymbol);
    const currentInstrumentRevision = exactRevision(
      input.currentInstrumentRevision,
      'current instrument revision',
      INSTRUMENT_REVISION_PATTERN,
    );
    const currentInstrumentEvidenceRevision = exactRevision(
      input.currentInstrumentEvidenceRevision,
      'current instrument evidence revision',
      INSTRUMENT_EVIDENCE_REVISION_PATTERN,
    );
    const currentInstrumentSnapshotRevision = exactRevision(
      input.currentInstrumentSnapshotRevision,
      'current instrument snapshot revision',
      INSTRUMENT_SNAPSHOT_REVISION_PATTERN,
    );
    const bindingRevision = revision('l05wait_', prior);
    if (currentProjection.targetSymbol === null
      || currentSymbol !== currentProjection.targetSymbol) {
      return output('BLOCKED', ['CURRENT_SYMBOL_NOT_PROJECTION_TARGET'], bindingRevision);
    }
    const permissionRevisions = sortedRevisions(
      input.permissionRevisions,
      'current permission revisions',
      2,
      PRIVATE_PERMISSION_REVISION_PATTERN,
    );
    if (permissionRevisions.length !== 2) {
      return output('BLOCKED', ['PRIVATE_PERMISSION_EVIDENCE_REQUIRED'], bindingRevision);
    }
    const witnesses = lifecycleWitnesses(input.lifecycleWitnesses);
    const lifecycleRevisions = sortedRevisions(
      witnesses.map((witness) => witness.lifecycleRevision),
      'derived lifecycle revisions',
      3,
      PRIVATE_LIFECYCLE_REVISION_PATTERN,
    );
    const reconciliationCutRevision = nullableRevision(
      input.reconciliationCutRevision,
      'current reconciliation cut revision',
      PRIVATE_RECONCILIATION_CUT_REVISION_PATTERN,
    );
    const projectionPermissionRevisions = privateSortedUnique(
      currentProjection.permissions.map((item) => item.revision),
    );
    if (!same(projectionPermissionRevisions, permissionRevisions)) {
      return output('BLOCKED', ['CURRENT_PERMISSION_REVISIONS_NOT_PROJECTION_BOUND'], bindingRevision);
    }
    if (reconciliationCutRevision === null || prior.reconciliationCutRevision === null) {
      return output('BLOCKED', ['FOUNDATION_RECONCILIATION_CUT_REQUIRED'], bindingRevision);
    }
    const projectionReconciliationCutRevision = currentProjection
      .reconciliationObservation?.sourceCutRevision ?? null;
    if (reconciliationCutRevision !== projectionReconciliationCutRevision) {
      return output(
        'BLOCKED',
        ['CURRENT_RECONCILIATION_CUT_NOT_PROJECTION_BOUND'],
        bindingRevision,
      );
    }
    if (!currentProjection.entryEvidenceComplete || currentProjection.completeness !== 'COMPLETE') {
      return output('BLOCKED', ['PRIVATE_PROJECTION_NOT_COMPLETE'], bindingRevision);
    }
    if (witnesses.length === 0 || prior.lifecycleRevisions.length === 0) {
      return output('BLOCKED', ['PRIVATE_LIFECYCLE_EVIDENCE_REQUIRED'], bindingRevision);
    }
    const requiredProducts = requiredLifecycleProductsForPosture(currentProjection.posture);
    const witnessProducts = witnesses.map((witness) => witness.product);
    if (!same(witnessProducts, requiredProducts)) {
      return output('BLOCKED', ['PRIVATE_LIFECYCLE_PRODUCT_SET_MISMATCH'], bindingRevision);
    }
    if (witnesses.some((witness) => witness.accountRealmId !== currentProjection.accountRealmId)) {
      return output('BLOCKED', ['PRIVATE_LIFECYCLE_ACCOUNT_REALM_MISMATCH'], bindingRevision);
    }
    if (witnesses.some((witness) => !witness.acceptableForOwnerComparison)) {
      return output('BLOCKED', ['PRIVATE_LIFECYCLE_WITNESS_UNACCEPTABLE'], bindingRevision);
    }
    const projectionProductCutRevisions = currentProjection
      .reconciliationObservation?.productCutRevisions ?? null;
    if (projectionProductCutRevisions === null
      || witnesses.some((witness) => (
        witness.product !== 'MARGIN'
          && lifecycleOwnerRestRevision(witness)
            !== projectionProductCutRevisions[witness.product]
      ))) {
      return output(
        'BLOCKED',
        ['PRIVATE_LIFECYCLE_RECONCILIATION_PRODUCT_CUT_MISMATCH'],
        bindingRevision,
      );
    }
    // Clock-divergence tolerance never makes evidence available before it
    // exists. A waiting decision must be at or after every cut it consumes,
    // even when those cuts are within the bounded cross-source skew policy.
    if (evaluatedAtMs < prior.evaluatedAtMs) {
      return output(
        'BLOCKED',
        ['PRIVATE_WAITING_DECISION_PRECEDES_BINDING'],
        bindingRevision,
      );
    }
    if (evaluatedAtMs < currentProjection.evaluatedAtMs) {
      return output(
        'BLOCKED',
        ['PRIVATE_WAITING_DECISION_PRECEDES_PROJECTION'],
        bindingRevision,
      );
    }
    if (witnesses.some((witness) => (
      evaluatedAtMs < witness.observedAtMs
        || evaluatedAtMs < witness.evaluatedAtMs
    ))) {
      return output(
        'BLOCKED',
        ['PRIVATE_WAITING_DECISION_PRECEDES_LIFECYCLE_WITNESS'],
        bindingRevision,
      );
    }
    // Reapply the constructor's complete lifecycle/projection invariant on
    // every decision. A manually shaped prior is not allowed to substitute a
    // witness from a different temporal cut and compare as current. The
    // availability checks stay first so a canonical future witness cannot be
    // treated as available merely because its clocks are close.
    assertLifecycleProjectionBinding(currentProjection, witnesses);
    if (witnesses.some((witness) => (
      witness.validUntilMs === null || evaluatedAtMs > witness.validUntilMs
    ))) {
      return output('REVALIDATION_REQUIRED', ['PRIVATE_LIFECYCLE_WITNESS_EXPIRED'], bindingRevision);
    }
    if (currentProjection.validUntilMs === null) {
      return output('BLOCKED', ['PRIVATE_PROJECTION_VALIDITY_REQUIRED'], bindingRevision);
    }
    const currentBindingValidUntilMs = minimumValidity(
      currentProjection.validUntilMs,
      witnesses,
    );
    if (currentBindingValidUntilMs === null) {
      return output('BLOCKED', ['PRIVATE_WAITING_VALIDITY_REQUIRED'], bindingRevision);
    }
    if (evaluatedAtMs > prior.validUntilMs) {
      return output('REVALIDATION_REQUIRED', ['PRIVATE_WAITING_BINDING_EXPIRED'], bindingRevision);
    }
    if (evaluatedAtMs > currentProjection.validUntilMs) {
      return output('REVALIDATION_REQUIRED', ['PRIVATE_PROJECTION_EXPIRED'], bindingRevision);
    }

    const changed: string[] = [];
    if (prior.symbol !== currentSymbol) changed.push('WAITING_SYMBOL_CHANGED');
    if (prior.instrumentRevision !== currentInstrumentRevision) changed.push('INSTRUMENT_REVISION_CHANGED');
    if (prior.instrumentEvidenceRevision !== currentInstrumentEvidenceRevision) {
      changed.push('INSTRUMENT_EVIDENCE_REVISION_CHANGED');
    }
    if (prior.instrumentSnapshotRevision !== currentInstrumentSnapshotRevision) {
      changed.push('INSTRUMENT_SNAPSHOT_REVISION_CHANGED');
    }
    if (prior.privateProjectionRevision !== currentProjection.projectionRevision) {
      changed.push('PRIVATE_PROJECTION_REVISION_CHANGED');
    }
    if (prior.evaluatedAtMs !== currentProjection.evaluatedAtMs) {
      changed.push('PRIVATE_PROJECTION_EVALUATION_CUT_CHANGED');
    }
    if (prior.validUntilMs !== currentBindingValidUntilMs) {
      changed.push('PRIVATE_WAITING_EVIDENCE_VALIDITY_CHANGED');
    }
    if (!same(prior.permissionRevisions, permissionRevisions)) changed.push('PERMISSION_REVISIONS_CHANGED');
    if (!same(prior.lifecycleRevisions, lifecycleRevisions)) changed.push('LIFECYCLE_REVISIONS_CHANGED');
    if (prior.reconciliationCutRevision !== reconciliationCutRevision) {
      changed.push('RECONCILIATION_CUT_REVISION_CHANGED');
    }
    return changed.length > 0
      ? output('REVALIDATION_REQUIRED', changed, bindingRevision)
      : output('CURRENT_NON_SENDABLE', [], bindingRevision);
  } catch {
    return output('BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED'], rejectedRevision);
  }
}
