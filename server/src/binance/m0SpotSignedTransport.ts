/**
 * Direct-import-only mapper for one authority-consumed Spot test order.
 *
 * It can validate and transiently construct signed bytes for exactly
 * POST /api/v3/order/test after a separately injected atomic one-use consumer
 * returns a valid receipt. A local route-bound commitment is derived, while
 * signed material is neither returned nor retained in the result. Callers
 * receive only a non-executable proof. It has no HTTP client, host, API key,
 * environment read, retry, dispatch, live-order, query, cancel, flatten,
 * transfer, withdrawal, or money capability. M0-I2 production does not import
 * or construct this mapper.
 */
import { createHash } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import type { BinanceClockSample } from '../liveEdge/adapters/binanceSignedKernel/clock.js';
import {
  constructSignedRequest,
  constructUnsignedRequest,
  type BoundHmacSigner,
  type SignedRequestFailureCode,
} from '../liveEdge/adapters/binanceSignedKernel/request.js';
import {
  M0_SPOT_TEST_ORDER_NOTIONAL_ASSET,
  M0_SPOT_TEST_ORDER_SCOPE,
  validateM0SpotTestOrderAuthority,
  validateM0SpotTestOrderConsumptionReceipt,
  type M0SpotTestOrderAuthority,
  type M0SpotTestOrderAuthorityConsumer,
  type M0SpotTestOrderAuthorityFailureCode,
  type M0SpotTestOrderConsumptionReceipt,
} from '../foundation/execution/m0SpotTestOrderAuthority.js';
import type { SpotSignedTestOrderIntent } from '../foundation/execution/spotPort.js';
import type { SpotExecutionTicket } from '../foundation/execution/spotTicket.js';

export const M0_SPOT_SIGNED_TEST_ORDER_SCHEMA =
  'cosmos.binance.m0-spot-signed-test-order.v1' as const;

const INPUT_KEYS = Object.freeze([
  'requestId',
  'ticket',
  'intent',
  'authority',
  'correlationId',
  'requestSequence',
] as const);
const INTENT_KEYS = Object.freeze([
  'kind',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'symbol',
  'side',
  'type',
  'timeInForce',
  'quantity',
  'price',
  'filterSnapshotRevision',
  'createsVenueOrder',
  'liveSendAuthorized',
] as const);
const CLOCK_SAMPLE_KEYS = Object.freeze([
  'product',
  'environment',
  'utcSendEpochMs',
  'utcReceiveEpochMs',
  'monotonicSendMs',
  'monotonicReceiveMs',
  'serverEpochMs',
] as const);
const CLOCK_CUT_KEYS = Object.freeze([
  'utcEpochMs',
  'monotonicMs',
  'clockFenceId',
  'clockSamples',
] as const);
const CLOCK_FENCE_ID = /^m0_clock_fence_[A-Za-z0-9_.:-]{16,192}$/u;

type PlainRecord = Readonly<Record<string, unknown>>;

export interface M0SpotSignedTestOrderInput {
  readonly requestId: `m0_req_${string}`;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly intent: Readonly<SpotSignedTestOrderIntent>;
  readonly authority: Readonly<M0SpotTestOrderAuthority>;
  readonly correlationId: string;
  readonly requestSequence: number;
}

