/**
 * Pure, default-closed shared seam for M0 Spot source validation.
 *
 * This module owns no environment, clock, signer, transport, private read,
 * persistence, ledger, venue-test, order, cancel, or capital-movement port.
 * Callers must inject an explicit symbol ticket, canonical risk evidence, and
 * a fresh public exchangeInfo filter projection. Even a successful validation
 * returns no signed-test or live-order intent.
 */
import { canonicalJson } from '../contracts/identity.js';
import type { BinanceSpotFilterValidation } from '../exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
  type SpotRiskVerdict,
} from '../risk/spotRiskPolicy.js';
import {
  prepareSpotCore,
  type SpotCoreBlockingCode,
  type SpotRiskEvidence,
} from './spotCore.js';
import {
  createSpotExecutionTicket,
  type SpotExecutionTicket,
} from './spotTicket.js';

export const SPOT_VALIDATE_ONLY_SCHEMA =
  'cosmos.foundation.spot-validate-only.v1' as const;
export const SPOT_PUBLIC_FILTER_EVIDENCE_SCHEMA =
  'cosmos.foundation.spot-public-filter-evidence.v1' as const;
export const SPOT_PUBLIC_FILTER_SOURCE =
  'BINANCE_SPOT_EXCHANGE_INFO' as const;
export const MAX_SPOT_PUBLIC_FILTER_AGE_MS = 60_000 as const;

export const SPOT_VALIDATE_ONLY_CAPABILITIES = Object.freeze({
  localValidation: true,
  signedTestOrder: false,
  liveOrder: false,
  orderQuery: false,
  cancelOrder: false,
  withdrawal: false,
  transfer: false,
  borrow: false,
  repay: false,
} as const);

const NO_EXTERNAL_ACTIONS = Object.freeze([]) as readonly never[];

export const SPOT_VALIDATE_ONLY_BLOCKING_CODES = Object.freeze([
  'SOURCE_DISABLED',
  'CONFIG_INVALID',
  'KILL_SWITCH_ENGAGED_OR_UNKNOWN',
  'INPUT_INVALID',
  'EVALUATION_TIME_INVALID',
  'TICKET_INVALID',
  'SYMBOL_NOT_ALLOWLISTED',
  'SYMBOL_BLOCKED',
  'PUBLIC_FILTER_EVIDENCE_INVALID',
  'PUBLIC_FILTER_SYMBOL_MISMATCH',
  'PUBLIC_FILTER_QUOTE_ASSET_NOT_APPROVED',
  'PUBLIC_FILTER_STALE',
  'PUBLIC_FILTER_TRADING_DISABLED',
  'PUBLIC_FILTER_ORDER_TYPE_UNSUPPORTED',
  'CORE_VALIDATION_FAILED',
] as const);

export type SpotValidateOnlyOuterBlockingCode =
  (typeof SPOT_VALIDATE_ONLY_BLOCKING_CODES)[number];
export type SpotValidateOnlyBlockingCode =
  | SpotValidateOnlyOuterBlockingCode
  | SpotCoreBlockingCode;

export interface SpotValidateOnlySeamConfig {
  /** Positive source admission. Only exact true enables local validation. */
  readonly sourceEnabled: boolean;
  /** False is the only clear state; true or null is closed. */
  readonly killSwitchEngaged: boolean | null;
  /** Exact symbols supplied by the owner/configuration boundary. */
  readonly allowedSymbols: readonly string[];
  /** Explicit deny policy wins over allow policy. */
  readonly blockedSymbols: readonly string[];
  /**
   * Quote assets explicitly approved by policy as USD-denominated for the
   * hard 10-unit M0 ceiling. The seam never infers this from the symbol.
   */
  readonly approvedUsdQuoteAssets: readonly string[];
  /** Must be positive and no greater than MAX_SPOT_PUBLIC_FILTER_AGE_MS. */
  readonly maximumFilterAgeMs: number;
}

export const DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG:
  Readonly<SpotValidateOnlySeamConfig> = Object.freeze({
    sourceEnabled: false,
    killSwitchEngaged: true,
    allowedSymbols: Object.freeze([]),
    blockedSymbols: Object.freeze([]),
    approvedUsdQuoteAssets: Object.freeze([]),
    maximumFilterAgeMs: MAX_SPOT_PUBLIC_FILTER_AGE_MS,
  });

/**
 * Authority-owned projection of the exact public exchangeInfo row used for
 * validation. Producing or refreshing this evidence is outside this seam.
 */
