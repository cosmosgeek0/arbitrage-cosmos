/**
 * Direct-import production composition for one exact M0 Spot lifecycle.
 *
 * The route supplies only actor/request/card digests. This factory resolves all
 * executable values from a canonical server-held bundle, constructs the
 * narrow signed transport, binds it to the sole-Ledger lifecycle owner, and
 * returns no reusable execution authority.
 */
import {
  createHash,
} from 'node:crypto';
import {
  types as nodeUtilTypes,
} from 'node:util';
import {
  addSpotDecimals,
} from '../../foundation/exchange/binanceSpot/filters.js';
import type {
  SpotOwnerSendAuthority,
  SpotSignedTestEvidence,
} from '../../foundation/execution/spotCore.js';
import type {
  SpotCancelIntent,
  SpotFillObservation,
  SpotFlattenIntent,
  SpotMutationOutcome,
  SpotQueryByClientOrderIdIntent,
  SpotQueryFillsIntent,
  SpotQueryOutcome,
  SpotSignedTestOrderIntent,
  SpotLiveSubmitIntent,
  BinanceSpotExecutionPort,
} from '../../foundation/execution/spotPort.js';
import {
  calculateM0SpotIntentDigest,
  type M0SpotActionAuthority,
  type M0SpotLifecycleCard,
} from '../../foundation/execution/m0SpotLifecycleCard.js';
import type {
  SpotExecutionTicket,
} from '../../foundation/execution/spotTicket.js';
import {
  runSpotTransportCoordinator,
  type SpotAuthoritativeFlatEvidence,
  type SpotFlatEvidenceRequest,
  type SpotFlattenAttemptRecord,
  type SpotDeriveFlattenLegPort,
  type SpotMutationReservationReceipt,
  type SpotCancelReservationReceipt,
  type SpotTransportAdmission,
  type SpotTransportAction,
  type SpotTransportCoordinatorInput,
  type SpotTransportCoordinatorPorts,
  type SpotTransportLegInput,
} from '../../foundation/execution/spotTransportCoordinator.js';
import type {
  SpotLedgerAppendIntent,
} from '../../foundation/reconciliation/spotLedgerBridge.js';
import {
  createM0SpotProductionTransport,
  type M0SpotProductionSigner,
} from '../../liveEdge/adapters/binanceSpotExecution/productionTransport.js';
import {
  projectM0SpotPermissionTruth,
  type M0SpotPermissionEnvelope,
  type M0SpotPermissionTruth,
} from '../../binance/m0SpotPermissionTruth.js';
import {
  createBinanceSpotExecutionAdapter,
} from '../../liveEdge/adapters/binanceSpotExecution/adapter.js';
import {
  M0SpotLifecyclePersistenceAdapter,
  type M0SpotLifecycleActionResolver,
  type M0SpotLifecycleClock,
  type M0SpotLifecycleLedgerPort,
  type M0SpotLifecycleState,
} from '../persistence/m0SpotLifecyclePersistenceAdapter.js';
import {
  M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
  calculateM0SpotExecutableEntryEvidenceDigest,
  type M0SpotReadinessCard,
} from '../evidence/m0SpotReadinessCard.js';
import type {
  M0SpotApprovedLifecycleExecutionPort,
  M0SpotApprovedLifecycleExecutionInput,
  M0SpotRuntimeExecutionResult,
} from './m0SpotRuntimeBoundary.js';
import {
  M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
  validateM0SpotReadyCard,
} from './m0SpotRuntimeBoundary.js';

export interface M0SpotCanonicalActionOwner
extends M0SpotLifecycleActionResolver {
  resolveReservedMutation(input: Readonly<{
    action: 'ENTRY' | 'FLATTEN' | 'ENTRY_CANCEL' | 'FLATTEN_CANCEL';
    ticket: Readonly<SpotExecutionTicket>;
    intent: Readonly<
      SpotLiveSubmitIntent | SpotFlattenIntent | SpotCancelIntent
    >;
    state: Readonly<M0SpotLifecycleState>;
  }>): Readonly<M0SpotActionAuthority> | null;
}

export interface M0SpotCanonicalExecutionBundle {
  readonly card: Readonly<M0SpotLifecycleCard>;
  readonly entry: Readonly<SpotTransportLegInput>;
  readonly flatten: Readonly<SpotTransportLegInput> | null;
  readonly permissionEnvelope: Readonly<M0SpotPermissionEnvelope>;
  readonly readSigner: Readonly<M0SpotProductionSigner>;
  readonly executionSigner: Readonly<M0SpotProductionSigner>;
  readonly actionOwner: Readonly<M0SpotCanonicalActionOwner>;
  readonly readAdmission: (
    symbol: string,
    action: 'ENTRY' | 'FLATTEN',
    state: Readonly<M0SpotLifecycleState> | null,
  ) =>
    | Readonly<SpotTransportAdmission>
    | Promise<Readonly<SpotTransportAdmission>>;
  readonly verifySignedTestEvidence: (
    intent: Readonly<SpotSignedTestOrderIntent>,
    outcome: Readonly<SpotMutationOutcome>,
    evidence: Readonly<SpotSignedTestEvidence> | null,
  ) => boolean | Promise<boolean>;
  readonly readFlatEvidence: (
    request: Readonly<SpotFlatEvidenceRequest>,
  ) =>
    | Readonly<SpotAuthoritativeFlatEvidence>
    | null
    | Promise<Readonly<SpotAuthoritativeFlatEvidence> | null>;
  /**
   * A partial fill determines the exact SELL quantity only after venue
   * observation. The canonical owner derives one deterministic server-held
   * flatten leg; no HTTP field participates.
   */
  readonly deriveFlattenLeg: SpotDeriveFlattenLegPort;
}

export interface M0SpotCanonicalBundleResolver {
  resolve(input: Readonly<{
    operatorId: string;
    readinessDigest: `sha256:${string}`;
    lifecycleCardDigest: `sha256:${string}`;
  }>): Promise<Readonly<M0SpotCanonicalExecutionBundle> | null>;
  resolveRecovery(input: Readonly<{
    operatorId: string;
    lifecycleCardDigest: `sha256:${string}`;
  }>): Promise<Readonly<M0SpotCanonicalExecutionBundle> | null>;
}

export interface M0SpotProductionExecutorOptions {
  readonly ledger: Readonly<M0SpotLifecycleLedgerPort>;
  readonly clock: Readonly<M0SpotLifecycleClock>;
  readonly fetch: typeof fetch;
  readonly resolveBundle: Readonly<M0SpotCanonicalBundleResolver>;
  readonly identity: Readonly<{
    executorId: string;
    hostId: string;
    bootId: string;
    processId: string;
    revision: string;
  }>;
}

export interface M0SpotProductionExecutor
extends M0SpotApprovedLifecycleExecutionPort {
  /**
   * Startup-only recovery. It can acquire an existing locked lifecycle but
   * cannot arm a card, consume entry authority, or create a second entry.
   */
  recoverOnBoot(): Promise<Readonly<M0SpotRuntimeExecutionResult>>;
}

interface EffectCounts {
  privateCalls: number;
  signatures: number;
  transportCalls: number;
  authorityConsumptions: number;
  ledgerWrites: number;
  orders: number;
  moneyMutations: number;
}

function deepFreezeSnapshot<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        deepFreezeSnapshot(descriptor.value);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function plainDataGraph(
  value: unknown,
  seen: Set<object> = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) return true;
  if (typeof value !== 'object' || nodeUtilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== Array.prototype
  ) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return false;
      }
      if (Array.isArray(value) && key === 'length') return true;
      return descriptor.enumerable === true
        && plainDataGraph(descriptor.value, seen);
    });
  } finally {
    seen.delete(value);
  }
}

function exactPlainRecord(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== fields.length
      || fields.some((field) => {
        const descriptor = descriptors[field];
        return descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true;
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      fields.map((field) => [field, descriptors[field].value]),
    ));
  } catch {
    return null;
  }
}

function snapshotSigner(
  value: unknown,
): Readonly<M0SpotProductionSigner> | null {
  const record = exactPlainRecord(value, ['algorithm', 'apiKey', 'sign']);
  if (
    record === null
    || (
      record.algorithm !== 'ED25519'
      && record.algorithm !== 'HMAC_SHA256'
    )
    || typeof record.apiKey !== 'string'
    || typeof record.sign !== 'function'
  ) return null;
  const receiver = Object.freeze({
    algorithm: record.algorithm,
    apiKey: record.apiKey,
  });
  return Object.freeze({
    algorithm: record.algorithm,
    apiKey: record.apiKey,
    sign: (record.sign as M0SpotProductionSigner['sign']).bind(receiver),
  });
}