export interface M0SpotSignedTestOrderMapping {
  readonly schema: typeof M0_SPOT_SIGNED_TEST_ORDER_SCHEMA;
  readonly operation: 'SIGNED_TEST_PROOF';
  readonly contractId: 'SPOT_TEST_ORDER_POST';
  readonly method: 'POST';
  readonly path: '/api/v3/order/test';
  readonly computeCommissionRates: false;
  readonly notionalAsset: typeof M0_SPOT_TEST_ORDER_NOTIONAL_ASSET;
  readonly authorityScope: typeof M0_SPOT_TEST_ORDER_SCOPE;
  readonly authorityConsumption:
    Readonly<M0SpotTestOrderConsumptionReceipt>;
  readonly signedProof: Readonly<{
    readonly proofKind: 'LOCAL_ROUTE_BOUND_SIGNER_COMMITMENT';
    readonly contractId: 'SPOT_TEST_ORDER_POST';
    readonly product: 'SPOT';
    readonly environment: 'PRODUCTION';
    readonly method: 'POST';
    readonly path: '/api/v3/order/test';
    readonly signerProfile: 'SPOT_HMAC_SHA256';
    readonly requestId: `lrq_${string}`;
    readonly clientOrderId: string;
    readonly mutationClass: 'TEST_ORDER_MUTATION';
    readonly safeRetryClass: 'NEVER_AUTOMATIC';
    readonly signedAtMs: number;
    readonly routeBoundCommitmentSha256: `sha256:${string}`;
    readonly signedMaterialReturned: false;
    readonly executableMaterialReturned: false;
  }>;
  readonly automaticRetry: false;
  readonly transportCallsAuthorized: 0;
  readonly dispatchAuthorized: false;
  readonly submitAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

export type M0SpotSignedTestOrderFailureCode =
  | SignedRequestFailureCode
  | M0SpotTestOrderAuthorityFailureCode
  | 'INPUT_INVALID'
  | 'INTENT_INVALID'
  | 'INTENT_BINDING_MISMATCH'
  | 'AUTHORITY_NOT_CONSUMED'
  | 'AUTHORITY_CONSUMER_FAILED'
  | 'SIGNED_REQUEST_TIME_INVALID'
  | 'SIGNED_REQUEST_DRIFT'
  | 'SIGNED_REQUEST_SCOPE_MISMATCH';

export type M0SpotSignedTestOrderMapResult =
  | {
      readonly ok: true;
      readonly mapped: Readonly<M0SpotSignedTestOrderMapping>;
    }
  | {
      readonly ok: false;
      readonly failure: Readonly<{
        readonly code: M0SpotSignedTestOrderFailureCode;
      }>;
    };

export interface M0SpotSignedTestOrderMapper {
  map(
    input: Readonly<M0SpotSignedTestOrderInput>,
  ): Promise<M0SpotSignedTestOrderMapResult>;
}

export interface M0SpotSignedTestOrderClock {
  /**
   * Trusted synchronous local-UTC, monotonic-epoch, and Binance-sample cut.
   * clockFenceId must be stable within one monotonic epoch and rotate across
   * process/host restart. The mapper reads again after async authority
   * consumption and performs no await before the signer. Request callers
   * cannot supply any clock evidence.
   */
  cut(): Readonly<{
    readonly utcEpochMs: number;
    readonly monotonicMs: number;
    readonly clockFenceId: `m0_clock_fence_${string}`;
    readonly clockSamples: readonly Readonly<BinanceClockSample>[];
  }>;
}

function failure(
  code: M0SpotSignedTestOrderFailureCode,
): M0SpotSignedTestOrderMapResult {
  return Object.freeze({
    ok: false as const,
    failure: Object.freeze({ code }),
  });
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): PlainRecord | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as unknown as Record<string, PropertyDescriptor>;
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.length
      || expectedKeys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true
        );
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      expectedKeys.map((key) => [key, descriptors[key].value]),
    ));
  } catch {
    return null;
  }
}

function intentMatchesTicket(
  intent: PlainRecord,
  ticket: Readonly<SpotExecutionTicket>,
): intent is PlainRecord & Readonly<SpotSignedTestOrderIntent> {
  return (
    intent.kind === 'SIGNED_TEST_ORDER'
    && intent.ticketId === ticket.ticketId
    && intent.termsDigest === ticket.termsDigest
    && intent.clientOrderId === ticket.clientOrderId
    && intent.symbol === ticket.symbol
    && intent.side === ticket.side
    && intent.type === ticket.type
    && intent.timeInForce === ticket.timeInForce
    && intent.quantity === ticket.quantity
    && intent.price === ticket.price
    && typeof intent.filterSnapshotRevision === 'string'
    && intent.filterSnapshotRevision.length > 0
    && intent.filterSnapshotRevision.length <= 256
    && intent.createsVenueOrder === false
    && intent.liveSendAuthorized === false
  );
}

function snapshotClockSamples(
  value: unknown,
): readonly Readonly<BinanceClockSample>[] | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || nodeUtilTypes.isProxy(value)
      || !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as unknown as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || (lengthDescriptor.value as number) < 0
      || (lengthDescriptor.value as number) > 9
      || Reflect.ownKeys(descriptors).length
        !== (lengthDescriptor.value as number) + 1
    ) return null;
    const samples: Readonly<BinanceClockSample>[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true
      ) return null;
      const sample = closedRecord(descriptor.value, CLOCK_SAMPLE_KEYS);
      if (sample === null) return null;
      samples.push(Object.freeze({
        product: sample.product as BinanceClockSample['product'],
        environment:
          sample.environment as BinanceClockSample['environment'],
        utcSendEpochMs: sample.utcSendEpochMs as number,
        utcReceiveEpochMs: sample.utcReceiveEpochMs as number,
        monotonicSendMs: sample.monotonicSendMs as number,
        monotonicReceiveMs: sample.monotonicReceiveMs as number,
        serverEpochMs: sample.serverEpochMs as number,
      }));
    }
    return Object.freeze(samples);
  } catch {
    return null;
  }
}

