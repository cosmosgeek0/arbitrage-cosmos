/**
 * Direct-import-only coordinator for one owner-authorized Binance Spot M0.
 *
 * This module owns no credential, signer, network client, environment read,
 * timer, persistence engine, route, or live mount. All effects are injected,
 * and every returned result grants no further execution authority.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  addSpotDecimals,
  compareSpotDecimals,
  normalizeSpotDecimal,
  type BinanceSpotVenueEvidence,
} from '../exchange/binanceSpot/filters.js';
import {
  buildSpotLedgerAppendIntent,
  classifySpotLedgerDiscrepancy,
  type SpotClock,
  type SpotLedgerAppendIntent,
  type SpotLedgerProjectionState,
  type SpotReconciliationStatus,
} from '../reconciliation/spotLedgerBridge.js';
import {
  decideSpotLiveSend,
  prepareSpotCore,
  type SpotCurrentM0Readiness,
  type SpotFilterSnapshot,
  type SpotOwnerSendAuthority,
  type SpotRiskEvidence,
  type SpotSignedTestEvidence,
} from './spotCore.js';
import {
  reduceSpotLifecycle,
  spotResidualQuantity,
  type SpotLifecycleEvent,
  type SpotLifecycleState,
} from './spotLifecycle.js';
import type {
  BinanceSpotExecutionPort,
  SpotFillObservation,
  SpotLiveSubmitIntent,
  SpotMutationOutcome,
  SpotQueryOutcome,
  SpotSignedTestOrderIntent,
} from './spotPort.js';
import type { SpotExecutionTicket } from './spotTicket.js';

export const SPOT_TRANSPORT_COORDINATOR_SCHEMA =
  'COSMOS_SPOT_TRANSPORT_COORDINATOR_V1' as const;

export const SPOT_TRANSPORT_COORDINATOR_POSTURE = Object.freeze({
  liveMounted: false,
  liveExportReachable: false,
  sharedBarrelExported: false,
  automaticMutationRetry: false,
} as const);

export type SpotTransportAction = 'ENTRY' | 'FLATTEN';

export interface SpotTransportAdmission {
  readonly revision: string;
  readonly sourceEnabled: boolean;
  /** Exact false is the sole clear value. */
  readonly killSwitchEngaged: boolean | null;
  readonly allowedSymbols: readonly string[];
  readonly blockedSymbols: readonly string[];
}

export interface SpotTransportLegInput {
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly filterSnapshot: Readonly<SpotFilterSnapshot>;
  /** Caller time is documentary only; the injected clock is authoritative. */
  readonly nowMs?: number;
  readonly riskEvidence: Readonly<SpotRiskEvidence> | null;
  readonly venueEvidence: Readonly<BinanceSpotVenueEvidence> | null;
  readonly readiness: Readonly<SpotCurrentM0Readiness>;
  /**
   * Evidence is not trusted on shape alone. The coordinator first performs
   * the injected signed test and accepts this evidence only when the port
   * proves the test created no venue order and filled zero.
   */
  readonly signedTestEvidence: Readonly<SpotSignedTestEvidence> | null;
  readonly ownerAuthority: Readonly<SpotOwnerSendAuthority> | null;
}

export interface SpotTransportCoordinatorInput {
  readonly entry: Readonly<SpotTransportLegInput>;
  readonly flatten: Readonly<SpotTransportLegInput> | null;
}

export interface SpotAuthorityConsumptionPort {
  /**
   * Must be atomic and durable: exact true may be returned only for the first
   * consumption of this authority/intent binding, including across restarts.
   */
  (
    authority: Readonly<SpotOwnerSendAuthority>,
    intent: Readonly<SpotLiveSubmitIntent>,
  ): Promise<boolean>;
}

export interface SpotAuthoritativeFlatEvidence {
  readonly revision: string;
  readonly sourceTicketId: string;
  readonly sourceClientOrderId: string;
  readonly sourceVenueOrderId: string;
  readonly sourceOrderTerminal: boolean;
  readonly sourceFillsComplete: boolean;
  readonly sourceCumulativeFilledQuantity: string;
  readonly flattenTicketId: string | null;
  readonly flattenClientOrderId: string | null;
  readonly flattenVenueOrderId: string | null;
  readonly flattenOrderTerminal: boolean;
  readonly flattenFillsComplete: boolean;
  readonly flattenCumulativeFilledQuantity: string;
  readonly canonicalStatus: SpotReconciliationStatus;
  readonly ledgerState: SpotLedgerProjectionState;
  readonly quoteQuantity: string;
  readonly feeQuantity: string;
  readonly feeAsset: string;
  readonly occurredAtMs: number;
}

export interface SpotFlatEvidenceRequest {
  readonly sourceTicket: Readonly<SpotExecutionTicket>;
  readonly flattenTicket: Readonly<SpotExecutionTicket> | null;
  readonly lifecycle: Readonly<SpotLifecycleState>;
  readonly sourceFills: readonly Readonly<SpotFillObservation>[];
  readonly flattenFills: readonly Readonly<SpotFillObservation>[];
}

export interface SpotTransportCoordinatorPorts {
  readonly clock: Readonly<SpotClock>;
  readonly executionPort: Readonly<BinanceSpotExecutionPort>;
  readonly readAdmission: (
    symbol: string,
    action: SpotTransportAction,
  ) =>
    | Readonly<SpotTransportAdmission>
    | Promise<Readonly<SpotTransportAdmission>>;
  readonly consumeAuthority: SpotAuthorityConsumptionPort;
  readonly verifySignedTestEvidence: (
    intent: Readonly<SpotSignedTestOrderIntent>,
    outcome: Readonly<SpotMutationOutcome>,
    evidence: Readonly<SpotSignedTestEvidence> | null,
  ) => boolean | Promise<boolean>;
  readonly appendLedger: (
    intent: Readonly<SpotLedgerAppendIntent>,
  ) => 'APPENDED' | 'DUPLICATE' | 'CONFLICT' | Promise<
    'APPENDED' | 'DUPLICATE' | 'CONFLICT'
  >;
  readonly readFlatEvidence: (
    request: Readonly<SpotFlatEvidenceRequest>,
  ) =>
    | Readonly<SpotAuthoritativeFlatEvidence>
    | null
    | Promise<Readonly<SpotAuthoritativeFlatEvidence> | null>;
}