function snapshotCanonicalBundle(
  value: Readonly<M0SpotCanonicalExecutionBundle>,
): Readonly<M0SpotCanonicalExecutionBundle> | null {
  try {
    const bundle = exactPlainRecord(value, [
      'card',
      'entry',
      'flatten',
      'permissionEnvelope',
      'readSigner',
      'executionSigner',
      'actionOwner',
      'readAdmission',
      'verifySignedTestEvidence',
      'readFlatEvidence',
      'deriveFlattenLeg',
    ]);
    if (bundle === null) return null;
    const readSigner = snapshotSigner(bundle.readSigner);
    const executionSigner = snapshotSigner(bundle.executionSigner);
    const actionOwner = exactPlainRecord(
      bundle.actionOwner,
      ['resolve', 'resolveReservedMutation'],
    );
    if (
      readSigner === null
      || executionSigner === null
      || actionOwner === null
      || typeof actionOwner.resolve !== 'function'
      || typeof actionOwner.resolveReservedMutation !== 'function'
      || typeof bundle.readAdmission !== 'function'
      || typeof bundle.verifySignedTestEvidence !== 'function'
      || typeof bundle.readFlatEvidence !== 'function'
      || typeof bundle.deriveFlattenLeg !== 'function'
      || !plainDataGraph(bundle.card)
      || !plainDataGraph(bundle.entry)
      || (
        bundle.flatten !== null
        && !plainDataGraph(bundle.flatten)
      )
      || !plainDataGraph(bundle.permissionEnvelope)
    ) return null;
    const resolveActionSource = (
      actionOwner.resolve as M0SpotCanonicalActionOwner['resolve']
    );
    const resolveReservedMutationSource = (
      actionOwner.resolveReservedMutation as
        M0SpotCanonicalActionOwner['resolveReservedMutation']
    );
    const readAdmissionSource = (
      bundle.readAdmission as
        M0SpotCanonicalExecutionBundle['readAdmission']
    );
    const verifySignedTestEvidenceSource = (
      bundle.verifySignedTestEvidence as
        M0SpotCanonicalExecutionBundle['verifySignedTestEvidence']
    );
    const readFlatEvidenceSource = (
      bundle.readFlatEvidence as
        M0SpotCanonicalExecutionBundle['readFlatEvidence']
    );
    const deriveFlattenLegSource = (
      bundle.deriveFlattenLeg as
        M0SpotCanonicalExecutionBundle['deriveFlattenLeg']
    );
    const resolveAction = resolveActionSource.bind(actionOwner);
    const resolveReservedMutation =
      resolveReservedMutationSource.bind(actionOwner);
    const readAdmission = readAdmissionSource.bind(undefined);
    const verifySignedTestEvidence =
      verifySignedTestEvidenceSource.bind(undefined);
    const readFlatEvidence = readFlatEvidenceSource.bind(undefined);
    const deriveFlattenLeg = deriveFlattenLegSource.bind(undefined);
    return Object.freeze({
      card: deepFreezeSnapshot(structuredClone(
        bundle.card as M0SpotLifecycleCard,
      )),
      entry: deepFreezeSnapshot(structuredClone(
        bundle.entry as SpotTransportLegInput,
      )),
      flatten: bundle.flatten === null
        ? null
        : deepFreezeSnapshot(structuredClone(
            bundle.flatten as SpotTransportLegInput,
          )),
      permissionEnvelope: deepFreezeSnapshot(
        structuredClone(
          bundle.permissionEnvelope as M0SpotPermissionEnvelope,
        ),
      ),
      readSigner,
      executionSigner,
      actionOwner: Object.freeze({
        resolve: resolveAction,
        resolveReservedMutation,
      }),
      readAdmission,
      verifySignedTestEvidence,
      readFlatEvidence,
      deriveFlattenLeg,
    });
  } catch {
    return null;
  }
}