interface M0SpotSignedTestOrderClockCut {
  readonly utcEpochMs: number;
  readonly monotonicMs: number;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly clockSamples: readonly Readonly<BinanceClockSample>[];
}

function readClockCut(
  clock: Readonly<M0SpotSignedTestOrderClock>,
): Readonly<M0SpotSignedTestOrderClockCut> | null {
  try {
    const row = closedRecord(clock.cut(), CLOCK_CUT_KEYS);
    if (
      row === null
      || !Number.isSafeInteger(row.utcEpochMs)
      || (row.utcEpochMs as number) < 0
      || !Number.isSafeInteger(row.monotonicMs)
      || (row.monotonicMs as number) < 0
      || typeof row.clockFenceId !== 'string'
      || !CLOCK_FENCE_ID.test(row.clockFenceId)
    ) return null;
    const clockSamples = snapshotClockSamples(row.clockSamples);
    if (clockSamples === null) return null;
    return Object.freeze({
      utcEpochMs: row.utcEpochMs as number,
      monotonicMs: row.monotonicMs as number,
      clockFenceId:
        row.clockFenceId as `m0_clock_fence_${string}`,
      clockSamples,
    });
  } catch {
    return null;
  }
}

function parameters(
  ticket: Readonly<SpotExecutionTicket>,
): readonly (readonly [string, string])[] {
  const values: (readonly [string, string])[] = [
    Object.freeze(['symbol', ticket.symbol] as const),
    Object.freeze(['side', ticket.side] as const),
    Object.freeze(['type', ticket.type] as const),
    Object.freeze(['quantity', ticket.quantity] as const),
    Object.freeze(['computeCommissionRates', 'false'] as const),
  ];
  if (
    ticket.type === 'LIMIT'
    && ticket.timeInForce !== null
    && ticket.price !== null
  ) {
    values.push(
      Object.freeze(['timeInForce', ticket.timeInForce] as const),
      Object.freeze(['price', ticket.price] as const),
    );
  }
  return Object.freeze(values);
}

function unsignedTimestampMs(query: string): number | null {
  const values = query
    .split('&')
    .filter((pair) => pair.startsWith('timestamp='))
    .map((pair) => pair.slice('timestamp='.length));
  if (values.length !== 1 || !/^(?:0|[1-9][0-9]*)$/u.test(values[0])) {
    return null;
  }
  const timestampMs = Number(values[0]);
  return Number.isSafeInteger(timestampMs)
    && timestampMs >= 0
    && String(timestampMs) === values[0]
    ? timestampMs
    : null;
}

/**
 * Construct an unmounted mapper. The injected consumer must provide durable,
 * atomic one-use semantics; signing occurs only after its exact receipt.
 */
