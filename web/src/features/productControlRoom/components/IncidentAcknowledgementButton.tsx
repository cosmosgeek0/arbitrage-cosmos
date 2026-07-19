import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX,
  PRODUCT_COMMAND_SCHEMA,
  abortActiveCommandResultRead,
  ambiguousCommandResultReconciliation,
  clearDurableCommandResultIdentity,
  prepareDurableCommandSubmission,
  readDurableCommandResultIdentity,
  reconcileDurableCommandResult,
  requiresDurableCommandResultReadback,
  uncheckedCommandResultReconciliation,
  type ProductCommandResultIdentity,
  type ProductCommandResultReconciliation,
  type ProductCommandRequest,
  type ProductControlPreview,
  type ProductControlResult,
  type ProductIncidentProjection,
} from '../../../lib/productIntegration';
import { useProductControlRoomContext } from '../ProductControlRoomProvider';
import './IncidentAcknowledgementButton.css';

function blocksCommands(value: Readonly<ProductCommandResultReconciliation>): boolean {
  return value.state === 'PENDING'
    || value.state === 'AMBIGUOUS'
    || value.state === 'INVALID_DURABLE_STATE';
}

export function IncidentAcknowledgementButton({ incident, compact = false }: {
  incident: Readonly<ProductIncidentProjection>;
  compact?: boolean;
}) {
  const { client, binding } = useProductControlRoomContext();
  const [preview, setPreview] = useState<ProductControlPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ProductCommandResultReconciliation>(() => (
    uncheckedCommandResultReconciliation()
  ));
  const initiatorRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const reconciliationAbortRef = useRef<AbortController | null>(null);
  const reconciliationRequestRef = useRef(0);

  useEffect(() => {
    setPreview(null);
    setMessage(null);
  }, [incident.incidentId, incident.ledgerEventId, incident.state]);

  useEffect(() => {
    if (preview !== null) confirmRef.current?.focus();
  }, [preview]);

  const restoreInitiatorFocus = () => {
    window.requestAnimationFrame(() => initiatorRef.current?.focus());
  };

  const cancelCommandResultRead = useCallback(() => {
    reconciliationRequestRef.current += 1;
    if (!abortActiveCommandResultRead(reconciliationAbortRef.current)) return;
    reconciliationAbortRef.current = null;
    setWorking(false);
  }, []);

  const reconcileCommandResult = useCallback(async (
    identity: Readonly<ProductCommandResultIdentity>,
    priorResult: Readonly<ProductControlResult> | null,
  ) => {
    const requestId = reconciliationRequestRef.current + 1;
    reconciliationRequestRef.current = requestId;
    reconciliationAbortRef.current?.abort();
    const controller = new AbortController();
    reconciliationAbortRef.current = controller;
    setWorking(true);
    setMessage(`Reading durable ACK result for ${identity.controlId}.`);
    try {
      const next = await reconcileDurableCommandResult(
        identity,
        priorResult,
        async (query) => {
          const readback = await client.readCommandResult(query, controller.signal);
          if (controller.signal.aborted || reconciliationRequestRef.current !== requestId) {
            throw Object.freeze({ code: 'COMMAND_RESULT_READBACK_CANCELLED' });
          }
          return readback;
        },
      );
      if (reconciliationRequestRef.current !== requestId) return;
      setReconciliation(next);
      if (next.state === 'TERMINAL') {
        setMessage(`ACK persisted · ${next.result?.receiptId ?? 'NO_RECEIPT'}`);
        await binding.refresh();
      } else if (next.state === 'PENDING') {
        setMessage('ACK accepted; durable result remains pending. Recheck before another command.');
      } else if (next.state === 'AMBIGUOUS') {
        setMessage(`ACK result remains ambiguous (${next.reasonCode}). Recheck durable truth.`);
      } else if (next.state === 'INVALID_DURABLE_STATE') {
        setMessage(`Durable ACK state is unverifiable (${next.reasonCode}); commands remain blocked.`);
      }
    } finally {
      if (reconciliationRequestRef.current === requestId) {
        if (reconciliationAbortRef.current === controller) reconciliationAbortRef.current = null;
        setWorking(false);
      }
    }
  }, [binding, client]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const restored = readDurableCommandResultIdentity();
      setReconciliation(restored);
      if (restored.state === 'PENDING'
        && restored.identity.controlId === incident.acknowledgementControlId) {
        void reconcileCommandResult(restored.identity, null);
      }
    });
    return () => {
      active = false;
      cancelCommandResultRead();
    };
  }, [cancelCommandResultRead, incident.acknowledgementControlId, reconcileCommandResult]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX)) return;
      cancelCommandResultRead();
      const restored = readDurableCommandResultIdentity();
      setReconciliation(restored);
      if (restored.state === 'PENDING'
        && restored.identity.controlId === incident.acknowledgementControlId) {
        void reconcileCommandResult(restored.identity, null);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [cancelCommandResultRead, incident.acknowledgementControlId, reconcileCommandResult]);

  const requestPreview = async (initiator: HTMLButtonElement) => {
    initiatorRef.current = initiator;
    const durable = readDurableCommandResultIdentity();
    setReconciliation(durable);
    if (blocksCommands(durable)) {
      setMessage(`A durable command result is unresolved (${durable.state}). Recheck it first.`);
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const next = await client.previewCommand(
        incident.acknowledgementControlId,
        String(incident.ledgerEventId),
        incident.incidentId,
      );
      if (next.synthetic) throw new Error('INCIDENT_ACK_PREVIEW_SYNTHETIC');
      setPreview(next);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Incident acknowledgement preview failed.');
      restoreInitiatorFocus();
    } finally {
      setWorking(false);
    }
  };

  const submit = async () => {
    if (!preview || preview.expiresAtMs <= Date.now()) {
      setPreview(null);
      setMessage('Preview expired. Request a fresh incident revision.');
      restoreInitiatorFocus();
      return;
    }
    setWorking(true);
    setMessage(null);
    let durableIdentity: Readonly<ProductCommandResultIdentity> | null = null;
    try {
      const idempotencyKey = `ui:incident-ack:${crypto.randomUUID()}`;
      const prepared = await prepareDurableCommandSubmission(idempotencyKey, incident.acknowledgementControlId);
      durableIdentity = prepared.identity;
      setReconciliation(prepared.reconciliation);
      if (prepared.reconciliation.state !== 'PENDING') {
        throw new Error(prepared.reconciliation.reasonCode ?? 'INCIDENT_ACK_DURABLE_IDENTITY_UNAVAILABLE');
      }
      const request: Readonly<ProductCommandRequest> = Object.freeze({
        schemaVersion: PRODUCT_COMMAND_SCHEMA,
        idempotencyKey,
        controlId: incident.acknowledgementControlId,
        backendCommandId: 'ACK_INCIDENT',
        targetType: 'INCIDENT',
        targetId: incident.incidentId,
        payload: Object.freeze({ incidentId: incident.incidentId }),
        currentRevision: String(incident.ledgerEventId),
        expectedRevision: preview.expectedRevision,
        previewId: preview.previewId,
        previewDigest: preview.digest,
        expiresAtMs: preview.expiresAtMs,
        reason: `Operator acknowledged ${incident.incidentId} from canonical Product incident truth.`,
      });
      const submitted = await client.submitCommand(request);
      if (submitted.synthetic
        || submitted.commandId !== durableIdentity.commandId
        || submitted.controlId !== durableIdentity.controlId) {
        throw new Error('INCIDENT_ACK_RESULT_IDENTITY_INVALID');
      }
      setPreview(null);
      restoreInitiatorFocus();
      if (requiresDurableCommandResultReadback(submitted)) {
        await reconcileCommandResult(durableIdentity, submitted);
      } else {
        const terminal = clearDurableCommandResultIdentity(durableIdentity, submitted);
        setReconciliation(terminal);
        if (terminal.state !== 'TERMINAL') {
          throw new Error(terminal.reasonCode ?? 'INCIDENT_ACK_DURABLE_CLEAR_FAILED');
        }
        setMessage(`ACK persisted · ${submitted.receiptId ?? 'NO_RECEIPT'}`);
        await binding.refresh();
      }
    } catch (cause) {
      if (durableIdentity !== null) {
        const durable = readDurableCommandResultIdentity();
        const ambiguous = durable.state === 'PENDING'
          && durable.identity.commandId === durableIdentity.commandId
          ? ambiguousCommandResultReconciliation(
              durableIdentity,
              null,
              'INCIDENT_ACK_SUBMIT_RESULT_AMBIGUOUS',
            )
          : durable;
        setReconciliation(ambiguous);
        setPreview(null);
        restoreInitiatorFocus();
      }
      setMessage(cause instanceof Error ? cause.message : 'Incident acknowledgement failed.');
    } finally {
      setWorking(false);
    }
  };

  const cancel = () => {
    setPreview(null);
    setMessage(null);
    restoreInitiatorFocus();
  };
  const continuityBlocked = binding.continuity !== 'PROVEN';
  const resultBlocked = blocksCommands(reconciliation);
  const ownDurableIdentity = reconciliation.identity?.controlId === incident.acknowledgementControlId;
  const durableRecheck = ownDurableIdentity && reconciliation.identity && resultBlocked ? (
    <button
      type="button"
      disabled={working}
      aria-label={`Recheck durable acknowledgement result for ${incident.incidentId}`}
      onClick={() => void reconcileCommandResult(reconciliation.identity!, reconciliation.result)}
    >Recheck Durable Result</button>
  ) : null;

  if (incident.state !== 'OPEN') {
    return <span className={`pcr-incident-ack-state ${compact ? 'compact' : ''}`}>
      {incident.state === 'ACKNOWLEDGED'
        ? `ACK · ${incident.acknowledgedByOperatorId ?? 'OPERATOR'}`
        : `RECOVERY ${incident.recoveryProof.state}`}
      {durableRecheck}
      {message && <small role={message.startsWith('ACK persisted') ? 'status' : 'alert'}>{message}</small>}
    </span>;
  }

  return (
    <span className={`pcr-incident-ack ${compact ? 'compact' : ''}`} aria-live="polite">
      {preview === null ? (
        <button
          ref={initiatorRef}
          type="button"
          disabled={working || continuityBlocked || resultBlocked}
          aria-label={`Acknowledge incident ${incident.incidentId}`}
          onClick={(event) => void requestPreview(event.currentTarget)}
        >{working ? 'Loading…' : 'Acknowledge'}</button>
      ) : (
        <span
          className="pcr-incident-ack-confirm"
          role="group"
          aria-label={`Confirm acknowledgement for incident ${incident.incidentId}`}
        >
          {!compact && <em>{preview.consequence}</em>}
          <button ref={confirmRef} type="button" disabled={working} onClick={() => void submit()}>
            {working ? 'Persisting…' : 'Confirm ACK'}
          </button>
          <button type="button" disabled={working} onClick={cancel}>Cancel</button>
        </span>
      )}
      {durableRecheck}
      {message && <small role={message.startsWith('ACK persisted') ? 'status' : 'alert'}>{message}</small>}
    </span>
  );
}