export interface SpotPublicFilterEvidence {
  readonly schema: typeof SPOT_PUBLIC_FILTER_EVIDENCE_SCHEMA;
  readonly source: typeof SPOT_PUBLIC_FILTER_SOURCE;
  readonly verification: 'VERIFIED_BY_PUBLIC_FILTER_OWNER';
  readonly revision: string;
  readonly symbol: string;
  readonly quoteAsset: string;
  readonly tradingStatus: string;
  readonly spotTradingAllowed: boolean;
  readonly orderTypes: readonly string[];
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly filters: readonly unknown[];
}

export interface SpotValidateOnlyInput {
  readonly nowMs: number;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly riskEvidence: Readonly<SpotRiskEvidence> | null;
  readonly publicFilterEvidence: Readonly<SpotPublicFilterEvidence>;
}

export interface SpotValidateOnlyResult {
  readonly schema: typeof SPOT_VALIDATE_ONLY_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly localValidationPassed: boolean;
  readonly ticketId: string | null;
  readonly termsDigest: string | null;
  readonly clientOrderId: string | null;
  readonly symbol: string | null;
  readonly quoteAsset: string | null;
  readonly filterEvidenceRevision: string | null;
  readonly filterValidation: Readonly<BinanceSpotFilterValidation> | null;
  readonly riskVerdict: Readonly<SpotRiskVerdict> | null;
  readonly blockingCodes: readonly SpotValidateOnlyBlockingCode[];
  readonly ownerOrderNotionalCeilingQuote:
    typeof OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE;
  readonly signedTestRequired: true;
  readonly signedTestPerformed: false;
  readonly signedTestIntentExposed: false;
  readonly liveSendAuthorized: false;
  readonly sendsPerformed: 0;
  readonly sideEffectsPerformed: 0;
  readonly externalActionAuthorization: 'NONE';
  readonly permittedExternalActions: readonly never[];
  readonly capabilities: typeof SPOT_VALIDATE_ONLY_CAPABILITIES;
}

export interface SpotValidateOnlySeam {
  readonly mode: 'VALIDATE_ONLY';
  readonly sourceEnabled: boolean;
  readonly validate: (
    input: Readonly<SpotValidateOnlyInput>,
  ) => Readonly<SpotValidateOnlyResult>;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function snapshotPlainRecord(value: unknown): UnknownRecord {
  const snapshot = JSON.parse(canonicalJson(value)) as unknown;
  const candidate = record(snapshot);
  if (candidate === null) {
    throw new TypeError('value must be a plain record');
  }
  return candidate;
}

function validLabel(
  value: unknown,
  maximumLength: number,
  expression?: RegExp,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    (expression === undefined || expression.test(value))
  );
}

function validUtcMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validExactList(
  value: unknown,
  expression: RegExp,
  maximumItems: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        expression.test(item) &&
        item === item.trim(),
    ) &&
    new Set(value).size === value.length
  );
}

function configurationValid(
  config: Readonly<SpotValidateOnlySeamConfig>,
): boolean {
  return (
    typeof config?.sourceEnabled === 'boolean' &&
    (typeof config.killSwitchEngaged === 'boolean' ||
      config.killSwitchEngaged === null) &&
    validExactList(config.allowedSymbols, /^[A-Z0-9]{1,64}$/u, 500) &&
    validExactList(config.blockedSymbols, /^[A-Z0-9]{1,64}$/u, 500) &&
    validExactList(
      config.approvedUsdQuoteAssets,
      /^[A-Z0-9]{1,20}$/u,
      50,
    ) &&
    Number.isSafeInteger(config.maximumFilterAgeMs) &&
    config.maximumFilterAgeMs > 0 &&
    config.maximumFilterAgeMs <= MAX_SPOT_PUBLIC_FILTER_AGE_MS
  );
}

function canonicalTicket(
  value: unknown,
): Readonly<SpotExecutionTicket> | null {
  try {
    const candidate = snapshotPlainRecord(value);
    const rebuilt = createSpotExecutionTicket({
      correlationId: candidate.correlationId as string,
      planId: candidate.planId as string,
      accountId: candidate.accountId as string,
      symbol: candidate.symbol as string,
      side: candidate.side as SpotExecutionTicket['side'],
      type: candidate.type as SpotExecutionTicket['type'],
      timeInForce:
        candidate.timeInForce as SpotExecutionTicket['timeInForce'],
      quantity: candidate.quantity as string,
      price: candidate.price as string | null,
      riskReferencePrice: candidate.riskReferencePrice as string,
      estimatedMaxLossQuote: candidate.estimatedMaxLossQuote as string,
      purpose: candidate.purpose as SpotExecutionTicket['purpose'],
      attempt: candidate.attempt as number,
      createdAtMs: candidate.createdAtMs as number,
      expiresAtMs: candidate.expiresAtMs as number,
    });
    return canonicalJson(candidate) === canonicalJson(rebuilt)
      ? rebuilt
      : null;
  } catch {
    return null;
  }
}