export function createM0SpotSignedTestOrderMapper(ports: {
  readonly consumeAuthority: Readonly<M0SpotTestOrderAuthorityConsumer>;
  readonly clock: Readonly<M0SpotSignedTestOrderClock>;
  readonly signer: Readonly<BoundHmacSigner>;
}): Readonly<M0SpotSignedTestOrderMapper> {
  if (
    typeof ports?.consumeAuthority?.consume !== 'function'
    || typeof ports?.clock?.cut !== 'function'
    || typeof ports?.signer?.sign !== 'function'
  ) {
    throw new TypeError(
      'M0 test-order authority consumer, trusted clock, and signer required',
    );
  }

  return Object.freeze({
    async map(
      inputValue: Readonly<M0SpotSignedTestOrderInput>,
    ): Promise<M0SpotSignedTestOrderMapResult> {
      const input = closedRecord(inputValue, INPUT_KEYS);
      if (input === null) return failure('INPUT_INVALID');

      const beforeConsumptionCut = readClockCut(ports.clock);
      if (beforeConsumptionCut === null) {
        return failure('CLOCK_EVIDENCE_INVALID');
      }
      const authority = validateM0SpotTestOrderAuthority({
        requestId: input.requestId,
        ticket: input.ticket,
        authority: input.authority,
        evaluatedAtMs: beforeConsumptionCut.utcEpochMs,
        clockFenceId: beforeConsumptionCut.clockFenceId,
        evaluatedMonotonicMs: beforeConsumptionCut.monotonicMs,
      });
      if (!authority.ok) return failure(authority.code);

      const intent = closedRecord(input.intent, INTENT_KEYS);
      if (intent === null) return failure('INTENT_INVALID');
      if (
        !intentMatchesTicket(intent, authority.ticket)
        || intent.filterSnapshotRevision
          !== authority.authority.filterSnapshotRevision
      ) {
        return failure('INTENT_BINDING_MISMATCH');
      }

      const requestInputBeforeConsumption = Object.freeze({
        contractId: 'SPOT_TEST_ORDER_POST' as const,
        expectedProduct: 'SPOT' as const,
        expectedEnvironment: 'PRODUCTION' as const,
        parameters: parameters(authority.ticket),
        clockSamples: beforeConsumptionCut.clockSamples,
        nowMonotonicMs: beforeConsumptionCut.monotonicMs,
        correlationId: input.correlationId,
        requestSequence: input.requestSequence,
        clientOrderIdentity: Object.freeze({
          planId: authority.ticket.planId,
          legId: authority.ticket.legId,
          attempt: authority.ticket.attempt,
        }),
      });
      const unsignedBeforeConsumption = constructUnsignedRequest(
        requestInputBeforeConsumption,
      );
      if (!unsignedBeforeConsumption.ok) {
        return failure(unsignedBeforeConsumption.failure.code);
      }
      const signingAtMs = unsignedTimestampMs(
        unsignedBeforeConsumption.request.material.query,
      );
      if (signingAtMs === null) {
        return failure('SIGNED_REQUEST_TIME_INVALID');
      }
      const authorityEvaluatedAtMs = Math.max(
        beforeConsumptionCut.utcEpochMs,
        signingAtMs,
      );
      const signingAuthority = validateM0SpotTestOrderAuthority({
        requestId: authority.authority.requestId,
        ticket: authority.ticket,
        authority: authority.authority,
        evaluatedAtMs: authorityEvaluatedAtMs,
        clockFenceId: beforeConsumptionCut.clockFenceId,
        evaluatedMonotonicMs: beforeConsumptionCut.monotonicMs,
      });
      if (!signingAuthority.ok) return failure(signingAuthority.code);

      let consumption: Readonly<M0SpotTestOrderConsumptionReceipt> | null;
      try {
        consumption = await ports.consumeAuthority.consume(Object.freeze({
          requestId: signingAuthority.authority.requestId,
          ticket: signingAuthority.ticket,
          authority: signingAuthority.authority,
          evaluatedAtMs: authorityEvaluatedAtMs,
          clockFenceId: beforeConsumptionCut.clockFenceId,
          evaluatedMonotonicMs: beforeConsumptionCut.monotonicMs,
        }));
      } catch {
        return failure('AUTHORITY_CONSUMER_FAILED');
      }
      if (consumption === null) return failure('AUTHORITY_NOT_CONSUMED');

      const afterConsumptionCut = readClockCut(ports.clock);
      if (
        afterConsumptionCut === null
        || afterConsumptionCut.clockFenceId
          !== beforeConsumptionCut.clockFenceId
        || afterConsumptionCut.monotonicMs
          < beforeConsumptionCut.monotonicMs
        || afterConsumptionCut.utcEpochMs
          < beforeConsumptionCut.utcEpochMs
      ) return failure('SIGNED_REQUEST_DRIFT');
      const authorityElapsedMs = afterConsumptionCut.monotonicMs
        - beforeConsumptionCut.monotonicMs;
      const monotonicAuthorityFloorMs = authorityEvaluatedAtMs
        + authorityElapsedMs;
      if (
        !Number.isSafeInteger(authorityElapsedMs)
        || !Number.isSafeInteger(monotonicAuthorityFloorMs)
      ) return failure('SIGNED_REQUEST_DRIFT');
      const requestInputAfterConsumption = Object.freeze({
        ...requestInputBeforeConsumption,
        clockSamples: afterConsumptionCut.clockSamples,
        nowMonotonicMs: afterConsumptionCut.monotonicMs,
      });
      const unsignedAfterConsumption = constructUnsignedRequest(
        requestInputAfterConsumption,
      );
      if (!unsignedAfterConsumption.ok) {
        return failure(unsignedAfterConsumption.failure.code);
      }
      const finalSigningAtMs = unsignedTimestampMs(
        unsignedAfterConsumption.request.material.query,
      );
      if (
        finalSigningAtMs === null
        || finalSigningAtMs < signingAtMs
      ) return failure('SIGNED_REQUEST_TIME_INVALID');
      const finalAuthorityEvaluatedAtMs = Math.max(
        afterConsumptionCut.utcEpochMs,
        finalSigningAtMs,
        monotonicAuthorityFloorMs,
      );
      const finalSigningAuthority = validateM0SpotTestOrderAuthority({
        requestId: signingAuthority.authority.requestId,
        ticket: signingAuthority.ticket,
        authority: signingAuthority.authority,
        evaluatedAtMs: finalAuthorityEvaluatedAtMs,
        clockFenceId: afterConsumptionCut.clockFenceId,
        evaluatedMonotonicMs: afterConsumptionCut.monotonicMs,
      });
      if (!finalSigningAuthority.ok) {
        return failure(finalSigningAuthority.code);
      }
      const receipt = validateM0SpotTestOrderConsumptionReceipt({
        requestId: finalSigningAuthority.authority.requestId,
        ticket: finalSigningAuthority.ticket,
        authority: finalSigningAuthority.authority,
        receipt: consumption,
        evaluatedAtMs: finalAuthorityEvaluatedAtMs,
        clockFenceId: afterConsumptionCut.clockFenceId,
        minimumMonotonicMs: beforeConsumptionCut.monotonicMs,
        evaluatedMonotonicMs: afterConsumptionCut.monotonicMs,
      });
      if (!receipt.ok) return failure(receipt.code);
      if (
        afterConsumptionCut.monotonicMs
          === beforeConsumptionCut.monotonicMs
        && (
          unsignedAfterConsumption.request.material.query
            !== unsignedBeforeConsumption.request.material.query
          || unsignedAfterConsumption.request.requestIdentity.requestId
            !== unsignedBeforeConsumption.request.requestIdentity.requestId
        )
      ) return failure('SIGNED_REQUEST_DRIFT');

      const constructed = constructSignedRequest(
        requestInputAfterConsumption,
        ports.signer,
      );
      if (!constructed.ok) return failure(constructed.failure.code);
      if (
        constructed.request.contractId !== 'SPOT_TEST_ORDER_POST'
        || constructed.request.product !== 'SPOT'
        || constructed.request.environment !== 'PRODUCTION'
        || constructed.request.method !== 'POST'
        || constructed.request.clientOrderId !== authority.ticket.clientOrderId
        || constructed.request.signerProfile !== 'SPOT_HMAC_SHA256'
        || constructed.request.mutationClass !== 'TEST_ORDER_MUTATION'
        || constructed.request.safeRetryClass !== 'NEVER_AUTOMATIC'
        || constructed.request.externalActionAuthorization !== 'NONE'
        || constructed.request.requestIdentity.requestId
          !== unsignedAfterConsumption.request.requestIdentity.requestId
        || !constructed.request.material.query.startsWith(
          `${unsignedAfterConsumption.request.material.query}&signature=`,
        )
      ) return failure('SIGNED_REQUEST_SCOPE_MISMATCH');
      const routeBoundCommitmentSha256 =
        `sha256:${createHash('sha256')
        .update(
          [
            M0_SPOT_SIGNED_TEST_ORDER_SCHEMA,
            'SPOT_TEST_ORDER_POST',
            'POST',
            '/api/v3/order/test',
            constructed.request.material.query,
          ].join('\u0000'),
          'utf8',
        )
        .digest('hex')}` as const;

      return Object.freeze({
        ok: true as const,
        mapped: Object.freeze({
          schema: M0_SPOT_SIGNED_TEST_ORDER_SCHEMA,
          operation: 'SIGNED_TEST_PROOF' as const,
          contractId: 'SPOT_TEST_ORDER_POST' as const,
          method: 'POST' as const,
          path: '/api/v3/order/test' as const,
          computeCommissionRates: false as const,
          notionalAsset: M0_SPOT_TEST_ORDER_NOTIONAL_ASSET,
          authorityScope: M0_SPOT_TEST_ORDER_SCOPE,
          authorityConsumption: receipt.receipt,
          signedProof: Object.freeze({
            proofKind:
              'LOCAL_ROUTE_BOUND_SIGNER_COMMITMENT' as const,
            contractId: 'SPOT_TEST_ORDER_POST' as const,
            product: 'SPOT' as const,
            environment: 'PRODUCTION' as const,
            method: 'POST' as const,
            path: '/api/v3/order/test' as const,
            signerProfile: 'SPOT_HMAC_SHA256' as const,
            requestId: constructed.request.requestIdentity.requestId,
            clientOrderId: authority.ticket.clientOrderId,
            mutationClass: 'TEST_ORDER_MUTATION' as const,
            safeRetryClass: 'NEVER_AUTOMATIC' as const,
            signedAtMs: finalSigningAtMs,
            routeBoundCommitmentSha256,
            signedMaterialReturned: false as const,
            executableMaterialReturned: false as const,
          }),
          automaticRetry: false as const,
          transportCallsAuthorized: 0 as const,
          dispatchAuthorized: false as const,
          submitAuthority: 'NONE' as const,
          externalActionAuthorization: 'NONE' as const,
        }),
      });
    },
  });
}
