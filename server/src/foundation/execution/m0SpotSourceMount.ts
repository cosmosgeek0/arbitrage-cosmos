/**
 * Pure production source mount for the M0 Spot validate/test-order route.
 *
 * The containing runtime mounts only the accepted local validate-only seam and
 * a truthful description of the separately gated test-order boundary. It owns
 * no authority issuer/consumer, signer, credential, transport, private read,
 * order adapter, persistence writer, host, provider, timer, or money path.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../risk/spotRiskPolicy.js';
import {
  createSpotValidateOnlySeam,
  DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
  type SpotValidateOnlyInput,
  type SpotValidateOnlyResult,
} from './spotValidateOnly.js';

export const M0_SPOT_SOURCE_MOUNT_SCHEMA =
  'cosmos.foundation.m0-spot-validate-test-source.v1' as const;

const REQUEST_KEYS = Object.freeze([
  'requestId',
  'ownerConfirmation',
  'operator',
] as const);
const OPERATOR_KEYS = Object.freeze(['id', 'email', 'source'] as const);
const REQUEST_ID = /^m0_req_[0-9a-f]{32}$/u;
const SEALED_VALIDATE_INPUT = Object.freeze(
  Object.create(null) as Record<string, never>,
) as unknown as Readonly<SpotValidateOnlyInput>;

type PlainRecord = Readonly<Record<string, unknown>>;

export interface M0SpotSourceMountOperator {
  readonly id: string;
  readonly email: string | null;
  readonly source: 'loopback' | 'cloudflare-access';
}

export interface M0SpotSourceMountInput {
  readonly requestId: `m0_req_${string}`;
  readonly ownerConfirmation: 'YES';
  readonly operator: Readonly<M0SpotSourceMountOperator>;
}

export interface M0SpotSourceMountResult {
  readonly schema: typeof M0_SPOT_SOURCE_MOUNT_SCHEMA;
  readonly ok: false;
  readonly code: 'M0_SOURCE_MOUNT_BLOCKED';
  readonly state: 'VALIDATE_TEST_ORDER_SOURCE_MOUNTED_NOT_ACTIVATED';
  readonly sourceMounted: true;
  readonly runtimeActivated: false;
  readonly hostProvisioned: false;
  readonly liveExecutionPermitted: false;
  readonly ownerConfirmation: 'ACKNOWLEDGED_NOT_AUTHORITY';
  readonly maximumOrderNotionalQuote:
    typeof OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE;
  readonly maximumOrderNotionalAsset: 'USDT';
  readonly admission: Readonly<{
    readonly sourceEnabled: false;
    readonly killSwitchEngaged: true;
    readonly allowedSymbols: readonly never[];
    readonly approvedUsdQuoteAssets: readonly never[];
  }>;
  readonly validation: Readonly<SpotValidateOnlyResult>;
  readonly testOrder: Readonly<{
    readonly mode: 'SIGNED_TEST_ORDER_ONLY';
    readonly orderType: 'LIMIT';
    readonly notionalBasis: 'SIGNED_LIMIT_PRICE_TIMES_QUANTITY';
    readonly method: 'POST';
    readonly path: '/api/v3/order/test';
    readonly authorityScope: 'BINANCE_SPOT_TEST_ORDER_ONLY';
    readonly authorityCardinality: 'ONE_USE';
    readonly authoritySource: 'SEPARATE_SERVER_AUTHORITY_REQUIRED';
    readonly authorityState: 'NOT_PRESENT';
    readonly authorityConsumption: 'NOT_ATTEMPTED';
    readonly intent: null;
    readonly signedRequest: 'NOT_CONSTRUCTED';
    readonly transport: 'NOT_CONFIGURED';
    readonly receipt: 'NOT_ATTEMPTED';
    readonly createsVenueOrder: false;
    readonly automaticRetry: false;
    readonly calls: 0;
  }>;
  readonly submitAuthority: 'NONE';
  readonly withdrawalPolicy: 'DISABLED';
  readonly transferPolicy: 'DISABLED';
  readonly flat: 'NOT_PROVED';
  readonly reconciliation: 'NOT_PROVED';
  readonly disarm: 'NOT_PROVED';
  readonly effects: Readonly<{
    readonly authorityConsumptions: 0;
    readonly signatures: 0;
    readonly transportCalls: 0;
    readonly privateCalls: 0;
    readonly testOrders: 0;
    readonly submits: 0;
    readonly transfers: 0;
    readonly withdrawals: 0;
    readonly moneyMutations: 0;
  }>;
}

export interface M0SpotSourceMountPort {
  inspectSourceMount(
    input: Readonly<M0SpotSourceMountInput>,
  ): Promise<Readonly<M0SpotSourceMountResult>>;
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
    const descriptors = Object.getOwnPropertyDescriptors(value);
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

function validInput(input: unknown): input is Readonly<M0SpotSourceMountInput> {
  const row = closedRecord(input, REQUEST_KEYS);
  const operator = row === null
    ? null
    : closedRecord(row.operator, OPERATOR_KEYS);
  return (
    row !== null
    && typeof row.requestId === 'string'
    && REQUEST_ID.test(row.requestId)
    && row.ownerConfirmation === 'YES'
    && operator !== null
    && typeof operator.id === 'string'
    && operator.id.length > 0
    && operator.id.length <= 160
    && (operator.email === null
      || (typeof operator.email === 'string' && operator.email.length <= 320))
    && (operator.source === 'loopback'
      || operator.source === 'cloudflare-access')
  );
}

/**
 * Construct the default-closed source mount. Calls remain deterministic and
 * side-effect free; plain YES is documentary acknowledgement only.
 */