function uniqueCodes(
  codes: readonly SpotValidateOnlyBlockingCode[],
): readonly SpotValidateOnlyBlockingCode[] {
  return Object.freeze([...new Set(codes)]);
}

function freezeResult(
  input: {
    readonly passed: boolean;
    readonly ticket: Readonly<SpotExecutionTicket> | null;
    readonly quoteAsset: string | null;
    readonly filterEvidenceRevision: string | null;
    readonly filterValidation: Readonly<BinanceSpotFilterValidation> | null;
    readonly riskVerdict: Readonly<SpotRiskVerdict> | null;
    readonly blockingCodes: readonly SpotValidateOnlyBlockingCode[];
  },
): Readonly<SpotValidateOnlyResult> {
  return Object.freeze({
    schema: SPOT_VALIDATE_ONLY_SCHEMA,
    version: 1 as const,
    mode: 'VALIDATE_ONLY' as const,
    localValidationPassed: input.passed,
    ticketId: input.ticket?.ticketId ?? null,
    termsDigest: input.ticket?.termsDigest ?? null,
    clientOrderId: input.ticket?.clientOrderId ?? null,
    symbol: input.ticket?.symbol ?? null,
    quoteAsset: input.quoteAsset,
    filterEvidenceRevision: input.filterEvidenceRevision,
    filterValidation: input.filterValidation,
    riskVerdict: input.riskVerdict,
    blockingCodes: uniqueCodes(input.blockingCodes),
    ownerOrderNotionalCeilingQuote:
      OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
    signedTestRequired: true as const,
    signedTestPerformed: false as const,
    signedTestIntentExposed: false as const,
    liveSendAuthorized: false as const,
    sendsPerformed: 0 as const,
    sideEffectsPerformed: 0 as const,
    externalActionAuthorization: 'NONE' as const,
    permittedExternalActions: NO_EXTERNAL_ACTIONS,
    capabilities: SPOT_VALIDATE_ONLY_CAPABILITIES,
  });
}

function blocked(
  blockingCodes: readonly SpotValidateOnlyBlockingCode[],
  ticket: Readonly<SpotExecutionTicket> | null = null,
  evidence: Readonly<SpotPublicFilterEvidence> | null = null,
): Readonly<SpotValidateOnlyResult> {
  return freezeResult({
    passed: false,
    ticket,
    quoteAsset: evidence?.quoteAsset ?? null,
    filterEvidenceRevision: evidence?.revision ?? null,
    filterValidation: null,
    riskVerdict: null,
    blockingCodes,
  });
}

/**
 * Construct a source-only validation seam. Construction and calls are
 * deterministic and side-effect-free. The default configuration is closed.
 */
