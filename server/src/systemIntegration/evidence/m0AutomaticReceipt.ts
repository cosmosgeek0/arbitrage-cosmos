/**
 * Pure evidence composer for the M0 Spot transport-canary receipt.
 *
 * This module validates already-owned facts. It has no clock, port, route,
 * signer, provider client, persistence writer, control mutation, or execution
 * authority. In particular, an injected LIVE_PRIVATE label cannot promote a
 * validation receipt into live/provider acceptance.
 */

import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { canonicalJson } from '../../foundation/contracts/identity.js';
import {
  compareSpotDecimals,
  normalizeSpotDecimal,
} from '../../foundation/exchange/binanceSpot/filters.js';
import {
  replaySpotLifecycle,
  spotResidualQuantity,
  type SpotLifecycleEvent,
  type SpotLifecycleState,
} from '../../foundation/execution/spotLifecycle.js';
import {
  createSpotExecutionTicket,
  type SpotExecutionTicket,
} from '../../foundation/execution/spotTicket.js';
import {
  classifySpotLedgerDiscrepancy,
  type SpotLedgerProjectionState,
  type SpotReconciliationStatus,
} from '../../foundation/reconciliation/spotLedgerBridge.js';
import {
  calculatePreviewDigest,
  durableActionDigest,
} from '../../liveEdge/controls/integrity.js';
import type {
  ControlCommandReceipt,
  DurableControlPreview,
} from '../../liveEdge/controls/types.js';
import {
  validateControlReceipt,
  validatePreview,
} from '../../liveEdge/controls/validation.js';

export const M0_AUTOMATIC_RECEIPT_INPUT_SCHEMA =
  'cosmos.system-integration.m0-automatic-receipt-input.v1' as const;
export const M0_AUTOMATIC_RECEIPT_SCHEMA =
  'cosmos.system-integration.m0-automatic-receipt.v1' as const;
export const M0_RECEIPT_BINDING_SCHEMA =
  'cosmos.system-integration.m0-receipt-binding.v1' as const;
export const M0_VALIDATION_FACT_SCHEMA =
  'cosmos.system-integration.m0-validation-fact.v1' as const;
export const M0_TERMINAL_COVERAGE_SCHEMA =
  'cosmos.system-integration.m0-terminal-coverage.v1' as const;
export const M0_LIFECYCLE_EVIDENCE_SCHEMA =
  'cosmos.system-integration.m0-lifecycle-evidence.v1' as const;
export const M0_POST_FLAT_SCHEMA =
  'cosmos.system-integration.m0-post-flat.v1' as const;
export const M0_RECONCILIATION_FACT_SCHEMA =
  'cosmos.system-integration.m0-reconciliation-fact.v1' as const;
export const M0_POST_DISARM_SCHEMA =
  'cosmos.system-integration.m0-post-disarm.v1' as const;
export const M0_CONSUMED_AUTHORITY_SCHEMA =
  'cosmos.system-integration.m0-consumed-authority.v1' as const;
export const M0_FINANCIAL_FACT_SCHEMA =
  'cosmos.system-integration.m0-financial-fact.v1' as const;

export const M0_MAX_EVIDENCE_AGE_MS = 60_000 as const;
export const M0_MAX_CURRENT_PRIVATE_AGE_MS = 5_000 as const;
const MAX_UTC_MS = 8_640_000_000_000_000;
const MAX_INPUT_DEPTH = 18;
const MAX_INPUT_NODES = 4_096;
const MAX_ARRAY_LENGTH = 512;
const MAX_OBJECT_KEYS = 64;
const MAX_STRING_LENGTH = 512;
const MAX_IDENTITY_LENGTH = 160;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const PRIVATE_SOURCE_CUT_REVISION = /^l05pcut_[a-f0-9]{64}$/u;
const PRIVATE_PROJECTION_REVISION = /^l05proj_[a-f0-9]{64}$/u;
const FOUNDATION_RECONCILIATION_RESULT_REVISION =
  /^foundation-reconciliation-result:[a-f0-9]{24,64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SYMBOL = /^[A-Z0-9]{2,30}$/u;
const ASSET = /^[A-Z0-9]{1,20}$/u;
const SENSITIVE_VALUE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_ -]?secret|password|bearer\s+[A-Za-z0-9+/_=-]{8,}|access[_ -]?token|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:^|[^A-Za-z0-9])(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:cookie|recovery[_ -]?code)\s*[:=])/iu;
const REMOTE_VALUE = /^[a-z][a-z0-9+.-]*:\/\//iu;

const INPUT_KEYS = Object.freeze([
  'schema',
  'version',
  'sourceCommitSha',
  'evaluatedAtMs',
  'maxEvidenceAgeMs',
  'evidenceAuthority',
  'ticket',
  'flattenClientOrderId',
  'validation',
  'lifecycle',
  'reconciliation',
  'disarm',
  'entryAuthority',
  'flattenAuthority',
  'financials',
] as const);

const BINDING_KEYS = Object.freeze([
  'schema',
  'version',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'flattenClientOrderId',
  'correlationId',
  'accountId',
  'symbol',
  'sourceVenueOrderId',
  'flattenVenueOrderId',
  'lifecycleReplayDigest',
  'privateSourceCutRevision',
  'privateProjectionRevision',
  'reconciliationResultRevision',
] as const);

const FACT_BASE_KEYS = Object.freeze([
  'schema',
  'version',
  'binding',
  'authority',
  'ownerRevision',
  'observedAtMs',
  'validUntilMs',
] as const);

const SANITIZED_DISARM_PREVIEW_KEYS = Object.freeze([
  'schema',
  'version',
  'commandId',
  'action',
  'actionDigest',
  'expectedConfigVersion',
  'expectedControlRevision',
  'actorBinding',
  'reason',
  'generatedAtMs',
  'expiresAtMs',
  'riskWitness',
  'previewDigest',
  'externalActionAuthorization',
] as const);

export type M0EvidenceAuthority =
  | 'LIVE_PRIVATE'
  | 'RECORDED_REPLAY'
  | 'SYNTHETIC_TEST';

export type M0ReceiptReasonCode =
  | 'INPUT_INVALID'
  | 'IDENTITY_BINDING_INVALID'
  | 'VALIDATE_ONLY_FACT_INVALID'
  | 'AUTHORITY_FACT_INVALID'
  | 'LIFECYCLE_REPLAY_INVALID'
  | 'POSITIVE_FILL_NOT_PROVED'
  | 'TERMINAL_COVERAGE_INVALID'
  | 'POST_FLAT_TRUTH_INVALID'
  | 'RECONCILIATION_NOT_EXACT'
  | 'FINANCIAL_FACT_INVALID'
  | 'DISARM_PREVIEW_INVALID'
  | 'DISARM_RECEIPT_INVALID'
  | 'POST_DISARM_TRUTH_INVALID'
  | 'EVIDENCE_CHRONOLOGY_INVALID';

export interface M0ReceiptAxis {
  readonly state: 'PROVED' | 'NOT_PROVED';
  readonly reasonCodes: readonly M0ReceiptReasonCode[];
}

