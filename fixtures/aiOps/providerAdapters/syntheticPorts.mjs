const freeze = (value) => Object.freeze(value);

export function createSyntheticCallbackDedupPort(options = {}) {
  const replay = new Map();
  const providerEvents = new Map();
  const internalRuns = new Map();
  const callbackIds = new Map();
  const callbackJobIds = new Map();
  const callbackAttemptIds = new Map();
  const jobIds = new Map();
  const attemptIds = new Map();
  let callbackReservations = 0;
  let jobReservations = 0;
  let deliveryAudits = 0;
  let sequence = 0;

  const unavailable = () => freeze({ status: 'UNAVAILABLE', receiptId: null, deliveryAuditReceiptId: null });
  const auditReceipt = () => {
    deliveryAudits += 1;
    sequence += 1;
    return `delivery-audit-test-only-${sequence}`;
  };

  const conflict = (receiptId) => freeze({
    status: 'CONFLICT',
    receiptId: receiptId ?? null,
    deliveryAuditReceiptId: auditReceipt(),
  });

  const duplicate = (receiptId) => freeze({
    status: 'DUPLICATE',
    receiptId,
    deliveryAuditReceiptId: auditReceipt(),
  });

  const reserveAtomic = ({ replayKey, contentDigest, semanticEntries, receiptPrefix }) => {
    if (options.throwError === true) throw new Error('TEST_ONLY_SYNTHETIC_STORE_FAILURE');
    if (options.invalidResult !== undefined) return options.invalidResult;
    if (options.unavailable === true) return unavailable();

    const replayExisting = replay.get(replayKey);
    if (replayExisting !== undefined) {
      if (replayExisting.digest !== contentDigest) return conflict(replayExisting.receiptId);
      return duplicate(replayExisting.receiptId);
    }

    const existing = semanticEntries.map(({ store, key }) => store.get(key));
    const present = existing.filter((row) => row !== undefined);
    if (present.length > 0) {
      const first = present[0];
      const exactDuplicate = present.length === semanticEntries.length
        && present.every((row) => row.digest === contentDigest && row.receiptId === first.receiptId);
      if (!exactDuplicate) return conflict(first.receiptId);
      replay.set(replayKey, { digest: contentDigest, receiptId: first.receiptId });
      return duplicate(first.receiptId);
    }

    sequence += 1;
    const receiptId = `${receiptPrefix}-test-only-${sequence}`;
    const row = { digest: contentDigest, receiptId };
    replay.set(replayKey, row);
    for (const entry of semanticEntries) entry.store.set(entry.key, row);
    return freeze({ status: 'RESERVED', receiptId, deliveryAuditReceiptId: auditReceipt() });
  };

  return freeze({
    schema: 'AI_OPS_CALLBACK_DEDUP_PORT_V1',
    reserveAuthenticatedCallback(input) {
      const result = reserveAtomic({
        replayKey: input.replayKey,
        contentDigest: input.contentDigest,
        semanticEntries: [
          { store: providerEvents, key: input.providerEventId },
          { store: internalRuns, key: input.internalRunId },
          { store: callbackIds, key: input.callbackId },
          { store: callbackJobIds, key: input.jobId },
          { store: callbackAttemptIds, key: input.attemptId },
        ],
        receiptPrefix: 'callback',
      });
      if (result.status === 'RESERVED') callbackReservations += 1;
      return Promise.resolve(result);
    },
    reserveAuthenticatedJob(input) {
      const result = reserveAtomic({
        replayKey: input.replayKey,
        contentDigest: input.contentDigest,
        semanticEntries: [
          { store: jobIds, key: input.jobId },
          { store: attemptIds, key: input.attemptId },
        ],
        receiptPrefix: 'job',
      });
      if (result.status === 'RESERVED') jobReservations += 1;
      return Promise.resolve(result);
    },
    snapshot() {
      return freeze({
        replayReservations: replay.size,
        callbackReservations,
        jobReservations,
        deliveryAudits,
      });
    },
  });
}

export const SYNTHETIC_TEST_KEY = freeze({
  keyId: 'test-only-invalid-callback-key',
  classification: 'TEST_ONLY_SYNTHETIC_INVALID',
  keyBytes: new TextEncoder().encode('TEST_ONLY_INVALID_KEY_MATERIAL_DO_NOT_USE'),
});