export function createM0SpotSourceMount(): Readonly<M0SpotSourceMountPort> {
  const seam = createSpotValidateOnlySeam(
    DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
  );
  if (
    seam.sourceEnabled !== false
    || DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.killSwitchEngaged !== true
    || DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.allowedSymbols.length !== 0
    || DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.approvedUsdQuoteAssets.length !== 0
  ) throw new Error('M0_SPOT_DEFAULT_POSTURE_VIOLATION');

  return Object.freeze({
    async inspectSourceMount(
      input: Readonly<M0SpotSourceMountInput>,
    ): Promise<Readonly<M0SpotSourceMountResult>> {
      if (!validInput(input)) {
        throw new TypeError('M0 Spot source-mount invocation is invalid');
      }
      const validation = seam.validate(SEALED_VALIDATE_INPUT);
      if (
        validation.localValidationPassed !== false
        || validation.blockingCodes.length !== 1
        || validation.blockingCodes[0] !== 'SOURCE_DISABLED'
        || validation.signedTestPerformed !== false
        || validation.sendsPerformed !== 0
        || validation.sideEffectsPerformed !== 0
        || validation.externalActionAuthorization !== 'NONE'
      ) throw new Error('M0_SPOT_VALIDATE_ONLY_POSTURE_VIOLATION');

      return Object.freeze({
        schema: M0_SPOT_SOURCE_MOUNT_SCHEMA,
        ok: false as const,
        code: 'M0_SOURCE_MOUNT_BLOCKED' as const,
        state:
          'VALIDATE_TEST_ORDER_SOURCE_MOUNTED_NOT_ACTIVATED' as const,
        sourceMounted: true as const,
        runtimeActivated: false as const,
        hostProvisioned: false as const,
        liveExecutionPermitted: false as const,
        ownerConfirmation: 'ACKNOWLEDGED_NOT_AUTHORITY' as const,
        maximumOrderNotionalQuote:
          OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
        maximumOrderNotionalAsset: 'USDT' as const,
        admission: Object.freeze({
          sourceEnabled: false as const,
          killSwitchEngaged: true as const,
          allowedSymbols: Object.freeze([]) as readonly never[],
          approvedUsdQuoteAssets: Object.freeze([]) as readonly never[],
        }),
        validation,
        testOrder: Object.freeze({
          mode: 'SIGNED_TEST_ORDER_ONLY' as const,
          orderType: 'LIMIT' as const,
          notionalBasis:
            'SIGNED_LIMIT_PRICE_TIMES_QUANTITY' as const,
          method: 'POST' as const,
          path: '/api/v3/order/test' as const,
          authorityScope: 'BINANCE_SPOT_TEST_ORDER_ONLY' as const,
          authorityCardinality: 'ONE_USE' as const,
          authoritySource:
            'SEPARATE_SERVER_AUTHORITY_REQUIRED' as const,
          authorityState: 'NOT_PRESENT' as const,
          authorityConsumption: 'NOT_ATTEMPTED' as const,
          intent: null,
          signedRequest: 'NOT_CONSTRUCTED' as const,
          transport: 'NOT_CONFIGURED' as const,
          receipt: 'NOT_ATTEMPTED' as const,
          createsVenueOrder: false as const,
          automaticRetry: false as const,
          calls: 0 as const,
        }),
        submitAuthority: 'NONE' as const,
        withdrawalPolicy: 'DISABLED' as const,
        transferPolicy: 'DISABLED' as const,
        flat: 'NOT_PROVED' as const,
        reconciliation: 'NOT_PROVED' as const,
        disarm: 'NOT_PROVED' as const,
        effects: Object.freeze({
          authorityConsumptions: 0 as const,
          signatures: 0 as const,
          transportCalls: 0 as const,
          privateCalls: 0 as const,
          testOrders: 0 as const,
          submits: 0 as const,
          transfers: 0 as const,
          withdrawals: 0 as const,
          moneyMutations: 0 as const,
        }),
      });
    },
  });
}