export interface M0AutomaticReceipt {
  readonly schema: typeof M0_AUTOMATIC_RECEIPT_SCHEMA;
  readonly version: 1;
  readonly receiptId: string;
  readonly sourceCommitSha: string | null;
  readonly inputEvidenceDigest: string | null;
  readonly evaluatedAtMs: number | null;
  readonly evidenceAuthority: M0EvidenceAuthority | null;
  readonly scope: 'M0_TICKET';
  readonly claimBoundary: 'TRANSPORT_ONLY';
  readonly disposition: 'PROVED' | 'NOT_PROVED';
  readonly milestoneClaim: 'VALIDATION_PROVED' | 'NOT_PROVED';
  readonly liveCanaryProven: false;
  readonly moneyMovementProven: false;
  readonly providerAcceptance: 'NOT_CLAIMED';
  readonly axes: Readonly<{
    readonly identity: Readonly<M0ReceiptAxis>;
    readonly validateOnly: Readonly<M0ReceiptAxis>;
    readonly authorities: Readonly<M0ReceiptAxis>;
    readonly flat: Readonly<M0ReceiptAxis>;
    readonly reconciliation: Readonly<M0ReceiptAxis>;
    readonly disarm: Readonly<M0ReceiptAxis>;
    readonly financials: Readonly<M0ReceiptAxis>;
  }>;
  readonly reasonCodes: readonly M0ReceiptReasonCode[];
  readonly evidence: Readonly<{
    readonly ticketId: string;
    readonly evidenceBundleDigest: string;
    readonly termsDigest: string;
    readonly clientOrderId: string;
    readonly flattenClientOrderId: string;
    readonly correlationId: string;
    readonly accountId: string;
    readonly symbol: string;
    readonly sourceVenueOrderId: string;
    readonly flattenVenueOrderId: string;
    readonly lifecycleReplayDigest: string;
    readonly privateSourceCutRevision: string;
    readonly privateProjectionRevision: string;
    readonly reconciliationResultRevision: string;
    readonly validationOwnerRevision: string;
    readonly terminalCoverageRevision: string;
    readonly postFlatRevision: string;
    readonly financialOwnerRevision: string;
    readonly entryAuthorityId: string;
    readonly flattenAuthorityId: string;
    readonly entryAuthorityConsumedAtMs: number;
    readonly flattenAuthorityConsumedAtMs: number;
    readonly ticketCreatedAtMs: number;
    readonly ticketExpiresAtMs: number;
    readonly validationObservedAtMs: number;
    readonly terminalObservedAtMs: number;
    readonly postFlatObservedAtMs: number;
    readonly reconciliationObservedAtMs: number;
    readonly financialObservedAtMs: number;
    readonly cumulativeFilledQuantity: string;
    readonly cumulativeFlattenedQuantity: string;
    readonly residualBaseQuantity: string;
    readonly canonicalReconciliationStatus: string;
    readonly ledgerProjectionState: string;
    readonly disarmCommandId: string;
    readonly disarmPreviewDigest: string;
    readonly disarmRecordedAtMs: number;
    readonly disarmedArmId: string;
    readonly committedControlRevision: number;
    readonly postDisarmOwnerRevision: string;
    readonly postDisarmObservedAtMs: number;
    readonly quoteAsset: string;
    readonly feeRowsDigest: string;
    readonly cashCommittedQuote: string;
    readonly orderNotionalQuote: string;
    readonly flattenNotionalQuote: string;
    readonly grossExposureQuote: string;
    readonly feesQuote: string;
    readonly maximumLossQuote: string;
  }> | null;
  readonly mode: 'VALIDATE_ONLY';
  readonly executionAuthority: 'NONE';
  readonly routeAuthority: 'NONE';
  readonly persistenceAuthorization: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly permittedExternalActions: readonly never[];
  readonly sendsPerformed: 0;
  readonly sideEffectsPerformed: 0;
  readonly networkCallsPerformed: 0;
  readonly credentialReadsPerformed: 0;
  readonly privateReadsPerformed: 0;
  readonly providerCallsPerformed: 0;
  readonly moneyMutationsPerformed: 0;
  readonly persistenceWritesPerformed: 0;
  readonly controlMutationsPerformed: 0;
  readonly receiptDigest: string;
}

type PlainRecord = Record<string, unknown>;

class ReceiptValidationError extends Error {
  readonly code: M0ReceiptReasonCode;