export function createSpotValidateOnlySeam(
  config: Readonly<SpotValidateOnlySeamConfig> =
    DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
): Readonly<SpotValidateOnlySeam> {
  let configSnapshot: Readonly<SpotValidateOnlySeamConfig> | null = null;
  try {
    configSnapshot =
      snapshotPlainRecord(config) as unknown as SpotValidateOnlySeamConfig;
  } catch {
    // Invalid or effectful-looking configuration remains closed.
  }
  const configIsValid =
    configSnapshot !== null && configurationValid(configSnapshot);
  const sourceEnabled =
    configIsValid && configSnapshot?.sourceEnabled === true;
  const killSwitchEngaged = configIsValid
    ? configSnapshot?.killSwitchEngaged ?? null
    : true;
  const maximumFilterAgeMs = configIsValid
    ? configSnapshot?.maximumFilterAgeMs ??
      DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.maximumFilterAgeMs
    : DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.maximumFilterAgeMs;
  const allowedSymbols = configIsValid
    ? Object.freeze([...(configSnapshot?.allowedSymbols ?? [])])
    : Object.freeze([] as string[]);
  const blockedSymbols = configIsValid
    ? Object.freeze([...(configSnapshot?.blockedSymbols ?? [])])
    : Object.freeze([] as string[]);
  const approvedUsdQuoteAssets = configIsValid
    ? Object.freeze([
        ...(configSnapshot?.approvedUsdQuoteAssets ?? []),
      ])
    : Object.freeze([] as string[]);

  return Object.freeze({
    mode: 'VALIDATE_ONLY' as const,
    sourceEnabled,
    validate(
      input: Readonly<SpotValidateOnlyInput>,
    ): Readonly<SpotValidateOnlyResult> {
      if (!configIsValid) return blocked(['CONFIG_INVALID']);
      if (!sourceEnabled) return blocked(['SOURCE_DISABLED']);
      if (killSwitchEngaged !== false) {
        return blocked(['KILL_SWITCH_ENGAGED_OR_UNKNOWN']);
      }

      try {
        const inputRecord = record(input);
        if (inputRecord === null) return blocked(['INPUT_INVALID']);
        const nowMsValue = inputRecord.nowMs;
        const ticketValue = inputRecord.ticket;
        const riskEvidenceValue = inputRecord.riskEvidence;
        const publicFilterEvidenceValue =
          inputRecord.publicFilterEvidence;

        if (!validUtcMs(nowMsValue)) {
          return blocked(['EVALUATION_TIME_INVALID']);
        }
        const nowMs = nowMsValue;
        const ticket = canonicalTicket(ticketValue);
        if (ticket === null) return blocked(['TICKET_INVALID']);

        const outerCodes: SpotValidateOnlyBlockingCode[] = [];
        if (!allowedSymbols.includes(ticket.symbol)) {
          outerCodes.push('SYMBOL_NOT_ALLOWLISTED');
        }
        if (blockedSymbols.includes(ticket.symbol)) {
          outerCodes.push('SYMBOL_BLOCKED');
        }

        const evidence = snapshotPlainRecord(publicFilterEvidenceValue);
        const evidenceStructurallyValid =
          evidence.schema === SPOT_PUBLIC_FILTER_EVIDENCE_SCHEMA &&
          evidence.source === SPOT_PUBLIC_FILTER_SOURCE &&
          evidence.verification === 'VERIFIED_BY_PUBLIC_FILTER_OWNER' &&
          validLabel(evidence.revision, 256) &&
          validLabel(evidence.symbol, 64, /^[A-Z0-9]{1,64}$/u) &&
          validLabel(evidence.quoteAsset, 20, /^[A-Z0-9]{1,20}$/u) &&
          typeof evidence.tradingStatus === 'string' &&
          typeof evidence.spotTradingAllowed === 'boolean' &&
          Array.isArray(evidence.orderTypes) &&
          evidence.orderTypes.every(
            (item) => validLabel(item, 64, /^[A-Z0-9_]{1,64}$/u),
          ) &&
          validUtcMs(evidence.observedAtMs) &&
          validUtcMs(evidence.validUntilMs) &&
          Array.isArray(evidence.filters);
        if (!evidenceStructurallyValid) {
          outerCodes.push('PUBLIC_FILTER_EVIDENCE_INVALID');
          return blocked(outerCodes, ticket);
        }

        const publicEvidence =
          evidence as unknown as Readonly<SpotPublicFilterEvidence>;
        if (publicEvidence.symbol !== ticket.symbol) {
          outerCodes.push('PUBLIC_FILTER_SYMBOL_MISMATCH');
        }
        if (!approvedUsdQuoteAssets.includes(publicEvidence.quoteAsset)) {
          outerCodes.push('PUBLIC_FILTER_QUOTE_ASSET_NOT_APPROVED');
        }
        if (
          publicEvidence.observedAtMs > nowMs ||
          publicEvidence.validUntilMs <= nowMs ||
          publicEvidence.validUntilMs <= publicEvidence.observedAtMs ||
          publicEvidence.validUntilMs - publicEvidence.observedAtMs >
            maximumFilterAgeMs ||
          nowMs - publicEvidence.observedAtMs > maximumFilterAgeMs
        ) {
          outerCodes.push('PUBLIC_FILTER_STALE');
        }
        if (
          publicEvidence.tradingStatus !== 'TRADING' ||
          publicEvidence.spotTradingAllowed !== true
        ) {
          outerCodes.push('PUBLIC_FILTER_TRADING_DISABLED');
        }
        if (!publicEvidence.orderTypes.includes(ticket.type)) {
          outerCodes.push('PUBLIC_FILTER_ORDER_TYPE_UNSUPPORTED');
        }
        if (outerCodes.length > 0) {
          return blocked(outerCodes, ticket, publicEvidence);
        }

        const riskEvidence =
          riskEvidenceValue === null
            ? null
            : (snapshotPlainRecord(
                riskEvidenceValue,
              ) as unknown as Readonly<SpotRiskEvidence>);
        try {
          const preparation = prepareSpotCore({
            ticket,
            filterSnapshot: {
              revision: publicEvidence.revision,
              observedAtMs: publicEvidence.observedAtMs,
              filters: publicEvidence.filters,
            },
            nowMs,
            riskEvidence,
          });
          return freezeResult({
            passed: preparation.readyForSignedTest,
            ticket,
            quoteAsset: publicEvidence.quoteAsset,
            filterEvidenceRevision: publicEvidence.revision,
            filterValidation: preparation.filterValidation,
            riskVerdict: preparation.riskVerdict,
            blockingCodes: preparation.blockingCodes,
          });
        } catch {
          return blocked(
            ['CORE_VALIDATION_FAILED'],
            ticket,
            publicEvidence,
          );
        }
      } catch {
        return blocked(['INPUT_INVALID']);
      }
    },
  });
}
