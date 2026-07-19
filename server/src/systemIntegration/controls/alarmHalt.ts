import { createHash } from 'node:crypto';
import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import type {
  MachineGraphAlarmEvidence,
} from '../../liveEdge/adapters/machineGraphEvidence/index.js';
import {
  MACHINE_GRAPH_ALARMS,
} from '../../liveEdge/adapters/machineGraphEvidence/index.js';
import type {
  SystemControlMutationResult,
} from '../contracts/index.js';
import type {
  SystemControlService,
} from './service.js';
import {
  SYSTEM_CONTROL_CANONICAL_ALARM_ACTOR,
} from './types.js';

const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAXIMUM_ALARM_AGE_MS = 300_000;

export interface CanonicalAlarmHaltInput {
  readonly service: SystemControlService;
  readonly alarm: Readonly<MachineGraphAlarmEvidence>;
  readonly evaluatedAtMs: number;
  readonly maximumAgeMs: number;
  readonly expectedControlRevision: number;
}

function boundedText(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validAlarm(input: Readonly<CanonicalAlarmHaltInput>): boolean {
  const alarm = input.alarm;
  if (
    !isValidUtcMillis(input.evaluatedAtMs)
    || !Number.isSafeInteger(input.maximumAgeMs)
    || input.maximumAgeMs < 0
    || input.maximumAgeMs > MAXIMUM_ALARM_AGE_MS
    || !Number.isSafeInteger(input.expectedControlRevision)
    || input.expectedControlRevision < 0
    || alarm.state !== 'ALARM'
    || alarm.haltRecommendation !== true
    || alarm.automaticAction !== 'NONE'
    || alarm.canLiquidate !== false
    || alarm.canMutateCapital !== false
    || !(MACHINE_GRAPH_ALARMS as readonly unknown[]).includes(alarm.alarm)
    || !boundedText(alarm.owner)
    || !boundedText(alarm.ownerRevision)
    || typeof alarm.ownerDigest !== 'string'
    || !SHA256.test(alarm.ownerDigest)
    || !isValidUtcMillis(alarm.observedAtMs)
    || (alarm.observedAtMs as number) > input.evaluatedAtMs
    || input.evaluatedAtMs - (alarm.observedAtMs as number) > input.maximumAgeMs
    || alarm.trace === null
    || !CORRELATION.test(alarm.trace.correlationId)
    || !boundedText(alarm.trace.traceRevision)
    || !Array.isArray(alarm.reasonCodes)
    || alarm.reasonCodes.length === 0
    || alarm.reasonCodes.length > 64
    || alarm.reasonCodes.some((code) => !boundedText(code))
    || new Set(alarm.reasonCodes).size !== alarm.reasonCodes.length
  ) return false;
  return true;
}

function invalidAlarmResult(input: Readonly<CanonicalAlarmHaltInput>): SystemControlMutationResult {
  const state = input.service.snapshot();
  return fail(createStructuredFailure({
    component: 'systemIntegration.controls',
    stage: 'canonical-alarm-halt',
    code: 'ALARM_EVIDENCE_INVALID',
    message: 'Canonical alarm evidence is missing, stale, malformed, or does not recommend a fail-safe halt.',
    occurredAt: isValidUtcMillis(input.evaluatedAtMs) ? input.evaluatedAtMs : state.updatedAtMs,
    retryable: false,
    safeCurrentState: state.killSwitchEngaged ? 'KILL_SWITCH_ENGAGED' : 'ALARM_NOT_APPLIED',
    recommendedOperatorAction: 'Restore current canonical alarm evidence; never infer or bypass the halt decision.',
    correlationId: state.correlationId,
  }));
}

function alarmIdempotencyKey(input: Readonly<CanonicalAlarmHaltInput>): string {
  const alarm = input.alarm;
  const digest = createHash('sha256').update(JSON.stringify({
    alarm: alarm.alarm,
    owner: alarm.owner,
    ownerRevision: alarm.ownerRevision,
    ownerDigest: alarm.ownerDigest,
    observedAtMs: alarm.observedAtMs,
    state: alarm.state,
    automaticAction: alarm.automaticAction,
    canLiquidate: alarm.canLiquidate,
    canMutateCapital: alarm.canMutateCapital,
    haltRecommendation: alarm.haltRecommendation,
    correlationId: alarm.trace?.correlationId,
    traceRevision: alarm.trace?.traceRevision,
    reasonCodes: alarm.reasonCodes,
    expectedControlRevision: input.expectedControlRevision,
  })).digest('hex');
  return `alarm.halt.${digest.slice(0, 48)}`;
}

/**
 * Routes one current evaluated alarm through the existing durable System
 * Control kill-switch path. It grants no liquidation or capital authority and
 * cannot release the switch; exact replay resolves to the first Ledger receipt.
 */
export async function routeCanonicalAlarmToKillSwitch(
  input: Readonly<CanonicalAlarmHaltInput>,
): Promise<SystemControlMutationResult> {
  if (!validAlarm(input)) return invalidAlarmResult(input);
  const alarm = input.alarm;
  return input.service.mutate(Object.freeze({
    idempotencyKey: alarmIdempotencyKey(input),
    expectedRevision: input.expectedControlRevision,
    reason: `Canonical ${alarm.alarm} requested fail-safe halt.`,
    requestedAtMs: input.evaluatedAtMs,
    correlationId: (alarm.trace as NonNullable<typeof alarm.trace>).correlationId,
    mutation: Object.freeze({ command: 'SET_KILL_SWITCH' as const, engaged: true }),
  }), SYSTEM_CONTROL_CANONICAL_ALARM_ACTOR);
}