  constructor(code: M0ReceiptReasonCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface SnapshotBudget {
  nodes: number;
}

interface ParsedFact {
  readonly record: PlainRecord;
  readonly binding: PlainRecord;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

interface ParsedAuthority {
  readonly phase: 'ENTRY' | 'FLATTEN';
  readonly authorizationId: string;
  readonly consumedNotionalQuote: string;
  readonly maxOrderNotionalQuote: string;
  readonly confirmedAtMs: number;
  readonly expiresAtMs: number;
  readonly consumedAtMs: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fail(
  code: M0ReceiptReasonCode,
  message: string,
): never {
  throw new ReceiptValidationError(code, message);
}

function taggedSha256(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) {
    return value as Readonly<T>;
  }
  seen.add(value as object);
  for (const child of Object.values(value as PlainRecord)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

/**
 * Copy plain data without invoking user accessors. isProxy() is checked before
 * prototype/key/descriptor inspection, so hostile traps are never consulted.
 */
function snapshotPlainData(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget: SnapshotBudget = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (depth > MAX_INPUT_DEPTH || budget.nodes > MAX_INPUT_NODES) {
    throw new TypeError('input exceeds bounded shape limits');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (
      value.length > MAX_STRING_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      SENSITIVE_VALUE.test(value) ||
      REMOTE_VALUE.test(value)
    ) {
      throw new TypeError('input string is unsafe or unbounded');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('input number is not finite canonical data');
    }
    return value;
  }
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new TypeError('input contains unsupported data');
  }

  const object = value as object;
  if (isProxy(object)) throw new TypeError('proxy input is forbidden');
  if (seen.has(object)) throw new TypeError('cyclic input is forbidden');
  seen.add(object);
  try {
    const symbols = Object.getOwnPropertySymbols(object);
    if (symbols.length !== 0) throw new TypeError('symbol fields are forbidden');
    const prototype = Object.getPrototypeOf(object);
    const descriptors = Object.getOwnPropertyDescriptors(object) as Record<
      string,
      PropertyDescriptor
    >;

    if (Array.isArray(object)) {
      if (prototype !== Array.prototype || object.length > MAX_ARRAY_LENGTH) {
        throw new TypeError('array input is invalid or unbounded');
      }
      const descriptorKeys = Object.keys(descriptors);
      if (
        descriptorKeys.length !== object.length + 1 ||
        !descriptorKeys.includes('length')
      ) {
        throw new TypeError('array input is sparse or extended');
      }
      const copy: unknown[] = [];
      for (let index = 0; index < object.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          !('value' in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        ) {
          throw new TypeError('array item must be an enumerable data field');
        }
        copy.push(
          snapshotPlainData(
            descriptor.value,
            depth + 1,
            seen,
            budget,
          ),
        );
      }
      return copy;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('class instances are forbidden');
    }
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_OBJECT_KEYS) {
      throw new TypeError('object contains too many fields');
    }
    const copy = Object.create(null) as PlainRecord;
    for (const key of keys) {
      if (
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor'
      ) {
        throw new TypeError('prototype-affecting fields are forbidden');
      }
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.enumerable !== true
      ) {
        throw new TypeError('object field must be enumerable plain data');
      }
      Object.defineProperty(copy, key, {
        value: snapshotPlainData(
          descriptor.value,
          depth + 1,
          seen,
          budget,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    seen.delete(object);
  }
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  const record = value as PlainRecord;
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw new TypeError(`${label} is not a closed schema`);
  }
  return record;
}

function exactArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function validUtcMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_UTC_MS
  );
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_IDENTITY_LENGTH &&
    IDENTIFIER.test(value)
  );
}

function canonicalDecimal(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be an exact decimal`);
  }
  const normalized = normalizeSpotDecimal(value, label);
  if (normalized !== value) {
    throw new TypeError(`${label} must already be canonical`);
  }
  return normalized;
}

function positiveDecimal(value: unknown, label: string): string {
  const decimal = canonicalDecimal(value, label);
  if (compareSpotDecimals(decimal, '0') <= 0) {
    throw new TypeError(`${label} must be positive`);
  }
  return decimal;
}

function freshFact(
  record: PlainRecord,
  evaluatedAtMs: number,
  maximumAgeMs: number,
): boolean {
  return (
    validUtcMs(record.observedAtMs) &&
    validUtcMs(record.validUntilMs) &&
    record.observedAtMs <= evaluatedAtMs &&
    evaluatedAtMs - record.observedAtMs <= maximumAgeMs &&
    record.validUntilMs > evaluatedAtMs &&
    record.observedAtMs < record.validUntilMs
  );
}

function parseTicket(value: unknown): Readonly<SpotExecutionTicket> {
  try {
    const ticket = value as PlainRecord;
    const rebuilt = createSpotExecutionTicket({
      correlationId: ticket.correlationId as string,
      planId: ticket.planId as string,
      accountId: ticket.accountId as string,
      symbol: ticket.symbol as string,
      side: ticket.side as SpotExecutionTicket['side'],
      type: ticket.type as SpotExecutionTicket['type'],
      timeInForce: ticket.timeInForce as SpotExecutionTicket['timeInForce'],
      quantity: ticket.quantity as string,
      price: ticket.price as string | null,
      riskReferencePrice: ticket.riskReferencePrice as string,
      estimatedMaxLossQuote: ticket.estimatedMaxLossQuote as string,
      purpose: ticket.purpose as SpotExecutionTicket['purpose'],
      attempt: ticket.attempt as number,
      createdAtMs: ticket.createdAtMs as number,
      expiresAtMs: ticket.expiresAtMs as number,
    });
    if (canonicalJson(ticket) !== canonicalJson(rebuilt)) {
      fail(
        'IDENTITY_BINDING_INVALID',
        'ticket is not its canonical reconstruction',
      );
    }
    return rebuilt;
  } catch (error) {
    if (error instanceof ReceiptValidationError) throw error;
    fail('IDENTITY_BINDING_INVALID', 'ticket is invalid');
  }
}

function parseBinding(
  value: unknown,
  ticket: Readonly<SpotExecutionTicket>,
  flattenClientOrderId: string,
  replayDigest: string,
  replayState: Readonly<SpotLifecycleState> | null,
): PlainRecord {
  try {
    const binding = closedRecord(value, BINDING_KEYS, 'receipt binding');
    if (
      binding.schema !== M0_RECEIPT_BINDING_SCHEMA ||
      binding.version !== 1 ||
      binding.ticketId !== ticket.ticketId ||
      binding.termsDigest !== ticket.termsDigest ||
      binding.clientOrderId !== ticket.clientOrderId ||
      binding.flattenClientOrderId !== flattenClientOrderId ||
      binding.correlationId !== ticket.correlationId ||
      binding.accountId !== ticket.accountId ||
      binding.symbol !== ticket.symbol ||
      !validIdentifier(binding.sourceVenueOrderId) ||
      !validIdentifier(binding.flattenVenueOrderId) ||
      binding.sourceVenueOrderId === binding.flattenVenueOrderId ||
      binding.lifecycleReplayDigest !== replayDigest ||
      typeof binding.privateSourceCutRevision !== 'string' ||
      !PRIVATE_SOURCE_CUT_REVISION.test(binding.privateSourceCutRevision) ||
      typeof binding.privateProjectionRevision !== 'string' ||
      !PRIVATE_PROJECTION_REVISION.test(binding.privateProjectionRevision) ||
      typeof binding.reconciliationResultRevision !== 'string' ||
      !FOUNDATION_RECONCILIATION_RESULT_REVISION.test(
        binding.reconciliationResultRevision,
      ) ||
      (replayState !== null &&
        replayState.venueOrderId !== binding.sourceVenueOrderId)
    ) {
      fail('IDENTITY_BINDING_INVALID', 'receipt identity binding is invalid');
    }
    return binding;
  } catch (error) {
    if (error instanceof ReceiptValidationError) throw error;
    fail('IDENTITY_BINDING_INVALID', 'receipt identity binding is invalid');
  }
}

function parseBoundFact(
  value: unknown,
  extraKeys: readonly string[],
  expectedBinding: PlainRecord,
  evaluatedAtMs: number,
  maximumAgeMs: number,
  label: string,
  failureCode: M0ReceiptReasonCode,
): ParsedFact {
  try {
    const record = closedRecord(
      value,
      [...FACT_BASE_KEYS, ...extraKeys],
      label,
    );
    const binding = closedRecord(record.binding, BINDING_KEYS, `${label} binding`);
    if (
      canonicalJson(binding) !== canonicalJson(expectedBinding) ||
      record.version !== 1 ||
      !validIdentifier(record.ownerRevision) ||
      !freshFact(record, evaluatedAtMs, maximumAgeMs)
    ) {
      fail(failureCode, `${label} is stale, foreign, or malformed`);
    }
    return {
      record,
      binding,
      observedAtMs: record.observedAtMs as number,
      validUntilMs: record.validUntilMs as number,
    };
  } catch (error) {
    if (error instanceof ReceiptValidationError) throw error;
    fail(failureCode, `${label} is stale, foreign, or malformed`);
  }
}

function axis(reasons: readonly M0ReceiptReasonCode[]): Readonly<M0ReceiptAxis> {
  const reasonCodes = Object.freeze([...new Set(reasons)].sort()) as readonly M0ReceiptReasonCode[];
  return Object.freeze({
    state: reasonCodes.length === 0 ? 'PROVED' as const : 'NOT_PROVED' as const,
    reasonCodes,
  });
}

function inertCore() {
  return {
    mode: 'VALIDATE_ONLY' as const,
    executionAuthority: 'NONE' as const,
    routeAuthority: 'NONE' as const,
    persistenceAuthorization: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
    permittedExternalActions: Object.freeze([]) as readonly never[],
    sendsPerformed: 0 as const,
    sideEffectsPerformed: 0 as const,
    networkCallsPerformed: 0 as const,
    credentialReadsPerformed: 0 as const,
    privateReadsPerformed: 0 as const,
    providerCallsPerformed: 0 as const,
    moneyMutationsPerformed: 0 as const,
    persistenceWritesPerformed: 0 as const,
    controlMutationsPerformed: 0 as const,
  };
}

function finalizeReceipt(
  payload: Omit<
    M0AutomaticReceipt,
    'receiptId' | 'receiptDigest' |
    'mode' | 'executionAuthority' | 'routeAuthority' |
    'persistenceAuthorization' | 'externalActionAuthorization' |
    'permittedExternalActions' | 'sendsPerformed' |
    'sideEffectsPerformed' | 'networkCallsPerformed' |
    'credentialReadsPerformed' | 'privateReadsPerformed' |
    'providerCallsPerformed' | 'moneyMutationsPerformed' |
    'persistenceWritesPerformed' | 'controlMutationsPerformed'
  >,
): Readonly<M0AutomaticReceipt> {
  const semanticDigest = sha256(canonicalJson(payload));
  const core = {
    ...payload,
    receiptId: `m0r_${semanticDigest.slice(0, 32)}`,
    ...inertCore(),
  };
  return deepFreeze({
    ...core,
    receiptDigest: sha256(canonicalJson(core)),
  }) as Readonly<M0AutomaticReceipt>;
}

function invalidReceipt(
  reason: M0ReceiptReasonCode = 'INPUT_INVALID',
  inputEvidenceDigest: string | null = null,
): Readonly<M0AutomaticReceipt> {
  const targetAxis = (
    axisName: keyof M0AutomaticReceipt['axes'],
  ): Readonly<M0ReceiptAxis> => {
    const matches =
      (axisName === 'identity' && reason === 'IDENTITY_BINDING_INVALID') ||
      (axisName === 'validateOnly' && reason === 'VALIDATE_ONLY_FACT_INVALID') ||
      (axisName === 'authorities' && reason === 'AUTHORITY_FACT_INVALID') ||
      (axisName === 'flat' && [
        'LIFECYCLE_REPLAY_INVALID',
        'POSITIVE_FILL_NOT_PROVED',
        'TERMINAL_COVERAGE_INVALID',
        'POST_FLAT_TRUTH_INVALID',
      ].includes(reason)) ||
      (axisName === 'reconciliation' && reason === 'RECONCILIATION_NOT_EXACT') ||
      (axisName === 'disarm' && [
        'DISARM_PREVIEW_INVALID',
        'DISARM_RECEIPT_INVALID',
        'POST_DISARM_TRUTH_INVALID',
      ].includes(reason)) ||
      (axisName === 'financials' && reason === 'FINANCIAL_FACT_INVALID');
    return axis([matches ? reason : 'INPUT_INVALID']);
  };
  const axes = Object.freeze({
    identity: targetAxis('identity'),
    validateOnly: targetAxis('validateOnly'),
    authorities: targetAxis('authorities'),
    flat: targetAxis('flat'),
    reconciliation: targetAxis('reconciliation'),
    disarm: targetAxis('disarm'),
    financials: targetAxis('financials'),
  });
  return finalizeReceipt({
    schema: M0_AUTOMATIC_RECEIPT_SCHEMA,
    version: 1,
    sourceCommitSha: null,
    inputEvidenceDigest,
    evaluatedAtMs: null,
    evidenceAuthority: null,
    scope: 'M0_TICKET',
    claimBoundary: 'TRANSPORT_ONLY',
    disposition: 'NOT_PROVED',
    milestoneClaim: 'NOT_PROVED',
    liveCanaryProven: false,
    moneyMovementProven: false,
    providerAcceptance: 'NOT_CLAIMED',
    axes,
    reasonCodes: Object.freeze(
      reason === 'INPUT_INVALID'
        ? ['INPUT_INVALID']
        : ['INPUT_INVALID', reason].sort(),
    ) as readonly M0ReceiptReasonCode[],
    evidence: null,
  });
}

function validationReasons(
  fact: ParsedFact,
): M0ReceiptReasonCode[] {
  const value = fact.record;
  const codes = exactArray(value.blockingCodes, 'blocking codes');
  const actions = exactArray(
    value.permittedExternalActions,
    'permitted external actions',
  );
  return (
    value.schema === M0_VALIDATION_FACT_SCHEMA &&
    value.authority === 'FOUNDATION_EXECUTION' &&
    value.mode === 'VALIDATE_ONLY' &&
    value.localValidationPassed === true &&
    codes.length === 0 &&
    value.signedTestPerformed === false &&
    value.liveSendAuthorized === false &&
    value.sendsPerformed === 0 &&
    value.sideEffectsPerformed === 0 &&
    value.externalActionAuthorization === 'NONE' &&
    actions.length === 0 &&
    typeof value.quoteAsset === 'string' &&
    ASSET.test(value.quoteAsset) &&
    validIdentifier(value.filterEvidenceRevision) &&
    validIdentifier(value.venueEvidenceRevision) &&
    validIdentifier(value.riskEvidenceRevision)
  )
    ? []
    : ['VALIDATE_ONLY_FACT_INVALID'];
}

function parseAuthority(
  value: unknown,
  phase: 'ENTRY' | 'FLATTEN',
  binding: PlainRecord,
  evaluatedAtMs: number,
  maximumAgeMs: number,
): ParsedAuthority {
  const record = closedRecord(value, [
    'schema',
    'version',
    'binding',
    'authority',
    'ownerRevision',
    'phase',
    'authorizationId',
    'verification',
    'singleUse',
    'consumed',
    'consumptionCount',
    'consumedNotionalQuote',
    'maxOrderNotionalQuote',
    'confirmedAtMs',
    'expiresAtMs',
    'consumedAtMs',
  ], `${phase} consumed authority`);
  const authorityBinding = closedRecord(
    record.binding,
    BINDING_KEYS,
    `${phase} authority binding`,
  );
  const consumedNotionalQuote = positiveDecimal(
    record.consumedNotionalQuote,
    `${phase} consumed notional`,
  );
  const maxOrderNotionalQuote = positiveDecimal(
    record.maxOrderNotionalQuote,
    `${phase} maximum notional`,
  );
  if (
    record.schema !== M0_CONSUMED_AUTHORITY_SCHEMA ||
    record.version !== 1 ||
    canonicalJson(authorityBinding) !== canonicalJson(binding) ||
    record.authority !== 'CAPITAL_APPROVALS' ||
    !validIdentifier(record.ownerRevision) ||
    record.phase !== phase ||
    !validIdentifier(record.authorizationId) ||
    record.verification !== 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY' ||
    record.singleUse !== true ||
    record.consumed !== true ||
    record.consumptionCount !== 1 ||
    !validUtcMs(record.confirmedAtMs) ||
    !validUtcMs(record.expiresAtMs) ||
    !validUtcMs(record.consumedAtMs) ||
    record.confirmedAtMs > record.consumedAtMs ||
    record.consumedAtMs > evaluatedAtMs ||
    record.consumedAtMs < evaluatedAtMs - maximumAgeMs ||
    record.consumedAtMs >= record.expiresAtMs ||
    compareSpotDecimals(consumedNotionalQuote, maxOrderNotionalQuote) > 0 ||
    compareSpotDecimals(maxOrderNotionalQuote, '10') > 0
  ) {
    throw new TypeError(`${phase} authority is not exact current consumption proof`);
  }
  return {
    phase,
    authorizationId: record.authorizationId,
    consumedNotionalQuote,
    maxOrderNotionalQuote,
    confirmedAtMs: record.confirmedAtMs,
    expiresAtMs: record.expiresAtMs,
    consumedAtMs: record.consumedAtMs,
  };
}

function parseFeeRows(value: unknown): readonly Readonly<{
  asset: string;
  quantity: string;
  quoteEquivalent: string;
}>[] {
  const rows = exactArray(value, 'fee rows');
  if (rows.length === 0 || rows.length > 16) {
    throw new TypeError('fee rows must explicitly record bounded coverage');
  }
  const parsed = rows.map((row, index) => {
    const record = closedRecord(
      row,
      ['asset', 'quantity', 'quoteEquivalent'],
      `fee row ${index}`,
    );
    if (typeof record.asset !== 'string' || !ASSET.test(record.asset)) {
      throw new TypeError('fee asset is invalid');
    }
    return Object.freeze({
      asset: record.asset,
      quantity: canonicalDecimal(record.quantity, 'fee quantity'),
      quoteEquivalent: canonicalDecimal(
        record.quoteEquivalent,
        'fee quote equivalent',
      ),
    });
  });
  return Object.freeze(
    [...parsed].sort((left, right) => {
      const leftCanonical = canonicalJson(left);
      const rightCanonical = canonicalJson(right);
      return leftCanonical < rightCanonical
        ? -1
        : leftCanonical > rightCanonical
          ? 1
          : 0;
    }),
  );
}

function closedLifecycleEvents(value: unknown): readonly SpotLifecycleEvent[] {
  const rows = exactArray(value, 'lifecycle events');
  if (rows.length === 0 || rows.length > 128) {
    fail('LIFECYCLE_REPLAY_INVALID', 'lifecycle event count is invalid');
  }
  const eventKeys: Readonly<Record<string, readonly string[]>> = Object.freeze({
    PREPARED: Object.freeze([
      'type', 'eventId', 'sequence', 'originalClientOrderId',
      'targetQuantity',
    ]),
    SUBMIT_STARTED: Object.freeze(['type', 'eventId', 'sequence']),
    OUTCOME_AMBIGUOUS: Object.freeze([
      'type', 'eventId', 'sequence', 'cause',
    ]),
    ORDER_ACKNOWLEDGED: Object.freeze([
      'type', 'eventId', 'sequence', 'venueOrderId',
      'cumulativeFilledQuantity',
    ]),
    FILL_OBSERVED: Object.freeze([
      'type', 'eventId', 'sequence', 'venueOrderId',
      'cumulativeFilledQuantity',
    ]),
    ORDER_PROVEN_ABSENT: Object.freeze(['type', 'eventId', 'sequence']),
    CANCEL_REQUESTED: Object.freeze(['type', 'eventId', 'sequence']),
    ORDER_CANCELLED: Object.freeze([
      'type', 'eventId', 'sequence', 'venueOrderId',
      'cumulativeFilledQuantity',
    ]),
    FLATTEN_REQUIRED: Object.freeze([
      'type', 'eventId', 'sequence', 'sourceOrderTerminal',
    ]),
    FLATTEN_STARTED: Object.freeze(['type', 'eventId', 'sequence']),
    FLATTEN_FILL_OBSERVED: Object.freeze([
      'type', 'eventId', 'sequence', 'cumulativeFlattenedQuantity',
    ]),
    FLAT_CONFIRMED: Object.freeze(['type', 'eventId', 'sequence']),
    FAILED: Object.freeze([
      'type', 'eventId', 'sequence', 'failureCode',
      'venueOrderTerminal',
    ]),
  });
  return rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      fail('LIFECYCLE_REPLAY_INVALID', `lifecycle event ${index} is invalid`);
    }
    const type = (row as PlainRecord).type;
    const keys = typeof type === 'string' ? eventKeys[type] : undefined;
    if (keys === undefined) {
      fail('LIFECYCLE_REPLAY_INVALID', `lifecycle event ${index} has unknown type`);
    }
    const event = closedRecord(
      row,
      keys,
      `lifecycle event ${index}`,
    );
    if (
      !validIdentifier(event.eventId) ||
      !Number.isSafeInteger(event.sequence) ||
      Number(event.sequence) < 1
    ) {
      fail('LIFECYCLE_REPLAY_INVALID', `lifecycle event ${index} has invalid envelope`);
    }
    for (const quantityField of [
      'targetQuantity',
      'cumulativeFilledQuantity',
      'cumulativeFlattenedQuantity',
    ]) {
      if (quantityField in event) {
        try {
          canonicalDecimal(
            event[quantityField],
            `lifecycle event ${index} ${quantityField}`,
          );
        } catch {
          fail(
            'LIFECYCLE_REPLAY_INVALID',
            `lifecycle event ${index} contains a non-canonical decimal`,
          );
        }
      }
    }
    return event as unknown as SpotLifecycleEvent;
  });
}

function receiptPayload(input: unknown): Omit<
  M0AutomaticReceipt,
  'receiptId' | 'receiptDigest' |
  'mode' | 'executionAuthority' | 'routeAuthority' |
  'persistenceAuthorization' | 'externalActionAuthorization' |
  'permittedExternalActions' | 'sendsPerformed' |
  'sideEffectsPerformed' | 'networkCallsPerformed' |
  'credentialReadsPerformed' | 'privateReadsPerformed' |
  'providerCallsPerformed' | 'moneyMutationsPerformed' |
  'persistenceWritesPerformed' | 'controlMutationsPerformed'
> {
  const top = closedRecord(input, INPUT_KEYS, 'M0 receipt input');
  if (
    top.schema !== M0_AUTOMATIC_RECEIPT_INPUT_SCHEMA ||
    top.version !== 1 ||
    typeof top.sourceCommitSha !== 'string' ||
    !COMMIT_SHA.test(top.sourceCommitSha) ||
    !validUtcMs(top.evaluatedAtMs) ||
    !Number.isSafeInteger(top.maxEvidenceAgeMs) ||
    Number(top.maxEvidenceAgeMs) < 1 ||
    Number(top.maxEvidenceAgeMs) > M0_MAX_EVIDENCE_AGE_MS ||
    !['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(
      String(top.evidenceAuthority),
    ) ||
    typeof top.flattenClientOrderId !== 'string' ||
    !validIdentifier(top.flattenClientOrderId)
  ) {
    throw new TypeError('M0 receipt envelope is invalid');
  }
  const evaluatedAtMs = top.evaluatedAtMs as number;
  const maximumAgeMs = top.maxEvidenceAgeMs as number;
  const ticket = parseTicket(top.ticket);
  if (
    ticket.purpose !== 'ENTRY' ||
    ticket.createdAtMs > evaluatedAtMs ||
    ticket.symbol.length > 30 ||
    !SYMBOL.test(ticket.symbol) ||
    top.flattenClientOrderId === ticket.clientOrderId
  ) {
    throw new TypeError('M0 entry identity is invalid');
  }

  const evidenceBundleDigest = taggedSha256(top);
  const lifecycle = closedRecord(
    top.lifecycle,
    ['schema', 'version', 'events', 'terminalCoverage', 'postFlat'],
    'lifecycle evidence',
  );
  if (
    lifecycle.schema !== M0_LIFECYCLE_EVIDENCE_SCHEMA ||
    lifecycle.version !== 1
  ) {
    fail('LIFECYCLE_REPLAY_INVALID', 'lifecycle envelope is invalid');
  }
  const events = closedLifecycleEvents(lifecycle.events);
  const replayDigest = taggedSha256(events);
  const replay = replaySpotLifecycle(events as readonly SpotLifecycleEvent[]);
  const replayState = replay.ok ? replay.state : null;
  const validationRaw = closedRecord(
    top.validation,
    [...FACT_BASE_KEYS, 'mode', 'localValidationPassed', 'blockingCodes',
      'signedTestPerformed', 'liveSendAuthorized', 'sendsPerformed',
      'sideEffectsPerformed', 'externalActionAuthorization',
      'permittedExternalActions', 'filterEvidenceRevision',
      'venueEvidenceRevision', 'riskEvidenceRevision', 'quoteAsset'],
    'validation fact',
  );
  const binding = parseBinding(
    validationRaw.binding,
    ticket,
    top.flattenClientOrderId,
    replayDigest,
    replayState,
  );

  const identityReasons: M0ReceiptReasonCode[] = [];
  if (
    replayState !== null &&
    (
      replayState.originalClientOrderId !== ticket.clientOrderId ||
      replayState.targetQuantity !== ticket.quantity
    )
  ) {
    identityReasons.push('IDENTITY_BINDING_INVALID');
  }

  const validation = parseBoundFact(
    top.validation,
    [
      'mode',
      'localValidationPassed',
      'blockingCodes',
      'signedTestPerformed',
      'liveSendAuthorized',
      'sendsPerformed',
      'sideEffectsPerformed',
      'externalActionAuthorization',
      'permittedExternalActions',
      'filterEvidenceRevision',
      'venueEvidenceRevision',
      'riskEvidenceRevision',
      'quoteAsset',
    ],
    binding,
    evaluatedAtMs,
    maximumAgeMs,
    'validation fact',
    'VALIDATE_ONLY_FACT_INVALID',
  );
  const validateOnlyReasons = validationReasons(validation);

  const terminal = parseBoundFact(
    lifecycle.terminalCoverage,
    [
      'coveredThroughSequence',
      'sourceOrderTerminal',
      'flattenOrderTerminal',
      'sourceFillsComplete',
      'flattenFillsComplete',
      'sourceVenueOrderId',
      'flattenVenueOrderId',
      'lifecycleReplayDigest',
    ],
    binding,
    evaluatedAtMs,
    maximumAgeMs,
    'terminal coverage',
    'TERMINAL_COVERAGE_INVALID',
  );
  const postFlat = parseBoundFact(
    lifecycle.postFlat,
    [
      'scope',
      'status',
      'openOrderCount',
      'openOrdersComplete',
      'ordersComplete',
      'tradesComplete',
      'accountSnapshotComplete',
      'privateSourceCutRevision',
      'lifecycleReplayDigest',
    ],
    binding,
    evaluatedAtMs,
    Math.min(maximumAgeMs, M0_MAX_CURRENT_PRIVATE_AGE_MS),
    'post-flat private truth',
    'POST_FLAT_TRUTH_INVALID',
  );

  const flatReasons: M0ReceiptReasonCode[] = [];
  let filled = '0';
  let flattened = '0';
  let residual = '0';
  if (!replay.ok) {
    flatReasons.push('LIFECYCLE_REPLAY_INVALID');
  } else {
    filled = replay.state.cumulativeFilledQuantity;
    flattened = replay.state.cumulativeFlattenedQuantity;
    residual = spotResidualQuantity(replay.state);
    if (
      replay.state.lifecycle !== 'FLAT' ||
      compareSpotDecimals(filled, '0') <= 0 ||
      compareSpotDecimals(flattened, '0') <= 0
    ) {
      flatReasons.push('POSITIVE_FILL_NOT_PROVED');
    }
    if (compareSpotDecimals(residual, '0') !== 0) {
      flatReasons.push('POST_FLAT_TRUTH_INVALID');
    }
  }
  if (
    terminal.record.schema !== M0_TERMINAL_COVERAGE_SCHEMA ||
    terminal.record.authority !== 'FOUNDATION_EXECUTION' ||
    terminal.record.coveredThroughSequence !== replayState?.lastSequence ||
    terminal.record.sourceOrderTerminal !== true ||
    terminal.record.flattenOrderTerminal !== true ||
    terminal.record.sourceFillsComplete !== true ||
    terminal.record.flattenFillsComplete !== true ||
    terminal.record.sourceVenueOrderId !== binding.sourceVenueOrderId ||
    terminal.record.flattenVenueOrderId !== binding.flattenVenueOrderId ||
    terminal.record.lifecycleReplayDigest !== replayDigest
  ) {
    flatReasons.push('TERMINAL_COVERAGE_INVALID');
  }
  if (
    postFlat.record.schema !== M0_POST_FLAT_SCHEMA ||
    postFlat.record.authority !== 'L05_PRIVATE_TRUTH' ||
    postFlat.record.ownerRevision !== binding.privateProjectionRevision ||
    postFlat.record.scope !== 'ACCOUNT_WIDE' ||
    postFlat.record.status !== 'CURRENT_COMPLETE' ||
    postFlat.record.openOrderCount !== 0 ||
    postFlat.record.openOrdersComplete !== true ||
    postFlat.record.ordersComplete !== true ||
    postFlat.record.tradesComplete !== true ||
    postFlat.record.accountSnapshotComplete !== true ||
    postFlat.record.privateSourceCutRevision !== binding.privateSourceCutRevision ||
    postFlat.record.lifecycleReplayDigest !== replayDigest
  ) {
    flatReasons.push('POST_FLAT_TRUTH_INVALID');
  }

  const reconciliationReasons: M0ReceiptReasonCode[] = [];
  let reconciliation: ParsedFact | null = null;
  try {
    reconciliation = parseBoundFact(
      top.reconciliation,
      [
        'canonicalStatus',
        'ledgerState',
        'coverage',
        'sourceOrderCovered',
        'flattenOrderCovered',
        'fillsCovered',
        'feesCovered',
        'residualBaseQuantity',
        'accountDeltaExact',
        'privateSourceCutRevision',
        'lifecycleReplayDigest',
        'terminalCoverageRevision',
        'postFlatRevision',
      ],
      binding,
      evaluatedAtMs,
      Math.min(maximumAgeMs, M0_MAX_CURRENT_PRIVATE_AGE_MS),
      'reconciliation fact',
      'RECONCILIATION_NOT_EXACT',
    );
    const reconciledResidual = canonicalDecimal(
      reconciliation.record.residualBaseQuantity,
      'reconciled residual base quantity',
    );
    const discrepancy = classifySpotLedgerDiscrepancy({
      canonicalStatus:
        reconciliation.record.canonicalStatus as SpotReconciliationStatus,
      ledgerState:
        reconciliation.record.ledgerState as SpotLedgerProjectionState,
    });
    if (
      reconciliation.record.schema !== M0_RECONCILIATION_FACT_SCHEMA ||
      reconciliation.record.authority !== 'FOUNDATION_RECONCILIATION' ||
      reconciliation.record.ownerRevision !==
        binding.reconciliationResultRevision ||
      discrepancy.classification !== 'EXACT' ||
      reconciliation.record.coverage !== 'ACCOUNT_WIDE_COMPLETE' ||
      reconciliation.record.sourceOrderCovered !== true ||
      reconciliation.record.flattenOrderCovered !== true ||
      reconciliation.record.fillsCovered !== true ||
      reconciliation.record.feesCovered !== true ||
      reconciledResidual !== '0' ||
      reconciliation.record.accountDeltaExact !== true ||
      reconciliation.record.privateSourceCutRevision !==
        binding.privateSourceCutRevision ||
      reconciliation.record.lifecycleReplayDigest !== replayDigest ||
      reconciliation.record.terminalCoverageRevision !==
        terminal.record.ownerRevision ||
      reconciliation.record.postFlatRevision !== postFlat.record.ownerRevision
    ) {
      reconciliationReasons.push('RECONCILIATION_NOT_EXACT');
    }
    if (
      reconciledResidual !== '0' ||
      reconciliation.record.accountDeltaExact !== true
    ) {
      flatReasons.push('POST_FLAT_TRUTH_INVALID');
    }
  } catch (error) {
    reconciliationReasons.push(
      error instanceof ReceiptValidationError
        ? error.code
        : 'RECONCILIATION_NOT_EXACT',
    );
    flatReasons.push('POST_FLAT_TRUTH_INVALID');
  }

  const authorityReasons: M0ReceiptReasonCode[] = [];
  let entryAuthority: ParsedAuthority | null = null;
  let flattenAuthority: ParsedAuthority | null = null;
  try {
    entryAuthority = parseAuthority(
      top.entryAuthority,
      'ENTRY',
      binding,
      evaluatedAtMs,
      maximumAgeMs,
    );
    flattenAuthority = parseAuthority(
      top.flattenAuthority,
      'FLATTEN',
      binding,
      evaluatedAtMs,
      maximumAgeMs,
    );
    if (
      entryAuthority.authorizationId === flattenAuthority.authorizationId ||
      entryAuthority.consumedAtMs > flattenAuthority.consumedAtMs ||
      compareSpotDecimals(
        entryAuthority.consumedNotionalQuote,
        ticket.orderNotionalQuote,
      ) !== 0
    ) {
      authorityReasons.push('AUTHORITY_FACT_INVALID');
    }
  } catch {
    authorityReasons.push('AUTHORITY_FACT_INVALID');
  }

  const financialReasons: M0ReceiptReasonCode[] = [];
  let financial: ParsedFact | null = null;
  let cashCommitted = '0';
  let orderNotional = '0';
  let flattenNotional = '0';
  let grossExposure = '0';
  let feesQuote = '0';
  let maximumLoss = '0';
  let quoteAsset = '';
  let feeRowsDigest = '';
  try {
    financial = parseBoundFact(
      top.financials,
      [
        'quoteAsset',
        'cashCommittedQuote',
        'orderNotionalQuote',
        'flattenNotionalQuote',
        'grossExposureQuote',
        'fees',
        'feesQuote',
        'feeCoverageComplete',
        'maximumLossQuote',
      ],
      binding,
      evaluatedAtMs,
      maximumAgeMs,
      'financial fact',
      'FINANCIAL_FACT_INVALID',
    );
    cashCommitted = positiveDecimal(
      financial.record.cashCommittedQuote,
      'cash committed',
    );
    orderNotional = positiveDecimal(
      financial.record.orderNotionalQuote,
      'order notional',
    );
    flattenNotional = positiveDecimal(
      financial.record.flattenNotionalQuote,
      'flatten notional',
    );
    grossExposure = positiveDecimal(
      financial.record.grossExposureQuote,
      'gross exposure',
    );
    feesQuote = canonicalDecimal(financial.record.feesQuote, 'fees quote');
    maximumLoss = canonicalDecimal(
      financial.record.maximumLossQuote,
      'maximum loss',
    );
    const fees = parseFeeRows(financial.record.fees);
    feeRowsDigest = taggedSha256(fees);
    quoteAsset = financial.record.quoteAsset as string;
    const feeTotal = fees.reduce(
      (total, fee) => {
        const left = canonicalDecimal(total, 'fee total');
        const right = canonicalDecimal(
          fee.quoteEquivalent,
          'fee quote equivalent',
        );
        const [leftWhole, leftFraction = ''] = left.split('.');
        const [rightWhole, rightFraction = ''] = right.split('.');
        const scale = Math.max(leftFraction.length, rightFraction.length);
        const leftUnits = BigInt(`${leftWhole}${leftFraction.padEnd(scale, '0')}`);
        const rightUnits = BigInt(`${rightWhole}${rightFraction.padEnd(scale, '0')}`);
        const units = leftUnits + rightUnits;
        const digits = units.toString().padStart(scale + 1, '0');
        return scale === 0
          ? digits
          : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
            .replace(/\.?0+$/u, '');
      },
      '0',
    );
    if (
      financial.record.schema !== M0_FINANCIAL_FACT_SCHEMA ||
      financial.record.authority !== 'CAPITAL_FOUNDATION' ||
      typeof financial.record.quoteAsset !== 'string' ||
      !ASSET.test(financial.record.quoteAsset) ||
      financial.record.feeCoverageComplete !== true ||
      financial.record.quoteAsset !== validation.record.quoteAsset ||
      compareSpotDecimals(orderNotional, ticket.orderNotionalQuote) !== 0 ||
      compareSpotDecimals(maximumLoss, ticket.estimatedMaxLossQuote) !== 0 ||
      compareSpotDecimals(cashCommitted, orderNotional) !== 0 ||
      compareSpotDecimals(grossExposure, orderNotional) !== 0 ||
      compareSpotDecimals(cashCommitted, '10') > 0 ||
      compareSpotDecimals(flattenNotional, '10') > 0 ||
      compareSpotDecimals(grossExposure, '10') > 0 ||
      compareSpotDecimals(maximumLoss, cashCommitted) > 0 ||
      compareSpotDecimals(feesQuote, cashCommitted) > 0 ||
      compareSpotDecimals(feesQuote, feeTotal) !== 0
    ) {
      financialReasons.push('FINANCIAL_FACT_INVALID');
    }
  } catch (error) {
    financialReasons.push(
      error instanceof ReceiptValidationError
        ? error.code
        : 'FINANCIAL_FACT_INVALID',
    );
  }
  if (
    entryAuthority !== null &&
    flattenAuthority !== null
  ) {
    if (
      entryAuthority.confirmedAtMs < ticket.createdAtMs ||
      validation.observedAtMs > entryAuthority.confirmedAtMs ||
      entryAuthority.consumedAtMs < entryAuthority.confirmedAtMs ||
      entryAuthority.consumedAtMs >= ticket.expiresAtMs ||
      entryAuthority.consumedAtMs > terminal.observedAtMs ||
      flattenAuthority.confirmedAtMs < entryAuthority.consumedAtMs ||
      flattenAuthority.consumedAtMs < flattenAuthority.confirmedAtMs ||
      flattenAuthority.consumedAtMs > terminal.observedAtMs
    ) {
      authorityReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
    }
    if (
      compareSpotDecimals(
        flattenAuthority.consumedNotionalQuote,
        flattenNotional,
      ) !== 0
    ) {
      authorityReasons.push('AUTHORITY_FACT_INVALID');
      financialReasons.push('FINANCIAL_FACT_INVALID');
    }
  }

  const disarmReasons: M0ReceiptReasonCode[] = [];
  let disarmCommandId = '';
  let disarmPreviewDigest = '';
  let disarmedArmId = '';
  let committedControlRevision = 0;
  let disarmReceiptTime = 0;
  let postDisarmObserved = 0;
  let postDisarmOwnerRevision = '';
  try {
    const disarm = closedRecord(
      top.disarm,
      ['preview', 'receipt', 'postDisarm'],
      'disarm evidence',
    );
    const sanitizedPreview = closedRecord(
      disarm.preview,
      SANITIZED_DISARM_PREVIEW_KEYS,
      'sanitized disarm preview',
    );
    const previewCheck = validatePreview({
      ...sanitizedPreview,
      // Shape validation requires this field, but the pure receipt contract
      // deliberately neither accepts nor retains the live authorization tag.
      authorizationTag: `l14tag_${'A'.repeat(16)}`,
    });
    if (!previewCheck.ok) {
      disarmReasons.push('DISARM_PREVIEW_INVALID');
    } else {
      const preview = previewCheck.value as Readonly<DurableControlPreview>;
      const {
        previewDigest: suppliedPreviewDigest,
        authorizationTag: _authorizationTag,
        ...unsignedPreview
      } = preview;
      const action = preview.action;
      const actionRecord = action as unknown as PlainRecord;
      const arm = actionRecord.arm as PlainRecord | undefined;
      if (
        action.type !== 'DISARM' ||
        preview.riskWitness !== null ||
        actionDigestMismatch(preview) ||
        calculatePreviewDigest(unsignedPreview) !== suppliedPreviewDigest ||
        preview.generatedAtMs > evaluatedAtMs ||
        preview.expiresAtMs <= preview.generatedAtMs ||
        arm === undefined ||
        arm.owner !== 'CAPITAL_APPROVALS' ||
        !validIdentifier(arm.id)
      ) {
        disarmReasons.push('DISARM_PREVIEW_INVALID');
      } else {
        disarmCommandId = preview.commandId;
        disarmPreviewDigest = preview.previewDigest;
        disarmedArmId = arm.id as string;
        const receiptCheck = validateControlReceipt(disarm.receipt);
        if (!receiptCheck.ok) {
          disarmReasons.push('DISARM_RECEIPT_INVALID');
        } else {
          const receipt =
            receiptCheck.value as Readonly<ControlCommandReceipt>;
          disarmReceiptTime = receipt.recordedAtMs;
          committedControlRevision = receipt.committedControlRevision;
          if (
            receipt.commandId !== preview.commandId ||
            receipt.previewDigest !== preview.previewDigest ||
            receipt.actionType !== 'DISARM' ||
            receipt.disposition !== 'APPLIED' ||
            receipt.reasonCode !== 'CONTROL_APPLIED' ||
            receipt.applied !== true ||
            receipt.actorBinding !== preview.actorBinding ||
            receipt.expectedConfigVersion !== preview.expectedConfigVersion ||
            receipt.committedControlRevision !==
              preview.expectedControlRevision + 1 ||
            receipt.recordedAtMs < preview.generatedAtMs ||
            receipt.recordedAtMs >= preview.expiresAtMs ||
            receipt.recordedAtMs > evaluatedAtMs
          ) {
            disarmReasons.push('DISARM_RECEIPT_INVALID');
          }
        }
        const postDisarm = parseBoundFact(
          disarm.postDisarm,
          [
            'armId',
            'armRevision',
            'armDigest',
            'controlRevision',
            'status',
            'armed',
            'newRiskBlocked',
            'liveSendAuthorized',
          ],
          binding,
          evaluatedAtMs,
          Math.min(maximumAgeMs, M0_MAX_CURRENT_PRIVATE_AGE_MS),
          'post-disarm capital posture',
          'POST_DISARM_TRUTH_INVALID',
        );
        postDisarmObserved = postDisarm.observedAtMs;
        postDisarmOwnerRevision = postDisarm.record.ownerRevision as string;
        if (
          postDisarm.record.schema !== M0_POST_DISARM_SCHEMA ||
          postDisarm.record.authority !== 'CAPITAL_APPROVALS' ||
          postDisarm.record.armId !== arm.id ||
          postDisarm.record.armRevision !== arm.revision ||
          postDisarm.record.armDigest !== arm.digest ||
          !Number.isSafeInteger(postDisarm.record.controlRevision) ||
          Number(postDisarm.record.controlRevision) <
            committedControlRevision ||
          postDisarm.record.status !== 'DISARMED_SAFE' ||
          postDisarm.record.armed !== false ||
          postDisarm.record.newRiskBlocked !== true ||
          postDisarm.record.liveSendAuthorized !== false ||
          postDisarm.observedAtMs < disarmReceiptTime
        ) {
          disarmReasons.push('POST_DISARM_TRUTH_INVALID');
        }
      }
    }
  } catch (error) {
    disarmReasons.push(
      error instanceof ReceiptValidationError
        ? error.code
        : 'DISARM_PREVIEW_INVALID',
    );
  }

  if (validation.observedAtMs > terminal.observedAtMs) {
    validateOnlyReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
    flatReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }
  if (terminal.observedAtMs > postFlat.observedAtMs) {
    flatReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }
  if (
    reconciliation !== null &&
    (
      postFlat.observedAtMs !== reconciliation.observedAtMs ||
      postFlat.validUntilMs !== reconciliation.validUntilMs
    )
  ) {
    flatReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
    reconciliationReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }
  if (
    financial !== null &&
    reconciliation !== null &&
    (
      financial.observedAtMs < terminal.observedAtMs ||
      financial.observedAtMs > reconciliation.observedAtMs
    )
  ) {
    financialReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
    reconciliationReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }
  if (
    disarmReceiptTime !== 0 &&
    reconciliation !== null &&
    reconciliation.observedAtMs > disarmReceiptTime
  ) {
    reconciliationReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
    disarmReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }
  if (postDisarmObserved !== 0 && disarmReceiptTime > postDisarmObserved) {
    disarmReasons.push('EVIDENCE_CHRONOLOGY_INVALID');
  }

  const axes = Object.freeze({
    identity: axis(identityReasons),
    validateOnly: axis(validateOnlyReasons),
    authorities: axis(authorityReasons),
    flat: axis(flatReasons),
    reconciliation: axis(reconciliationReasons),
    disarm: axis(disarmReasons),
    financials: axis(financialReasons),
  });
  const reasonCodes = Object.freeze([
    ...new Set(
      Object.values(axes).flatMap((value) => value.reasonCodes),
    ),
  ].sort()) as readonly M0ReceiptReasonCode[];
  const disposition = reasonCodes.length === 0 ? 'PROVED' as const : 'NOT_PROVED' as const;

  return {
    schema: M0_AUTOMATIC_RECEIPT_SCHEMA,
    version: 1,
    sourceCommitSha: top.sourceCommitSha,
    inputEvidenceDigest: evidenceBundleDigest,
    evaluatedAtMs,
    evidenceAuthority: top.evidenceAuthority as M0EvidenceAuthority,
    scope: 'M0_TICKET',
    claimBoundary: 'TRANSPORT_ONLY',
    disposition,
    milestoneClaim:
      disposition === 'PROVED' ? 'VALIDATION_PROVED' : 'NOT_PROVED',
    liveCanaryProven: false,
    moneyMovementProven: false,
    providerAcceptance: 'NOT_CLAIMED',
    axes,
    reasonCodes,
    evidence: disposition === 'PROVED'
      ? Object.freeze({
          ticketId: ticket.ticketId,
          evidenceBundleDigest,
          termsDigest: ticket.termsDigest,
          clientOrderId: ticket.clientOrderId,
          flattenClientOrderId: top.flattenClientOrderId,
          correlationId: ticket.correlationId,
          accountId: ticket.accountId,
          symbol: ticket.symbol,
          sourceVenueOrderId: binding.sourceVenueOrderId as string,
          flattenVenueOrderId: binding.flattenVenueOrderId as string,
          lifecycleReplayDigest: replayDigest,
          privateSourceCutRevision:
            binding.privateSourceCutRevision as string,
          privateProjectionRevision:
            binding.privateProjectionRevision as string,
          reconciliationResultRevision:
            binding.reconciliationResultRevision as string,
          validationOwnerRevision:
            validation.record.ownerRevision as string,
          terminalCoverageRevision:
            terminal.record.ownerRevision as string,
          postFlatRevision: postFlat.record.ownerRevision as string,
          financialOwnerRevision:
            financial!.record.ownerRevision as string,
          entryAuthorityId: entryAuthority?.authorizationId ?? '',
          flattenAuthorityId: flattenAuthority?.authorizationId ?? '',
          entryAuthorityConsumedAtMs:
            entryAuthority?.consumedAtMs ?? 0,
          flattenAuthorityConsumedAtMs:
            flattenAuthority?.consumedAtMs ?? 0,
          ticketCreatedAtMs: ticket.createdAtMs,
          ticketExpiresAtMs: ticket.expiresAtMs,
          validationObservedAtMs: validation.observedAtMs,
          terminalObservedAtMs: terminal.observedAtMs,
          postFlatObservedAtMs: postFlat.observedAtMs,
          reconciliationObservedAtMs: reconciliation!.observedAtMs,
          financialObservedAtMs: financial!.observedAtMs,
          cumulativeFilledQuantity: filled,
          cumulativeFlattenedQuantity: flattened,
          residualBaseQuantity: residual,
          canonicalReconciliationStatus:
            reconciliation!.record.canonicalStatus as string,
          ledgerProjectionState:
            reconciliation!.record.ledgerState as string,
          disarmCommandId,
          disarmPreviewDigest,
          disarmRecordedAtMs: disarmReceiptTime,
          disarmedArmId,
          committedControlRevision,
          postDisarmOwnerRevision,
          postDisarmObservedAtMs: postDisarmObserved,
          quoteAsset,
          feeRowsDigest,
          cashCommittedQuote: cashCommitted,
          orderNotionalQuote: orderNotional,
          flattenNotionalQuote: flattenNotional,
          grossExposureQuote: grossExposure,
          feesQuote,
          maximumLossQuote: maximumLoss,
        })
      : null,
  };
}

function actionDigestMismatch(
  preview: Readonly<DurableControlPreview>,
): boolean {
  try {
    return durableActionDigest(preview.action) !== preview.actionDigest;
  } catch {
    return true;
  }
}

/**
 * Validate and compose one inert M0 receipt. Malformed or hostile input never
 * escapes as an exception and never produces a green axis.
 */
export function generateM0AutomaticReceipt(
  input: unknown,
): Readonly<M0AutomaticReceipt> {
  let snapshot: unknown;
  let inputEvidenceDigest: string | null = null;
  try {
    snapshot = snapshotPlainData(input);
    inputEvidenceDigest = taggedSha256(snapshot);
    return finalizeReceipt(receiptPayload(snapshot));
  } catch (error) {
    return invalidReceipt(
      error instanceof ReceiptValidationError
        ? error.code
        : 'INPUT_INVALID',
      inputEvidenceDigest,
    );
  }
}
