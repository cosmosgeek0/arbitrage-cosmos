import {
  ASSURANCE_VERDICTS,
  assertDigestOrNull,
  assertFiniteNonNegative,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  sortedUnique,
  verdictFromReasons,
  type AssuranceVerdict,
} from '../common.js';

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
}

function assertVerdict(value: unknown, label: string): asserts value is AssuranceVerdict {
  if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(value)) {
    throw new TypeError(`${label} is unsupported`);
  }
}

export interface TemporalCoherenceInput {
  readonly sourceEventTimeMs: number | null;
  readonly receiveTimeMs: number | null;
  readonly processTimeMs: number | null;
  readonly sendTimeMs: number | null;
  readonly acknowledgementTimeMs: number | null;
  readonly hostClockOffsetMs: number | null;
  readonly hostClockObservedAtMs: number | null;
  readonly exchangeClockOffsetMs: number | null;
  readonly exchangeClockObservedAtMs: number | null;
  readonly spotEventTimeMs: number | null;
  readonly usdmEventTimeMs: number | null;
  readonly maximumCrossMarketSkewMs: number;
  readonly maximumObservationAgeMs: number;
  readonly maximumAbsoluteHostClockOffsetMs: number;
  readonly maximumAbsoluteExchangeClockOffsetMs: number;
  readonly continuityWatermark: string | null;
  readonly continuityProven: boolean;
}

export interface TemporalCoherenceProjection {
  readonly verdict: AssuranceVerdict;
  readonly crossMarketSkewMs: number | null;
  readonly stagesOrdered: boolean | null;
  readonly continuityProven: boolean;
  readonly reasonCodes: readonly string[];
}