export interface SpotTransportCallCounts {
  readonly admissions: number;
  readonly signedTests: number;
  readonly authorityConsumptions: number;
  readonly submits: number;
  readonly orderQueries: number;
  readonly fillQueries: number;
  readonly cancels: number;
  readonly flattens: number;
  readonly ledgerAppends: number;
}

export type SpotTransportCoordinatorStatus =
  | 'BLOCKED'
  | 'RECOVERY_REQUIRED'
  | 'FLAT_RECONCILED';

export interface SpotTransportCoordinatorResult {
  readonly schema: typeof SPOT_TRANSPORT_COORDINATOR_SCHEMA;
  readonly version: 1;
  readonly status: SpotTransportCoordinatorStatus;
  readonly symbol: string;
  readonly lifecycle: Readonly<SpotLifecycleState> | null;
  readonly reasonCodes: readonly string[];
  readonly calls: Readonly<SpotTransportCallCounts>;
  readonly liveExportReachable: false;
  readonly automaticMutationRetry: false;
  readonly executionAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

interface MutableCounts {
  admissions: number;
  signedTests: number;
  authorityConsumptions: number;
  submits: number;
  orderQueries: number;
  fillQueries: number;
  cancels: number;
  flattens: number;
  ledgerAppends: number;
}

type DataRecord = Readonly<Record<string, unknown>>;

const SYMBOL = /^[A-Z0-9]{1,64}$/u;
const CONTROL_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;
const NO_REASONS = Object.freeze([]) as readonly string[];
const NO_FILLS = Object.freeze(
  [],
) as readonly Readonly<SpotFillObservation>[];

function snapshotRecord(value: unknown): DataRecord | null {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      nodeUtilTypes.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return null;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function exactStringArray(value: unknown): readonly string[] | null {
  try {
    if (
      !Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 500
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        typeof descriptor.value !== 'string' ||
        !SYMBOL.test(descriptor.value)
      ) {
        return null;
      }
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function counts(value: MutableCounts): Readonly<SpotTransportCallCounts> {
  return Object.freeze({ ...value });
}

function result(
  status: SpotTransportCoordinatorStatus,
  symbol: string,
  lifecycle: Readonly<SpotLifecycleState> | null,
  reasonCodes: readonly string[],
  callCounts: MutableCounts,
): Readonly<SpotTransportCoordinatorResult> {
  return Object.freeze({
    schema: SPOT_TRANSPORT_COORDINATOR_SCHEMA,
    version: 1 as const,
    status,
    symbol,
    lifecycle,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    calls: counts(callCounts),
    liveExportReachable: false as const,
    automaticMutationRetry: false as const,
    executionAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

function admissionBlockCode(
  value: unknown,
  symbol: string,
): string | null {
  const admission = snapshotRecord(value);
  if (admission === null) return 'ADMISSION_INVALID';
  if (admission.killSwitchEngaged !== false) {
    return 'KILL_SWITCH_ENGAGED_OR_UNKNOWN';
  }
  if (admission.sourceEnabled !== true) return 'SOURCE_DISABLED';
  if (
    typeof admission.revision !== 'string' ||
    !CONTROL_ID.test(admission.revision)
  ) {
    return 'ADMISSION_INVALID';
  }
  const allowed = exactStringArray(admission.allowedSymbols);
  if (allowed === null) return 'ADMISSION_INVALID';
  if (allowed.length === 0) return 'EMPTY_ALLOWLIST';
  if (!allowed.includes(symbol)) return 'SYMBOL_NOT_ALLOWLISTED';
  const blocked = exactStringArray(admission.blockedSymbols);
  if (blocked === null) return 'ADMISSION_INVALID';
  if (blocked.includes(symbol)) return 'SYMBOL_BLOCKED';
  return null;
}

async function preflight(
  symbol: string,
  action: SpotTransportAction,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<string | null> {
  try {
    callCounts.admissions += 1;
    return admissionBlockCode(
      await ports.readAdmission(symbol, action),
      symbol,
    );
  } catch {
    return 'ADMISSION_UNAVAILABLE';
  }
}

function applied(
  state: Readonly<SpotLifecycleState> | null,
  event: SpotLifecycleEvent,
): Readonly<SpotLifecycleState> {
  const reduced = reduceSpotLifecycle(state, event);
  if (!reduced.applied) {
    throw new TypeError(`lifecycle rejected ${reduced.reason}`);
  }
  return reduced.state;
}

function eventEnvelope(
  state: Readonly<SpotLifecycleState> | null,
  ticketId: string,
): Readonly<{ eventId: string; sequence: number }> {
  const sequence = (state?.lastSequence ?? 0) + 1;
  return Object.freeze({
    eventId: `spot-coord-${ticketId}-${sequence}`,
    sequence,
  });
}

function sumFills(values: readonly Readonly<SpotFillObservation>[]): string {
  return values.reduce(
    (sum, fill) => addSpotDecimals(sum, fill.quantity),
    '0',
  );
}

function observeQuery(
  state: Readonly<SpotLifecycleState>,
  ticketId: string,
  observation: Extract<SpotQueryOutcome, { readonly kind: 'FOUND' }>,
): Readonly<{
  state: Readonly<SpotLifecycleState>;
  terminal: boolean;
}> {
  const terminal =
    observation.status === 'FILLED' ||
    observation.status === 'CANCELED' ||
    observation.status === 'REJECTED' ||
    observation.status === 'EXPIRED' ||
    observation.status === 'EXPIRED_IN_MATCH';
  if (
    observation.status === 'CANCELED' ||
    observation.status === 'REJECTED' ||
    observation.status === 'EXPIRED' ||
    observation.status === 'EXPIRED_IN_MATCH'
  ) {
    if (state.lifecycle === 'FILLED') {
      return Object.freeze({ state, terminal: true });
    }
    const next = applied(state, {
      ...eventEnvelope(state, ticketId),
      type: 'ORDER_CANCELLED',
      venueOrderId: observation.venueOrderId,
      cumulativeFilledQuantity: observation.cumulativeFilledQuantity,
    });
    return Object.freeze({ state: next, terminal });
  }
  const next = applied(state, {
    ...eventEnvelope(state, ticketId),
    type: 'FILL_OBSERVED',
    venueOrderId: observation.venueOrderId,
    cumulativeFilledQuantity: observation.cumulativeFilledQuantity,
  });
  return Object.freeze({ state: next, terminal });
}

function acceptedSignedTest(
  outcome: Readonly<SpotMutationOutcome>,
): boolean {
  if (
    outcome.kind !== 'ACKNOWLEDGED' ||
    outcome.venueOrderId !== null
  ) {
    return false;
  }
  try {
    return normalizeSpotDecimal(
      outcome.cumulativeFilledQuantity,
      'signed test fill',
    ) === '0';
  } catch {
    return false;
  }
}

async function queryOrder(
  ticket: Readonly<SpotExecutionTicket>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<Readonly<SpotQueryOutcome>> {
  callCounts.orderQueries += 1;
  return ports.executionPort.queryByOriginalClientOrderId(
    Object.freeze({
      kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
      ticketId: ticket.ticketId,
      symbol: ticket.symbol,
      originalClientOrderId: ticket.clientOrderId,
      readOnly: true as const,
    }),
  );
}

async function appendMutationAttempt(
  ticket: Readonly<SpotExecutionTicket>,
  attemptKind: 'ORDER' | 'CANCEL' | 'FLATTEN',
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<'FRESH' | 'DUPLICATE' | 'FAILED'> {
  const cancelId =
    attemptKind === 'CANCEL' ? `cancel-${ticket.ticketId}` : null;
  const flattenId =
    attemptKind === 'FLATTEN' ? ticket.ticketId : null;
  const fact =
    attemptKind === 'CANCEL'
      ? {
          eventKind: 'ATTEMPT' as const,
          eventRevision: `attempt-${attemptKind}-${ticket.ticketId}`,
          symbol: ticket.symbol,
          correlation: Object.freeze({
            ticketId: ticket.ticketId,
            clientOrderId: ticket.clientOrderId,
            orderId: null,
            fillId: null,
            cancelId,
            flattenId,
            attemptKind,
          }),
          occurredAtMs: ports.clock.nowMs(),
          status: 'SUBMITTING',
        }
      : {
          eventKind: 'ATTEMPT' as const,
          eventRevision: `attempt-${attemptKind}-${ticket.ticketId}`,
          symbol: ticket.symbol,
          correlation: Object.freeze({
            ticketId: ticket.ticketId,
            clientOrderId: ticket.clientOrderId,
            orderId: null,
            fillId: null,
            cancelId,
            flattenId,
            attemptKind,
          }),
          side: ticket.side,
          baseQuantity: ticket.quantity,
          quoteQuantity: ticket.orderNotionalQuote,
          occurredAtMs: ports.clock.nowMs(),
          status: 'SUBMITTING',
        };
  let intent: Readonly<SpotLedgerAppendIntent>;
  try {
    intent = buildSpotLedgerAppendIntent(fact, ports.clock);
  } catch {
    return 'FAILED';
  }
  callCounts.ledgerAppends += 1;
  try {
    const outcome = await ports.appendLedger(intent);
    if (outcome === 'APPENDED') return 'FRESH';
    if (outcome === 'DUPLICATE') return 'DUPLICATE';
    return 'FAILED';
  } catch {
    return 'FAILED';
  }
}

function fillSetMatchesOrder(
  fills: readonly Readonly<SpotFillObservation>[],
  venueOrderId: string | null,
): boolean {
  if (venueOrderId === null) return fills.length === 0;
  const fillIds = new Set<string>();
  for (const fill of fills) {
    if (
      fill.venueOrderId !== venueOrderId ||
      fillIds.has(fill.fillId)
    ) {
      return false;
    }
    fillIds.add(fill.fillId);
  }
  return true;
}

function exactFlatEvidence(
  evidence: Readonly<SpotAuthoritativeFlatEvidence> | null,
  entryTicket: Readonly<SpotExecutionTicket>,
  flattenTicket: Readonly<SpotExecutionTicket> | null,
  flattenVenueOrderId: string | null,
  lifecycle: Readonly<SpotLifecycleState>,
  sourceFills: readonly Readonly<SpotFillObservation>[],
  flattenFills: readonly Readonly<SpotFillObservation>[],
): boolean {
  if (evidence === null) return false;
  const discrepancy = classifySpotLedgerDiscrepancy({
    canonicalStatus: evidence.canonicalStatus,
    ledgerState: evidence.ledgerState,
  });
  if (
    discrepancy.classification !== 'EXACT' ||
    evidence.sourceTicketId !== entryTicket.ticketId ||
    evidence.sourceClientOrderId !== entryTicket.clientOrderId ||
    evidence.sourceVenueOrderId !== lifecycle.venueOrderId ||
    evidence.sourceOrderTerminal !== true ||
    evidence.sourceFillsComplete !== true ||
    evidence.flattenTicketId !== (flattenTicket?.ticketId ?? null) ||
    evidence.flattenClientOrderId !==
      (flattenTicket?.clientOrderId ?? null) ||
    evidence.flattenVenueOrderId !== flattenVenueOrderId ||
    evidence.flattenOrderTerminal !== true ||
    evidence.flattenFillsComplete !== true
  ) {
    return false;
  }
  if (
    !fillSetMatchesOrder(sourceFills, evidence.sourceVenueOrderId) ||
    !fillSetMatchesOrder(flattenFills, evidence.flattenVenueOrderId)
  ) {
    return false;
  }
  const allFillIds = new Set(
    [...sourceFills, ...flattenFills].map((fill) => fill.fillId),
  );
  if (allFillIds.size !== sourceFills.length + flattenFills.length) {
    return false;
  }
  try {
    return (
      normalizeSpotDecimal(
        evidence.sourceCumulativeFilledQuantity,
        'source cumulative fill',
      ) === lifecycle.cumulativeFilledQuantity &&
      normalizeSpotDecimal(
        evidence.flattenCumulativeFilledQuantity,
        'flatten cumulative fill',
      ) === lifecycle.cumulativeFlattenedQuantity &&
      sumFills(sourceFills) === lifecycle.cumulativeFilledQuantity &&
      sumFills(flattenFills) === lifecycle.cumulativeFlattenedQuantity &&
      spotResidualQuantity(lifecycle) === '0'
    );
  } catch {
    return false;
  }
}

/**
 * Run one bounded Spot attempt. No mutation is automatically retried.
 * Query and cancellation reconciliation remain available after a kill flip;
 * every new order action, including flatten, requires a fresh admission.
 */
export async function runSpotTransportCoordinator(
  symbol: string,
  input: Readonly<SpotTransportCoordinatorInput>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
): Promise<Readonly<SpotTransportCoordinatorResult>> {
  const callCounts: MutableCounts = {
    admissions: 0,
    signedTests: 0,
    authorityConsumptions: 0,
    submits: 0,
    orderQueries: 0,
    fillQueries: 0,
    cancels: 0,
    flattens: 0,
    ledgerAppends: 0,
  };
  let lifecycle: Readonly<SpotLifecycleState> | null = null;
  let entryTicket: Readonly<SpotExecutionTicket> | null = null;

  if (typeof symbol !== 'string' || !SYMBOL.test(symbol)) {
    return result('BLOCKED', '', null, ['SYMBOL_INVALID'], callCounts);
  }
  if (
    typeof ports?.readAdmission !== 'function' ||
    typeof ports?.clock?.nowMs !== 'function' ||
    typeof ports?.executionPort?.signedTestOrder !== 'function' ||
    typeof ports?.consumeAuthority !== 'function' ||
    typeof ports?.verifySignedTestEvidence !== 'function' ||
    typeof ports?.appendLedger !== 'function' ||
    typeof ports?.readFlatEvidence !== 'function'
  ) {
    return result('BLOCKED', symbol, null, ['PORTS_INVALID'], callCounts);
  }

  const initialAdmission = await preflight(
    symbol,
    'ENTRY',
    ports,
    callCounts,
  );
  if (initialAdmission !== null) {
    return result('BLOCKED', symbol, null, [initialAdmission], callCounts);
  }

  try {
    const entry = input.entry;
    entryTicket = entry.ticket;
    if (
      entryTicket.symbol !== symbol ||
      entryTicket.purpose !== 'ENTRY' ||
      entryTicket.side !== 'BUY'
    ) {
      return result(
        'BLOCKED',
        symbol,
        null,
        ['ENTRY_TICKET_BINDING_INVALID'],
        callCounts,
      );
    }
    const nowMs = ports.clock.nowMs();
    const preparation = prepareSpotCore({
      ticket: entryTicket,
      filterSnapshot: entry.filterSnapshot,
      nowMs,
      riskEvidence: entry.riskEvidence,
      venueEvidence: entry.venueEvidence,
    });
    if (!preparation.readyForSignedTest || preparation.signedTestIntent === null) {
      return result(
        'BLOCKED',
        symbol,
        null,
        ['ENTRY_CORE_BLOCKED', ...preparation.blockingCodes],
        callCounts,
      );
    }
    lifecycle = applied(null, {
      ...eventEnvelope(null, entryTicket.ticketId),
      type: 'PREPARED',
      originalClientOrderId: entryTicket.clientOrderId,
      targetQuantity: entryTicket.quantity,
    });

    callCounts.signedTests += 1;
    let signedTestOutcome: Readonly<SpotMutationOutcome>;
    try {
      signedTestOutcome = await ports.executionPort.signedTestOrder(
        preparation.signedTestIntent,
      );
    } catch {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_TRANSPORT_FAILED'],
        callCounts,
      );
    }
    if (!acceptedSignedTest(signedTestOutcome)) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_NOT_ZERO_ORDER_ACK'],
        callCounts,
      );
    }
    let entryTestEvidenceVerified = false;
    try {
      entryTestEvidenceVerified =
        (await ports.verifySignedTestEvidence(
          preparation.signedTestIntent,
          signedTestOutcome,
          entry.signedTestEvidence,
        )) === true;
    } catch {
      entryTestEvidenceVerified = false;
    }
    if (!entryTestEvidenceVerified) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_EVIDENCE_NOT_VERIFIED'],
        callCounts,
      );
    }

    const finalEntryAdmission = await preflight(
      symbol,
      'ENTRY',
      ports,
      callCounts,
    );
    if (finalEntryAdmission !== null) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        [finalEntryAdmission],
        callCounts,
      );
    }

    const sendDecision = decideSpotLiveSend({
      ticket: entryTicket,
      filterSnapshot: entry.filterSnapshot,
      nowMs: ports.clock.nowMs(),
      riskEvidence: entry.riskEvidence,
      venueEvidence: entry.venueEvidence,
      readiness: entry.readiness,
      signedTestEvidence: entry.signedTestEvidence,
      ownerAuthority: entry.ownerAuthority,
    });
    if (
      !sendDecision.allowed ||
      sendDecision.intent === null ||
      entry.ownerAuthority === null
    ) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_SEND_BLOCKED', ...sendDecision.blockingCodes],
        callCounts,
      );
    }

    callCounts.authorityConsumptions += 1;
    let consumed = false;
    try {
      consumed =
        (await ports.consumeAuthority(
          entry.ownerAuthority,
          sendDecision.intent,
        )) === true;
    } catch {
      consumed = false;
    }
    if (!consumed) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_AUTHORITY_NOT_CONSUMED'],
        callCounts,
      );
    }
    const entryAttemptFence = await appendMutationAttempt(
      entryTicket,
      'ORDER',
      ports,
      callCounts,
    );
    if (entryAttemptFence === 'DUPLICATE') {
      try {
        await queryOrder(entryTicket, ports, callCounts);
      } catch {
        // The prior mutation identity remains fenced even when readback fails.
      }
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['ENTRY_ATTEMPT_ALREADY_EXISTS_NO_RESEND'],
        callCounts,
      );
    }
    if (entryAttemptFence !== 'FRESH') {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_ATTEMPT_LEDGER_NOT_DURABLE'],
        callCounts,
      );
    }
    const immediateEntryAdmission = await preflight(
      symbol,
      'ENTRY',
      ports,
      callCounts,
    );
    if (immediateEntryAdmission !== null) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        [
          immediateEntryAdmission,
          'ENTRY_AUTHORITY_CONSUMED_SEND_NOW_BLOCKED',
        ],
        callCounts,
      );
    }

    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'SUBMIT_STARTED',
    });
    callCounts.submits += 1;
    let submitOutcome: Readonly<SpotMutationOutcome>;
    try {
      submitOutcome = await ports.executionPort.submitLiveOrder(
        sendDecision.intent,
      );
    } catch {
      submitOutcome = Object.freeze({
        kind: 'AMBIGUOUS' as const,
        reasonCode: 'SUBMIT_TRANSPORT_THROW',
        queryOriginalClientOrderId: entryTicket.clientOrderId,
        automaticRetry: false as const,
      });
    }

    if (submitOutcome.kind === 'REJECTED') {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FAILED',
        failureCode: submitOutcome.reasonCode,
        venueOrderTerminal: true,
      });
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_REJECTED'],
        callCounts,
      );
    }
    if (submitOutcome.kind === 'AMBIGUOUS') {
      if (
        submitOutcome.automaticRetry !== false ||
        submitOutcome.queryOriginalClientOrderId !==
          entryTicket.clientOrderId
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['SUBMIT_AMBIGUITY_BINDING_INVALID'],
          callCounts,
        );
      }
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'OUTCOME_AMBIGUOUS',
        cause: 'CANONICAL_ATTEMPT_UNKNOWN',
      });
    } else {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'ORDER_ACKNOWLEDGED',
        venueOrderId: submitOutcome.venueOrderId,
        cumulativeFilledQuantity:
          submitOutcome.cumulativeFilledQuantity,
      });
    }

    let sourceObservation: Readonly<SpotQueryOutcome>;
    try {
      sourceObservation = await queryOrder(
        entryTicket,
        ports,
        callCounts,
      );
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SOURCE_QUERY_FAILED'],
        callCounts,
      );
    }
    if (sourceObservation.kind === 'UNRESOLVED') {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SOURCE_QUERY_UNRESOLVED'],
        callCounts,
      );
    }
    if (sourceObservation.kind === 'AUTHORITATIVE_NOT_FOUND') {
      if (
        lifecycle.lifecycle === 'UNKNOWN' &&
        lifecycle.ambiguityOperation === 'SUBMIT'
      ) {
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'ORDER_PROVEN_ABSENT',
        });
      }
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SUBMIT_AUTHORITY_CONSUMED_ORDER_PROVEN_ABSENT'],
        callCounts,
      );
    }
    let observed = observeQuery(
      lifecycle,
      entryTicket.ticketId,
      sourceObservation,
    );
    lifecycle = observed.state;
    let sourceTerminal = observed.terminal;

    if (!sourceTerminal) {
      const cancelAttemptFence = await appendMutationAttempt(
        entryTicket,
        'CANCEL',
        ports,
        callCounts,
      );
      if (cancelAttemptFence === 'DUPLICATE') {
        try {
          await queryOrder(entryTicket, ports, callCounts);
        } catch {
          // The prior cancel identity remains fenced.
        }
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_ATTEMPT_ALREADY_EXISTS_NO_RETRY'],
          callCounts,
        );
      }
      if (cancelAttemptFence !== 'FRESH') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_ATTEMPT_LEDGER_NOT_DURABLE'],
          callCounts,
        );
      }
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'CANCEL_REQUESTED',
      });
      callCounts.cancels += 1;
      let cancelOutcome: Readonly<SpotMutationOutcome>;
      try {
        cancelOutcome = await ports.executionPort.cancel(
          Object.freeze({
            kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
            ticketId: entryTicket.ticketId,
            symbol,
            originalClientOrderId: entryTicket.clientOrderId,
            automaticRetry: false as const,
          }),
        );
      } catch {
        cancelOutcome = Object.freeze({
          kind: 'AMBIGUOUS' as const,
          reasonCode: 'CANCEL_TRANSPORT_THROW',
          queryOriginalClientOrderId: entryTicket.clientOrderId,
          automaticRetry: false as const,
        });
      }
      if (cancelOutcome.kind === 'ACKNOWLEDGED') {
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'ORDER_CANCELLED',
          venueOrderId: cancelOutcome.venueOrderId,
          cumulativeFilledQuantity:
            cancelOutcome.cumulativeFilledQuantity,
        });
        sourceTerminal = true;
      } else {
        if (cancelOutcome.kind === 'AMBIGUOUS') {
          if (
            cancelOutcome.automaticRetry !== false ||
            cancelOutcome.queryOriginalClientOrderId !==
              entryTicket.clientOrderId
          ) {
            return result(
              'RECOVERY_REQUIRED',
              symbol,
              lifecycle,
              ['CANCEL_AMBIGUITY_BINDING_INVALID'],
              callCounts,
            );
          }
          lifecycle = applied(lifecycle, {
            ...eventEnvelope(lifecycle, entryTicket.ticketId),
            type: 'OUTCOME_AMBIGUOUS',
            cause: 'CANONICAL_ATTEMPT_UNKNOWN',
          });
        }
        let cancelObservation: Readonly<SpotQueryOutcome>;
        try {
          cancelObservation = await queryOrder(
            entryTicket,
            ports,
            callCounts,
          );
        } catch {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['CANCEL_QUERY_FAILED'],
            callCounts,
          );
        }
        if (cancelObservation.kind !== 'FOUND') {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['CANCEL_QUERY_UNRESOLVED'],
            callCounts,
          );
        }
        observed = observeQuery(
          lifecycle,
          entryTicket.ticketId,
          cancelObservation,
        );
        lifecycle = observed.state;
        sourceTerminal = observed.terminal;
        if (!sourceTerminal) {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['CANCEL_NOT_TERMINAL_NO_RETRY'],
            callCounts,
          );
        }
      }
    }

    const sourceFilled = lifecycle.cumulativeFilledQuantity;
    let flattenTicket: Readonly<SpotExecutionTicket> | null = null;
    let flattenVenueOrderId: string | null = null;

    if (compareSpotDecimals(sourceFilled, '0') > 0) {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FLATTEN_REQUIRED',
        sourceOrderTerminal: sourceTerminal,
      });
      const flattenAdmission = await preflight(
        symbol,
        'FLATTEN',
        ports,
        callCounts,
      );
      if (flattenAdmission !== null) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          [flattenAdmission, 'FLATTEN_BLOCKED_WITH_RESIDUAL'],
          callCounts,
        );
      }
      const flatten = input.flatten;
      if (flatten === null) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_TICKET_MISSING'],
          callCounts,
        );
      }
      flattenTicket = flatten.ticket;
      if (
        flattenTicket.symbol !== symbol ||
        flattenTicket.purpose !== 'FLATTEN' ||
        flattenTicket.side !== 'SELL' ||
        flattenTicket.accountId !== entryTicket.accountId ||
        flattenTicket.planId !== entryTicket.planId ||
        flattenTicket.correlationId !== entryTicket.correlationId ||
        normalizeSpotDecimal(flattenTicket.quantity, 'flatten quantity') !==
          spotResidualQuantity(lifecycle)
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_TICKET_BINDING_INVALID'],
          callCounts,
        );
      }
      const flattenPreparation = prepareSpotCore({
        ticket: flattenTicket,
        filterSnapshot: flatten.filterSnapshot,
        nowMs: ports.clock.nowMs(),
        riskEvidence: flatten.riskEvidence,
        venueEvidence: flatten.venueEvidence,
      });
      if (
        !flattenPreparation.readyForSignedTest ||
        flattenPreparation.signedTestIntent === null
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CORE_BLOCKED', ...flattenPreparation.blockingCodes],
          callCounts,
        );
      }
      callCounts.signedTests += 1;
      let flattenTest: Readonly<SpotMutationOutcome>;
      try {
        flattenTest = await ports.executionPort.signedTestOrder(
          flattenPreparation.signedTestIntent,
        );
      } catch {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_SIGNED_TEST_FAILED'],
          callCounts,
        );
      }
      if (!acceptedSignedTest(flattenTest)) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_SIGNED_TEST_NOT_ZERO_ORDER_ACK'],
          callCounts,
        );
      }
      let flattenTestEvidenceVerified = false;
      try {
        flattenTestEvidenceVerified =
          (await ports.verifySignedTestEvidence(
            flattenPreparation.signedTestIntent,
            flattenTest,
            flatten.signedTestEvidence,
          )) === true;
      } catch {
        flattenTestEvidenceVerified = false;
      }
      if (!flattenTestEvidenceVerified) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_SIGNED_TEST_EVIDENCE_NOT_VERIFIED'],
          callCounts,
        );
      }
      const finalFlattenAdmission = await preflight(
        symbol,
        'FLATTEN',
        ports,
        callCounts,
      );
      if (finalFlattenAdmission !== null) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          [finalFlattenAdmission, 'FLATTEN_BLOCKED_WITH_RESIDUAL'],
          callCounts,
        );
      }
      const flattenDecision = decideSpotLiveSend({
        ticket: flattenTicket,
        filterSnapshot: flatten.filterSnapshot,
        nowMs: ports.clock.nowMs(),
        riskEvidence: flatten.riskEvidence,
        venueEvidence: flatten.venueEvidence,
        readiness: flatten.readiness,
        signedTestEvidence: flatten.signedTestEvidence,
        ownerAuthority: flatten.ownerAuthority,
      });
      if (
        !flattenDecision.allowed ||
        flattenDecision.intent === null ||
        flatten.ownerAuthority === null
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_SEND_BLOCKED', ...flattenDecision.blockingCodes],
          callCounts,
        );
      }
      callCounts.authorityConsumptions += 1;
      let flattenAuthorityConsumed = false;
      try {
        flattenAuthorityConsumed =
          (await ports.consumeAuthority(
            flatten.ownerAuthority,
            flattenDecision.intent,
          )) === true;
      } catch {
        flattenAuthorityConsumed = false;
      }
      if (!flattenAuthorityConsumed) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_AUTHORITY_NOT_CONSUMED'],
          callCounts,
        );
      }
      const flattenAttemptFence = await appendMutationAttempt(
        flattenTicket,
        'FLATTEN',
        ports,
        callCounts,
      );
      if (flattenAttemptFence === 'DUPLICATE') {
        try {
          await queryOrder(flattenTicket, ports, callCounts);
        } catch {
          // The prior flatten identity remains fenced.
        }
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_ATTEMPT_ALREADY_EXISTS_NO_RESEND'],
          callCounts,
        );
      }
      if (flattenAttemptFence !== 'FRESH') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_ATTEMPT_LEDGER_NOT_DURABLE'],
          callCounts,
        );
      }
      const immediateFlattenAdmission = await preflight(
        symbol,
        'FLATTEN',
        ports,
        callCounts,
      );
      if (immediateFlattenAdmission !== null) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          [
            immediateFlattenAdmission,
            'FLATTEN_AUTHORITY_CONSUMED_SEND_NOW_BLOCKED',
          ],
          callCounts,
        );
      }
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FLATTEN_STARTED',
      });
      callCounts.flattens += 1;
      let flattenOutcome: Readonly<SpotMutationOutcome>;
      try {
        flattenOutcome = await ports.executionPort.flatten(
          Object.freeze({
            kind: 'FLATTEN' as const,
            sourceTicketId: entryTicket.ticketId,
            flattenTicket,
            residualQuantity: spotResidualQuantity(lifecycle),
            automaticRetry: false as const,
          }),
        );
      } catch {
        flattenOutcome = Object.freeze({
          kind: 'AMBIGUOUS' as const,
          reasonCode: 'FLATTEN_TRANSPORT_THROW',
          queryOriginalClientOrderId: flattenTicket.clientOrderId,
          automaticRetry: false as const,
        });
      }
      if (flattenOutcome.kind === 'REJECTED') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_REJECTED_WITH_RESIDUAL'],
          callCounts,
        );
      }
      if (
        flattenOutcome.kind === 'AMBIGUOUS' &&
        (flattenOutcome.automaticRetry !== false ||
          flattenOutcome.queryOriginalClientOrderId !==
            flattenTicket.clientOrderId)
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_AMBIGUITY_BINDING_INVALID'],
          callCounts,
        );
      }
      if (flattenOutcome.kind === 'ACKNOWLEDGED') {
        flattenVenueOrderId = flattenOutcome.venueOrderId;
      }

      let flattenObservation: Readonly<SpotQueryOutcome>;
      try {
        flattenObservation = await queryOrder(
          flattenTicket,
          ports,
          callCounts,
        );
      } catch {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_QUERY_FAILED'],
          callCounts,
        );
      }
      if (flattenObservation.kind !== 'FOUND') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_QUERY_UNRESOLVED_NO_RESUBMIT'],
          callCounts,
        );
      }
      if (
        flattenObservation.venueOrderId === null ||
        (flattenVenueOrderId !== null &&
          flattenVenueOrderId !== flattenObservation.venueOrderId)
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_ORDER_IDENTITY_CONFLICT'],
          callCounts,
        );
      }
      flattenVenueOrderId = flattenObservation.venueOrderId;
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FLATTEN_FILL_OBSERVED',
        cumulativeFlattenedQuantity:
          flattenObservation.cumulativeFilledQuantity,
      });
      let flattenTerminal =
        flattenObservation.status === 'FILLED' ||
        flattenObservation.status === 'CANCELED' ||
        flattenObservation.status === 'REJECTED' ||
        flattenObservation.status === 'EXPIRED' ||
        flattenObservation.status === 'EXPIRED_IN_MATCH';
      if (!flattenTerminal) {
        const flattenCancelAttemptFence = await appendMutationAttempt(
          flattenTicket,
          'CANCEL',
          ports,
          callCounts,
        );
        if (flattenCancelAttemptFence === 'DUPLICATE') {
          try {
            await queryOrder(flattenTicket, ports, callCounts);
          } catch {
            // The prior flatten-cancel identity remains fenced.
          }
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_ATTEMPT_ALREADY_EXISTS_NO_RETRY'],
            callCounts,
          );
        }
        if (flattenCancelAttemptFence !== 'FRESH') {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_ATTEMPT_LEDGER_NOT_DURABLE'],
            callCounts,
          );
        }
        callCounts.cancels += 1;
        let flattenCancelOutcome: Readonly<SpotMutationOutcome>;
        try {
          flattenCancelOutcome = await ports.executionPort.cancel(
            Object.freeze({
              kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
              ticketId: flattenTicket.ticketId,
              symbol,
              originalClientOrderId: flattenTicket.clientOrderId,
              automaticRetry: false as const,
            }),
          );
        } catch {
          flattenCancelOutcome = Object.freeze({
            kind: 'AMBIGUOUS' as const,
            reasonCode: 'FLATTEN_CANCEL_TRANSPORT_THROW',
            queryOriginalClientOrderId: flattenTicket.clientOrderId,
            automaticRetry: false as const,
          });
        }
        if (
          flattenCancelOutcome.kind === 'AMBIGUOUS' &&
          (flattenCancelOutcome.automaticRetry !== false ||
            flattenCancelOutcome.queryOriginalClientOrderId !==
              flattenTicket.clientOrderId)
        ) {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_AMBIGUITY_BINDING_INVALID'],
            callCounts,
          );
        }
        let afterFlattenCancel: Readonly<SpotQueryOutcome>;
        try {
          afterFlattenCancel = await queryOrder(
            flattenTicket,
            ports,
            callCounts,
          );
        } catch {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_QUERY_FAILED'],
            callCounts,
          );
        }
        if (afterFlattenCancel.kind !== 'FOUND') {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_QUERY_UNRESOLVED_NO_RETRY'],
            callCounts,
          );
        }
        if (
          afterFlattenCancel.venueOrderId === null ||
          (flattenVenueOrderId !== null &&
            flattenVenueOrderId !== afterFlattenCancel.venueOrderId)
        ) {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_CANCEL_ORDER_IDENTITY_CONFLICT'],
            callCounts,
          );
        }
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'FLATTEN_FILL_OBSERVED',
          cumulativeFlattenedQuantity:
            afterFlattenCancel.cumulativeFilledQuantity,
        });
        flattenVenueOrderId = afterFlattenCancel.venueOrderId;
        flattenTerminal =
          afterFlattenCancel.status === 'FILLED' ||
          afterFlattenCancel.status === 'CANCELED' ||
          afterFlattenCancel.status === 'REJECTED' ||
          afterFlattenCancel.status === 'EXPIRED' ||
          afterFlattenCancel.status === 'EXPIRED_IN_MATCH';
      }
      if (!flattenTerminal || spotResidualQuantity(lifecycle) !== '0') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_NOT_TERMINAL_OR_RESIDUAL'],
          callCounts,
        );
      }
    }

    const sourceVenueOrderId = lifecycle.venueOrderId;
    if (sourceVenueOrderId === null) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SOURCE_ORDER_ID_MISSING'],
        callCounts,
      );
    }
    let sourceFills: readonly Readonly<SpotFillObservation>[] = NO_FILLS;
    let flattenFills: readonly Readonly<SpotFillObservation>[] = NO_FILLS;
    try {
      if (compareSpotDecimals(lifecycle.cumulativeFilledQuantity, '0') > 0) {
        callCounts.fillQueries += 1;
        sourceFills = await ports.executionPort.queryFills(
          Object.freeze({
            kind: 'QUERY_FILLS' as const,
            ticketId: entryTicket.ticketId,
            symbol,
            originalClientOrderId: entryTicket.clientOrderId,
            venueOrderId: sourceVenueOrderId,
            readOnly: true as const,
          }),
        );
      }
      if (
        flattenTicket !== null &&
        compareSpotDecimals(
          lifecycle.cumulativeFlattenedQuantity,
          '0',
        ) > 0
      ) {
        if (flattenVenueOrderId === null) {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['FLATTEN_ORDER_ID_MISSING'],
            callCounts,
          );
        }
        callCounts.fillQueries += 1;
        flattenFills = await ports.executionPort.queryFills(
          Object.freeze({
            kind: 'QUERY_FILLS' as const,
            ticketId: flattenTicket.ticketId,
            symbol,
            originalClientOrderId: flattenTicket.clientOrderId,
            venueOrderId: flattenVenueOrderId,
            readOnly: true as const,
          }),
        );
      }
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FILL_QUERY_UNRESOLVED'],
        callCounts,
      );
    }

    let flatEvidence: Readonly<SpotAuthoritativeFlatEvidence> | null;
    try {
      flatEvidence = await ports.readFlatEvidence(
        Object.freeze({
          sourceTicket: entryTicket,
          flattenTicket,
          lifecycle,
          sourceFills,
          flattenFills,
        }),
      );
    } catch {
      flatEvidence = null;
    }
    if (
      !exactFlatEvidence(
        flatEvidence,
        entryTicket,
        flattenTicket,
        flattenVenueOrderId,
        lifecycle,
        sourceFills,
        flattenFills,
      ) ||
      flatEvidence === null
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['AUTHORITATIVE_FLAT_EVIDENCE_INCOMPLETE'],
        callCounts,
      );
    }

    const correlation = Object.freeze({
      ticketId: entryTicket.ticketId,
      clientOrderId: entryTicket.clientOrderId,
      orderId: sourceVenueOrderId,
      fillId: null,
      cancelId: null,
      flattenId: flattenTicket?.ticketId ?? null,
      attemptKind: flattenTicket === null ? ('ORDER' as const) : ('FLATTEN' as const),
    });
    const ledgerIntent = buildSpotLedgerAppendIntent(
      {
        eventKind: 'RECONCILIATION',
        eventRevision: flatEvidence.revision,
        symbol,
        correlation,
        side: entryTicket.side,
        baseQuantity: lifecycle.cumulativeFilledQuantity,
        quoteQuantity: flatEvidence.quoteQuantity,
        feeQuantity: flatEvidence.feeQuantity,
        feeAsset: flatEvidence.feeAsset,
        occurredAtMs: flatEvidence.occurredAtMs,
        status: 'EXACT',
      },
      ports.clock,
    );
    callCounts.ledgerAppends += 1;
    let appendOutcome: 'APPENDED' | 'DUPLICATE' | 'CONFLICT';
    try {
      appendOutcome = await ports.appendLedger(ledgerIntent);
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['LEDGER_APPEND_FAILED'],
        callCounts,
      );
    }
    if (
      appendOutcome !== 'APPENDED' &&
      appendOutcome !== 'DUPLICATE'
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['LEDGER_APPEND_CONFLICT'],
        callCounts,
      );
    }

    if (lifecycle.lifecycle !== 'FLAT') {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FLAT_CONFIRMED',
      });
    }
    if (
      lifecycle.lifecycle !== 'FLAT' ||
      spotResidualQuantity(lifecycle) !== '0'
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLAT_REDUCER_CONFIRMATION_FAILED'],
        callCounts,
      );
    }
    return result(
      'FLAT_RECONCILED',
      symbol,
      lifecycle,
      NO_REASONS,
      callCounts,
    );
  } catch {
    return result(
      callCounts.submits > 0 ? 'RECOVERY_REQUIRED' : 'BLOCKED',
      symbol,
      lifecycle,
      [
        callCounts.submits > 0
          ? 'COORDINATOR_FAILED_AFTER_SUBMIT'
          : 'COORDINATOR_INPUT_OR_GATE_INVALID',
      ],
      callCounts,
    );
  }
}
