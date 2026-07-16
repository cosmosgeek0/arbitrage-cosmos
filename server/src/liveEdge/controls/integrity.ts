import { createHash } from 'node:crypto';

import { canonicalJson } from '../../foundation/contracts/index.js';
import {
  DURABLE_CONTROL_EVENT_SCHEMA,
  type AuthenticatedOperatorIdentity,
  type ControlEventAppendAcknowledgement,
  type ControlEventAppendRequest,
  type DurableControlAction,
  type DurableControlEvent,
  type DurableControlPreview,
} from './types.js';
import { validateAppendAcknowledgement } from './validation.js';

export type ControlEventDraft = DurableControlEvent extends infer Event
  ? Event extends DurableControlEvent
    ? Omit<Event, 'eventId' | 'contentDigest'>
    : never
  : never;

export type ConfirmControlAppendResult =
  | {
      readonly ok: true;
      readonly ledgerEventId: number;
      readonly committedJournalVersion: number;
      readonly committedHeadDigest: string;
      readonly committedAtMs: number;
      readonly currentConfigVersion: number;
      readonly currentControlRevision: number;
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | 'PERSISTENCE_ACK_INVALID'
        | 'PERSISTENCE_UNAVAILABLE'
        | 'IDEMPOTENCY_CONFLICT'
        | 'STALE_CONFIG_VERSION'
        | 'STALE_CONTROL_REVISION'
        | 'COMMAND_EXPIRED';
    };

export function controlSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function durableActionDigest(action: Readonly<DurableControlAction>): string {
  return controlSha256({ schema: 'LIVE_EDGE_CONTROL_ACTION_DIGEST_V1', action });
}

export function operatorActorBinding(identity: Readonly<AuthenticatedOperatorIdentity>): string {
  const hash = createHash('sha256').update(canonicalJson({
    schema: 'LIVE_EDGE_CONTROL_ACTOR_BINDING_V1',
    subjectId: identity.subjectId,
    sessionId: identity.sessionId,
    source: identity.source,
    audience: identity.audience,
    authenticatedAtMs: identity.authenticatedAtMs,
    expiresAtMs: identity.expiresAtMs,
  })).digest('hex');
  return `l14actor_${hash}`;
}

export function controlPreviewSeedDigest(input: Readonly<{
  actionDigest: string;
  expectedConfigVersion: number;
  expectedControlRevision: number;
  actorBinding: string;
  reason: string;
  generatedAtMs: number;
  expiresAtMs: number;
  riskWitness: DurableControlPreview['riskWitness'];
}>): string {
  return controlSha256({ schema: 'LIVE_EDGE_CONTROL_PREVIEW_SEED_V1', ...input });
}

export function calculatePreviewDigest(preview: Omit<
Readonly<DurableControlPreview>, 'previewDigest' | 'authorizationTag'
>): string {
  return controlSha256({ schema: 'LIVE_EDGE_CONTROL_PREVIEW_DIGEST_V1', preview });
}

export function buildControlEvent(draft: Readonly<ControlEventDraft>): Readonly<DurableControlEvent> {
  const seed = { schema: 'LIVE_EDGE_CONTROL_EVENT_ID_V1', event: draft };
  const eventId = `l14evt_${createHash('sha256').update(canonicalJson(seed)).digest('hex')}`;
  const contentDigest = controlSha256({ ...draft, eventId });
  return deepFreeze({ ...draft, eventId, contentDigest } as DurableControlEvent);
}

export function prepareControlEventAppend(
  event: Readonly<DurableControlEvent>,
  expectedJournalVersion: number,
  previousHeadDigest: string | null,
): Readonly<ControlEventAppendRequest> {
  if (!Number.isSafeInteger(expectedJournalVersion) || expectedJournalVersion < 0) {
    throw new TypeError('expectedJournalVersion must be a non-negative safe integer');
  }
  const nextHeadDigest = `l14head_${createHash('sha256').update(canonicalJson({
    schema: 'LIVE_EDGE_CONTROL_HEAD_V1',
    previousHeadDigest,
    journalVersion: expectedJournalVersion + 1,
    eventId: event.eventId,
    contentDigest: event.contentDigest,
  })).digest('hex')}`;
  const base = {
    ownerTarget: 'SYSTEM_INTEGRATION_LEDGER' as const,
    event,
    idempotencyKey: `l14:${event.commandId}:${event.kind}`,
    expectedJournalVersion,
    previousHeadDigest,
    nextHeadDigest,
    externalActionAuthorization: 'NONE' as const,
  };
  return deepFreeze({
    ...base,
    appendRequestDigest: controlSha256({ schema: 'LIVE_EDGE_CONTROL_APPEND_REQUEST_V1', ...base }),
  });
}

export function confirmControlEventAppend(
  request: Readonly<ControlEventAppendRequest>,
  acknowledgement: unknown,
): ConfirmControlAppendResult {
  const checked = validateAppendAcknowledgement(acknowledgement);
  if (!checked.ok) return Object.freeze({ ok: false as const, reasonCode: 'PERSISTENCE_ACK_INVALID' as const });
  const ack = checked.value as Readonly<ControlEventAppendAcknowledgement>;
  if (ack.commandId !== request.event.commandId
    || ack.eventId !== request.event.eventId
    || ack.idempotencyKey !== request.idempotencyKey
    || ack.appendRequestDigest !== request.appendRequestDigest
    || ack.expectedJournalVersion !== request.expectedJournalVersion
    || ack.previousHeadDigest !== request.previousHeadDigest) {
    return Object.freeze({ ok: false as const, reasonCode: 'PERSISTENCE_ACK_INVALID' as const });
  }
  if (ack.disposition === 'IDEMPOTENCY_CONFLICT') {
    return Object.freeze({ ok: false as const, reasonCode: 'IDEMPOTENCY_CONFLICT' as const });
  }
  if (ack.disposition === 'VERSION_CONFLICT') {
    const reasonCode = ack.currentConfigVersion !== request.event.expectedConfigVersion
      ? 'STALE_CONFIG_VERSION'
      : 'STALE_CONTROL_REVISION';
    return Object.freeze({ ok: false as const, reasonCode });
  }
  if (ack.disposition === 'EXPIRED') {
    return Object.freeze({ ok: false as const, reasonCode: 'COMMAND_EXPIRED' as const });
  }
  if (ack.disposition === 'FAILED') {
    return Object.freeze({ ok: false as const, reasonCode: 'PERSISTENCE_UNAVAILABLE' as const });
  }
  const replayed = ack.disposition === 'IDEMPOTENT_REPLAY';
  if (ack.committedJournalVersion !== request.expectedJournalVersion + 1
    || ack.committedHeadDigest !== request.nextHeadDigest
    || ack.appendedCount !== (replayed ? 0 : 1)
    || ack.ledgerEventId === null
    || ack.committedAtMs === null
    || ack.committedAtMs < request.event.occurredAtMs
    || ack.failureCode !== null) {
    return Object.freeze({ ok: false as const, reasonCode: 'PERSISTENCE_ACK_INVALID' as const });
  }
  return Object.freeze({
    ok: true as const,
    ledgerEventId: ack.ledgerEventId,
    committedJournalVersion: ack.committedJournalVersion,
    committedHeadDigest: ack.committedHeadDigest,
    committedAtMs: ack.committedAtMs,
    currentConfigVersion: ack.currentConfigVersion,
    currentControlRevision: ack.currentControlRevision,
    replayed,
  });
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value as Readonly<T>;
}