export function projectTemporalCoherence(input: Readonly<TemporalCoherenceInput>, nowMs: number): Readonly<TemporalCoherenceProjection> {
  assertUtcMs(nowMs, 'nowMs');
  assertSafeNonNegativeInteger(input.maximumCrossMarketSkewMs, 'input.maximumCrossMarketSkewMs');
  assertPositiveSafeInteger(input.maximumObservationAgeMs, 'input.maximumObservationAgeMs');
  assertSafeNonNegativeInteger(input.maximumAbsoluteHostClockOffsetMs, 'input.maximumAbsoluteHostClockOffsetMs');
  assertSafeNonNegativeInteger(input.maximumAbsoluteExchangeClockOffsetMs, 'input.maximumAbsoluteExchangeClockOffsetMs');
  assertBoolean(input.continuityProven, 'input.continuityProven');
  const unknown: string[] = [];
  const failed: string[] = [];
  const orderedTimes = [input.sourceEventTimeMs, input.receiveTimeMs, input.processTimeMs, input.sendTimeMs, input.acknowledgementTimeMs];
  for (const [index, value] of orderedTimes.entries()) {
    if (value === null) unknown.push(`TIME_STAGE_${index}_UNKNOWN`);
    else {
      assertUtcMs(value, `timeStage[${index}]`);
      if (value > nowMs) failed.push(`TIME_STAGE_${index}_IN_FUTURE`);
      else if (nowMs - value >= input.maximumObservationAgeMs) failed.push(`TIME_STAGE_${index}_STALE`);
    }
  }
  let ordered: boolean | null = null;
  if (orderedTimes.every((value) => value !== null)) {
    const concrete = orderedTimes as number[];
    ordered = concrete.every((value, index) => index === 0 || value >= (concrete[index - 1] ?? value));
    if (!ordered) failed.push('TIME_STAGE_ORDER_INVALID');
  }
  let skew: number | null = null;
  if (input.spotEventTimeMs === null || input.usdmEventTimeMs === null) unknown.push('CROSS_MARKET_TIME_UNKNOWN');
  else {
    assertUtcMs(input.spotEventTimeMs, 'input.spotEventTimeMs');
    assertUtcMs(input.usdmEventTimeMs, 'input.usdmEventTimeMs');
    if (input.spotEventTimeMs > nowMs || input.usdmEventTimeMs > nowMs) failed.push('CROSS_MARKET_TIME_IN_FUTURE');
    if (input.spotEventTimeMs <= nowMs && nowMs - input.spotEventTimeMs >= input.maximumObservationAgeMs) failed.push('SPOT_EVENT_TIME_STALE');
    if (input.usdmEventTimeMs <= nowMs && nowMs - input.usdmEventTimeMs >= input.maximumObservationAgeMs) failed.push('USDM_EVENT_TIME_STALE');
    skew = Math.abs(input.spotEventTimeMs - input.usdmEventTimeMs);
    if (skew > input.maximumCrossMarketSkewMs) failed.push('CROSS_MARKET_SKEW_EXCEEDED');
  }
  if ((input.hostClockOffsetMs === null) !== (input.hostClockObservedAtMs === null)) {
    throw new TypeError('host clock offset and observation time must be supplied together');
  }
  if ((input.exchangeClockOffsetMs === null) !== (input.exchangeClockObservedAtMs === null)) {
    throw new TypeError('exchange clock offset and observation time must be supplied together');
  }
  if (input.hostClockOffsetMs === null) unknown.push('HOST_CLOCK_OFFSET_UNKNOWN');
  else {
    if (!Number.isFinite(input.hostClockOffsetMs)) throw new TypeError('input.hostClockOffsetMs must be finite');
    if (Math.abs(input.hostClockOffsetMs) > input.maximumAbsoluteHostClockOffsetMs) failed.push('HOST_CLOCK_OFFSET_EXCEEDED');
    assertUtcMs(input.hostClockObservedAtMs, 'input.hostClockObservedAtMs');
    if (input.hostClockObservedAtMs > nowMs) failed.push('HOST_CLOCK_SAMPLE_IN_FUTURE');
    else if (nowMs - input.hostClockObservedAtMs >= input.maximumObservationAgeMs) failed.push('HOST_CLOCK_SAMPLE_STALE');
  }
  if (input.exchangeClockOffsetMs === null) unknown.push('EXCHANGE_CLOCK_OFFSET_UNKNOWN');
  else {
    if (!Number.isFinite(input.exchangeClockOffsetMs)) throw new TypeError('input.exchangeClockOffsetMs must be finite');
    if (Math.abs(input.exchangeClockOffsetMs) > input.maximumAbsoluteExchangeClockOffsetMs) failed.push('EXCHANGE_CLOCK_OFFSET_EXCEEDED');
    assertUtcMs(input.exchangeClockObservedAtMs, 'input.exchangeClockObservedAtMs');
    if (input.exchangeClockObservedAtMs > nowMs) failed.push('EXCHANGE_CLOCK_SAMPLE_IN_FUTURE');
    else if (nowMs - input.exchangeClockObservedAtMs >= input.maximumObservationAgeMs) failed.push('EXCHANGE_CLOCK_SAMPLE_STALE');
  }
  if (input.continuityWatermark !== null) assertIdentifier(input.continuityWatermark, 'input.continuityWatermark');
  if (!input.continuityProven || input.continuityWatermark === null) failed.push('CONTINUITY_NOT_PROVEN');
  return Object.freeze({ verdict: failed.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS', crossMarketSkewMs: skew, stagesOrdered: ordered, continuityProven: input.continuityProven, reasonCodes: sortedUnique([...failed, ...unknown]) });
}

export interface ExecutionLeaseProjectionInput {
  readonly configured: boolean;
  readonly ownerId: string | null;
  readonly epoch: number | null;
  readonly processIdentity: string | null;
  readonly releaseIdentity: string | null;
  readonly renewedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly competingOwnerIds: readonly string[];
}

export interface ExecutionLeaseProjection {
  readonly verdict: AssuranceVerdict;
  readonly active: boolean;
  readonly ownerId: string | null;
  readonly epoch: number | null;
  readonly processIdentity: string | null;
  readonly releaseIdentity: string | null;
  readonly renewedAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly evaluatedAtMs: number;
  readonly reasonCodes: readonly string[];
}

export function projectExecutionLease(input: Readonly<ExecutionLeaseProjectionInput>, nowMs: number): Readonly<ExecutionLeaseProjection> {
  assertUtcMs(nowMs, 'nowMs');
  assertBoolean(input.configured, 'input.configured');
  if (input.ownerId !== null) assertIdentifier(input.ownerId, 'input.ownerId');
  if (input.epoch !== null) assertSafeNonNegativeInteger(input.epoch, 'input.epoch');
  if (input.processIdentity !== null) assertIdentifier(input.processIdentity, 'input.processIdentity');
  if (input.releaseIdentity !== null) assertIdentifier(input.releaseIdentity, 'input.releaseIdentity');
  if (input.renewedAtMs !== null) assertUtcMs(input.renewedAtMs, 'input.renewedAtMs');
  if (input.expiresAtMs !== null) assertUtcMs(input.expiresAtMs, 'input.expiresAtMs');
  for (const ownerId of input.competingOwnerIds) assertIdentifier(ownerId, 'input.competingOwnerId');
  if (new Set(input.competingOwnerIds).size !== input.competingOwnerIds.length) {
    throw new TypeError('input.competingOwnerIds contains duplicate identities');
  }
  const projected = (verdict: AssuranceVerdict, active: boolean, reasonCodes: readonly string[]): Readonly<ExecutionLeaseProjection> => Object.freeze({
    verdict,
    active,
    ownerId: input.ownerId,
    epoch: input.epoch,
    processIdentity: input.processIdentity,
    releaseIdentity: input.releaseIdentity,
    renewedAtMs: input.renewedAtMs,
    expiresAtMs: input.expiresAtMs,
    evaluatedAtMs: nowMs,
    reasonCodes,
  });
  if (!input.configured) return projected('UNKNOWN', false, Object.freeze(['EXECUTION_LEASE_NOT_CONFIGURED']));
  const missing = input.ownerId === null || input.epoch === null || input.processIdentity === null || input.releaseIdentity === null || input.renewedAtMs === null || input.expiresAtMs === null;
  const reasons: string[] = [];
  if (input.renewedAtMs !== null && input.renewedAtMs > nowMs) reasons.push('EXECUTION_LEASE_RENEWAL_IN_FUTURE');
  if (input.renewedAtMs !== null && input.expiresAtMs !== null && input.expiresAtMs <= input.renewedAtMs) reasons.push('EXECUTION_LEASE_INTERVAL_INVALID');
  if (input.expiresAtMs !== null && nowMs >= input.expiresAtMs) reasons.push('EXECUTION_LEASE_EXPIRED');
  if (input.competingOwnerIds.length > 0) reasons.push('DUPLICATE_EXECUTION_OWNER');
  if (missing) {
    return projected(reasons.length > 0 ? 'FAIL' : 'UNKNOWN', false, sortedUnique([...reasons, 'EXECUTION_LEASE_EVIDENCE_INCOMPLETE']));
  }
  return projected(reasons.length > 0 ? 'FAIL' : 'PASS', reasons.length === 0, sortedUnique(reasons));
}

export interface SentinelCheck {
  readonly checkId: string;
  readonly producerId: string;
  readonly verifierId: string;
  readonly selfReportedVerdict: AssuranceVerdict;
  readonly independentVerdict: AssuranceVerdict;
  readonly checkedAtMs: number;
  readonly maximumAgeMs: number;
  readonly capitalCritical: boolean;
}

export interface SentinelProjection {
  readonly verdict: AssuranceVerdict;
  readonly failedCheckIds: readonly string[];
  readonly unknownCheckIds: readonly string[];
  readonly disagreements: readonly string[];
  readonly reasonCodes: readonly string[];
}

export function projectIndependentSentinel(checks: readonly Readonly<SentinelCheck>[], nowMs: number): Readonly<SentinelProjection> {
  assertUtcMs(nowMs, 'nowMs');
  const failed: string[] = [];
  const unknown: string[] = [];
  const disagreements: string[] = [];
  const reasons: string[] = [];
  if (checks.length === 0) {
    return Object.freeze({
      verdict: 'UNKNOWN',
      failedCheckIds: Object.freeze([]),
      unknownCheckIds: Object.freeze([]),
      disagreements: Object.freeze([]),
      reasonCodes: Object.freeze(['INDEPENDENT_SENTINEL_EMPTY']),
    });
  }
  const checkIds = checks.map((check) => check.checkId);
  if (new Set(checkIds).size !== checkIds.length) throw new TypeError('sentinel checks contain duplicate IDs');
  for (const check of checks) {
    assertIdentifier(check.checkId, 'check.checkId');
    assertIdentifier(check.producerId, 'check.producerId');
    assertIdentifier(check.verifierId, 'check.verifierId');
    assertVerdict(check.selfReportedVerdict, 'check.selfReportedVerdict');
    assertVerdict(check.independentVerdict, 'check.independentVerdict');
    assertBoolean(check.capitalCritical, 'check.capitalCritical');
    assertUtcMs(check.checkedAtMs, 'check.checkedAtMs');
    assertPositiveSafeInteger(check.maximumAgeMs, 'check.maximumAgeMs');
    if (check.producerId === check.verifierId) {
      failed.push(check.checkId);
      reasons.push('SENTINEL_NOT_INDEPENDENT');
      continue;
    }
    if (check.checkedAtMs > nowMs) {
      failed.push(check.checkId);
      reasons.push('SENTINEL_CHECK_IN_FUTURE');
      continue;
    }
    if (nowMs - check.checkedAtMs >= check.maximumAgeMs) {
      unknown.push(check.checkId);
      reasons.push('SENTINEL_CHECK_STALE');
      continue;
    }
    if (check.selfReportedVerdict !== check.independentVerdict) {
      disagreements.push(check.checkId);
      unknown.push(check.checkId);
    }
    if (check.independentVerdict === 'FAIL') failed.push(check.checkId);
    if (check.independentVerdict === 'UNKNOWN') unknown.push(check.checkId);
  }
  if (disagreements.length > 0) reasons.push('SELF_REPORT_SENTINEL_DISAGREEMENT');
  if (failed.length > 0) reasons.push('INDEPENDENT_SENTINEL_FAILED');
  if (unknown.length > 0) reasons.push('INDEPENDENT_SENTINEL_UNKNOWN');
  return Object.freeze({ verdict: failed.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS', failedCheckIds: sortedUnique(failed), unknownCheckIds: sortedUnique(unknown), disagreements: sortedUnique(disagreements), reasonCodes: sortedUnique(reasons) });
}

export interface TelemetryPipelineInput {
  readonly schemaCompatible: boolean | null;
  readonly queueDepth: number | null;
  readonly queueCapacity: number | null;
  readonly droppedRecords: number | null;
  readonly retryCount: number | null;
  readonly persistentBufferConfigured: boolean | null;
  readonly lastExportAtMs: number | null;
  readonly maximumExportAgeMs: number;
  readonly retentionProven: boolean | null;
  readonly ledgerEvidenceAvailable: boolean;
}

export interface TelemetryPipelineProjection {
  readonly verdict: AssuranceVerdict;
  readonly exporterHealthy: boolean | null;
  readonly ledgerEvidencePreserved: boolean;
  readonly reasonCodes: readonly string[];
}

export function projectTelemetryPipeline(input: Readonly<TelemetryPipelineInput>, nowMs: number): Readonly<TelemetryPipelineProjection> {
  assertUtcMs(nowMs, 'nowMs');
  assertPositiveSafeInteger(input.maximumExportAgeMs, 'input.maximumExportAgeMs');
  if (input.schemaCompatible !== null) assertBoolean(input.schemaCompatible, 'input.schemaCompatible');
  if (input.persistentBufferConfigured !== null) assertBoolean(input.persistentBufferConfigured, 'input.persistentBufferConfigured');
  if (input.retentionProven !== null) assertBoolean(input.retentionProven, 'input.retentionProven');
  assertBoolean(input.ledgerEvidenceAvailable, 'input.ledgerEvidenceAvailable');
  const failed: string[] = [];
  const unknown: string[] = [];
  if (input.schemaCompatible === false) failed.push('TELEMETRY_SCHEMA_INCOMPATIBLE');
  if (input.schemaCompatible === null) unknown.push('TELEMETRY_SCHEMA_UNKNOWN');
  if (input.queueDepth !== null) assertFiniteNonNegative(input.queueDepth, 'input.queueDepth');
  if (input.queueCapacity !== null) assertFiniteNonNegative(input.queueCapacity, 'input.queueCapacity');
  if (input.queueDepth === null || input.queueCapacity === null) unknown.push('TELEMETRY_QUEUE_UNKNOWN');
  else {
    if (input.queueDepth >= input.queueCapacity) failed.push('TELEMETRY_QUEUE_AT_CAPACITY');
  }
  if (input.droppedRecords === null) unknown.push('TELEMETRY_DROPS_UNKNOWN');
  else {
    assertFiniteNonNegative(input.droppedRecords, 'input.droppedRecords');
    if (input.droppedRecords > 0) failed.push('TELEMETRY_RECORDS_DROPPED');
  }
  if (input.retryCount === null) unknown.push('TELEMETRY_RETRY_COUNT_UNKNOWN');
  else assertFiniteNonNegative(input.retryCount, 'input.retryCount');
  if (input.persistentBufferConfigured === false) failed.push('TELEMETRY_PERSISTENT_BUFFER_DISABLED');
  if (input.persistentBufferConfigured === null) unknown.push('TELEMETRY_PERSISTENT_BUFFER_UNKNOWN');
  if (input.lastExportAtMs === null) unknown.push('TELEMETRY_LAST_EXPORT_UNKNOWN');
  else {
    assertUtcMs(input.lastExportAtMs, 'input.lastExportAtMs');
    if (input.lastExportAtMs > nowMs) failed.push('TELEMETRY_EXPORT_IN_FUTURE');
    else if (nowMs - input.lastExportAtMs >= input.maximumExportAgeMs) failed.push('TELEMETRY_EXPORT_STALE');
  }
  if (input.retentionProven === false) failed.push('TELEMETRY_RETENTION_FAILED');
  if (input.retentionProven === null) unknown.push('TELEMETRY_RETENTION_UNKNOWN');
  if (!input.ledgerEvidenceAvailable) failed.push('LEDGER_EVIDENCE_UNAVAILABLE');
  return Object.freeze({ verdict: failed.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS', exporterHealthy: failed.length > 0 ? false : unknown.length > 0 ? null : true, ledgerEvidencePreserved: input.ledgerEvidenceAvailable, reasonCodes: sortedUnique([...failed, ...unknown]) });
}

export interface WatchdogDeliveryReceipt {
  readonly notificationId: string;
  readonly sentAtMs: number;
  readonly deliveredAtMs: number | null;
  readonly channelId: string;
  readonly deliveryDigest: string | null;
  readonly maximumAgeMs: number;
}

export function evaluateWatchdogDelivery(
  receipt: Readonly<WatchdogDeliveryReceipt> | null,
  nowMs: number,
): Readonly<{ verdict: AssuranceVerdict; reasonCodes: readonly string[] }> {
  assertUtcMs(nowMs, 'nowMs');
  if (receipt === null) return Object.freeze({ verdict: 'UNKNOWN', reasonCodes: Object.freeze(['WATCHDOG_DELIVERY_RECEIPT_MISSING']) });
  assertIdentifier(receipt.notificationId, 'receipt.notificationId');
  assertIdentifier(receipt.channelId, 'receipt.channelId');
  assertUtcMs(receipt.sentAtMs, 'receipt.sentAtMs');
  assertPositiveSafeInteger(receipt.maximumAgeMs, 'receipt.maximumAgeMs');
  assertDigestOrNull(receipt.deliveryDigest, 'receipt.deliveryDigest');
  const failed: string[] = [];
  const unknown: string[] = [];
  if (receipt.sentAtMs > nowMs) failed.push('WATCHDOG_SENT_IN_FUTURE');
  if (receipt.deliveredAtMs === null) {
    if (receipt.sentAtMs <= nowMs && nowMs - receipt.sentAtMs >= receipt.maximumAgeMs) {
      failed.push('WATCHDOG_DELIVERY_TIMEOUT');
    } else {
      unknown.push('WATCHDOG_DELIVERY_UNPROVEN');
    }
  } else {
    assertUtcMs(receipt.deliveredAtMs, 'receipt.deliveredAtMs');
    if (receipt.deliveredAtMs < receipt.sentAtMs) failed.push('WATCHDOG_DELIVERY_TIME_INVALID');
    if (receipt.deliveredAtMs > nowMs) failed.push('WATCHDOG_DELIVERED_IN_FUTURE');
    if (receipt.deliveredAtMs <= nowMs && nowMs - receipt.deliveredAtMs >= receipt.maximumAgeMs) {
      failed.push('WATCHDOG_DELIVERY_STALE');
    }
  }
  if (receipt.deliveryDigest === null) unknown.push('WATCHDOG_DELIVERY_DIGEST_MISSING');
  return Object.freeze({
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
  });
}