export function calculateM0SpotApiKeyFingerprint(
  apiKey: string,
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update('m0-spot-api-key-fingerprint\u0000', 'utf8')
    .update(apiKey, 'utf8')
    .digest('hex')}`;
}

const RUNTIME_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/u;
const EXACT_REVISION = /^[0-9a-f]{40}$/u;

function validExecutorIdentity(
  value: Readonly<M0SpotProductionExecutorOptions['identity']>,
): boolean {
  return RUNTIME_IDENTITY.test(value.executorId)
    && RUNTIME_IDENTITY.test(value.hostId)
    && RUNTIME_IDENTITY.test(value.bootId)
    && RUNTIME_IDENTITY.test(value.processId)
    && EXACT_REVISION.test(value.revision);
}

function bundleMatchesReadiness(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  truth: Readonly<M0SpotPermissionTruth>,
  readiness: Readonly<M0SpotApprovedLifecycleExecutionInput['readinessCard']>,
  identity: Readonly<M0SpotProductionExecutorOptions['identity']>,
  operatorId: string,
  nowMs: number,
  mode: 'ENTRY' | 'RECOVERY_ONLY',
): boolean {
  const readEvidence = truth.readSignerEvidence;
  const executionEvidence = truth.executionSignerEvidence;
  const readProfile = readiness.apiKeyPermissions.readProfile;
  const executionProfile = readiness.apiKeyPermissions.executionProfile;
  const ownerAuthority = bundle.entry.ownerAuthority;
  let executableEntryEvidenceDigest: `sha256:${string}`;
  try {
    executableEntryEvidenceDigest =
      calculateM0SpotExecutableEntryEvidenceDigest(Object.freeze({
        schema: M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
        version: 1 as const,
        ticket: bundle.entry.ticket,
        filterSnapshot: bundle.entry.filterSnapshot,
        documentaryNowMs: bundle.entry.nowMs ?? null,
        riskEvidence: bundle.entry.riskEvidence,
        venueEvidence: bundle.entry.venueEvidence,
        readiness: bundle.entry.readiness,
        signedTestEvidence: bundle.entry.signedTestEvidence,
        ownerAuthorityEvidence:
          ownerAuthority === null
            ? null
            : Object.freeze({
                schema: ownerAuthority.schema,
                authorizationId: ownerAuthority.authorizationId,
                verification: ownerAuthority.verification,
                ticketId: ownerAuthority.ticketId,
                termsDigest: ownerAuthority.termsDigest,
                clientOrderId: ownerAuthority.clientOrderId,
                maxOrderNotionalQuote:
                  ownerAuthority.maxOrderNotionalQuote,
                confirmedAtMs: ownerAuthority.confirmedAtMs,
                expiresAtMs: ownerAuthority.expiresAtMs,
                singleUse: ownerAuthority.singleUse,
              }),
      }));
  } catch {
    return false;
  }
  return (
    validExecutorIdentity(identity)
    && executableEntryEvidenceDigest
      === readiness.executableEntryEvidenceDigest
    && readiness.ownerId === operatorId
    && readiness.lifecycleCardDigest === bundle.card.cardDigest
    && readiness.revisionHost.revision === identity.revision
    && readiness.revisionHost.hostId === identity.hostId
    && (
      mode === 'RECOVERY_ONLY'
      || readiness.revisionHost.bootId === identity.bootId
    )
    && (
      mode === 'RECOVERY_ONLY'
      || readiness.revisionHost.processId === identity.processId
    )
    && readiness.namedExecutor.executorId === identity.executorId
    && readiness.namedExecutor.hostId === identity.hostId
    && (
      mode === 'RECOVERY_ONLY'
      || readiness.namedExecutor.bootId === identity.bootId
    )
    && (
      mode === 'RECOVERY_ONLY'
      || readiness.namedExecutor.processId === identity.processId
    )
    && bundle.card.ownerId === operatorId
    && bundle.card.accountId === readiness.accountMode.accountId
    && bundle.card.symbol === readiness.order.symbol
    && bundle.card.baseAsset === readiness.order.baseAsset
    && bundle.card.quoteAsset === readiness.order.quoteAsset
    && bundle.card.side === readiness.order.side
    && bundle.card.orderType === readiness.order.orderType
    && bundle.card.entryTicketId === readiness.clientIdentity.ticketId
    && bundle.card.entryTermsDigest
      === readiness.clientIdentity.termsDigest
    && bundle.card.entryClientOrderId
      === readiness.clientIdentity.entryClientOrderId
    && bundle.card.entryNotionalQuote === readiness.order.quoteAmount
    && bundle.card.maximumOrderNotionalQuote
      === readiness.limits.maximumOrderNotionalQuote
    && bundle.card.maximumSimultaneousExposureQuote
      === readiness.limits.maximumSimultaneousExposureQuote
    && bundle.card.maximumGrossLifecycleTurnoverQuote
      === readiness.limits.maximumGrossLifecycleTurnoverQuote
    && bundle.card.maximumResidualDustNotionalQuote
      === readiness.limits.maximumResidualDustNotionalQuote
    && bundle.card.maximumLossQuote === readiness.limits.maximumLossQuote
    && bundle.card.maximumExposureDurationMs
      === readiness.limits.maximumExposureDurationMs
    && bundle.card.maximumSignedTestSubmissions
      === readiness.limits.maximumSignedTestSubmissions
    && bundle.card.maximumEntrySubmissions
      === readiness.limits.maximumEntrySubmissions
    && bundle.card.maximumEntryCancelSubmissions
      === readiness.limits.maximumEntryCancelSubmissions
    && bundle.card.maximumFlattenSubmissions
      === readiness.limits.maximumFlattenSubmissions
    && bundle.card.maximumFlattenCancelSubmissions
      === readiness.limits.maximumFlattenCancelSubmissions
    && bundle.card.recoveryAuthorizedUntil === 'EXACT_FLAT_RECONCILED'
    && bundle.card.actionAllowlist.length
      === readiness.executorActionAllowlist.length
    && bundle.card.actionAllowlist.every(
      (action, index) =>
        action === readiness.executorActionAllowlist[index],
    )
    && bundle.card.filterSnapshotRevision
      === readiness.filters.snapshotRevision
    && bundle.card.feeEvidenceRevision
      === readiness.economics.evidenceRevision
    && bundle.entry.readiness.totalFeeReserveQuote
      === readiness.economics.totalFeeReserveQuote
    && bundle.card.privateReadRevision
      === readiness.apiKeyPermissions.evidenceRevision
    && bundle.card.signedTestEvidenceRevision
      === readiness.validation.evidenceRevision
    && bundle.card.controlRevision === readiness.revisionHost.revision
    && bundle.card.oneLifecycle === true
    && bundle.card.withdrawalsEnabled === false
    && bundle.card.transfersEnabled === false
    && bundle.card.futuresEnabled === false
    && bundle.card.marginBorrowEnabled === false
    && bundle.entry.ticket.ticketId === bundle.card.entryTicketId
    && bundle.entry.ticket.termsDigest === bundle.card.entryTermsDigest
    && bundle.entry.ticket.clientOrderId
      === bundle.card.entryClientOrderId
    && bundle.entry.ticket.symbol === bundle.card.symbol
    && bundle.entry.ticket.side === 'BUY'
    && bundle.entry.ticket.type === 'LIMIT'
    && bundle.entry.ticket.timeInForce === 'FOK'
    && bundle.entry.ticket.price === readiness.order.price
    && bundle.entry.ticket.quantity === readiness.order.baseQuantity
    && bundle.entry.ticket.orderNotionalQuote
      === readiness.order.quoteAmount
    && truth.state === 'VERIFIED'
    && truth.reasonCodes.length === 0
    && truth.accountRealmId === bundle.card.accountId
    && truth.accountRealmId === readiness.accountMode.accountId
    && truth.accountFingerprintRef
      === readiness.apiKeyPermissions.accountFingerprintRef
    && (
      mode === 'RECOVERY_ONLY'
      || truth.evidenceDigest === readiness.apiKeyPermissions.evidenceDigest
    )
    && truth.accountCanTrade === true
    && truth.keySpotTradeEnabled === true
    && truth.readingEnabled === true
    && truth.ipRestricted === true
    && truth.withdrawalsEnabled === false
    && truth.internalTransfersEnabled === false
    && truth.universalTransfersEnabled === false
    && truth.marginEnabled === false
    && truth.futuresEnabled === false
    && truth.validUntilMs > nowMs
    && truth.readApiKeyFingerprint
      === calculateM0SpotApiKeyFingerprint(bundle.readSigner.apiKey)
    && truth.executionApiKeyFingerprint
      === calculateM0SpotApiKeyFingerprint(bundle.executionSigner.apiKey)
    && truth.readApiKeyFingerprint !== truth.executionApiKeyFingerprint
    && truth.readApiKeyFingerprint === readProfile.signerFingerprint
    && truth.executionApiKeyFingerprint
      === executionProfile.signerFingerprint
    && truth.readProfile.profileId === readProfile.profileId
    && truth.executionProfile.profileId === executionProfile.profileId
    && readEvidence.endpointClass === 'USER_DATA'
    && executionEvidence.endpointClass === 'TRADE'
    && readEvidence.profileId === readProfile.profileId
    && executionEvidence.profileId === executionProfile.profileId
    && (
      mode === 'RECOVERY_ONLY'
      || readEvidence.permissionRevision === readProfile.permissionRevision
    )
    && (
      mode === 'RECOVERY_ONLY'
      || executionEvidence.permissionRevision
        === executionProfile.permissionRevision
    )
    && (
      mode === 'RECOVERY_ONLY'
      || readEvidence.signerRevision === readProfile.signerRevision
    )
    && (
      mode === 'RECOVERY_ONLY'
      || executionEvidence.signerRevision
        === executionProfile.signerRevision
    )
    && readEvidence.accountRealmId === bundle.card.accountId
    && executionEvidence.accountRealmId === bundle.card.accountId
    && readEvidence.accountFingerprintRef
      === truth.accountFingerprintRef
    && executionEvidence.accountFingerprintRef
      === truth.accountFingerprintRef
    && readEvidence.validUntilMs > nowMs
    && executionEvidence.validUntilMs > nowMs
    && truth.accountCanTradeEvidence.canTrade === true
    && truth.accountCanTradeEvidence.profileId
      === readiness.accountCanTrade.profileId
    && (
      mode === 'RECOVERY_ONLY'
      || truth.accountCanTradeEvidence.permissionRevision
        === readiness.accountCanTrade.permissionRevision
    )
    && truth.accountCanTradeEvidence.accountRealmId
      === readiness.accountCanTrade.accountRealmId
    && truth.accountCanTradeEvidence.accountFingerprintRef
      === readiness.accountCanTrade.accountFingerprintRef
  );
}

function effects(value: EffectCounts): Readonly<EffectCounts> {
  return Object.freeze({ ...value });
}

function runtimeResult(
  code: M0SpotRuntimeExecutionResult['code'],
  state: M0SpotRuntimeExecutionResult['state'],
  cardDigest: `sha256:${string}`,
  value: EffectCounts,
): Readonly<M0SpotRuntimeExecutionResult> {
  return Object.freeze({
    schema: M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
    ok: code === 'M0_LIFECYCLE_RECONCILED',
    code,
    state,
    cardDigest,
    ownerConfirmation: 'EXACT_CARD_ACKNOWLEDGED',
    queryBeforeRetry: true,
    blindResend: false,
    executionAuthorityReturned: 'NONE',
    effects: effects(value),
  });
}

function persistedAuthorizationId(
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  ticketId: string,
  actions: readonly string[],
): string | null {
  const rows = persistence.read()?.actions ?? [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (
      candidate !== undefined
      && candidate.receipt.ticketId === ticketId
      && actions.includes(candidate.receipt.action)
      && candidate.dispatchClaimed
    ) return candidate.receipt.authorizationId;
  }
  return null;
}

function terminalStatus(status: string): boolean {
  return [
    'FILLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'EXPIRED_IN_MATCH',
  ].includes(status);
}

function sumFillQuantities(
  fills: readonly Readonly<SpotFillObservation>[],
): string {
  return fills.reduce(
    (sum, fill) => addSpotDecimals(sum, fill.quantity),
    '0',
  );
}

function currentReadResponseAuthorizationId(
  state: Readonly<M0SpotLifecycleState> | null,
  action: 'QUERY_ORDER' | 'QUERY_FILLS',
  ticket: Readonly<SpotExecutionTicket> | null,
): string | null {
  if (
    state?.execution === null
    || state?.execution === undefined
    || ticket === null
  ) return null;
  const matches = state.actions.filter((candidate) =>
    candidate.receipt.action === action
    && candidate.operation === action
    && candidate.receipt.ticketId === ticket.ticketId
    && candidate.receipt.termsDigest === ticket.termsDigest
    && candidate.receipt.clientOrderId === ticket.clientOrderId
    && candidate.dispatchClaimed
    && candidate.dispatchLease?.requestId === state.execution?.requestId
    && candidate.dispatchLease?.clockFenceId
      === state.execution?.clockFenceId
    && candidate.egressConfirmation === 'RESPONSE_RECEIVED'
    && candidate.outcome === 'NONE',
  );
  return matches.length === 1
    ? matches[0]!.receipt.authorizationId
    : null;
}

function persistOutcome(
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  ticketId: string,
  actions: readonly string[],
  outcome: M0SpotPersistedOutcome,
  detail: string,
  counts: EffectCounts,
): void {
  const authorizationId = persistedAuthorizationId(
    persistence,
    ticketId,
    actions,
  );
  if (authorizationId === null) return;
  const result = persistence.recordMutationOutcome({
    authorizationId,
    outcome,
    detail,
  });
  if (result.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
}

type M0SpotPersistedOutcome =
  | 'unknown'
  | 'accepted'
  | 'accepted_reconciled'
  | 'not_sent'
  | 'not_sent_rejected'
  | 'not_sent_reconciled';

function wrapExecutionPort(
  source: Readonly<BinanceSpotExecutionPort>,
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  counts: EffectCounts,
): Readonly<BinanceSpotExecutionPort> {
  return Object.freeze({
    async signedTestOrder(
      intent: Readonly<SpotSignedTestOrderIntent>,
    ): Promise<SpotMutationOutcome> {
      const outcome = await source.signedTestOrder(intent);
      persistOutcome(
        persistence,
        intent.ticketId,
        ['SIGNED_TEST'],
        outcome.kind === 'ACKNOWLEDGED'
          ? 'accepted'
          : outcome.kind === 'REJECTED'
            ? 'not_sent_rejected'
            : 'unknown',
        outcome.kind,
        counts,
      );
      return outcome;
    },

    async submitLiveOrder(
      intent: Readonly<SpotLiveSubmitIntent>,
    ): Promise<SpotMutationOutcome> {
      const outcome = await source.submitLiveOrder(intent);
      // Once fetch was invoked even a 4xx response is reconciled by query.
      persistOutcome(
        persistence,
        intent.ticketId,
        ['ENTRY'],
        'unknown',
        outcome.kind,
        counts,
      );
      return outcome;
    },

    async queryByOriginalClientOrderId(
      intent: Readonly<SpotQueryByClientOrderIdIntent>,
    ): Promise<SpotQueryOutcome> {
      const outcome = await source.queryByOriginalClientOrderId(intent);
      const state = persistence.read();
      const persistedFlatten = [
        ...(state?.flattenHistory ?? []),
        ...(state?.flatten === null || state?.flatten === undefined
          ? []
          : [state.flatten]),
      ].find((candidate) =>
        candidate.ticket.ticketId === intent.ticketId,
      );
      const leg = persistedFlatten !== undefined
        ? 'FLATTEN'
        : 'ENTRY';
      const order = leg === 'ENTRY' ? state?.entry : persistedFlatten;
      const queryAuthorizationId = currentReadResponseAuthorizationId(
        state,
        'QUERY_ORDER',
        order?.ticket ?? null,
      );
      if (order == null || queryAuthorizationId === null) {
        return Object.freeze({
          kind: 'UNRESOLVED' as const,
          reasonCode: 'QUERY_ORDER_RESPONSE_PROOF_MISSING',
        });
      }
      if (outcome.kind === 'AUTHORITATIVE_NOT_FOUND') {
        const absent = persistence.recordAuthoritativeAbsence({
          leg,
          ticketId: intent.ticketId,
          queryAuthorizationId,
          originalClientOrderId: intent.originalClientOrderId,
          evidenceRevision:
            `venue-query-${queryAuthorizationId}-not-found`,
        });
        if (
          absent.disposition !== 'COMMITTED_NEW'
          && absent.disposition !== 'REPLAY_QUERY_ONLY'
        ) {
          return Object.freeze({
            kind: 'UNRESOLVED' as const,
            reasonCode: 'AUTHORITATIVE_ABSENCE_PERSISTENCE_CONFLICT',
          });
        }
        if (absent.disposition === 'COMMITTED_NEW') {
          counts.ledgerWrites += 1;
        }
        const confirmedLeg = leg === 'ENTRY'
          ? absent.state?.entry
          : [
              ...(absent.state?.flattenHistory ?? []),
              ...(absent.state?.flatten === null
                || absent.state?.flatten === undefined
                ? []
                : [absent.state.flatten]),
            ].find((candidate) =>
              candidate.ticket.ticketId === intent.ticketId,
            );
        if (
          confirmedLeg?.venueStatus !== 'AUTHORITATIVE_NOT_FOUND'
          || !confirmedLeg.terminal
          || !confirmedLeg.fillsComplete
        ) {
          return Object.freeze({
            kind: 'UNRESOLVED' as const,
            reasonCode: 'AUTHORITATIVE_ABSENCE_SETTLEMENT_PENDING',
          });
        }
        persistOutcome(
          persistence,
          intent.ticketId,
          leg === 'ENTRY' ? ['ENTRY'] : ['FLATTEN'],
          'not_sent_reconciled',
          'AUTHORITATIVE_NOT_FOUND',
          counts,
        );
      } else if (outcome.kind === 'FOUND' && outcome.venueOrderId !== null) {
        const observed = persistence.recordOrderObservation({
          leg,
          ticketId: intent.ticketId,
          queryAuthorizationId,
          venueOrderId: outcome.venueOrderId,
          venueStatus: outcome.status,
          terminal: terminalStatus(outcome.status),
          fillsComplete: false,
          cumulativeFilledQuantity: outcome.cumulativeFilledQuantity,
          evidenceRevision:
            `venue-query-${queryAuthorizationId}-${outcome.status}`,
        });
        if (observed.disposition === 'COMMITTED_NEW') {
          counts.ledgerWrites += 1;
        }
        if (
          observed.disposition !== 'COMMITTED_NEW'
          && observed.disposition !== 'REPLAY_QUERY_ONLY'
        ) {
          return Object.freeze({
            kind: 'UNRESOLVED' as const,
            reasonCode: 'ORDER_OBSERVATION_PERSISTENCE_CONFLICT',
          });
        }
        persistOutcome(
          persistence,
          intent.ticketId,
          leg === 'ENTRY' ? ['ENTRY'] : ['FLATTEN'],
          'accepted_reconciled',
          outcome.status,
          counts,
        );
      }
      return outcome;
    },

    async queryFills(
      intent: Readonly<SpotQueryFillsIntent>,
    ): Promise<readonly Readonly<SpotFillObservation>[]> {
      const rows = await source.queryFills(intent);
      const state = persistence.read();
      const persistedFlatten = [
        ...(state?.flattenHistory ?? []),
        ...(state?.flatten === null || state?.flatten === undefined
          ? []
          : [state.flatten]),
      ].find((candidate) =>
        candidate.ticket.ticketId === intent.ticketId,
      );
      const leg = persistedFlatten !== undefined
        ? 'FLATTEN'
        : 'ENTRY';
      const order = leg === 'ENTRY' ? state?.entry : persistedFlatten;
      if (
        state === null
        || order == null
        || order.venueOrderId === null
        || order.venueOrderId !== intent.venueOrderId
      ) throw new Error('M0_FILL_QUERY_ORDER_IDENTITY_CONFLICT');
      const queryAuthorizationId = currentReadResponseAuthorizationId(
        state,
        'QUERY_FILLS',
        order.ticket,
      );
      if (queryAuthorizationId === null) {
        throw new Error('M0_FILL_QUERY_RESPONSE_PROOF_MISSING');
      }
      const fillIds = new Set<string>();
      for (const fill of rows) {
        if (fillIds.has(fill.fillId)) {
          throw new Error('M0_FILL_QUERY_DUPLICATE');
        }
        fillIds.add(fill.fillId);
      }
      if (sumFillQuantities(rows) !== order.cumulativeFilledQuantity) {
        throw new Error('M0_FILL_SET_INCOMPLETE');
      }
      const recorded = persistence.recordFill({
        leg,
        ticketId: intent.ticketId,
        queryAuthorizationId,
        symbol: intent.symbol,
        fills: rows,
      });
      if (recorded.disposition === 'COMMITTED_NEW') {
        counts.ledgerWrites += 1;
      } else {
        throw new Error('M0_FILL_PERSISTENCE_CONFLICT');
      }
      const refreshed = persistence.read();
      const refreshedOrder = leg === 'ENTRY'
        ? refreshed?.entry
        : [
            ...(refreshed?.flattenHistory ?? []),
            ...(refreshed?.flatten === null
              || refreshed?.flatten === undefined
              ? []
              : [refreshed.flatten]),
          ].find((candidate) =>
            candidate.ticket.ticketId === intent.ticketId,
          );
      const persistedFillIds = new Set(
        refreshed?.fills
          .filter((fill) =>
            fill.leg === leg
            && fill.venueOrderId === intent.venueOrderId,
          )
          .map((fill) => fill.fillId) ?? [],
      );
      if (
        refreshedOrder?.venueOrderId === null
        || refreshedOrder?.venueOrderId === undefined
        || sumFillQuantities(rows)
          !== refreshedOrder.cumulativeFilledQuantity
        || persistedFillIds.size !== fillIds.size
        || [...fillIds].some((fillId) => !persistedFillIds.has(fillId))
      ) throw new Error('M0_FILL_SET_INCOMPLETE');
      if (!refreshedOrder.fillsComplete) {
        throw new Error('M0_FILL_COMPLETION_PERSISTENCE_CONFLICT');
      }
      return rows;
    },

    async cancel(
      intent: Readonly<SpotCancelIntent>,
    ): Promise<SpotMutationOutcome> {
      const outcome = await source.cancel(intent);
      persistOutcome(
        persistence,
        intent.ticketId,
        ['ENTRY_CANCEL', 'FLATTEN_CANCEL'],
        outcome.kind === 'ACKNOWLEDGED' ? 'accepted' : 'unknown',
        outcome.kind,
        counts,
      );
      return outcome;
    },

    async flatten(
      intent: Readonly<SpotFlattenIntent>,
    ): Promise<SpotMutationOutcome> {
      const outcome = await source.flatten(intent);
      persistOutcome(
        persistence,
        intent.flattenTicket.ticketId,
        ['FLATTEN'],
        'unknown',
        outcome.kind,
        counts,
      );
      return outcome;
    },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function countedFetch(
  source: typeof fetch,
  counts: EffectCounts,
): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    counts.privateCalls += 1;
    counts.transportCalls += 1;
    const url = new URL(requestUrl(input));
    const method = (init?.method ?? (
      input instanceof Request ? input.method : 'GET'
    )).toUpperCase();
    if (url.pathname === '/api/v3/order' && method === 'POST') {
      counts.orders += 1;
      counts.moneyMutations += 1;
    } else if (
      url.pathname === '/api/v3/order'
      && method === 'DELETE'
    ) {
      counts.moneyMutations += 1;
    }
    return source(input, init);
  }) as typeof fetch;
}

function countedSigner(
  source: Readonly<M0SpotProductionSigner>,
  counts: EffectCounts,
): Readonly<M0SpotProductionSigner> {
  const algorithm = source.algorithm;
  const apiKey = source.apiKey;
  const sign = source.sign.bind(source);
  return Object.freeze({
    algorithm,
    apiKey,
    async sign(payload: string): Promise<string> {
      counts.signatures += 1;
      return sign(payload);
    },
  });
}

function persistedFills(
  state: Readonly<M0SpotLifecycleState>,
  leg: 'ENTRY' | 'FLATTEN',
): readonly Readonly<SpotFillObservation>[] {
  return Object.freeze(
    state.fills
      .filter((fill) => fill.leg === leg)
      .map((fill) => Object.freeze({
        fillId: fill.fillId,
        venueOrderId: fill.venueOrderId,
        price: fill.price,
        quantity: fill.quantity,
        quoteQuantity: fill.quoteQuantity,
        commission: fill.commission,
        commissionAsset: fill.commissionAsset,
        occurredAtMs: fill.occurredAtMs,
      })),
  );
}

function persistedFlattenAttempts(
  state: Readonly<M0SpotLifecycleState>,
): readonly Readonly<SpotFlattenAttemptRecord>[] | null {
  const legs = Object.freeze([
    ...state.flattenHistory,
    ...(state.flatten === null ? [] : [state.flatten]),
  ]);
  const attempts: Readonly<SpotFlattenAttemptRecord>[] = [];
  for (const leg of legs) {
    if (
      !leg.terminal
      || !leg.fillsComplete
    ) return null;
    const authoritativelyAbsent =
      leg.venueOrderId === null
      && leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND'
      && leg.cumulativeFilledQuantity === '0';
    if (leg.venueOrderId === null && !authoritativelyAbsent) return null;
    attempts.push(Object.freeze({
      attempt: leg.ticket.attempt,
      ticket: leg.ticket,
      venueOrderId: leg.venueOrderId,
      authoritativelyAbsent,
      terminal: true as const,
      fillsComplete: true as const,
      fills: Object.freeze(
        leg.venueOrderId === null
          ? []
          : persistedFills(state, 'FLATTEN').filter(
              (fill) => fill.venueOrderId === leg.venueOrderId,
            ),
      ),
    }));
  }
  return Object.freeze(attempts);
}

function coordinatorInputFromReadiness(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  readiness: Readonly<M0SpotApprovedLifecycleExecutionInput['readinessCard']>,
  recovery: Readonly<{
    sourceVenueOrderId: string | null;
    priorFlattenAttempts: readonly Readonly<SpotFlattenAttemptRecord>[];
  }> | null,
): Readonly<SpotTransportCoordinatorInput> | null {
  const baseAsset = readiness.order.baseAsset;
  const quoteAsset = readiness.order.quoteAsset;
  const maximumGrossLifecycleTurnoverQuote =
    readiness.limits.maximumGrossLifecycleTurnoverQuote;
  const totalFeeReserveQuote =
    readiness.economics.totalFeeReserveQuote;
  const exchangeBaseTolerance =
    readiness.baseline.exchangeBaseTolerance;
  const maximumResidualDustNotionalQuote =
    readiness.limits.maximumResidualDustNotionalQuote;
  const baselineRevision = readiness.baseline.baselineRevision;
  const baselineQuantity = readiness.baseline.baselineBaseQuantity;
  const baselineQuoteQuantity =
    readiness.baseline.baselineQuoteQuantity;
  const quoteQuantityTolerance =
    readiness.baseline.quoteQuantityTolerance;
  const baselineObservedAtMs = readiness.baseline.observedAtMs;
  if (
    baseAsset === null
    || quoteAsset !== 'USDT'
    || maximumGrossLifecycleTurnoverQuote === null
    || totalFeeReserveQuote === null
    || exchangeBaseTolerance === null
    || maximumResidualDustNotionalQuote === null
    || baselineRevision === null
    || baselineQuantity === null
    || baselineQuoteQuantity === null
    || quoteQuantityTolerance === null
    || baselineObservedAtMs === null
  ) return null;
  return Object.freeze({
    entry: bundle.entry,
    flatten: bundle.flatten,
    baseAsset,
    quoteAsset,
    maximumGrossLifecycleTurnoverQuote,
    totalFeeReserveQuote,
    exchangeBaseTolerance,
    maximumResidualDustNotionalQuote,
    baseBalanceBaseline: Object.freeze({
      revision: baselineRevision,
      quantity: baselineQuantity,
      observedAtMs: baselineObservedAtMs,
    }),
    quoteBalanceBaseline: Object.freeze({
      revision: baselineRevision,
      quantity: baselineQuoteQuantity,
      tolerance: quoteQuantityTolerance,
      observedAtMs: baselineObservedAtMs,
    }),
    ...(recovery === null
      ? {}
      : {
          mode: 'RECOVERY_ONLY' as const,
          sourceVenueOrderId: recovery.sourceVenueOrderId,
          priorFlattenAttempts: recovery.priorFlattenAttempts,
        }),
  });
}

function createCoordinatorPorts(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  execution: Readonly<BinanceSpotExecutionPort>,
  counts: EffectCounts,
  flatCapture: {
    value: Readonly<SpotAuthoritativeFlatEvidence> | null;
  },
  clock: Readonly<M0SpotLifecycleClock>,
): Readonly<SpotTransportCoordinatorPorts> {
  return Object.freeze({
    clock,
    executionPort: execution,
    readAdmission: (
      symbol: string,
      action: SpotTransportAction,
    ) =>
      bundle.readAdmission(symbol, action, persistence.read()),
    async reserveMutation(
      _compatibilityAuthority: Readonly<SpotOwnerSendAuthority>,
      intent: Readonly<SpotLiveSubmitIntent | SpotFlattenIntent>,
    ): Promise<Readonly<SpotMutationReservationReceipt> | null> {
      const state = persistence.read();
      if (state === null) return null;
      const action = intent.kind === 'FLATTEN'
        ? 'FLATTEN' as const
        : 'ENTRY' as const;
      const ticket = intent.kind === 'FLATTEN'
        ? intent.flattenTicket
        : state.entryTicket;
      const authority = bundle.actionOwner.resolveReservedMutation({
        action,
        ticket,
        intent,
        state,
      });
      if (authority === null) return null;
      const reserved = persistence.reserveAction({
        action,
        authority,
        ticket,
        intent,
      });
      if (
        reserved.disposition !== 'COMMITTED_NEW'
        || reserved.receipt === undefined
      ) return null;
      counts.authorityConsumptions += 1;
      counts.ledgerWrites += 1;
      return Object.freeze({
        schema: 'cosmos.foundation.spot-mutation-reservation.v1' as const,
        action,
        ticketId: ticket.ticketId,
        termsDigest: ticket.termsDigest,
        clientOrderId: ticket.clientOrderId,
        intentDigest: reserved.receipt.intentDigest,
        durableAuthorityConsumed: true as const,
        canonicalOrderRequestAppended: true as const,
        dispatchClaimAvailable: true as const,
        replay: false as const,
      });
    },
    async reserveCancel(
      action: 'ENTRY_CANCEL' | 'FLATTEN_CANCEL',
      ticket: Readonly<SpotExecutionTicket>,
      intent: Readonly<SpotCancelIntent>,
    ): Promise<Readonly<SpotCancelReservationReceipt> | null> {
      let state = persistence.read();
      if (state === null) return null;
      const leg = action === 'ENTRY_CANCEL'
        ? state.entry
        : [
            ...state.flattenHistory,
            ...(state.flatten === null ? [] : [state.flatten]),
          ].find((candidate) =>
            candidate.ticket.ticketId === ticket.ticketId,
          ) ?? null;
      const intentDigest = calculateM0SpotIntentDigest(intent);
      if (
        leg === null
        || leg.terminal
        || leg.ticket.ticketId !== ticket.ticketId
        || leg.ticket.termsDigest !== ticket.termsDigest
        || leg.ticket.clientOrderId !== ticket.clientOrderId
        || intent.ticketId !== ticket.ticketId
        || intent.symbol !== ticket.symbol
        || intent.originalClientOrderId !== ticket.clientOrderId
        || intent.automaticRetry !== false
      ) return null;
      let reserved = [...state.actions].reverse().find((row) =>
        row.receipt.action === action
        && row.receipt.ticketId === ticket.ticketId
        && row.receipt.termsDigest === ticket.termsDigest
        && row.receipt.clientOrderId === ticket.clientOrderId
        && row.receipt.intentDigest === intentDigest,
      );
      let replay = reserved !== undefined;
      if (reserved === undefined) {
        const authority = bundle.actionOwner.resolveReservedMutation({
          action,
          ticket,
          intent,
          state,
        });
        if (authority === null) return null;
        const result = persistence.reserveAction({
          action,
          authority,
          ticket,
          intent,
        });
        if (
          result.disposition !== 'COMMITTED_NEW'
          || result.receipt === undefined
        ) return null;
        counts.authorityConsumptions += 1;
        counts.ledgerWrites += 1;
        state = result.state;
        reserved = state.actions.find((row) =>
          row.receipt.authorizationId
            === result.receipt!.authorizationId,
        );
        replay = false;
      }
      if (
        reserved === undefined
        || reserved.dispatchClaimed
        || reserved.requestDigest !== null
        || reserved.outcome !== 'NONE'
      ) return null;
      return Object.freeze({
        schema: 'cosmos.foundation.spot-cancel-reservation.v1' as const,
        action,
        ticketId: ticket.ticketId,
        termsDigest: ticket.termsDigest,
        clientOrderId: ticket.clientOrderId,
        intentDigest,
        durableAuthorityConsumed: true as const,
        canonicalCancelAttemptAppended: true as const,
        dispatchClaimAvailable: true as const,
        replay,
      });
    },
    deriveFlattenLeg: bundle.deriveFlattenLeg,
    verifySignedTestEvidence: bundle.verifySignedTestEvidence,
    appendLedger: async (
      intent: Readonly<SpotLedgerAppendIntent>,
    ) => {
      const appended = persistence.appendSpotLedgerIntent(intent);
      if (appended === 'APPENDED') counts.ledgerWrites += 1;
      return appended;
    },
    async readFlatEvidence(
      request: Readonly<SpotFlatEvidenceRequest>,
    ) {
      flatCapture.value = await bundle.readFlatEvidence(request);
      return flatCapture.value;
    },
  });
}

function createExecutionPort(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  options: Readonly<M0SpotProductionExecutorOptions>,
  counts: EffectCounts,
): Readonly<BinanceSpotExecutionPort> {
  const transport = createM0SpotProductionTransport({
    allowedSymbol: bundle.card.symbol,
    allowedCardDigest: bundle.card.cardDigest,
    recvWindowMs: 5_000,
    requestTimeoutMs: 5_000,
    clock: options.clock,
    readSigner: countedSigner(bundle.readSigner, counts),
    executionSigner: countedSigner(bundle.executionSigner, counts),
    egress: Object.freeze({
      async spend(
        input: Parameters<
          M0SpotLifecyclePersistenceAdapter['spend']
        >[0],
      ) {
        const before = persistence.read()?.revision ?? null;
        const receipt = await persistence.spend(input);
        const after = persistence.read()?.revision ?? null;
        if (
          receipt !== null
          && before !== null
          && after !== null
          && after > before
        ) counts.ledgerWrites += after - before;
        return receipt;
      },
      async confirm(
        input: Parameters<
          M0SpotLifecyclePersistenceAdapter['confirm']
        >[0],
      ) {
        const before = persistence.read()?.revision ?? null;
        const confirmed = await persistence.confirm(input);
        const after = persistence.read()?.revision ?? null;
        if (
          confirmed
          && before !== null
          && after !== null
          && after > before
        ) counts.ledgerWrites += after - before;
        return confirmed;
      },
    }),
    fetch: countedFetch(options.fetch, counts),
  });
  const adapter = createBinanceSpotExecutionAdapter({
    transport,
    authority: Object.freeze({
      async claimDispatch(
        input: Parameters<
          M0SpotLifecyclePersistenceAdapter['claimDispatch']
        >[0],
      ) {
        const before = persistence.read();
        const permit = await persistence.claimDispatch(input);
        const after = persistence.read();
        if (permit !== null && before !== null && after !== null) {
          counts.authorityConsumptions += Math.max(
            0,
            after.actions.length - before.actions.length,
          );
          counts.ledgerWrites += Math.max(
            0,
            after.revision - before.revision,
          );
        }
        return permit;
      },
    }),
  });
  return wrapExecutionPort(adapter, persistence, counts);
}

async function queryExactOrder(
  execution: Readonly<BinanceSpotExecutionPort>,
  ticket: Readonly<SpotExecutionTicket>,
): Promise<Readonly<SpotQueryOutcome>> {
  return execution.queryByOriginalClientOrderId(Object.freeze({
    kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
    ticketId: ticket.ticketId,
    symbol: ticket.symbol,
    originalClientOrderId: ticket.clientOrderId,
    readOnly: true as const,
  }));
}

async function queryExactFills(
  execution: Readonly<BinanceSpotExecutionPort>,
  ticket: Readonly<SpotExecutionTicket>,
  venueOrderId: string,
): Promise<void> {
  await execution.queryFills(Object.freeze({
    kind: 'QUERY_FILLS' as const,
    ticketId: ticket.ticketId,
    symbol: ticket.symbol,
    originalClientOrderId: ticket.clientOrderId,
    venueOrderId,
    readOnly: true as const,
  }));
}

async function settlePersistedFlatten(
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  execution: Readonly<BinanceSpotExecutionPort>,
): Promise<boolean> {
  let state = persistence.read();
  if (state === null) return false;
  const tickets = Object.freeze([
    ...state.flattenHistory.map((leg) => leg.ticket),
    ...(state.flatten === null ? [] : [state.flatten.ticket]),
  ]);
  for (const ticket of tickets) {
    state = persistence.read();
    let leg = [
      ...(state?.flattenHistory ?? []),
      ...(state?.flatten === null || state?.flatten === undefined
        ? []
        : [state.flatten]),
    ].find((candidate) =>
      candidate.ticket.ticketId === ticket.ticketId,
    );
    if (leg === undefined) return false;
    if (
      !leg.terminal
      || leg.venueStatus === 'AUTHORITATIVE_NOT_FOUND'
    ) {
      let observed = await queryExactOrder(execution, ticket);
      if (observed.kind === 'UNRESOLVED') return false;
      if (observed.kind === 'FOUND' && !terminalStatus(observed.status)) {
        await execution.cancel(Object.freeze({
          kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
          ticketId: ticket.ticketId,
          symbol: ticket.symbol,
          originalClientOrderId: ticket.clientOrderId,
          automaticRetry: false as const,
        }));
        observed = await queryExactOrder(execution, ticket);
        if (
          observed.kind !== 'FOUND'
          || !terminalStatus(observed.status)
        ) return false;
      }
      state = persistence.read();
      leg = [
        ...(state?.flattenHistory ?? []),
        ...(state?.flatten === null || state?.flatten === undefined
          ? []
          : [state.flatten]),
      ].find((candidate) =>
        candidate.ticket.ticketId === ticket.ticketId,
      );
      if (leg === undefined) return false;
    }
    if (leg.venueOrderId !== null && !leg.fillsComplete) {
      await queryExactFills(execution, ticket, leg.venueOrderId);
    }
  }
  state = persistence.read();
  return state !== null
    && [
      ...state.flattenHistory,
      ...(state.flatten === null ? [] : [state.flatten]),
    ].every((leg) => leg.terminal && leg.fillsComplete);
}

async function resumeLockedLifecycle(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  execution: Readonly<BinanceSpotExecutionPort>,
  counts: EffectCounts,
  clock: Readonly<M0SpotLifecycleClock>,
): Promise<'FLAT_RECONCILED' | 'RECOVERY_REQUIRED'> {
  let state = persistence.read();
  if (state === null || state.entry === null) return 'RECOVERY_REQUIRED';
  if (
    state.entry.venueOrderId === null
    && state.entry.venueStatus !== 'AUTHORITATIVE_NOT_FOUND'
  ) {
    const observed = await queryExactOrder(execution, state.entryTicket);
    if (observed.kind === 'UNRESOLVED') return 'RECOVERY_REQUIRED';
    state = persistence.read();
    if (state === null || state.entry === null) {
      return 'RECOVERY_REQUIRED';
    }
  }
  if (!await settlePersistedFlatten(persistence, execution)) {
    return 'RECOVERY_REQUIRED';
  }
  state = persistence.read();
  if (state === null || state.entry === null) return 'RECOVERY_REQUIRED';
  const attempts = persistedFlattenAttempts(state);
  if (attempts === null) return 'RECOVERY_REQUIRED';
  const coordinatorInput = coordinatorInputFromReadiness(
    bundle,
    state.readinessCard,
    Object.freeze({
      sourceVenueOrderId: state.entry.venueOrderId,
      priorFlattenAttempts: attempts,
    }),
  );
  if (coordinatorInput === null) return 'RECOVERY_REQUIRED';
  const flatCapture: {
    value: Readonly<SpotAuthoritativeFlatEvidence> | null;
  } = { value: null };
  const result = await runSpotTransportCoordinator(
    state.card.symbol,
    coordinatorInput,
    createCoordinatorPorts(
      bundle,
      persistence,
      execution,
      counts,
      flatCapture,
      clock,
    ),
  );
  if (
    result.status !== 'FLAT_RECONCILED'
    || flatCapture.value === null
    || flatCapture.value.canonicalStatus !== 'EXACT'
    || flatCapture.value.ledgerState !== 'MATCHED'
  ) return 'RECOVERY_REQUIRED';
  const disarmed = persistence.reconcileAndDisarm(flatCapture.value);
  if (disarmed.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
  return disarmed.disposition === 'COMMITTED_NEW'
    || disarmed.state?.phase === 'DISARMED_SAFE'
    ? 'FLAT_RECONCILED'
    : 'RECOVERY_REQUIRED';
}

function emptyCounts(): EffectCounts {
  return {
    privateCalls: 0,
    signatures: 0,
    transportCalls: 0,
    authorityConsumptions: 0,
    ledgerWrites: 0,
    orders: 0,
    moneyMutations: 0,
  };
}

function terminalRuntimeResult(
  state: Readonly<M0SpotLifecycleState>,
  cardDigest: `sha256:${string}`,
  counts: EffectCounts,
): Readonly<M0SpotRuntimeExecutionResult> | null {
  if (state.phase === 'DISARMED_SAFE') {
    return runtimeResult(
      'M0_LIFECYCLE_RECONCILED',
      'DISARMED_SAFE',
      cardDigest,
      counts,
    );
  }
  if (state.phase === 'DISARMED_NO_EXPOSURE') {
    return runtimeResult(
      'M0_CARD_NOT_READY',
      'DISARMED',
      cardDigest,
      counts,
    );
  }
  return null;
}

function parkAndReturn(
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  requestId: string,
  cardDigest: `sha256:${string}`,
  counts: EffectCounts,
  desired: Readonly<M0SpotRuntimeExecutionResult>,
): Readonly<M0SpotRuntimeExecutionResult> {
  try {
    const parked = persistence.parkExecution(requestId);
    if (parked.disposition === 'COMMITTED_NEW') {
      counts.ledgerWrites += 1;
      return runtimeResult(
        desired.code,
        desired.state,
        cardDigest,
        counts,
      );
    }
    if (
      parked.state?.execution?.status === 'PARKED'
      || parked.state?.phase === 'DISARMED_SAFE'
      || parked.state?.phase === 'DISARMED_NO_EXPOSURE'
    ) {
      return runtimeResult(
        desired.code,
        desired.state,
        cardDigest,
        counts,
      );
    }
  } catch {
    // A failed park leaves recovery non-green even if the operation threw.
  }
  return runtimeResult(
    'M0_LIFECYCLE_RECOVERY_REQUIRED',
    'RECOVERY_REQUIRED',
    cardDigest,
    counts,
  );
}

function disarmPreEntry(
  persistence: Readonly<M0SpotLifecyclePersistenceAdapter>,
  requestId: string,
  cardDigest: `sha256:${string}`,
  counts: EffectCounts,
  reasonCode: string,
): Readonly<M0SpotRuntimeExecutionResult> {
  const disarmed = persistence.disarmBeforeEntry(reasonCode);
  if (disarmed.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
  const safe =
    disarmed.disposition === 'COMMITTED_NEW'
    || disarmed.state?.phase === 'DISARMED_NO_EXPOSURE';
  return parkAndReturn(
    persistence,
    requestId,
    cardDigest,
    counts,
    runtimeResult(
      safe ? 'M0_CARD_NOT_READY' : 'M0_LIFECYCLE_RECOVERY_REQUIRED',
      safe ? 'DISARMED' : 'RECOVERY_REQUIRED',
      cardDigest,
      counts,
    ),
  );
}

function permissionTruthAt(
  bundle: Readonly<M0SpotCanonicalExecutionBundle>,
  nowMs: number,
): Readonly<M0SpotPermissionTruth> | null {
  try {
    return projectM0SpotPermissionTruth(
      bundle.permissionEnvelope,
      nowMs,
    );
  } catch {
    return null;
  }
}

function recoveryCardWasValid(
  readiness: Readonly<M0SpotReadinessCard>,
): readiness is Readonly<M0SpotReadinessCard> & Readonly<{
  lifecycleCardDigest: `sha256:${string}`;
  executableEntryEvidenceDigest: `sha256:${string}`;
  validUntilMs: number;
}> {
  return validateM0SpotReadyCard(
    readiness,
    readiness.readinessDigest,
    readiness.observedAtMs,
  );
}

function recoveryIdentity(
  state: Readonly<M0SpotLifecycleState>,
  identity: Readonly<M0SpotProductionExecutorOptions['identity']>,
): Readonly<{
  requestId: `m0_req_${string}`;
  idempotencyKeyDigest: `sha256:${string}`;
}> {
  const seed = createHash('sha256')
    .update('m0-spot-boot-recovery\u0000', 'utf8')
    .update(state.lifecycleId, 'utf8')
    .update('\u0000', 'utf8')
    .update(state.stateDigest, 'utf8')
    .update('\u0000', 'utf8')
    .update(identity.bootId, 'utf8')
    .digest('hex');
  return Object.freeze({
    requestId: `m0_req_${seed.slice(0, 32)}`,
    idempotencyKeyDigest: `sha256:${seed}`,
  });
}

/**
 * Construct the server-side executor. Construction reads no bundle, signer,
 * credential, Ledger value, or network.
 */
export function createM0SpotProductionExecutor(
  options: Readonly<M0SpotProductionExecutorOptions>,
): Readonly<M0SpotProductionExecutor> {
  if (
    typeof options?.ledger?.getConfigValue !== 'function'
    || typeof options?.clock?.nowMs !== 'function'
    || typeof options?.fetch !== 'function'
    || typeof options?.resolveBundle?.resolve !== 'function'
    || typeof options?.resolveBundle?.resolveRecovery !== 'function'
    || !validExecutorIdentity(options.identity)
  ) throw new TypeError('M0 Spot production executor ports are required');

  const execute = async (
    input: Readonly<M0SpotApprovedLifecycleExecutionInput>,
  ): Promise<Readonly<M0SpotRuntimeExecutionResult>> => {
    const counts = emptyCounts();
    const digest = /^sha256:[0-9a-f]{64}$/u.test(input?.cardDigest ?? '')
      ? input.cardDigest
      : `sha256:${'0'.repeat(64)}` as const;
    if (
      input.action !== 'EXECUTE_APPROVED_LIFECYCLE'
      || input.ownerConfirmation !== 'YES'
      || !/^m0_req_[0-9a-f]{32}$/u.test(input.requestId)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.idempotencyKeyDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.cardDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.lifecycleCardDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(
        input.executableEntryEvidenceDigest,
      )
      || typeof input.operatorId !== 'string'
      || input.operatorId.length < 1
      || input.operatorId.length > 160
    ) return runtimeResult('M0_CARD_NOT_READY', 'DISARMED', digest, counts);

    let resolvedBundle: Readonly<M0SpotCanonicalExecutionBundle> | null;
    try {
      resolvedBundle = await options.resolveBundle.resolve({
        operatorId: input.operatorId,
        readinessDigest: input.cardDigest,
        lifecycleCardDigest: input.lifecycleCardDigest,
      });
    } catch {
      resolvedBundle = null;
    }
    const bundle = resolvedBundle === null
      ? null
      : snapshotCanonicalBundle(resolvedBundle);
    const nowMs = options.clock.nowMs();
    const permissionTruth = bundle === null
      ? null
      : permissionTruthAt(bundle, nowMs);
    if (
      bundle === null
      || permissionTruth === null
      || !validateM0SpotReadyCard(
        input.readinessCard,
        input.cardDigest,
        nowMs,
      )
      || input.readinessCard.readinessDigest !== input.cardDigest
      || input.readinessCard.executableEntryEvidenceDigest
        !== input.executableEntryEvidenceDigest
      || bundle.card.cardDigest !== input.lifecycleCardDigest
      || !bundleMatchesReadiness(
        bundle,
        permissionTruth,
        input.readinessCard,
        options.identity,
        input.operatorId,
        nowMs,
        'ENTRY',
      )
    ) return runtimeResult('M0_CARD_NOT_READY', 'DISARMED', digest, counts);

    let persistence: M0SpotLifecyclePersistenceAdapter;
    try {
      persistence = new M0SpotLifecyclePersistenceAdapter({
        ledger: options.ledger,
        clock: options.clock,
        resolveAction: bundle.actionOwner,
      });
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    let existing: Readonly<M0SpotLifecycleState> | null;
    try {
      existing = persistence.read();
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    if (existing !== null) {
      if (
        existing.card.cardDigest !== input.lifecycleCardDigest
        || existing.readinessCard.readinessDigest !== input.cardDigest
        || existing.readinessCard.executableEntryEvidenceDigest
          !== input.executableEntryEvidenceDigest
      ) {
        return runtimeResult(
          'M0_LIFECYCLE_RECOVERY_REQUIRED',
          'RECOVERY_REQUIRED',
          digest,
          counts,
        );
      }
      const terminal = terminalRuntimeResult(existing, digest, counts);
      if (terminal !== null) return terminal;
    } else {
      let armed: ReturnType<
        M0SpotLifecyclePersistenceAdapter['armLifecycle']
      >;
      try {
        armed = persistence.armLifecycle(
          bundle.card,
          bundle.entry.ticket,
          input.readinessCard,
        );
      } catch {
        return runtimeResult(
          'M0_LIFECYCLE_RECOVERY_REQUIRED',
          'RECOVERY_REQUIRED',
          digest,
          counts,
        );
      }
      if (armed.disposition === 'COMMITTED_NEW') {
        counts.ledgerWrites += 1;
      } else if (armed.state !== null) {
        existing = armed.state;
        if (
          existing.card.cardDigest !== input.lifecycleCardDigest
          || existing.readinessCard.readinessDigest !== input.cardDigest
          || existing.readinessCard.executableEntryEvidenceDigest
            !== input.executableEntryEvidenceDigest
        ) {
          return runtimeResult(
            'M0_LIFECYCLE_RECOVERY_REQUIRED',
            'RECOVERY_REQUIRED',
            digest,
            counts,
          );
        }
        const terminal = terminalRuntimeResult(existing, digest, counts);
        if (terminal !== null) return terminal;
      } else {
        return runtimeResult(
          'M0_CARD_NOT_READY',
          'DISARMED',
          digest,
          counts,
        );
      }
    }

    const mode = existing === null ? 'ENTRY' as const : 'RECOVERY_ONLY' as const;
    let acquired: ReturnType<
      M0SpotLifecyclePersistenceAdapter['acquireExecution']
    >;
    try {
      acquired = persistence.acquireExecution({
        requestId: input.requestId,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        operatorId: input.operatorId,
        ...options.identity,
        mode,
      });
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    if (acquired.disposition === 'IN_FLIGHT') {
      return runtimeResult(
        'M0_LIFECYCLE_ACCEPTED',
        mode === 'ENTRY' ? 'ARMED' : 'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    if (acquired.disposition !== 'ACQUIRED') {
      const terminal = acquired.state === null
        ? null
        : terminalRuntimeResult(acquired.state, digest, counts);
      return terminal ?? runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    counts.ledgerWrites += 1;

    try {
      const execution = createExecutionPort(
        bundle,
        persistence,
        options,
        counts,
      );
      if (mode === 'RECOVERY_ONLY') {
        let state = persistence.read();
        if (state === null) throw new Error('M0_DURABLE_STATE_LOST');
        if (state.entry === null) {
          return disarmPreEntry(
            persistence,
            input.requestId,
            digest,
            counts,
            'RECOVERY_FOUND_NO_ENTRY_EXPOSURE',
          );
        }
        const restart = persistence.markRestartRecovery(input.requestId);
        if (restart.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
        if (
          restart.disposition !== 'COMMITTED_NEW'
          && restart.disposition !== 'REPLAY_QUERY_ONLY'
        ) throw new Error('M0_RESTART_RECOVERY_FENCE_FAILED');
        const resumed = await resumeLockedLifecycle(
          bundle,
          persistence,
          execution,
          counts,
          options.clock,
        );
        return parkAndReturn(
          persistence,
          input.requestId,
          digest,
          counts,
          runtimeResult(
            resumed === 'FLAT_RECONCILED'
              ? 'M0_LIFECYCLE_RECONCILED'
              : 'M0_LIFECYCLE_RECOVERY_REQUIRED',
            resumed === 'FLAT_RECONCILED'
              ? 'DISARMED_SAFE'
              : 'RECOVERY_REQUIRED',
            digest,
            counts,
          ),
        );
      }

      const coordinatorInput = coordinatorInputFromReadiness(
        bundle,
        input.readinessCard,
        null,
      );
      if (coordinatorInput === null) {
        return disarmPreEntry(
          persistence,
          input.requestId,
          digest,
          counts,
          'COORDINATOR_INPUT_NOT_EXACT',
        );
      }
      const flatCapture: {
        value: Readonly<SpotAuthoritativeFlatEvidence> | null;
      } = { value: null };
      const result = await runSpotTransportCoordinator(
        bundle.card.symbol,
        coordinatorInput,
        createCoordinatorPorts(
          bundle,
          persistence,
          execution,
          counts,
          flatCapture,
          options.clock,
        ),
      );
      if (result.status === 'BLOCKED') {
        const state = persistence.read();
        if (state?.entry === null) {
          return disarmPreEntry(
            persistence,
            input.requestId,
            digest,
            counts,
            result.reasonCodes[0] ?? 'PRE_ENTRY_COORDINATOR_BLOCKED',
          );
        }
      }
      let lifecycleResult: Readonly<M0SpotRuntimeExecutionResult>;
      if (
        result.status === 'FLAT_RECONCILED'
        && flatCapture.value !== null
        && flatCapture.value.canonicalStatus === 'EXACT'
        && flatCapture.value.ledgerState === 'MATCHED'
      ) {
        const disarmed = persistence.reconcileAndDisarm(flatCapture.value);
        if (disarmed.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
        lifecycleResult = runtimeResult(
          disarmed.disposition === 'COMMITTED_NEW'
            || disarmed.state?.phase === 'DISARMED_SAFE'
            ? 'M0_LIFECYCLE_RECONCILED'
            : 'M0_LIFECYCLE_RECOVERY_REQUIRED',
          disarmed.disposition === 'COMMITTED_NEW'
            || disarmed.state?.phase === 'DISARMED_SAFE'
            ? 'DISARMED_SAFE'
            : 'RECOVERY_REQUIRED',
          digest,
          counts,
        );
      } else {
        lifecycleResult = runtimeResult(
          'M0_LIFECYCLE_RECOVERY_REQUIRED',
          'RECOVERY_REQUIRED',
          digest,
          counts,
        );
      }
      return parkAndReturn(
        persistence,
        input.requestId,
        digest,
        counts,
        lifecycleResult,
      );
    } catch {
      let state: Readonly<M0SpotLifecycleState> | null = null;
      try {
        state = persistence.read();
      } catch {
        state = null;
      }
      if (state?.entry === null) {
        return disarmPreEntry(
          persistence,
          input.requestId,
          digest,
          counts,
          'EXECUTOR_FAILED_BEFORE_ENTRY',
        );
      }
      return parkAndReturn(
        persistence,
        input.requestId,
        digest,
        counts,
        runtimeResult(
          'M0_LIFECYCLE_RECOVERY_REQUIRED',
          'RECOVERY_REQUIRED',
          digest,
          counts,
        ),
      );
    }
  };

  const recoverOnBoot = async (): Promise<
    Readonly<M0SpotRuntimeExecutionResult>
  > => {
    const counts = emptyCounts();
    const zeroDigest = `sha256:${'0'.repeat(64)}` as const;
    const inertResolver: M0SpotLifecycleActionResolver = Object.freeze({
      resolve: () => null,
    });
    let state: Readonly<M0SpotLifecycleState> | null;
    try {
      state = new M0SpotLifecyclePersistenceAdapter({
        ledger: options.ledger,
        clock: options.clock,
        resolveAction: inertResolver,
      }).read();
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        zeroDigest,
        counts,
      );
    }
    if (state === null) {
      return runtimeResult(
        'M0_CARD_NOT_READY',
        'DISARMED',
        zeroDigest,
        counts,
      );
    }
    const digest = state.readinessCard.readinessDigest;
    const terminal = terminalRuntimeResult(state, digest, counts);
    if (terminal !== null) return terminal;
    let resolvedBundle: Readonly<M0SpotCanonicalExecutionBundle> | null;
    try {
      resolvedBundle = await options.resolveBundle.resolveRecovery({
        operatorId: state.card.ownerId,
        lifecycleCardDigest: state.card.cardDigest,
      });
    } catch {
      resolvedBundle = null;
    }
    const bundle = resolvedBundle === null
      ? null
      : snapshotCanonicalBundle(resolvedBundle);
    const nowMs = options.clock.nowMs();
    const permissionTruth = bundle === null
      ? null
      : permissionTruthAt(bundle, nowMs);
    if (
      bundle === null
      || permissionTruth === null
      || !recoveryCardWasValid(state.readinessCard)
      || bundle.card.cardDigest !== state.card.cardDigest
      || bundle.entry.ticket.ticketId !== state.entryTicket.ticketId
      || bundle.entry.ticket.termsDigest !== state.entryTicket.termsDigest
      || bundle.entry.ticket.clientOrderId
        !== state.entryTicket.clientOrderId
      || !bundleMatchesReadiness(
        bundle,
        permissionTruth,
        state.readinessCard,
        options.identity,
        state.card.ownerId,
        nowMs,
        'RECOVERY_ONLY',
      )
    ) {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    let persistence: M0SpotLifecyclePersistenceAdapter;
    try {
      persistence = new M0SpotLifecyclePersistenceAdapter({
        ledger: options.ledger,
        clock: options.clock,
        resolveAction: bundle.actionOwner,
      });
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    const identity = recoveryIdentity(state, options.identity);
    let acquired: ReturnType<
      M0SpotLifecyclePersistenceAdapter['acquireExecution']
    >;
    try {
      acquired = persistence.acquireExecution({
        ...identity,
        operatorId: state.card.ownerId,
        ...options.identity,
        mode: 'RECOVERY_ONLY',
      });
    } catch {
      return runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    if (acquired.disposition === 'IN_FLIGHT') {
      return runtimeResult(
        'M0_LIFECYCLE_ACCEPTED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    if (acquired.disposition !== 'ACQUIRED') {
      const terminalAfterRace = acquired.state === null
        ? null
        : terminalRuntimeResult(acquired.state, digest, counts);
      return terminalAfterRace ?? runtimeResult(
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'RECOVERY_REQUIRED',
        digest,
        counts,
      );
    }
    counts.ledgerWrites += 1;
    try {
      if (acquired.state.entry === null) {
        return disarmPreEntry(
          persistence,
          identity.requestId,
          digest,
          counts,
          'BOOT_RECOVERY_FOUND_NO_ENTRY_EXPOSURE',
        );
      }
      const restart = persistence.markRestartRecovery(identity.requestId);
      if (restart.disposition === 'COMMITTED_NEW') counts.ledgerWrites += 1;
      if (
        restart.disposition !== 'COMMITTED_NEW'
        && restart.disposition !== 'REPLAY_QUERY_ONLY'
      ) throw new Error('M0_BOOT_RECOVERY_FENCE_FAILED');
      const execution = createExecutionPort(
        bundle,
        persistence,
        options,
        counts,
      );
      const resumed = await resumeLockedLifecycle(
        bundle,
        persistence,
        execution,
        counts,
        options.clock,
      );
      return parkAndReturn(
        persistence,
        identity.requestId,
        digest,
        counts,
        runtimeResult(
          resumed === 'FLAT_RECONCILED'
            ? 'M0_LIFECYCLE_RECONCILED'
            : 'M0_LIFECYCLE_RECOVERY_REQUIRED',
          resumed === 'FLAT_RECONCILED'
            ? 'DISARMED_SAFE'
            : 'RECOVERY_REQUIRED',
          digest,
          counts,
        ),
      );
    } catch {
      return parkAndReturn(
        persistence,
        identity.requestId,
        digest,
        counts,
        runtimeResult(
          'M0_LIFECYCLE_RECOVERY_REQUIRED',
          'RECOVERY_REQUIRED',
          digest,
          counts,
        ),
      );
    }
  };

  return Object.freeze({ execute, recoverOnBoot });
}
